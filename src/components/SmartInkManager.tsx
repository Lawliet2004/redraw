/**
 * SmartInkManager — mounts beside the canvas, watches freedraw strokes while
 * Smart Ink is enabled, and drives recognition + conversion.
 *
 * Modes:
 *  - auto:    pause → recognize → commit when confidence ≥ threshold,
 *             otherwise show the editable preview card.
 *  - preview: pause → recognize → always show the preview card.
 *  - manual:  no timers; "Convert" applies to the current selection.
 *
 * Only strokes drawn *after* the manager mounts (page lifetime) enter the
 * pending set, and converted/rejected ids are remembered so undoing a
 * conversion never re-triggers recognition.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { AppState, ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { InkRecognizer, type InkEngineStatus } from "../smartink/engine";
import {
  collectStrokes,
  isInkStrokeElement,
} from "../smartink/strokes";
import {
  commitBlocks,
  recognizeStrokes,
  restyleInkTexts,
  styleOfInkText,
  syncInkDecorations,
} from "../smartink/convert";
import { registerInkFonts, preloadSceneFonts } from "../smartink/fonts";
import type { InkStroke, InkTextStyle, RecognizedBlock, SmartInkSettings } from "../smartink/types";
import SmartInkBar from "./SmartInkBar";
import SmartInkPreview from "./SmartInkPreview";

let recognizer: InkRecognizer | null = null;
function getRecognizer(): InkRecognizer {
  if (!recognizer) recognizer = new InkRecognizer();
  return recognizer;
}

type Pending = { strokes: InkStroke[] };

type Preview = {
  blocks: RecognizedBlock[];
  /** screen position for the card */
  x: number;
  y: number;
  /** source stroke ids to delete on commit */
  strokeIds: string[];
};

