import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";

export type TabPage = {
  id: string;
  name: string;
};

type Props = {
  pages: TabPage[];
  activeId: string;
  theme: "light" | "dark";
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onDelete: (id: string) => void;
};

export default function PageTabBar({
  pages,
  activeId,
  theme,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [maximized, setMaximized] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win.isMaximized().then(setMaximized);
    void win.onResized(() => {
      void win.isMaximized().then(setMaximized);
    }).then((fn) => {
      unlisten = fn;
    });
    return () => unlisten?.();
  }, []);

  function startEdit(page: TabPage) {
    setEditingId(page.id);
    setDraft(page.name);
  }

  function commitEdit() {
    if (!editingId) return;
    const name = draft.trim() || "Untitled";
    onRename(editingId, name);
    setEditingId(null);
  }

  const win = () => getCurrentWindow();

  return (
    <div
      className={`titlebar ${theme === "dark" ? "titlebar--dark" : ""}`}
      data-tauri-drag-region
      onDoubleClick={(e) => {
        const t = e.target as HTMLElement;
        if (t.closest(".no-drag")) return;
        void win().toggleMaximize();
      }}
    >
      <div className="titlebar__brand no-drag" title="Redraw">
        <img src="/logo.png" alt="" className="titlebar__logo" draggable={false} />
        <span className="titlebar__name">Redraw</span>
      </div>

      <div className="titlebar__tabs" role="tablist">
        {pages.map((page) => {
          const active = page.id === activeId;
          const canDelete = pages.length > 1;
          return (
            <div
              key={page.id}
              role="tab"
              aria-selected={active}
              className={`page-tab no-drag ${active ? "page-tab--active" : ""}`}
              onClick={() => {
                if (editingId !== page.id) onSelect(page.id);
              }}
              onDoubleClick={(e) => {
                e.stopPropagation();
                startEdit(page);
              }}
            >
              {editingId === page.id ? (
                <input
                  ref={inputRef}
                  className="page-tab__input"
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onBlur={commitEdit}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitEdit();
                    if (e.key === "Escape") setEditingId(null);
                  }}
                  onClick={(e) => e.stopPropagation()}
                />
              ) : (
                <span className="page-tab__label">{page.name}</span>
              )}
              <button
                type="button"
                className="page-tab__close"
                title="Delete page"
                disabled={!canDelete}
                aria-disabled={!canDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canDelete) onDelete(page.id);
                }}
              >
                ×
              </button>
            </div>
          );
        })}
        <button
          type="button"
          className="titlebar__add no-drag"
          title="New page"
          aria-label="New page"
          onClick={onCreate}
        >
          +
        </button>
      </div>

      <div className="titlebar__spacer" data-tauri-drag-region />

      <div className="titlebar__controls no-drag">
        <button
          type="button"
          className="win-btn"
          title="Minimize"
          aria-label="Minimize"
          onClick={() => void win().minimize()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path d="M0 5h10" stroke="currentColor" strokeWidth="1.2" />
          </svg>
        </button>
        <button
          type="button"
          className="win-btn"
          title={maximized ? "Restore" : "Maximize"}
          aria-label={maximized ? "Restore" : "Maximize"}
          onClick={() => void win().toggleMaximize()}
        >
          {maximized ? (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <path
                d="M2.5 3.5h5v5h-5zM3.5 2.5h5v1M8.5 2.5v5h-1"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.1"
              />
            </svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
              <rect
                x="1"
                y="1"
                width="8"
                height="8"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.2"
              />
            </svg>
          )}
        </button>
        <button
          type="button"
          className="win-btn win-btn--close"
          title="Close"
          aria-label="Close"
          onClick={() => void win().close()}
        >
          <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
            <path
              d="M1 1l8 8M9 1L1 9"
              stroke="currentColor"
              strokeWidth="1.2"
            />
          </svg>
        </button>
      </div>
    </div>
  );
}
