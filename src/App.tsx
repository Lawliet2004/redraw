import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { isTouchUi } from "./platform";
import type {
  AppState,
  BinaryFiles,
  ExcalidrawImperativeAPI,
  ExcalidrawInitialDataState,
} from "@excalidraw/excalidraw/types";
import type { OrderedExcalidrawElement } from "@excalidraw/excalidraw/element/types";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { ask } from "@tauri-apps/plugin-dialog";
import "./App.css";
import PageTabBar from "./components/PageTabBar";
import {
  bootstrapPages,
  createPage,
  deletePage,
  getPageScene,
  listPages,
  parseScene,
  renamePage,
  setMeta,
  updatePageScene,
  type PageMeta,
  type SceneData,
} from "./db";

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
      ...(scene.appState as Partial<AppState>),
      collaborators: undefined,
    } as ExcalidrawInitialDataState["appState"],
    files: (scene.files ?? {}) as BinaryFiles,
  };
}

export default function App() {
  const [ready, setReady] = useState(false);
  const [pages, setPages] = useState<PageMeta[]>([]);
  const [activeId, setActiveId] = useState("");
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [touch, setTouch] = useState(false);
  const [initialData, setInitialData] =
    useState<ExcalidrawInitialDataState | null>(null);

  useEffect(() => {
    setTouch(isTouchUi());
  }, []);

  const apiRef = useRef<ExcalidrawImperativeAPI | null>(null);
  const activeIdRef = useRef("");
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastSavedRef = useRef("");
  const dirtyRef = useRef(false);
  const switchingRef = useRef(false);
  const themeRef = useRef<"light" | "dark">("light");

  const persistIfNeeded = useCallback(async () => {
    const id = activeIdRef.current;
    const api = apiRef.current;
    if (!id || !api || switchingRef.current) return;

    const payload = serializeScene(
      api.getSceneElementsIncludingDeleted() as OrderedExcalidrawElement[],
      api.getAppState(),
      api.getFiles(),
    );
    if (payload === lastSavedRef.current) {
      dirtyRef.current = false;
      return;
    }
    lastSavedRef.current = payload;
    dirtyRef.current = false;
    await updatePageScene(id, payload);
  }, []);

  const flushSave = useCallback(async () => {
    if (saveTimerRef.current) {
      clearTimeout(saveTimerRef.current);
      saveTimerRef.current = null;
    }
    await persistIfNeeded();
  }, [persistIfNeeded]);

  const scheduleSave = useCallback(() => {
    dirtyRef.current = true;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveTimerRef.current = null;
      void persistIfNeeded();
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
      lastSavedRef.current = activeScene;
      setInitialData(sceneToInitial(parseScene(activeScene)));
      setReady(true);
    })();
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
          } finally {
            await win.destroy();
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
      if (document.visibilityState === "hidden") void flushSave();
    };
    const onHide = () => {
      void flushSave();
    };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("pagehide", onHide);
    return () => {
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("pagehide", onHide);
    };
  }, [ready, flushSave]);

  const loadSceneIntoCanvas = useCallback(
    (sceneRaw: string) => {
      const api = apiRef.current;
      if (!api) return;
      const scene = parseScene(sceneRaw);
      switchingRef.current = true;
      lastSavedRef.current = sceneRaw;
      dirtyRef.current = false;
      api.updateScene({
        elements: (scene.elements ?? []) as OrderedExcalidrawElement[],
        appState: {
          ...(scene.appState as object),
          theme: (scene.appState?.theme as AppState["theme"]) ?? themeRef.current,
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
    },
    [],
  );

  const handleSelect = useCallback(
    async (id: string) => {
      if (id === activeIdRef.current) return;
      await flushSave();
      const sceneRaw = await getPageScene(id);
      setActiveId(id);
      activeIdRef.current = id;
      void setMeta("last_active_page_id", id);
      loadSceneIntoCanvas(sceneRaw);
    },
    [flushSave, loadSceneIntoCanvas],
  );

  const handleCreate = useCallback(async () => {
    await flushSave();
    const count = (await listPages()).length;
    const page = await createPage(`P${count + 1}`);
    setPages((prev) => [...prev, page]);
    setActiveId(page.id);
    activeIdRef.current = page.id;
    void setMeta("last_active_page_id", page.id);
    loadSceneIntoCanvas(JSON.stringify({ elements: [], appState: {}, files: {} }));
  }, [flushSave, loadSceneIntoCanvas]);

  const handleRename = useCallback(async (id: string, name: string) => {
    await renamePage(id, name);
    setPages((prev) => prev.map((p) => (p.id === id ? { ...p, name } : p)));
  }, []);

  const handleDelete = useCallback(
    async (id: string) => {
      if (pages.length <= 1) return;
      const page = pages.find((p) => p.id === id);
      const ok = await ask(
        `Delete "${page?.name ?? "this page"}"? This cannot be undone.`,
        { title: "Delete page", kind: "warning" },
      );
      if (!ok) return;

      const remaining = pages.filter((p) => p.id !== id);
      const wasActive = id === activeIdRef.current;
      if (wasActive) {
        await flushSave();
      }
      await deletePage(id);
      setPages(remaining);
      if (wasActive) {
        const next = remaining[0];
        setActiveId(next.id);
        activeIdRef.current = next.id;
        void setMeta("last_active_page_id", next.id);
        const sceneRaw = await getPageScene(next.id);
        loadSceneIntoCanvas(sceneRaw);
      }
    },
    [flushSave, loadSceneIntoCanvas, pages],
  );

  const onChange = useCallback(
    (
      _elements: readonly OrderedExcalidrawElement[],
      appState: AppState,
      _files: BinaryFiles,
    ) => {
      if (appState.theme === "light" || appState.theme === "dark") {
        if (appState.theme !== themeRef.current) {
          themeRef.current = appState.theme;
          setTheme(appState.theme);
          void setMeta("theme", appState.theme);
        }
      }
      if (switchingRef.current) return;
      scheduleSave();
    },
    [scheduleSave],
  );

  const activePage = pages.find((p) => p.id === activeId);

  if (!ready || !initialData) {
    return <div className="app-loading">Loading…</div>;
  }

  return (
    <div
      className={`app-shell ${theme === "dark" ? "app-shell--dark" : ""} ${touch ? "app-shell--touch" : ""}`}
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
      <PageTabBar
        pages={pages}
        activeId={activeId}
        theme={theme}
        onSelect={(id) => void handleSelect(id)}
        onCreate={() => void handleCreate()}
        onRename={(id, name) => void handleRename(id, name)}
        onDelete={(id) => void handleDelete(id)}
      />
      <div className="app-shell__canvas">
        <Suspense fallback={<div className="app-loading">Loading canvas…</div>}>
          <Excalidraw
            excalidrawAPI={(api) => {
              apiRef.current = api;
            }}
            initialData={initialData}
            theme={theme}
            name={activePage?.name ?? "Page"}
            aiEnabled={false}
            UIOptions={{
              canvasActions: {
                loadScene: false,
                saveToActiveFile: false,
                export: { saveFileToDisk: true },
                saveAsImage: true,
                toggleTheme: true,
                clearCanvas: true,
              },
              tools: { image: true },
              welcomeScreen: false,
            }}
            onChange={onChange}
          />
        </Suspense>
      </div>
    </div>
  );
}
