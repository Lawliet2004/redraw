/**
 * Orchestrates stroke → text conversion: group strokes into lines, render,
 * recognize, correct, then commit styled text elements in one undoable
 * scene transaction.
 */
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { clusterLines, linesToBlocks } from "./strokes";
import { renderLineToImage } from "./render";
import { correctLine } from "./correct";
import { wordConfidences } from "./decode";
import { ensureFontLoaded, resolveFamily } from "./fonts";
import {
  applySpacing,
  decoSignature,
  decoSkeletons,
  DECO_KEY,
  INK_KEY,
  isInkDecoration,
  isInkText,
  stripSpacing,
  styledTextSkeletons,
  textLineGeometry,
  textPlacement,
  type DecoMeta,
  type InkMeta,
} from "./decorate";
import type { InkStroke, InkTextStyle, RecognizedBlock, SmartInkSettings } from "./types";
import type { InkRecognizer } from "./engine";

const excalidraw = () => import("@excalidraw/excalidraw");

/**
 * Group strokes → lines → images → recognized text lines → blocks.
 * Returns null when the strokes produced no text.
 */
export async function recognizeStrokes(
  strokes: InkStroke[],
  recognizer: InkRecognizer,
  settings: SmartInkSettings,
): Promise<RecognizedBlock[]> {
  const lines = clusterLines(strokes);
  if (!lines.length) return [];
  const images = lines.map(renderLineToImage);
  const results = await recognizer.recognize(images);
  const recogLines = lines.map((line, i) => {
    const r = results[i] ?? { text: "", confidence: 0, charConfs: [] };
    const text = correctLine(r.text, wordConfidences(r.text, r.charConfs), {
      spellFix: settings.spellFix,
    });
    return { ...r, text, line };
  });
  return linesToBlocks(lines)
    .map((block) => {
      const blines = block.lines.map((line) => recogLines[lines.indexOf(line)]);
      const text = blines
        .map((l) => l.text)
        .join("\n")
        .replace(/\n{3,}/g, "\n\n")
        .trim();
      const conf = blines.length
        ? blines.reduce((a, l) => a + l.confidence, 0) / blines.length
        : 0;
      return { lines: blines, text, confidence: conf, block };
    })
    .filter((b) => b.text.length > 0);
}

/** Commit recognized blocks to the scene — one undoable updateScene. */
export async function commitBlocks(
  api: ExcalidrawImperativeAPI,
  blocks: RecognizedBlock[],
  style: InkTextStyle,
): Promise<string[]> {
  const { convertToExcalidrawElements, newElementWith } = await excalidraw();
  const strokeIds = new Set(
    blocks.flatMap((b) => b.block.lines.flatMap((l) => l.strokes.map((s) => s.id))),
  );
  const skeletons: ExcalidrawElementSkeleton[] = [];
  await ensureFontLoaded(resolveFamily(style.fontFamily, style.bold, style.italic));
  for (const b of blocks) {
    const { x, y } = textPlacement(b.block, style);
    skeletons.push(...styledTextSkeletons(b.text, style, x, y).skeletons);
  }
  const created = convertToExcalidrawElements(skeletons);
  const kept = api
    .getSceneElementsIncludingDeleted()
    .map((el) => (strokeIds.has(el.id) ? newElementWith(el, { isDeleted: true }) : el));
  api.updateScene({
    elements: [...kept, ...created],
    appState: {
      selectedElementIds: Object.fromEntries(
        created.filter((e) => e.type === "text").map((e) => [e.id, true]),
      ),
      selectedGroupIds: {},
    } as never,
    captureUpdate: "IMMEDIATELY",
  });
  return created.filter((e) => e.type === "text").map((e) => e.id);
}

/** Style currently applied to an ink text element. */
export function styleOfInkText(el: ExcalidrawTextElement): InkTextStyle | null {
  return (el.customData as Record<string, InkMeta> | undefined)?.[INK_KEY]?.style ?? null;
}

function liveDecos(elements: readonly ExcalidrawElement[], parentId: string) {
  return elements.filter(
    (el) =>
      !el.isDeleted &&
      (el.customData as Record<string, DecoMeta> | undefined)?.[DECO_KEY]?.parent ===
        parentId,
  );
}

/** Natural width of a text element's lines at a given style. */
function textWidth(text: string, style: InkTextStyle, family: number): number {
  return Math.max(
    ...textLineGeometry(text, 0, 0, 1e6, style.fontSize, family, style.lineHeight, "left").map(
      (l) => l.w,
    ),
    1,
  );
}

/**
 * Apply a style patch to every selected ink text element — native props on the
 * text element, everything else rebuilt as decorations. Single updateScene.
 */
