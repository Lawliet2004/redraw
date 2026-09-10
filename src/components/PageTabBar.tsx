import { useEffect, useRef, useState } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTouchUi } from "../platform";
import logoUrl from "../assets/logo.png";

export type TabPage = {
  id: string;
  name: string;
};

type Props = {
  pages: TabPage[];
  activeId: string;
  theme: "light" | "dark";
  vertical?: boolean;
  onPages: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => void;
  onClosePage: (id: string) => void;
};

export default function PageTabBar({
  pages,
  activeId,
  theme,
  vertical = false,
  onPages,
  onSelect,
  onCreate,
  onRename,
  onClosePage,
}: Props) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState("");
  const [maximized, setMaximized] = useState(false);
  const [touch, setTouch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dark = theme === "dark";

  useEffect(() => {
    setTouch(isTouchUi());
  }, []);

  useEffect(() => {
    if (editingId && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editingId]);

  useEffect(() => {
    if (touch) return;
    if (!("__TAURI_INTERNALS__" in window)) return;
    const win = getCurrentWindow();
    let unlisten: (() => void) | undefined;
    void win
      .isMaximized()
      .then(setMaximized)
      .catch(() => {});
    void win
      .onResized(() => {
        void win
          .isMaximized()
          .then(setMaximized)
          .catch(() => {});
      })
      .then((fn) => {
        unlisten = fn;
      })
      .catch(() => {});
    return () => unlisten?.();
  }, [touch]);

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

  function clearLongPress() {
    if (longPressRef.current) {
      clearTimeout(longPressRef.current);
      longPressRef.current = null;
    }
  }

  const win = () => getCurrentWindow();

  return (
    <div
      className={`titlebar ${vertical ? "titlebar--vertical" : ""} ${dark ? "titlebar--dark" : ""} ${touch ? "titlebar--touch" : ""}`}
      {...(!touch ? { "data-tauri-drag-region": true } : {})}
      onDoubleClick={(e) => {
        if (touch) return;
        const t = e.target as HTMLElement;
        if (t.closest(".no-drag")) return;
        void win()
          .toggleMaximize()
          .catch(() => {});
      }}
    >
      <div className="titlebar__brand no-drag" title="Redraw">
        <span className="titlebar__logo-wrap">
          <img
            src={logoUrl}
            alt="Redraw"
            className="titlebar__logo"
            draggable={false}
          />
        </span>
        {!touch && <span className="titlebar__name">Redraw</span>}
      </div>

      <button
        className="icon-button no-drag all-pages-button"
        title="All pages"
        aria-label="All pages"
        onClick={onPages}
      >
        ▤
      </button>
      <div className="titlebar__tabs" role="tablist" aria-label="Open pages">
        {pages.map((page) => {
          const active = page.id === activeId;
          const canDelete = pages.length > 1;
          return (
            <div
              key={page.id}
              role="tab"
              aria-selected={active}
              tabIndex={active ? 0 : -1}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return;
                const index = pages.findIndex((p) => p.id === page.id);
                const next =
                  e.key === "ArrowRight"
                    ? (index + 1) % pages.length
                    : e.key === "ArrowLeft"
                      ? (index - 1 + pages.length) % pages.length
                      : e.key === "Home"
                        ? 0
                        : e.key === "End"
                          ? pages.length - 1
                          : -1;
                if (next >= 0) {
                  e.preventDefault();
                  onSelect(pages[next].id);
                  e.currentTarget.parentElement
                    ?.querySelectorAll<HTMLElement>('[role="tab"]')
                    [next]?.focus();
                }
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onSelect(page.id);
                }
              }}
              className={`page-tab no-drag ${active ? "page-tab--active" : ""}`}
              onClick={() => {
                if (editingId !== page.id) onSelect(page.id);
              }}
              onDoubleClick={(e) => {
                if (touch) return;
                e.stopPropagation();
                startEdit(page);
              }}
              onContextMenu={(e) => {
                if (!touch) return;
                e.preventDefault();
                startEdit(page);
              }}
              onTouchStart={() => {
                if (!touch) return;
                clearLongPress();
                longPressRef.current = setTimeout(() => {
                  longPressRef.current = null;
                  startEdit(page);
                }, 500);
              }}
              onTouchEnd={clearLongPress}
              onTouchMove={clearLongPress}
              onTouchCancel={clearLongPress}
            >
              <img
                src={logoUrl}
                alt=""
                className="page-tab__icon"
                draggable={false}
              />
              {editingId === page.id ? (
                <input
                  ref={inputRef}
                  className="page-tab__input"
                  value={draft}
                  enterKeyHint="done"
                  autoCapitalize="sentences"
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
                title="Close tab"
                aria-label={`Close ${page.name}`}
                disabled={!canDelete}
                aria-disabled={!canDelete}
                onClick={(e) => {
                  e.stopPropagation();
                  if (canDelete) onClosePage(page.id);
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

      <div
        className="titlebar__spacer"
        {...(!touch ? { "data-tauri-drag-region": true } : {})}
      />

      {!touch && (
        <div className="titlebar__controls no-drag">
          <button
            type="button"
            className="win-btn"
            title="Minimize"
            aria-label="Minimize"
            onClick={() =>
              void win()
                .minimize()
                .catch(() => {})
            }
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
            onClick={() =>
              void win()
                .toggleMaximize()
                .catch(() => {})
            }
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
            onClick={() =>
              void win()
                .close()
                .catch(() => {})
            }
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
      )}
    </div>
  );
}
