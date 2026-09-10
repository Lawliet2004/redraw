import { useEffect, useState } from "react";
import type { PageMeta } from "../db";
import type { Preferences } from "../preferences";

type Props = {
  pages: PageMeta[];
  pinnedIds?: string[];
  onPin?: (id: string) => void;
  onMove?: (id: string, direction: number) => void;
  onReorder?: (from: string, to: string) => void;
  activeId: string;
  closedIds: string[];
  onSelect: (id: string) => void;
  onCreate: () => void;
  onClosePage: (id: string) => void;
  onDelete: (id: string) => void;
  onRename: (id: string, name: string) => Promise<void>;
};

export function PageList({
  pages,
  pinnedIds = [],
  onPin,
  onMove,
  onReorder,
  activeId,
  closedIds,
  onSelect,
  onCreate,
  onClosePage,
  onDelete,
  onRename,
}: Props) {
  const [query, setQuery] = useState("");
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState("");
  const [error, setError] = useState("");
  const visible = [...pages]
    .sort(
      (a, b) =>
        Number(pinnedIds.includes(b.id)) - Number(pinnedIds.includes(a.id)),
    )
    .filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));
  return (
    <>
      <div className="panel-heading">
        <h2>
          Pages <span className="count">{pages.length}</span>
        </h2>
        <button
          className="icon-button"
          onClick={onCreate}
          aria-label="New page"
        >
          +
        </button>
      </div>
      <input
        className="page-search"
        aria-label="Find a page"
        placeholder="Find a page…"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
      />
      <div className="page-list">
        {visible.map((page) => (
          <div
            key={page.id}
            draggable={editing !== page.id && !!onReorder}
            onDragStart={(e) =>
              e.dataTransfer.setData("text/redraw-page", page.id)
            }
            onDragOver={(e) => {
              if (e.dataTransfer.types.includes("text/redraw-page"))
                e.preventDefault();
            }}
            onDrop={(e) => {
              e.preventDefault();
              onReorder?.(e.dataTransfer.getData("text/redraw-page"), page.id);
            }}
            className={`page-row ${activeId === page.id ? "is-active" : ""}`}
          >
            {editing === page.id ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  try {
                    await onRename(page.id, draft.trim() || "Untitled");
                    setEditing("");
                  } catch {
                    setError("Couldn't rename page.");
                  }
                }}
              >
                <input
                  aria-label="Page name"
                  autoFocus
                  value={draft}
                  onChange={(e) => setDraft(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Escape") setEditing("");
                  }}
                />
                <button type="submit" aria-label="Save page name">
                  ✓
                </button>
              </form>
            ) : (
              <>
                <button
                  className="page-select"
                  aria-current={activeId === page.id ? "page" : undefined}
                  onClick={() => onSelect(page.id)}
                  title={page.name}
                >
                  <span className="page-glyph">
                    {pinnedIds.includes(page.id) ? "◆" : "▤"}
                  </span>
                  <span>
                    {page.name}
                    <small>
                      {closedIds.includes(page.id)
                        ? "Closed · click to reopen"
                        : activeId === page.id
                          ? "Current page"
                          : ""}
                    </small>
                  </span>
                </button>
                <details className="page-actions">
                  <summary aria-label={`Actions for ${page.name}`}>⋯</summary>
                  <div>
                    {onPin && (
                      <button onClick={() => onPin(page.id)}>
                        {pinnedIds.includes(page.id) ? "Unpin tab" : "Pin tab"}
                      </button>
                    )}
                    {onMove && (
                      <>
                        <button
                          disabled={pages[0]?.id === page.id}
                          onClick={() => onMove(page.id, -1)}
                        >
                          Move up
                        </button>
                        <button
                          disabled={pages[pages.length - 1]?.id === page.id}
                          onClick={() => onMove(page.id, 1)}
                        >
                          Move down
                        </button>
                      </>
                    )}
                    <button
                      onClick={() => {
                        setEditing(page.id);
                        setDraft(page.name);
                      }}
                    >
                      Rename
                    </button>
                    {!closedIds.includes(page.id) && (
                      <button onClick={() => onClosePage(page.id)}>
                        Close tab
                      </button>
                    )}
                    <button
                      className="danger"
                      disabled={pages.length <= 1}
                      onClick={() => onDelete(page.id)}
                    >
                      Delete page…
                    </button>
                  </div>
                </details>
              </>
            )}
          </div>
        ))}
        {!visible.length && <p className="muted">No matching pages.</p>}
      </div>
      {error && (
        <p role="alert" className="error-text">
          {error}
        </p>
      )}
    </>
  );
}

export default function PagesPanel(
  props: Props & {
    preferences: Preferences;
    onPreferences: (p: Partial<Preferences>) => void;
  },
) {
  const { preferences: p, onPreferences } = props;
  const [narrow, setNarrow] = useState(
    () => window.matchMedia("(max-width: 720px)").matches,
  );
  const [mobileExpanded, setMobileExpanded] = useState(false);
  useEffect(() => {
    const media = window.matchMedia("(max-width: 720px)");
    const changed = () => {
      setNarrow(media.matches);
      setMobileExpanded(false);
    };
    media.addEventListener("change", changed);
    return () => media.removeEventListener("change", changed);
  }, []);
  const collapsed = narrow ? !mobileExpanded : p.sidebarCollapsed;
  const toggle = () => {
    if (narrow) setMobileExpanded((v) => !v);
    else onPreferences({ sidebarCollapsed: !p.sidebarCollapsed });
  };
  return (
    <aside
      className={`pages-panel ${collapsed ? "is-collapsed" : narrow ? "is-overlay" : ""}`}
      style={{ width: collapsed ? 48 : p.sidebarWidth }}
      aria-label="Page sidebar"
    >
      <button
        className="sidebar-collapse icon-button"
        aria-label={collapsed ? "Expand pages" : "Collapse pages"}
        onClick={toggle}
      >
        {collapsed ? "»" : "«"}
      </button>
      {collapsed ? (
        <div className="page-rail">
          {props.pages
            .filter((page) => !props.closedIds.includes(page.id))
            .map((page, i) => (
              <button
                key={page.id}
                title={page.name}
                aria-label={page.name}
                aria-current={page.id === props.activeId ? "page" : undefined}
                onClick={() => props.onSelect(page.id)}
              >
                {i + 1}
              </button>
            ))}
          <button onClick={props.onCreate} aria-label="New page">
            +
          </button>
        </div>
      ) : (
        <PageList {...props} />
      )}
      {!collapsed && !narrow && (
        <div
          className="sidebar-resizer"
          role="separator"
          tabIndex={0}
          aria-label="Page sidebar width"
          aria-orientation="vertical"
          aria-valuemin={200}
          aria-valuemax={360}
          aria-valuenow={p.sidebarWidth}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              onPreferences({
                sidebarWidth: Math.min(
                  360,
                  Math.max(
                    200,
                    p.sidebarWidth + (e.key === "ArrowRight" ? 16 : -16),
                  ),
                ),
              });
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              onPreferences({
                sidebarWidth: Math.min(360, Math.max(200, e.clientX)),
              });
          }}
        />
      )}
    </aside>
  );
}
