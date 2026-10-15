/**
 * SideRail — the app's single left-side control column. Collapses to an icon
 * strip (or slides over the canvas on phone) so the drawing area gets maximum
 * room. Hosts brand/window chrome, page navigation and workspace tools.
 */
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../platform";
import logoUrl from "../assets/logo.png";
import { PageList } from "./PageList";
import type { PageMeta } from "../db";
import {
  IconChevronLeft,
  IconChevronRight,
  IconFocus,
  IconGear,
  IconMoon,
  IconPen,
  IconSliders,
  IconSparkle,
  IconSun,
} from "./icons";

export type RailPageListProps = {
  pages: PageMeta[];
  pinnedIds: string[];
  closedIds: string[];
  activeId: string;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onRename: (id: string, name: string) => Promise<void>;
  onClosePage: (id: string) => void;
  onDelete: (id: string) => void;
  onPin: (id: string) => void;
  onMove: (id: string, direction: number) => void;
  onReorder: (from: string, to: string) => void;
};

type Props = {
  pageList: RailPageListProps;
  /** open pages in display order, for the collapsed icon strip */
  railPages: { id: string; name: string }[];
  collapsed: boolean;
  /** overlays the canvas with a backdrop (phone) instead of pushing it */
  overlay: boolean;
  onToggleCollapsed: () => void;
  width: number;
  onResize: (width: number) => void;
  touch: boolean;
  theme: "light" | "dark";
  propertiesShown: boolean;
  onToggleProperties: () => void;
  inkEnabled: boolean;
  onToggleInk: () => void;
  onAsk: () => void;
  onFocus: () => void;
  onSettings: () => void;
  onTheme: () => void;
};

function WindowControls({ stacked }: { stacked: boolean }) {
  const [maximized, setMaximized] = useState(false);
  useEffect(() => {
    if (!isTauri()) return;
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
  }, []);
  const win = () => getCurrentWindow();
  return (
    <div className={`rail-win ${stacked ? "rail-win--stacked" : ""}`}>
      <button
        type="button"
        className="win-btn"
        title="Minimize"
        aria-label="Minimize"
        onClick={() => void win().minimize().catch(() => {})}
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
        onClick={() => void win().toggleMaximize().catch(() => {})}
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
        onClick={() => void win().close().catch(() => {})}
      >
        <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
          <path d="M1 1l8 8M9 1L1 9" stroke="currentColor" strokeWidth="1.2" />
        </svg>
      </button>
    </div>
  );
}

export default function SideRail({
  pageList,
  railPages,
  collapsed,
  overlay,
  onToggleCollapsed,
  width,
  onResize,
  touch,
  theme,
  propertiesShown,
  onToggleProperties,
  inkEnabled,
  onToggleInk,
  onAsk,
  onFocus,
  onSettings,
  onTheme,
}: Props) {
  const dragProps = !touch ? { "data-tauri-drag-region": true } : {};
  const onHeadDoubleClick = (e: MouseEvent) => {
    if (touch) return;
    if ((e.target as HTMLElement).closest(".no-drag")) return;
    void getCurrentWindow()
      .toggleMaximize()
      .catch(() => {});
  };
  const tools: {
    key: string;
    icon: ReactNode;
    label: string;
    onClick: () => void;
    pressed?: boolean;
  }[] = [
    {
      key: "ai",
      icon: <IconSparkle />,
      label: "AI assistant",
      onClick: onAsk,
    },
    {
      key: "ink",
      icon: <IconPen />,
      label: "Smart Ink",
      onClick: onToggleInk,
      pressed: inkEnabled,
    },
    {
      key: "props",
      icon: <IconSliders />,
      label: propertiesShown ? "Hide properties" : "Properties",
      onClick: onToggleProperties,
      pressed: propertiesShown,
    },
    {
      key: "focus",
      icon: <IconFocus />,
      label: "Focus mode",
      onClick: onFocus,
    },
  ];
  return (
    <aside
      className={`app-rail ${collapsed ? "is-collapsed" : ""} ${overlay && !collapsed ? "is-overlay" : ""}`}
      style={collapsed ? undefined : { width }}
      aria-label="Sidebar"
    >
      <div
        className="app-rail__head"
        {...dragProps}
        onDoubleClick={onHeadDoubleClick}
      >
        <img
          src={logoUrl}
          alt="Redraw"
          className="app-rail__logo"
          draggable={false}
        />
        {!collapsed && <span className="app-rail__name">Redraw</span>}
        <button
          type="button"
          className="icon-button rail-collapse no-drag"
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          onClick={onToggleCollapsed}
        >
          {collapsed ? <IconChevronRight /> : <IconChevronLeft />}
        </button>
      </div>

      {collapsed ? (
        <>
          <nav
            className="page-rail app-rail__pages no-drag"
            aria-label="Open pages"
          >
            {railPages.map((page, i) => (
              <button
                key={page.id}
                type="button"
                title={page.name}
                aria-label={page.name}
                aria-current={page.id === pageList.activeId ? "page" : undefined}
                onClick={() => pageList.onSelect(page.id)}
              >
                {i + 1}
              </button>
            ))}
            <button
              type="button"
              onClick={pageList.onCreate}
              aria-label="New page"
              title="New page"
            >
              +
            </button>
          </nav>
          <div className="rail-tools no-drag" role="group" aria-label="Tools">
            {tools.map((t) => (
              <button
                key={t.key}
                type="button"
                className="rail-icon"
                aria-pressed={t.pressed}
                title={t.label}
                onClick={t.onClick}
              >
                {t.icon}
                <span className="sr-only">{t.label}</span>
              </button>
            ))}
          </div>
        </>
      ) : (
        <div className="app-rail__body no-drag">
          <PageList {...pageList} />
          <div className="rail-section" role="group" aria-label="Tools">
            {tools.map((t) => (
              <button
                key={t.key}
                type="button"
                className="rail-action"
                aria-pressed={t.pressed}
                onClick={t.onClick}
              >
                {t.icon}
                <span>{t.label}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="app-rail__spacer" {...dragProps} />

      <div className="app-rail__foot no-drag">
        <button
          type="button"
          className={collapsed ? "rail-icon" : "rail-action"}
          onClick={onSettings}
          title="Settings"
        >
          <IconGear />
          <span className={collapsed ? "sr-only" : undefined}>Settings</span>
        </button>
        <button
          type="button"
          className={collapsed ? "rail-icon" : "rail-action"}
          onClick={onTheme}
          title={
            theme === "dark" ? "Switch to light theme" : "Switch to dark theme"
          }
        >
          {theme === "dark" ? <IconSun /> : <IconMoon />}
          <span className={collapsed ? "sr-only" : undefined}>
            {theme === "dark" ? "Light theme" : "Dark theme"}
          </span>
        </button>
        {isTauri() && <WindowControls stacked={collapsed} />}
      </div>

      {!collapsed && !overlay && (
        <div
          className="sidebar-resizer no-drag"
          role="separator"
          tabIndex={0}
          aria-label="Sidebar width"
          aria-orientation="vertical"
          aria-valuemin={200}
          aria-valuemax={360}
          aria-valuenow={width}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
              e.preventDefault();
              onResize(width + (e.key === "ArrowRight" ? 16 : -16));
            }
          }}
          onPointerDown={(e) => {
            e.currentTarget.setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (e.currentTarget.hasPointerCapture(e.pointerId))
              onResize(e.clientX);
          }}
        />
      )}
    </aside>
  );
}
