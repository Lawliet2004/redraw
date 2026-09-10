import { useCallback, useEffect, useRef, useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { generateAi, type AiAction, type AiResult } from "../ai";
import type { SubscriptionConfig } from "../subscriptions";

export default function AiPanel({
  api,
  config,
  paperColor,
  onClose,
  onSettings,
  onApplied,
}: {
  api: ExcalidrawImperativeAPI;
  config: SubscriptionConfig;
  paperColor: string;
  onClose: () => void;
  onSettings: () => void;
  onApplied: () => void;
}) {
  const [action, setAction] = useState<AiAction>("answer");
  const [instruction, setInstruction] = useState("");
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("");
  const [preview, setPreview] = useState("");
  const [result, setResult] = useState<AiResult | null>(null);
  const [error, setError] = useState("");
  const [hasRegion, setHasRegion] = useState(false);
  const [selectionCount, setSelectionCount] = useState(0);
  const controller = useRef<AbortController | null>(null);
  const deltaTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const pendingText = useRef("");
  const lastRequest = useRef(-Infinity);
  const mounted = useRef(true);
  const [elapsed, setElapsed] = useState(0);
  const abort = useCallback(() => {
    controller.current?.abort();
  }, []);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
      abort();
      if (deltaTimer.current) clearTimeout(deltaTimer.current);
    };
  }, [abort]);
  const run = useCallback(async () => {
    if (controller.current) return;
    const ac = new AbortController();
    controller.current = ac;
    lastRequest.current = performance.now();
    setElapsed(0);
    setBusy(true);
    setError("");
    setResult(null);
    setPreview("");
    const tick = setInterval(
      () =>
        setElapsed(
          Math.round((performance.now() - lastRequest.current) / 1000),
        ),
      1000,
    );
    try {
      const response = await generateAi({
        api,
        config,
        paperColor,
        action,
        instruction,
        signal: ac.signal,
        onStatus: (s) => {
          if (mounted.current) setStatus(s);
        },
        onDelta: (full) => {
          pendingText.current = full;
          if (!deltaTimer.current)
            deltaTimer.current = setTimeout(() => {
              deltaTimer.current = null;
              if (mounted.current && !ac.signal.aborted)
                setPreview(pendingText.current);
            }, 50);
        },
      });
      if (!mounted.current || ac.signal.aborted) return;
      setResult(response);
      setPreview(response.text);
      setStatus("Ready to apply");
    } catch (e) {
      if (mounted.current) {
        setResult(null);
        setStatus(ac.signal.aborted ? "Stopped" : "Couldn't generate");
        if (!ac.signal.aborted)
          setError(e instanceof Error ? e.message : "AI request failed.");
      }
    } finally {
      clearInterval(tick);
      if (deltaTimer.current) clearTimeout(deltaTimer.current);
      deltaTimer.current = null;
      if (controller.current === ac) controller.current = null;
      if (mounted.current) setBusy(false);
    }
  }, [api, config, paperColor, action, instruction]);

  useEffect(() => {
    const changed = () => {
      const scene = api.getSceneElements();
      setSelectionCount(
        scene.filter(
          (el) => api.getAppState().selectedElementIds[el.id] && !el.isDeleted,
        ).length,
      );
      setHasRegion(scene.some((el) => el.customData?.redrawAiRegion));
    };
    changed();
    return api.onChange(changed);
  }, [api]);

  return (
    <aside className="ai-panel workspace-surface" aria-label="AI assistant">
      <header className="panel-heading">
        <div>
          <h2>AI assistant</h2>
          <span className="selection-caption">
            {selectionCount
              ? `${selectionCount} selected · ${config.provider === "chatgpt" ? "ChatGPT" : "Grok"}`
              : `Ask anything · ${config.provider === "chatgpt" ? "ChatGPT" : "Grok"}`}
          </span>
        </div>
        <button
          className="icon-button"
          aria-label="Close AI assistant"
          onClick={onClose}
        >
          ×
        </button>
      </header>
      <div className="ai-region-control">
        <button
          className="text-button"
          onClick={async () => {
            try {
              const { newElementWith } = await import("@excalidraw/excalidraw");
              const scene = api.getSceneElementsIncludingDeleted();
              const selected = scene.filter(
                (el) =>
                  !el.isDeleted && api.getAppState().selectedElementIds[el.id],
              );
              if (
                !hasRegion &&
                (selected.length !== 1 ||
                  !["rectangle", "frame"].includes(selected[0].type))
              )
                throw new Error(
                  "Select a rectangle or frame to use as an AI area. Writing inside it becomes the context for inline answers.",
                );
              const id = hasRegion ? null : selected[0].id;
              api.updateScene({
                elements: scene.map((el) =>
                  el.customData?.redrawAiRegion || el.id === id
                    ? newElementWith(el, {
                        customData: {
                          ...el.customData,
                          redrawAiRegion: el.id === id,
                        },
                      })
                    : el,
                ),
                captureUpdate: "IMMEDIATELY",
              });
              setError("");
            } catch (e) {
              setError(e instanceof Error ? e.message : String(e));
            }
          }}
        >
          {hasRegion ? "Clear AI area" : "Use selection as AI area"}
        </button>
        {hasRegion && (
          <small>Inline AI watches writing inside your marked rectangle.</small>
        )}
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void run();
        }}
      >
        <details className="ai-options">
          <summary>
            Response type · {action === "answer" ? "Automatic" : action}
          </summary>
          <select
            aria-label="Response type"
            value={action}
            disabled={busy}
            onChange={(e) => {
              setAction(e.target.value as AiAction);
              setResult(null);
              setPreview("");
            }}
          >
            <option value="answer">Automatic answer</option>
            <option value="explain">Explain</option>
            <option value="rewrite">Rewrite selection</option>
            <option value="diagram">Editable diagram</option>
            <option value="image">Create illustration</option>
          </select>
        </details>
        <textarea
          autoFocus
          aria-label="AI instruction"
          placeholder={
            action === "diagram"
              ? "Describe a flowchart or process…"
              : "Ask a question, solve a problem, or describe an idea…"
          }
          rows={3}
          maxLength={8000}
          value={instruction}
          disabled={busy}
          onChange={(e) => setInstruction(e.target.value)}
          onKeyDown={(e) => {
            if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
              e.preventDefault();
              void run();
            }
          }}
        />
        <div className="ai-submit">
          <button
            type="button"
            className="text-button"
            onClick={onSettings}
            disabled={busy}
          >
            Connection settings
          </button>
          {busy ? (
            <button type="button" onClick={abort}>
              Stop
            </button>
          ) : (
            <button
              className="primary"
              disabled={!selectionCount && !instruction.trim()}
            >
              Generate <span>↵</span>
            </button>
          )}
        </div>
      </form>
      {status && (
        <div className="ai-status" role="status">
          <span className={busy ? "status-dot is-busy" : "status-dot"} />
          {status}
          {busy && <span>{elapsed}s</span>}
        </div>
      )}
      {error && (
        <p className="error-text" role="alert">
          {error}
        </p>
      )}
      {result?.previewImage && (
        <img
          className="illustration-preview"
          src={result.previewImage}
          alt="Generated illustration preview"
        />
      )}
      {preview && (
        <div className="ai-preview" aria-label="AI preview">
          {(action === "diagram" || action === "image") && busy
            ? "Creating your visual…"
            : preview}
        </div>
      )}
      {result && (
        <footer className="dialog-actions">
          <button
            onClick={() => {
              setResult(null);
              setPreview("");
              setStatus("");
            }}
          >
            Discard
          </button>
          <button onClick={() => void run()}>Retry</button>
          <button
            className="primary"
            onClick={async () => {
              try {
                await result.apply();
                setResult(null);
                setPreview("");
                setStatus("Applied · undo on the canvas to restore");
                onApplied();
              } catch (e) {
                setError(
                  e instanceof Error ? e.message : "Couldn't apply result.",
                );
              }
            }}
          >
            Apply to canvas
          </button>
        </footer>
      )}
      {!status && (
        <p className="muted">
          Preview first. Apply when it looks right. Your canvas stays editable
          while AI works.
        </p>
      )}
    </aside>
  );
}
