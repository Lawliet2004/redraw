import { useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { generateAi, type AiResult } from "../ai";
import type { SubscriptionConfig } from "../subscriptions";

export default function InlineAssistant({
  api,
  config,
  paperColor,
  mode,
  disabled,
  onSettings,
}: {
  api: ExcalidrawImperativeAPI;
  config: SubscriptionConfig;
  paperColor: string;
  mode: "off" | "assist" | "auto";
  disabled: boolean;
  onSettings: () => void;
}) {
  const [hint, setHint] = useState<{
    text: string;
    x: number;
    y: number;
    busy: boolean;
    error?: boolean;
  } | null>(null);
  const result = useRef<AiResult | null>(null);
  const dismiss = useRef<() => void>(() => {});
  const accept = async () => {
    const current = result.current;
    if (!current) return;
    try {
      await current.apply();
      dismiss.current();
    } catch (e) {
      setHint((h) => (h ? { ...h, text: String(e), error: true } : h));
    }
  };
  useEffect(() => {
    if (mode === "off" || disabled) {
      setHint(null);
      result.current = null;
      return;
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    let controller: AbortController | null = null;
    let signature = "";
    let seen = "";
    let alive = true;
    const clear = () => {
      clearTimeout(timer);
      controller?.abort();
      controller = null;
      result.current = null;
      setHint(null);
    };
    dismiss.current = () => {
      seen = signature;
      clear();
    };
    const change = () => {
      const state = api.getAppState();
      const scene = api.getSceneElements();
      const region = scene.find(
        (el) => !el.isDeleted && el.customData?.redrawAiRegion,
      );
      const sources = scene.filter(
        (el) =>
          !el.isDeleted &&
          !el.customData?.redrawAi &&
          !el.customData?.redrawAiRegion &&
          (region
            ? el.x >= region.x &&
              el.y >= region.y &&
              el.x + el.width <= region.x + region.width &&
              el.y + el.height <= region.y + region.height
            : state.selectedElementIds[el.id]),
      );
      const next = sources.map((el) => `${el.id}:${el.version}`).join("|");
      if (
        state.editingTextElement ||
        state.newElement ||
        state.isResizing ||
        state.isRotating
      ) {
        signature = "";
        clear();
        return;
      }
      if (next === signature) return;
      signature = next;
      clear();
      if (
        !next ||
        next === seen ||
        !sources.some(
          (el) =>
            el.type === "text" || el.type === "freedraw" || el.type === "image",
        )
      )
        return;
      const x = Math.min(...sources.map((el) => el.x)),
        y = Math.max(...sources.map((el) => el.y + el.height));
      const placement = {
        x: Math.max(
          12,
          Math.min(state.width - 300, (x + state.scrollX) * state.zoom.value),
        ),
        y: Math.max(
          140,
          Math.min(
            state.height - 130,
            (y + state.scrollY) * state.zoom.value + 12,
          ),
        ),
      };
      timer = setTimeout(async () => {
        const ac = new AbortController();
        controller = ac;
        seen = next;
        setHint({ ...placement, text: "Thinking…", busy: true });
        try {
          const answer = await generateAi({
            api,
            config,
            paperColor,
            action: "answer",
            instruction: "",
            sourceIds: sources.map((el) => el.id),
            quiet: true,
            signal: ac.signal,
            onStatus: () => {},
            onDelta: (text) => {
              if (alive && !ac.signal.aborted)
                setHint({ ...placement, text, busy: true });
            },
          });
          if (!alive || ac.signal.aborted) return;
          result.current = answer;
          if (mode === "auto") {
            await answer.apply();
            result.current = null;
            setHint(null);
          } else setHint({ ...placement, text: answer.text, busy: false });
        } catch (e) {
          if (alive && !ac.signal.aborted)
            setHint({
              ...placement,
              text: e instanceof Error ? e.message : String(e),
              busy: false,
              error: true,
            });
        }
      }, 650);
    };
    const off = api.onChange(change);
    change();
    return () => {
      alive = false;
      off();
      clearTimeout(timer);
      controller?.abort();
      result.current = null;
    };
  }, [api, config, paperColor, mode, disabled]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        !hint ||
        (e.target as HTMLElement)?.closest(
          "input,textarea,dialog,[contenteditable=true]",
        )
      )
        return;
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        dismiss.current();
      }
      if (e.key === "Tab" && result.current) {
        e.preventDefault();
        e.stopPropagation();
        void accept();
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [hint]);
  if (!hint) return null;
  return (
    <aside
      className="inline-answer workspace-surface"
      style={{ left: hint.x, top: hint.y }}
      aria-label="Inline AI suggestion"
    >
      <div role="status">{hint.text}</div>
      <footer>
        {hint.error ? (
          <button onClick={onSettings}>Connection settings</button>
        ) : (
          !hint.busy && (
            <button className="primary" onClick={() => void accept()}>
              Accept <kbd>Tab</kbd>
            </button>
          )
        )}
        <button onClick={() => dismiss.current()}>
          {hint.busy ? "Stop" : "Dismiss"}
        </button>
      </footer>
    </aside>
  );
}