export async function restyleInkTexts(
  api: ExcalidrawImperativeAPI,
  ids: readonly string[],
  patch: Partial<InkTextStyle>,
): Promise<void> {
  const { convertToExcalidrawElements, newElementWith } = await excalidraw();
  const all = api.getSceneElementsIncludingDeleted();
  const idSet = new Set(ids);
  const targets = all.filter(
    (el) => el.type === "text" && !el.isDeleted && isInkText(el) && idSet.has(el.id),
  );
  if (!targets.length) return;

  const removedIds = new Set<string>();
  const added: ExcalidrawElementSkeleton[] = [];
  const patches = new Map<string, Record<string, unknown>>();

  for (const el of targets) {
    if (el.type !== "text") continue;
    const meta = (el.customData as Record<string, InkMeta>)[INK_KEY];
    const style = { ...meta.style, ...patch };
    const family = resolveFamily(style.fontFamily, style.bold, style.italic);
    await ensureFontLoaded(family);
    const raw = stripSpacing(el.text);
    const spaced = applySpacing(raw, style.letterSpacing);
    for (const d of liveDecos(all, el.id)) removedIds.add(d.id);
    const groupId = el.groupIds[0] ?? crypto.randomUUID();
    const width = textWidth(spaced, style, family);
    const lineGeoms = textLineGeometry(
      spaced, el.x, el.y, width, style.fontSize, family, style.lineHeight, style.align,
    );
    const sig = decoSignature(
      {
        x: el.x, y: el.y, width, height: lineGeoms.length * style.fontSize * style.lineHeight,
        fontSize: style.fontSize, fontFamily: family,
        lineHeight: style.lineHeight as never, textAlign: style.align, angle: el.angle,
      },
      style, raw,
    );
    added.push(...decoSkeletons(el.id, lineGeoms, style, groupId));
    patches.set(el.id, {
      fontSize: style.fontSize,
      fontFamily: family,
      strokeColor: style.color,
      textAlign: style.align,
      lineHeight: style.lineHeight,
      text: spaced,
      originalText: spaced,
      customData: { ...(el.customData ?? {}), [INK_KEY]: { ...meta, style, rawText: raw, decoSig: sig } },
      groupIds: [groupId],
    });
  }
  api.updateScene({
    elements: [
      ...all.map((el) => {
        const p = patches.get(el.id);
        if (p) return newElementWith(el, p as never);
        if (removedIds.has(el.id)) return newElementWith(el, { isDeleted: true });
        return el;
      }),
      ...convertToExcalidrawElements(added),
    ],
    captureUpdate: "IMMEDIATELY",
  });
}

/**
 * Rebuild decorations whose parent text was edited/moved, and delete
 * decorations whose parent text is gone. Called (debounced) from onChange.
 */
export async function syncInkDecorations(api: ExcalidrawImperativeAPI): Promise<void> {
  const all = api.getSceneElementsIncludingDeleted();
  const living = new Set(all.filter((e) => !e.isDeleted).map((e) => e.id));
  const dirty: ExcalidrawTextElement[] = [];
  const removedIds = new Set<string>();
  for (const el of all) {
    if (el.isDeleted) continue;
    if (el.type === "text" && isInkText(el)) {
      const meta = (el.customData as Record<string, InkMeta>)[INK_KEY];
      if (decoSignature(el, meta.style, stripSpacing(el.text)) !== meta.decoSig)
        dirty.push(el);
    } else if (isInkDecoration(el)) {
      const meta = (el.customData as Record<string, DecoMeta>)[DECO_KEY];
      if (!living.has(meta.parent)) removedIds.add(el.id);
    }
  }
  if (!dirty.length && !removedIds.size) return;
  const { convertToExcalidrawElements, newElementWith } = await excalidraw();
  const added: ExcalidrawElementSkeleton[] = [];
  const patches = new Map<string, Record<string, unknown>>();
  for (const el of dirty) {
    if (el.type !== "text") continue;
    const meta = (el.customData as Record<string, InkMeta>)[INK_KEY];
    const style = meta.style;
    const raw = stripSpacing(el.text);
    for (const d of liveDecos(all, el.id)) removedIds.add(d.id);
    const groupId = el.groupIds[0] ?? crypto.randomUUID();
    const width = textWidth(el.text, style, el.fontFamily);
    const geoms = textLineGeometry(
      el.text, el.x, el.y, width, el.fontSize, el.fontFamily, style.lineHeight, style.align,
    );
    added.push(...decoSkeletons(el.id, geoms, style, groupId));
    patches.set(el.id, {
      customData: {
        ...(el.customData ?? {}),
        [INK_KEY]: { ...meta, rawText: raw, decoSig: decoSignature(el, style, raw) },
      },
      groupIds: [groupId],
    });
  }
  api.updateScene({
    elements: [
      ...all.map((el) => {
        const p = patches.get(el.id);
        if (p) return newElementWith(el, p as never);
        if (removedIds.has(el.id)) return newElementWith(el, { isDeleted: true });
        return el;
      }),
      ...convertToExcalidrawElements(added),
    ],
    // derived repairs must not create undo steps — history belongs to
    // user intent (commit/restyle/edit), not decoration bookkeeping
    captureUpdate: "NEVER",
  });
}
