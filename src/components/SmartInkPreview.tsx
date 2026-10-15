/**
 * Editable preview card shown before committing recognized text.
 * Escape keeps the ink, Ctrl+Enter / Convert commits.
 */
import { useEffect, useRef, useState } from "react";
import { cssFamily } from "../smartink/fonts";
import type { InkTextStyle, RecognizedBlock } from "../smartink/types";

export default function SmartInkPreview({
  x,
  y,
  blocks,
  style,
  onCommit,
  onDismiss,
}: {
  x: number;
  y: number;
  blocks: RecognizedBlock[];
  style: InkTextStyle;
  onCommit: (edited: string | null) => void;
  onDismiss: () => void;
}) {
  const original = blocks.map((b) => b.text).join("\n\n");
  const [text, setText] = useState(original);
  const ref = useRef<HTMLTextAreaElement>(null);
  const conf = Math.min(...blocks.map((b) => b.confidence));

  useEffect(() => {
    ref.current?.focus();
    ref.current?.setSelectionRange(text.length, text.length);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onDismiss();
      }
      if ((e.ctrlKey || e.metaKey) && e.key === "Enter") {
        e.preventDefault();
        onCommit(text === original ? null : text);
      }
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [onCommit, onDismiss, text, original]);

  return (
    <aside
      className="ink-preview workspace-surface"
      style={{ left: x, top: y }}
      role="dialog"
      aria-label="Recognized text"
    >
      <header className="ink-preview__head">
        <span>Recognized text</span>
        <span className="ink-conf" title="Mean recognition confidence">
          {Math.round(conf * 100)}%
        </span>
      </header>
      <textarea
        ref={ref}
        value={text}
        onChange={(e) => setText(e.target.value)}
        rows={Math.min(8, text.split("\n").length + 1)}
        style={{ fontFamily: cssFamily(style.fontFamily) }}
        spellCheck={false}
        aria-label="Edit recognized text"
      />
      <footer>
        <button className="primary" onClick={() => onCommit(text === original ? null : text)}>
          Convert <kbd>⌘↵</kbd>
        </button>
        <button onClick={onDismiss}>Keep ink</button>
      </footer>
    </aside>
  );
}
