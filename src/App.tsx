import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { isMobileOS, isTauri, isTouchUi, usePhoneLayout } from "./platform";
import { IconChevronRight, IconFocus } from "./components/icons";
import { insertImages, pickImageFiles } from "./files";
import type {
  AppState,
  BinaryFiles,
  LibraryItems,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import "./App.css";
import SideRail from "./components/SideRail";
import AppSettings from "./components/AppSettings";
import { PageList } from "./components/PageList";
import Dialog from "./components/Dialog";
import {
  DEFAULT_PREFERENCES,
  parsePreferences,
  type Preferences,
} from "./preferences";
import { AiSettingsDialog } from "./components/AiSettingsDialog";
import {
  bootstrapPages,
  createPage,
  deletePage,
  getPageScene,
  listPages,
  parseScene,
  renamePage,
  reorderPages,
  setMeta,
  getMeta,
  updatePageScene,
  type PageMeta,
  type SceneData,
} from "./db";
import { DEFAULT_PAPER, parsePaper, paperImage, type Paper } from "./paper";
import InlineAssistant from "./components/InlineAssistant";
import PaperExport from "./components/PaperExport";
import QuickSwitcher from "./components/QuickSwitcher";
import AiPanel from "./components/AiPanel";
import { SaveQueue } from "./saveQueue";
import {
  DEFAULT_SUBSCRIPTION,
  loadSubscription,
  saveSubscription,
  type SubscriptionConfig,
} from "./subscriptions";

const RedrawMenu = lazy(() => import("./components/RedrawMenu"));
const PropertiesPanel = lazy(() => import("./components/PropertiesPanel"));
const SmartInkManager = lazy(() => import("./components/SmartInkManager"));

const Excalidraw = lazy(async () => {
  await import("@excalidraw/excalidraw/index.css");
  const m = await import("@excalidraw/excalidraw");
  return { default: m.Excalidraw };
});

// Excalidraw CaptureUpdateAction.NEVER — avoid eager package import
const CAPTURE_NEVER = "NEVER" as const;

const SAVE_DEBOUNCE_MS = 800;

const STRIP_APPSTATE = new Set([
  "collaborators",
  "fileHandle",
  "width",
  "height",
  "offsetTop",
  "offsetLeft",
  "isLoading",
  "errorMessage",
  "toast",
  "contextMenu",
  "newElement",
  "resizingElement",
  "multiElement",
  "selectionElement",
  "editingTextElement",
  "editingLinearElement",
  "openPopup",
  "openDialog",
  "suggestedBindings",
  "snapLines",
  "originSnapOffset",
  "userToFollow",
  "followedBy",
  "cursorButton",
  "isResizing",
  "isRotating",
  "name",
]);

function persistableAppState(appState: AppState): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(appState)) {
    if (STRIP_APPSTATE.has(k)) continue;
    if (v instanceof Map) continue;
    if (typeof v === "function") continue;
    out[k] = v;
  }
  return out;
}

function serializeScene(
  elements: readonly OrderedExcalidrawElement[],
  appState: AppState,
  files: BinaryFiles,
  paper: Paper,
): string {
  const used = new Set<string>();
  for (const el of elements) {
    if (el.type === "image" && "fileId" in el && el.fileId) {
      used.add(el.fileId as string);
    }
  }
  const filesOut: BinaryFiles = {};
  for (const id of used) {
    if (files[id]) filesOut[id] = files[id];
  }
  const scene: SceneData = {
    paper,
    elements: elements as unknown[],
    appState: persistableAppState(appState),
    files: filesOut as Record<string, unknown>,
  };
  return JSON.stringify(scene);
}

function sceneToInitial(scene: SceneData): ExcalidrawInitialDataState {
  return {
    elements: (scene.elements ?? []) as ExcalidrawInitialDataState["elements"],
    appState: {
      currentItemStrokeWidth: 1,
      ...(scene.appState as Partial<AppState>),
      collaborators: undefined,
    } as ExcalidrawInitialDataState["appState"],
    files: (scene.files ?? {}) as BinaryFiles,
  };
}

