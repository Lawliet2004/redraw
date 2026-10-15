/**
 * Build and maintain styled text elements produced from handwriting.
 *
 * Representation: a real Excalidraw `text` element (native editing, export,
 * zoom, undo) plus companion decoration elements in the same group —
 * per-line `line` elements for underline/strikethrough and per-line
 * `rectangle` elements for highlight. These are real scene elements, so they
 * persist, export, and transform exactly like everything else.
 *
 * The text element carries `customData.redrawInk = {v, rawText, style, decoSig}`;
 * decorations carry `customData.inkDeco = {parent, role, line}`.
 */
import type {
  ExcalidrawElement,
  ExcalidrawTextElement,
} from "@excalidraw/excalidraw/element/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { measureLine, resolveFamily } from "./fonts";
import type { InkBlock, InkTextStyle } from "./types";

export const INK_KEY = "redrawInk";
export const DECO_KEY = "inkDeco";

export type InkMeta = {
  v: 1;
  rawText: string;
  style: InkTextStyle;
  /** signature of geometry the decorations were built for */
  decoSig: string;
};

export type DecoMeta = { parent: string; role: "underline" | "strike" | "highlight"; line: number };

/**
 * Boolean check (not a type guard — Ordered element unions can't be narrowed
 * by predicates). Pair with `el.type === "text"` for narrowing.
 */
export function isInkText(el: ExcalidrawElement): boolean {
  return el.type === "text" && !!(el.customData as Record<string, unknown> | undefined)?.[INK_KEY];
}

export function isInkDecoration(el: ExcalidrawElement): boolean {
  return !!(el.customData as Record<string, unknown> | undefined)?.[DECO_KEY];
}

const SPACING_CHARS = /[\u2009\u200A\u2006\u2004\u2008\u2007\u200B\uFEFF]/g;

/** Remove inserted tracking spaces to recover the raw text (idempotent). */
export function stripSpacing(text: string): string {
  return text.replace(SPACING_CHARS, "");
}

/** Insert tracking spaces for positive letter-spacing (em). */
export function applySpacing(text: string, em: number): string {
  if (em <= 0.04) return stripSpacing(text);
  const ch = em <= 0.12 ? "\u200A" : em <= 0.22 ? "\u2009" : em <= 0.33 ? "\u2006" : "\u2004";
  return text
    .split("\n")
    .map((line) => [...line.replace(SPACING_CHARS, "")].join(ch))
    .join("\n");
}

const round = (n: number) => Math.round(n * 100) / 100;

type LineGeom = { text: string; x: number; y: number; w: number; h: number };

/**
 * Compute per-line geometry for a text element (or proposed style+text).
 * Line boxes follow Excalidraw: each line occupies lineHeightPx; glyphs are
 * vertically centered within it.
 */
export function textLineGeometry(
  text: string,
  x: number,
  y: number,
  width: number,
  fontSize: number,
  fontFamily: number,
  lineHeight: number,
  align: "left" | "center" | "right",
): LineGeom[] {
  const lhPx = fontSize * lineHeight;
  return text.split("\n").map((line, i) => {
    const w = line ? measureLine(line, fontFamily, fontSize) : 0;
    const lx = align === "center" ? x + (width - w) / 2 : align === "right" ? x + width - w : x;
    return { text: line, x: lx, y: y + i * lhPx, w, h: lhPx };
  });
}

/** Geometry signature used to detect when decorations need rebuilding. */
export function decoSignature(
  el: Pick<ExcalidrawTextElement, "x" | "y" | "width" | "height" | "fontSize" | "fontFamily" | "lineHeight" | "textAlign" | "angle">,
  style: InkTextStyle,
  text: string,
): string {
  return JSON.stringify([
    round(el.x), round(el.y), round(el.width), round(el.height),
    el.fontSize, el.fontFamily, el.lineHeight, el.textAlign, round(el.angle),
    style.underline, style.strikethrough, style.highlight, text,
  ]);
}

