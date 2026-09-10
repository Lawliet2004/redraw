import { useState } from "react";
import Dialog from "./Dialog";

export default function QuickSwitcher({
  pages,
  commands,
  onSelect,
  onClose,
}: {
  pages: { id: string; name: string }[];
  commands: { name: string; run: () => void }[];
  onSelect: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);
  const all = [
    ...pages.map((p) => ({
      id: p.id,
      name: p.name,
      kind: "Page",
      run: () => onSelect(p.id),
    })),
    ...commands.map((c, i) => ({ ...c, id: `command-${i}`, kind: "Command" })),
  ];
  const words = query.toLowerCase().trim().split(/\s+/);
  const matches = all
    .filter((item) =>
      words.every((word) => item.name.toLowerCase().includes(word)),
    )
    .slice(0, 30);
  const selected = Math.min(index, Math.max(0, matches.length - 1));
  function choose(i: number) {
    const item = matches[i];
    if (item) {
      onClose();
      item.run();
    }
  }
  return (
    <Dialog title="Quick search" onClose={onClose}>
      <input
        className="quick-input"
        autoFocus
        placeholder="Search pages and commands…"
        aria-label="Search pages and commands"
        role="combobox"
        aria-expanded="true"
        aria-controls="quick-results"
        aria-activedescendant={matches[selected]?.id}
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setIndex(0);
        }}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" || e.key === "ArrowUp") {
            e.preventDefault();
            setIndex(
              (i) =>
                (i + (e.key === "ArrowDown" ? 1 : -1) + matches.length) %
                Math.max(1, matches.length),
            );
          }
          if (e.key === "Enter") {
            e.preventDefault();
            choose(selected);
          }
        }}
      />
      <div id="quick-results" className="quick-results" role="listbox">
        {matches.map((item, i) => (
          <button
            key={item.id}
            id={item.id}
            role="option"
            aria-selected={i === selected}
            onMouseMove={() => setIndex(i)}
            onClick={() => choose(i)}
          >
            <span>{item.name}</span>
            <small>{item.kind}</small>
          </button>
        ))}
        {!matches.length && (
          <p className="muted">No matching pages or commands.</p>
        )}
      </div>
      <p className="muted">↑ ↓ Navigate · Enter Open · Escape Close</p>
    </Dialog>
  );
}