export default function App() {
  const [preferences, setPreferences] =
    useState<Preferences>(DEFAULT_PREFERENCES);
  const metadataQueue = useRef(new SaveQueue(setMeta));
  const preferencesRef = useRef(preferences);
  preferencesRef.current = preferences;
  const preferenceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [paper, setPaper] = useState<Paper>(DEFAULT_PAPER);
  const paperRef = useRef(paper);
  const [viewport, setViewport] = useState({ x: 0, y: 0, zoom: 1 });
  const [exportOpen, setExportOpen] = useState(false);
  const [quickOpen, setQuickOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [pagesOpen, setPagesOpen] = useState(false);
  const [focusMode, setFocusMode] = useState(false);
  const [advanced, setAdvanced] = useState(false);
  const phone = usePhoneLayout();
  const [phoneProps, setPhoneProps] = useState(false);
  const propsShown = phone ? phoneProps : preferences.propertiesVisible;
  const [railOpen, setRailOpen] = useState(false);
  const railCollapsed = phone ? !railOpen : preferences.sidebarCollapsed;
  const [closedIds, setClosedIdsState] = useState<string[]>([]);
  const closedIdsRef = useRef<string[]>([]);
  const setClosedIds = useCallback(
    (update: string[] | ((ids: string[]) => string[])) => {
      const next =
        typeof update === "function" ? update(closedIdsRef.current) : update;
      closedIdsRef.current = next;
      setClosedIdsState(next);
    },
    [],
  );
  const [canvasApi, setCanvasApi] = useState<ExcalidrawImperativeAPI | null>(
    null,
  );
  const [saveError, setSaveError] = useState("");
  const reportError = useCallback(
    (e: unknown) =>
      setSaveError(
        e instanceof Error
          ? e.message
          : "Couldn't save changes. Please try again.",
      ),
    [],
  );
  const patchPreferences = useCallback(
    (patch: Partial<Preferences>) => {
      const next = { ...preferencesRef.current, ...patch };
      preferencesRef.current = next;
      setPreferences(next);
      if (preferenceTimer.current) clearTimeout(preferenceTimer.current);
      preferenceTimer.current = setTimeout(() => {
        void metadataQueue.current
          .save("preferences", JSON.stringify(next))
          .catch(reportError);
      }, 250);
    },
    [reportError],
  );
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [touch, setTouch] = useState(false);
  const [libraryItems, setLibraryItems] = useState<LibraryItems>([]);
  const [initialData, setInitialData] =
    useState<ExcalidrawInitialDataState | null>(null);
  const [llmConfig, setLlmConfig] =
    useState<SubscriptionConfig>(DEFAULT_SUBSCRIPTION);
  const [aiOpen, setAiOpen] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const imageToolHandled = useRef(false);

  useEffect(() => {
    setTouch(isTouchUi());
  }, []);

  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const focusCanvas = useCallback(() => {
    requestAnimationFrame(() =>
      canvasContainerRef.current
        ?.querySelector<HTMLElement>(".excalidraw")
        ?.focus(),
    );
  }, []);
  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const activeIdRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const switchingRef = useRef(false);
  const themeRef = useRef<"light" | "dark">("light");
  const askAi = useCallback(() => setAiOpen(true), []);
  const waitAi = useCallback(async () => {
    setAiOpen(false);
  }, []);
  const saveQueue = useRef(new SaveQueue(updatePageScene));

  const persistIfNeeded = useCallback(async () => {
    const id = activeIdRef.current;
    const api = apiRef.current;
    if (!id || !api || switchingRef.current) return;

    const payload = serializeScene(
      api.getSceneElementsIncludingDeleted() as OrderedExcalidrawElement[],
      api.getAppState(),
      api.getFiles(),
      paperRef.current,
    );
    await saveQueue.current.save(id, payload);
    setSaveError("");
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistIfNeeded();
    if (preferenceTimer.current) {
      clearTimeout(preferenceTimer.current);
      preferenceTimer.current = null;
    }
    await metadataQueue.current.save(
      "preferences",
      JSON.stringify(preferencesRef.current),
    );
  }, [persistIfNeeded]);

  const scheduleSave = useCallback(() => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistIfNeeded().catch(reportError);
    }, SAVE_DEBOUNCE_MS);
  }, [persistIfNeeded]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const {
        pages: all,
        theme: t,
        activeId: lastId,
        activeScene,
      } = await bootstrapPages();
      if (cancelled) return;
      themeRef.current = t;
      setTheme(t);
      setPages(all);
      setActiveId(lastId);
      activeIdRef.current = lastId;
      setInitialData(sceneToInitial(parseScene(activeScene)));
      try {
        const library = JSON.parse((await getMeta("library_items")) || "[]");
        if (Array.isArray(library)) setLibraryItems(library);
      } catch {
        /* recover malformed library */
      }
      const prefs = parsePreferences(await getMeta("preferences"));
      setPreferences(prefs);
      const savedScene = parseScene(activeScene);
      const sheet = parsePaper(
        savedScene.paper,
        parsePaper(
          { color: savedScene.appState?.viewBackgroundColor },
          prefs.defaultPaper,
        ),
      );
      paperRef.current = sheet;
      setPaper(sheet);
      setInitialData({
        ...sceneToInitial(savedScene),
        appState: {
          ...sceneToInitial(savedScene).appState,
          viewBackgroundColor: "transparent",
          theme: "light",
        },
      });
      try {
        const closed = JSON.parse((await getMeta("closed_pages")) || "[]");
        if (Array.isArray(closed))
          setClosedIds(
            closed.filter((id) => typeof id === "string" && id !== lastId),
          );
      } catch {
        /* recover invalid preferences */
      }
      let llm = DEFAULT_SUBSCRIPTION;
      try {
        llm = await loadSubscription();
      } catch (e) {
        reportError(e);
        setAiSettingsOpen(true);
      }
      if (cancelled) return;
      setLlmConfig(llm);
      setReady(true);
    })().catch(reportError);
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    let unlisten: (() => void) | undefined;
    (async () => {
      try {
        const win = getCurrentWindow();
        unlisten = await win.onCloseRequested(async (event) => {
          event.preventDefault();
          try {
            await flushSave();
            await win.destroy();
          } catch (e) {
            reportError(e);
          }
        });
      } catch {
        // mobile / no desktop window chrome
      }
    })();
    return () => {
      unlisten?.();
    };
  }, [ready, flushSave]);

  // persist when app backgrounds (mobile)
  useEffect(() => {
    if (!ready) return;
    const onVis = () => {
      if (document.visibilityState === "hidden")
        void flushSave().catch(reportError);
    };
    const onHide = () => {
      void flushSave().catch(reportError);
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [ready, flushSave]);

  const loadSceneIntoCanvas = useCallback((sceneRaw: string) => {
    const api = apiRef.current;
    if (!api) return;
    const scene = parseScene(sceneRaw);
    const sheet = parsePaper(
      scene.paper,
      parsePaper(
        { color: scene.appState?.viewBackgroundColor },
        preferencesRef.current.defaultPaper,
      ),
    );
    paperRef.current = sheet;
    setPaper(sheet);
    switchingRef.current = true;
    api.updateScene({
      elements: (scene.elements ?? []) as OrderedExcalidrawElement[],
      appState: {
        currentItemStrokeWidth: 1,
        ...(scene.appState as object),
        viewBackgroundColor: "transparent",
        theme: "light",
        selectedElementIds: {},
        selectedGroupIds: {},
      } as AppState,
      captureUpdate: CAPTURE_NEVER,
    });
    api.history.clear();
    const files = (scene.files ?? {}) as BinaryFiles;
    const fileList = Object.values(files);
    if (fileList.length) {
      api.addFiles(fileList);
    }
    queueMicrotask(() => {
      switchingRef.current = false;
    });
  }, []);

  const handleSelect = useCallback(
    async (id: string) => {
      if (!(await listPages()).some((page) => page.id === id)) return;
      setClosedIds((ids) => ids.filter((closed) => closed !== id));
      if (id === activeIdRef.current) return;
      await waitAi();
      await flushSave();
      const sceneRaw = await getPageScene(id);
      setActiveId(id);
      activeIdRef.current = id;
      void metadataQueue.current
        .save("last_active_page_id", id)
        .catch(reportError);
      loadSceneIntoCanvas(sceneRaw);
    },
    [flushSave, loadSceneIntoCanvas, waitAi],
  );

  const handleCreate = useCallback(async () => {
    await waitAi();
    await flushSave();
    const count = (await listPages()).length;
    const page = await createPage(`P${count + 1}`);
    setPages((prev) => [...prev, page]);
    setActiveId(page.id);
    activeIdRef.current = page.id;
    void metadataQueue.current
      .save("last_active_page_id", page.id)
      .catch(reportError);
    loadSceneIntoCanvas(
      JSON.stringify({ elements: [], appState: {}, files: {} }),
    );
  }, [flushSave, loadSceneIntoCanvas, waitAi]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await renamePage(id, name);
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      const currentPages = await listPages();
      if (currentPages.length <= 1 || !currentPages.some((p) => p.id === id))
        return;
      const page = currentPages.find((p) => p.id === id);
      const ok = await ask(
        `Delete "${page?.name ?? "this page"}"? This cannot be undone.`,
        { title: "Delete page", kind: "warning" },
      );
      if (!ok) return;

      const remaining = currentPages.filter((p) => p.id !== id);
      const wasActive = id === activeIdRef.current;
      if (wasActive) {
        await waitAi();
        await flushSave();
      }
      await deletePage(id);
      setPages(remaining);
      if (wasActive) {
        const next = remaining[0];
        setClosedIds((ids) =>
          ids.filter((closed) => closed !== next.id && closed !== id),
        );
        setActiveId(next.id);
        activeIdRef.current = next.id;
        void metadataQueue.current
          .save("last_active_page_id", next.id)
          .catch(reportError);
        const sceneRaw = await getPageScene(next.id);
        loadSceneIntoCanvas(sceneRaw);
      }
    },
    [flushSave, loadSceneIntoCanvas, pages, waitAi],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key !== "Enter") return;
      if (e.repeat) return;
      const t = e.target as HTMLElement | null;
      if (t?.closest("input, textarea, [contenteditable=true]")) return;
      e.preventDefault();
      e.stopPropagation();
      void askAi();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [askAi]);

  const insertImageFiles = useCallback(async () => {
    const api = apiRef.current;
    if (!api) return;
    try {
      await insertImages(api, await pickImageFiles());
    } catch (e) {
      reportError(e);
    }
  }, [reportError]);

  const onChange = useCallback(
    (
      _elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      _files: BinaryFiles,
    ) => {
      setViewport((old) =>
        old.x === appState.scrollX &&
        old.y === appState.scrollY &&
        old.zoom === appState.zoom.value
          ? old
          : {
              x: appState.scrollX,
              y: appState.scrollY,
              zoom: appState.zoom.value,
            },
      );
      if (switchingRef.current) return;
      if (isTauri() && isMobileOS() && appState.activeTool.type === "image") {
        if (!imageToolHandled.current) {
          imageToolHandled.current = true;
          apiRef.current?.setActiveTool({ type: "selection" });
          void insertImageFiles();
        }
      } else {
        imageToolHandled.current = false;
      }
      if (
        appState.viewBackgroundColor !== "transparent" &&
        /^#[\da-f]{6}$/i.test(appState.viewBackgroundColor)
      ) {
        const next = {
          ...paperRef.current,
          color: appState.viewBackgroundColor,
        };
        paperRef.current = next;
        setPaper(next);
        queueMicrotask(() =>
          apiRef.current?.updateScene({
            appState: { viewBackgroundColor: "transparent" },
            captureUpdate: CAPTURE_NEVER,
          }),
        );
      }
      scheduleSave();
    },
    [scheduleSave, insertImageFiles],
  );

  useEffect(() => {
    if (ready)
      void metadataQueue.current
        .save("closed_pages", JSON.stringify(closedIds))
        .catch(reportError);
  }, [closedIds, ready, reportError]);

  const closePage = async (id: string) => {
    const currentPages = await listPages();
    const open = currentPages.filter(
      (p) => !closedIdsRef.current.includes(p.id) && p.id !== id,
    );
    if (!open.length) {
      setPagesOpen(true);
      return;
    }
    if (id === activeIdRef.current) await handleSelect(open[0].id);
    setClosedIds((ids) => [...new Set([...ids, id])]);
  };

  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if (
        (e.target as HTMLElement)?.closest(
          "input, textarea, [contenteditable=true], dialog",
        )
      )
        return;
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "p"
      ) {
        e.preventDefault();
        if (phone) setPhoneProps((v) => !v);
        else
          patchPreferences({
            propertiesVisible: !preferencesRef.current.propertiesVisible,
          });
      }
      if (
        (e.ctrlKey || e.metaKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "f"
      ) {
        e.preventDefault();
        setFocusMode((v) => !v);
      }
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        e.stopPropagation();
        setQuickOpen(true);
      }
      if (e.key === "Escape") setFocusMode(false);
    };
    window.addEventListener("keydown", key, true);
    return () => window.removeEventListener("keydown", key, true);
  }, [patchPreferences, phone]);

  useEffect(() => {
    if (!ready) return;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      const t =
        preferences.appTheme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : preferences.appTheme;
      themeRef.current = t;
      setTheme(t);
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [preferences.appTheme, ready]);
  const navigationQueue = useRef<Promise<void>>(Promise.resolve());
  const navigate = (operation: () => Promise<void>) => {
    const job = navigationQueue.current.then(operation);
    navigationQueue.current = job.catch(reportError);
  };
  const reorder = (from: string, to: string) =>
    navigate(async () => {
      const current = await listPages();
      const a = current.findIndex((p) => p.id === from),
        b = current.findIndex((p) => p.id === to);
      if (a < 0 || b < 0 || a === b) return;
      const [moved] = current.splice(a, 1);
      current.splice(b, 0, moved);
      await reorderPages(current.map((p) => p.id));
      setPages(current);
    });
  const pageProps = {
    pinnedIds: preferences.pinnedPages,
    onPin: (id: string) =>
      patchPreferences({
        pinnedPages: preferences.pinnedPages.includes(id)
          ? preferences.pinnedPages.filter((p) => p !== id)
          : [...preferences.pinnedPages, id],
      }),
    onReorder: reorder,
    onMove: (id: string, direction: number) => {
      const index = pages.findIndex((p) => p.id === id);
      if (pages[index + direction]) reorder(id, pages[index + direction].id);
    },
    pages,
    activeId,
    closedIds,
    onSelect: (id: string) => {
      navigate(async () => {
        await handleSelect(id);
        setPagesOpen(false);
      });
    },
    onCreate: () => {
      navigate(handleCreate);
    },
    onRename: handleRename,
    onDelete: (id: string) => {
      navigate(() => handleDelete(id));
    },
    onClosePage: (id: string) => {
      navigate(() => closePage(id));
    },
  };
  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container || !phone || !canvasApi) return;
    const update = () => {
      const islands = [
        ...container.querySelectorAll<HTMLElement>(".App-toolbar"),
      ];
      const bottom = islands.reduce<HTMLElement | null>(
        (a, b) =>
          !a || b.getBoundingClientRect().top > a.getBoundingClientRect().top
            ? b
            : a,
        null,
      );
      const dock = bottom
        ? container.getBoundingClientRect().bottom -
          bottom.getBoundingClientRect().top
        : 0;
      container.style.setProperty("--dock-h", `${Math.round(dock)}px`);
    };
    update();
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [phone, canvasApi]);
  const activePage = pages.find((p) => p.id === activeId);

  if (!ready || !initialData) {
    return (
      <div className="app-loading">
        {saveError ? (
          <div role="alert">
            {saveError}
            <button onClick={() => window.location.reload()}>Retry</button>
          </div>
        ) : (
          "Loading…"
        )}
      </div>
    );
  }

  return (
    <div
      className={`app-shell palette-${preferences.palette} density-${preferences.density} ${focusMode ? "is-focused" : ""} ${advanced && propsShown ? "show-advanced" : ""} ${theme === "dark" ? "app-shell--dark" : ""} ${touch ? "app-shell--touch" : ""} ${phone ? "is-phone" : ""}`}
      style={
        theme === "dark"
          ? ({
              ["--island-bg-color" as string]: "#232329",
              ["--color-primary" as string]: "#a8a5ff",
              ["--color-on-surface" as string]: "#e3e3e8",
            } as CSSProperties)
          : ({
              ["--color-primary" as string]: "#6965db",
            } as CSSProperties)
      }
    >
      {phone && railOpen && !focusMode && (
        <button
          type="button"
          className="sheet-backdrop"
          aria-label="Close panel"
          onClick={() => setRailOpen(false)}
        />
      )}
      <div className="workspace-body">
        {!focusMode && (!phone || railOpen) && (
          <SideRail
            pageList={{
              ...pageProps,
              onSelect: (id) => {
                pageProps.onSelect(id);
                setRailOpen(false);
              },
            }}
            railPages={[...pages]
              .sort(
                (a, b) =>
                  Number(preferences.pinnedPages.includes(b.id)) -
                  Number(preferences.pinnedPages.includes(a.id)),
              )
              .filter((p) => !closedIds.includes(p.id))}
            collapsed={railCollapsed}
            overlay={phone}
            onToggleCollapsed={() => {
              if (phone) setRailOpen((v) => !v);
              else
                patchPreferences({
                  sidebarCollapsed: !preferences.sidebarCollapsed,
                });
            }}
            width={preferences.sidebarWidth}
            onResize={(w) =>
              patchPreferences({
                sidebarWidth: Math.min(360, Math.max(200, Math.round(w))),
              })
            }
            touch={touch}
            theme={theme}
            propertiesShown={propsShown}
            onToggleProperties={() => {
              setRailOpen(false);
              if (phone) setPhoneProps((v) => !v);
              else
                patchPreferences({
                  propertiesVisible: !preferences.propertiesVisible,
                });
            }}
            inkEnabled={preferences.smartInk.enabled}
            onToggleInk={() => {
              setRailOpen(false);
              patchPreferences({
                smartInk: {
                  ...preferencesRef.current.smartInk,
                  enabled: !preferencesRef.current.smartInk.enabled,
                },
              });
            }}
            onAsk={() => {
              setRailOpen(false);
              askAi();
            }}
            onFocus={() => {
              setRailOpen(false);
              setFocusMode(true);
            }}
            onSettings={() => {
              setRailOpen(false);
              setSettingsOpen(true);
            }}
            onTheme={() =>
              patchPreferences({
                appTheme: theme === "dark" ? "light" : "dark",
              })
            }
          />
        )}
        <div className="app-shell__canvas" ref={canvasContainerRef}>
          {phone && !railOpen && !focusMode && (
            <button
              type="button"
              className="rail-open workspace-surface"
              aria-label="Open panel"
              title="Open panel"
              onClick={() => setRailOpen(true)}
            >
              <IconChevronRight />
            </button>
          )}
          {focusMode && (
            <button
              type="button"
              className="exit-focus workspace-surface"
              onClick={() => setFocusMode(false)}
            >
              <IconFocus />
              <span>Exit focus</span>
            </button>
          )}
          <div
            className="paper-background"
            aria-hidden="true"
            style={{
              backgroundColor: paper.color,
              backgroundImage:
                paper.pattern === "plain" ? undefined : paperImage(paper),
              backgroundSize: `${paper.spacing * viewport.zoom}px ${paper.spacing * viewport.zoom}px`,
              backgroundPosition: `${viewport.x * viewport.zoom}px ${viewport.y * viewport.zoom}px`,
            }}
          />
          {saveError && (
            <div className="save-error" role="alert">
              {saveError}
              <button
                onClick={() => {
                  void flushSave().catch(reportError);
                }}
              >
                Retry save
              </button>
            </div>
          )}
          {!focusMode && propsShown && !advanced && canvasApi && (
            <>
              {phone && (
                <button
                  type="button"
                  className="sheet-backdrop"
                  aria-label="Close properties"
                  onClick={() => setPhoneProps(false)}
                />
              )}
              <Suspense fallback={null}>
                <PropertiesPanel
                  api={canvasApi}
                  onHide={() =>
                    phone
                      ? setPhoneProps(false)
                      : patchPreferences({ propertiesVisible: false })
                  }
                  onAdvanced={() => {
                    setAdvanced(true);
                    setPhoneProps(false);
                  }}
                />
              </Suspense>
            </>
          )}
          {advanced && propsShown && !focusMode && (
            <button
              className="advanced-back"
              onClick={() => setAdvanced(false)}
            >
              ← Compact properties
            </button>
          )}
          <Suspense
            fallback={<div className="app-loading">Loading canvas…</div>}
          >
            <Excalidraw
              excalidrawAPI={(api) => {
                apiRef.current = api;
                setCanvasApi(api);
              }}
              initialData={{ ...initialData, libraryItems }}
              onLibraryChange={(items) => {
                void metadataQueue.current
                  .save("library_items", JSON.stringify(items))
                  .catch(reportError);
              }}
              theme="light"
              name={activePage?.name ?? "Page"}
              aiEnabled={false}
              zenModeEnabled={focusMode}
              UIOptions={{
                canvasActions: {
                  loadScene: false,
                  saveToActiveFile: false,
                  export: { saveFileToDisk: true },
                  saveAsImage: !isMobileOS(),
                  toggleTheme: true,
                  clearCanvas: true,
                },
                tools: { image: true },
                welcomeScreen: false,
              }}
              onChange={onChange}
            >
              <RedrawMenu
                onExport={() => setExportOpen(true)}
                onInsertImage={() => void insertImageFiles()}
                onTheme={() =>
                  patchPreferences({
                    appTheme: theme === "dark" ? "light" : "dark",
                  })
                }
                onSettings={() => setSettingsOpen(true)}
                onPages={() => setPagesOpen(true)}
                onFocus={() => setFocusMode((v) => !v)}
              />
            </Excalidraw>
          </Suspense>
          {canvasApi && (
            <InlineAssistant
              key={`inline-${activeId}`}
              api={canvasApi}
              config={llmConfig}
              paperColor={paper.color}
              mode={preferences.aiMode}
              disabled={aiOpen || settingsOpen || aiSettingsOpen || focusMode}
              onSettings={() => setAiSettingsOpen(true)}
            />
          )}
          {canvasApi && (
            <Suspense fallback={null}>
              <SmartInkManager
                key={`ink-${activeId}`}
                api={canvasApi}
                settings={preferences.smartInk}
                disabled={focusMode}
                onChangeSettings={(patch) =>
                  patchPreferences({
                    smartInk: { ...preferencesRef.current.smartInk, ...patch },
                  })
                }
              />
            </Suspense>
          )}
          {aiOpen && canvasApi && !focusMode && (
            <AiPanel
              key={activeId}
              api={canvasApi}
              config={llmConfig}
              paperColor={paper.color}
              onClose={() => {
                setAiOpen(false);
                focusCanvas();
              }}
              onApplied={focusCanvas}
              onSettings={() => setAiSettingsOpen(true)}
            />
          )}
        </div>
      </div>
      {exportOpen && canvasApi && (
        <PaperExport
          api={canvasApi}
          paper={paper}
          name={activePage?.name || "Page"}
          onClose={() => setExportOpen(false)}
        />
      )}
      {quickOpen && (
        <QuickSwitcher
          pages={pages}
          onClose={() => setQuickOpen(false)}
          onSelect={pageProps.onSelect}
          commands={[
            { name: "New page", run: pageProps.onCreate },
            { name: "All pages", run: () => setPagesOpen(true) },
            { name: "Settings", run: () => setSettingsOpen(true) },
            { name: "Focus mode", run: () => setFocusMode((v) => !v) },
            { name: "AI assistant", run: askAi },
            {
              name: "Toggle sidebar",
              run: () => {
                if (phone) setRailOpen((v) => !v);
                else
                  patchPreferences({
                    sidebarCollapsed: !preferences.sidebarCollapsed,
                  });
              },
            },
          ]}
        />
      )}
      {pagesOpen && (
        <Dialog title="All pages" onClose={() => setPagesOpen(false)}>
          <PageList {...pageProps} />
        </Dialog>
      )}
      {settingsOpen && (
        <AppSettings
          preferences={preferences}
          paper={paper}
          onClose={() => setSettingsOpen(false)}
          onAiSettings={() => {
            setSettingsOpen(false);
            setAiSettingsOpen(true);
          }}
          onSave={async (p, sheet) => {
            if (preferenceTimer.current) clearTimeout(preferenceTimer.current);
            await metadataQueue.current.save("preferences", JSON.stringify(p));
            preferencesRef.current = p;
            setPreferences(p);
            paperRef.current = sheet;
            setPaper(sheet);
            await persistIfNeeded();
          }}
        />
      )}
      {aiSettingsOpen && (
        <AiSettingsDialog
          config={llmConfig}
          theme={theme}
          onClose={() => setAiSettingsOpen(false)}
          onSave={async (c) => {
            await saveSubscription(c);
            setLlmConfig(c);
            setAiSettingsOpen(false);
          }}
        />
      )}
    </div>
  );
}