/** Decoration skeletons for a text element — highlights + line marks. */
export function decoSkeletons(
  parentId: string,
  lines: LineGeom[],
  style: InkTextStyle,
  groupId: string,
): ExcalidrawElementSkeleton[] {
  const out: ExcalidrawElementSkeleton[] = [];
  const pad = Math.max(1, style.fontSize * 0.05);
  lines.forEach((l, i) => {
    if (style.highlight && l.w > 0) {
      out.push({
        type: "rectangle",
        id: crypto.randomUUID(),
        x: round(l.x - pad),
        y: round(l.y + l.h * 0.06),
        width: round(l.w + pad * 2),
        height: round(l.h * 0.88),
        angle: 0,
        strokeColor: "transparent",
        strokeWidth: 0,
        backgroundColor: style.highlight,
        fillStyle: "solid",
        roughness: 0,
        opacity: 42,
        groupIds: [groupId],
        roundness: { type: 3 },
        customData: { [DECO_KEY]: { parent: parentId, role: "highlight", line: i } },
      } as ExcalidrawElementSkeleton);
    }
    const decoW = Math.max(1.5, style.fontSize / 16);
    if (style.underline && l.w > 0) {
      out.push({
        type: "line",
        id: crypto.randomUUID(),
        x: round(l.x),
        y: round(l.y + l.h - l.h * 0.08 + decoW),
        points: [[0, 0], [round(l.w), 0]],
        strokeColor: style.color,
        strokeWidth: decoW,
        strokeStyle: "solid",
        roughness: 0,
        backgroundColor: "transparent",
        groupIds: [groupId],
        customData: { [DECO_KEY]: { parent: parentId, role: "underline", line: i } },
      } as ExcalidrawElementSkeleton);
    }
    if (style.strikethrough && l.w > 0) {
      out.push({
        type: "line",
        id: crypto.randomUUID(),
        x: round(l.x),
        y: round(l.y + l.h * 0.5 + style.fontSize * 0.04),
        points: [[0, 0], [round(l.w), 0]],
        strokeColor: style.color,
        strokeWidth: decoW,
        strokeStyle: "solid",
        roughness: 0,
        backgroundColor: "transparent",
        groupIds: [groupId],
        customData: { [DECO_KEY]: { parent: parentId, role: "strike", line: i } },
      } as ExcalidrawElementSkeleton);
    }
  });
  return out;
}

/**
 * Skeletons for a converted block: highlight rects first (z-bottom), the text
 * element, then line decorations (z-top).
 */
export function styledTextSkeletons(
  text: string,
  style: InkTextStyle,
  x: number,
  y: number,
): { textId: string; skeletons: ExcalidrawElementSkeleton[] } {
  const family = resolveFamily(style.fontFamily, style.bold, style.italic);
  const spaced = applySpacing(text, style.letterSpacing);
  const groupId = crypto.randomUUID();
  const textId = crypto.randomUUID();
  const rawText = text;
  // Excalidraw measures width itself (autoResize); line geometry for
  // decorations uses measured widths.
  const approx = textLineGeometry(spaced, x, y, 10_000, style.fontSize, family, style.lineHeight, "left");
  const maxW = Math.max(...approx.map((l) => l.w), 1);
  const lineGeoms = textLineGeometry(spaced, x, y, maxW, style.fontSize, family, style.lineHeight, style.align);
  const sig = decoSignature(
    {
      x, y,
      width: maxW,
      height: lineGeoms.length * style.fontSize * style.lineHeight,
      fontSize: style.fontSize,
      fontFamily: family,
      lineHeight: style.lineHeight as never,
      textAlign: style.align,
      angle: 0,
    },
    style,
    text,
  );
  const meta: InkMeta = { v: 1, rawText, style, decoSig: sig };
  const textSkel: ExcalidrawElementSkeleton = {
    type: "text",
    id: textId,
    x,
    y,
    text: spaced,
    fontSize: style.fontSize,
    fontFamily: family,
    strokeColor: style.color,
    textAlign: style.align,
    lineHeight: style.lineHeight as never,
    autoResize: true,
    opacity: 100,
    roughness: 0,
    groupIds: [groupId],
    customData: { [INK_KEY]: meta },
  } as ExcalidrawElementSkeleton;
  const decos = decoSkeletons(textId, lineGeoms, style, groupId);
  const highlights = decos.filter(
    (d) => (d.customData as Record<string, DecoMeta>)?.[DECO_KEY]?.role === "highlight",
  );
  const strokes = decos.filter(
    (d) => (d.customData as Record<string, DecoMeta>)?.[DECO_KEY]?.role !== "highlight",
  );
  return { textId, skeletons: [...highlights, textSkel, ...strokes] };
}

/** Vertical offset so converted text lands where the ink was. */
export function textPlacement(block: InkBlock, style: InkTextStyle): { x: number; y: number } {
  const lhPx = style.fontSize * style.lineHeight;
  // glyph cap height starts ~15% below the line top — nudge up so text
  // visually replaces the ink
  return {
    x: block.minX,
    y: block.minY - (lhPx - style.fontSize) * 0.5 - style.fontSize * 0.1,
  };
}