export default function SmartInkManager({
  api,
  settings,
  onChangeSettings,
  disabled,
}: {
  api: ExcalidrawImperativeAPI;
  settings: SmartInkSettings;
  onChangeSettings: (patch: Partial<SmartInkSettings>) => void;
  disabled: boolean;
}) {
  const [engineStatus, setEngineStatus] = useState<InkEngineStatus>("idle");
  const [engineDetail, setEngineDetail] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [inkCount, setInkCount] = useState(0);
  const [selHasInk, setSelHasInk] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const known = useRef(new Set<string>());
  const pending = useRef(new Set<string>());
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);
  const enabled = settings.enabled && !disabled;
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;
  const settingsRef = useRef(settings);
  settingsRef.current = settings;
  const previewRef = useRef(preview);
  previewRef.current = preview;

  useEffect(() => {
    registerInkFonts();
    const r = getRecognizer();
    r.onStatus = (s, d) => {
      setEngineStatus(s);
      setEngineDetail(d ?? "");
    };
    setEngineStatus(r.status);
    setEngineDetail(r.statusDetail);
    return () => {
      r.onStatus = () => {};
    };
  }, []);

  // snapshot existing stroke ids on mount / page switch, and make sure the
  // woff2 faces used by previously converted ink texts are loaded
  useEffect(() => {
    const els = api.getSceneElementsIncludingDeleted();
    known.current = new Set(
      els.filter((el) => el.type === "freedraw").map((el) => el.id),
    );
    void preloadSceneFonts(
      els.filter((el) => el.type === "text").map((el) => el.fontFamily),
    ).catch(() => {});
    pending.current.clear();
    setInkCount(0);
    setPreview(null);
  }, [api]);

  // enabling Smart Ink switches to the pen so strokes land as freedraw
  useEffect(() => {
    if (enabled) api.setActiveTool({ type: "freedraw" });
  }, [enabled, api]);

  const clearTimer = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  }, []);

  useEffect(() => {
    alive.current = true; // StrictMode remounts effects — flag must reset here
    return () => {
      alive.current = false;
      clearTimer();
      if (decoTimerRef.current) clearTimeout(decoTimerRef.current);
      getRecognizer().cancelActive();
    };
  }, [clearTimer]);

  const currentPending = useCallback((): Pending | null => {
    const els = api.getSceneElements();
    const byId = new Map(els.map((e) => [e.id, e]));
    const strokes: InkStroke[] = [];
    for (const id of pending.current) {
      const el = byId.get(id);
      if (el && isInkStrokeElement(el)) strokes.push(collectStrokes([el])[0]);
    }
    return strokes.length ? { strokes } : null;
  }, [api]);

  const screenPos = useCallback(
    (block: { minX: number; maxY: number }) => {
      const st = api.getAppState();
      return {
        x: Math.max(12, Math.min(st.width - 330, (block.minX + st.scrollX) * st.zoom.value)),
        y: Math.max(150, Math.min(st.height - 60, (block.maxY + st.scrollY) * st.zoom.value + 16)),
      };
    },
    [api],
  );

  const runRecognize = useCallback(
    async (strokes: InkStroke[], auto: boolean) => {
      const s = settingsRef.current;
      if (!strokes.length || !alive.current) return;
      setBusy(true);
      setError("");
      try {
        const blocks = await recognizeStrokes(strokes, getRecognizer(), s);
        if (!alive.current) return;
        if (!blocks.length) {
          setError("Nothing readable — try writing more clearly.");
          return;
        }
        const strokeIdsOf = (bs: RecognizedBlock[]) =>
          bs.flatMap((b) => b.block.lines.flatMap((l) => l.strokes.map((st) => st.id)));
        // auto mode commits each confident block immediately; only the
        // genuinely uncertain remainder asks via the preview card
        const show = auto && s.mode === "auto"
          ? blocks.filter((b) => b.confidence < s.confidence)
          : blocks;
        const sure = blocks.filter((b) => !show.includes(b));
        if (sure.length) {
          for (const id of strokeIdsOf(sure)) pending.current.delete(id);
          await commitBlocks(api, sure, s.style);
          setInkCount(pending.current.size);
        }
        if (!show.length) return;
        const union = {
          minX: Math.min(...show.map((b) => b.block.minX)),
          maxY: Math.max(...show.map((b) => b.block.maxY)),
        };
        const pos = screenPos(union);
        setPreview({ blocks: show, x: pos.x, y: pos.y, strokeIds: strokeIdsOf(show) });
      } catch (e) {
        if (!alive.current) return;
        const m = e instanceof Error ? e.message : String(e);
        if (m !== "cancelled" && m !== "superseded") setError(m);
      } finally {
        if (alive.current) setBusy(false);
      }
    },
    [api, screenPos],
  );

  /** Auto/preview trigger: after the pause, recognize every pending stroke —
   *  lines/blocks preserve layout, so distant groups still land correctly. */
  const scheduleAuto = useCallback(() => {
    clearTimer();
    const s = settingsRef.current;
    if (!enabledRef.current || s.mode === "manual") return;
    timer.current = setTimeout(() => {
      const p = currentPending();
      if (!p || previewRef.current) return;
      void runRecognize(p.strokes, true);
    }, s.delayMs);
  }, [clearTimer, currentPending, runRecognize]);

  /** Manual convert: recognize every freedraw stroke in the selection. */
  const convertSelection = useCallback(async () => {
    const st = api.getAppState();
    const selected = api
      .getSceneElements()
      .filter((el) => st.selectedElementIds[el.id] && isInkStrokeElement(el));
    const strokes = collectStrokes(selected);
    if (!strokes.length) return;
    await runRecognize(strokes, false);
  }, [api, runRecognize]);

  const commitPreview = useCallback(
    async (editedText: string | null) => {
      const p = preview;
      setPreview(null);
      if (!p) return;
      for (const id of p.strokeIds) pending.current.delete(id);
      let blocks = p.blocks;
      if (editedText !== null) {
        // user corrected the text — commit as one element at union bounds,
        // keeping every source line so all ink strokes get removed
        const allInkLines = blocks.flatMap((b) => b.block.lines);
        blocks = [
          {
            lines: blocks.flatMap((b) => b.lines),
            text: editedText,
            confidence: 1,
            block: {
              lines: allInkLines,
              minX: Math.min(...blocks.map((b) => b.block.minX)),
              minY: Math.min(...blocks.map((b) => b.block.minY)),
              maxX: Math.max(...blocks.map((b) => b.block.maxX)),
              maxY: Math.max(...blocks.map((b) => b.block.maxY)),
            },
          },
        ];
      }
      try {
        await commitBlocks(api, blocks, settingsRef.current.style);
        setInkCount(0);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    },
    [api, preview],
  );

  const dismissPreview = useCallback(() => {
    // rejected strokes leave the pending set so they never re-recognize
    for (const id of preview?.strokeIds ?? []) pending.current.delete(id);
    setPreview(null);
  }, [preview]);

  const decoTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const decoTimer = useCallback(() => {
    if (decoTimerRef.current) clearTimeout(decoTimerRef.current);
    decoTimerRef.current = setTimeout(() => {
      void syncInkDecorations(api).catch(() => {});
    }, 400);
  }, [api]);

  const [selInkStyle, setSelInkStyle] = useState<InkTextStyle | null>(null);

  useEffect(() => {
    const off = api.onChange((elements, state) => {
      if (!enabledRef.current) return;
      // track new freedraw strokes
      let added = false;
      for (const el of elements) {
        if (el.type === "freedraw" && !el.isDeleted && !known.current.has(el.id)) {
          known.current.add(el.id);
          pending.current.add(el.id);
          added = true;
        }
      }
      if (added) setInkCount(pending.current.size);
      const selected = elements.filter(
        (el) => !el.isDeleted && state.selectedElementIds[el.id],
      );
      setSelHasInk(selected.some(isInkStrokeElement));
      const selText = selected.find((e) => e.type === "text");
      setSelInkStyle(
        selText?.type === "text" ? styleOfInkText(selText) : null,
      );
      // don't trigger while drawing or editing
      if (
        state.newElement ||
        state.editingTextElement ||
        state.isResizing ||
        state.isRotating
      ) {
        clearTimer();
        return;
      }
      // re-arm the pause timer whenever pending ink exists and the canvas is
      // idle — stroke ids register while newElement is still set, so scheduling
      // must happen on quiet events, not only on add
      if (pending.current.size) scheduleAuto();
      // lazily repair decorations when ink text is edited/moved
      decoTimer();
    });
    return off;
  }, [api, scheduleAuto, clearTimer, decoTimer]);

  // Ctrl+Shift+T converts the current ink selection (any mode)
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        enabledRef.current &&
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.code === "KeyT"
      ) {
        e.preventDefault();
        void convertSelection();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [convertSelection]);

  const applyStyleToSelection = useCallback(
    async (patch: Partial<InkTextStyle>) => {
      const st: AppState = api.getAppState();
      const ids = api
        .getSceneElements()
        .filter((el) => st.selectedElementIds[el.id] && !el.isDeleted)
        .map((el) => el.id);
      // style applies to ink texts in the selection; also becomes the new default
      onChangeSettings({
        style: { ...settingsRef.current.style, ...patch },
      });
      if (ids.length) await restyleInkTexts(api, ids, patch).catch(() => {});
    },
    [api, onChangeSettings],
  );

  if (!enabled) return null;
  return (
    <>
      <SmartInkBar
        settings={settings}
        onChangeSettings={onChangeSettings}
        engineStatus={engineStatus}
        engineDetail={engineDetail}
        inkCount={inkCount}
        canConvert={selHasInk}
        busy={busy}
        error={error}
        onConvert={() => void convertSelection()}
        onApplyStyle={(patch) => void applyStyleToSelection(patch)}
        activeStyle={selInkStyle ?? settings.style}
      />
      {preview && (
        <SmartInkPreview
          x={preview.x}
          y={preview.y}
          blocks={preview.blocks}
          style={settings.style}
          onCommit={commitPreview}
          onDismiss={dismissPreview}
        />
      )}
    </>
  );
}
