import Database from "@tauri-apps/plugin-sql";
import { appLocalDataDir, join } from "@tauri-apps/api/path";
import { mkdir, BaseDirectory } from "@tauri-apps/plugin-fs";

/** Lightweight row for tabs — no scene blob. */
export type PageMeta = {
  id: string;
  name: string;
  position: number;
  created_at: number;
  updated_at: number;
};

export type SceneData = {
  elements: unknown[];
  appState: Record<string, unknown>;
  files?: Record<string, unknown>;
};

let db: Database | null = null;
let initPromise: Promise<void> | null = null;

export async function initDb(): Promise<void> {
  if (db) return;
  if (initPromise) return initPromise;
  initPromise = (async () => {
    await mkdir("", { baseDir: BaseDirectory.AppLocalData, recursive: true });
    const dir = await appLocalDataDir();
    const file = await join(dir, "canvas.db");
    db = await Database.load(`sqlite:${file}`);
    await db.execute(`PRAGMA journal_mode = WAL`);
    await db.execute(`PRAGMA synchronous = NORMAL`);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS pages (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        position INTEGER NOT NULL,
        scene_data TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      )
    `);
    await db.execute(`
      CREATE TABLE IF NOT EXISTS meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      )
    `);
  })();
  await initPromise;
}

function requireDb(): Database {
  if (!db) throw new Error("db not initialized");
  return db;
}

export async function listPages(): Promise<PageMeta[]> {
  return requireDb().select<PageMeta[]>(
    "SELECT id, name, position, created_at, updated_at FROM pages ORDER BY position ASC",
  );
}

export async function getPageScene(id: string): Promise<string> {
  const rows = await requireDb().select<{ scene_data: string }[]>(
    "SELECT scene_data FROM pages WHERE id = $1",
    [id],
  );
  return rows[0]?.scene_data ?? JSON.stringify(emptyScene());
}

export async function createPage(name: string): Promise<PageMeta> {
  const d = requireDb();
  const rows = await d.select<{ m: number | null }[]>(
    "SELECT MAX(position) as m FROM pages",
  );
  const position = (rows[0]?.m ?? 0) + 1;
  const now = Date.now();
  const id = crypto.randomUUID();
  const scene_data = JSON.stringify(emptyScene());
  await d.execute(
    "INSERT INTO pages (id, name, position, scene_data, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6)",
    [id, name, position, scene_data, now, now],
  );
  return { id, name, position, created_at: now, updated_at: now };
}

export async function renamePage(id: string, name: string): Promise<void> {
  await requireDb().execute(
    "UPDATE pages SET name = $1, updated_at = $2 WHERE id = $3",
    [name, Date.now(), id],
  );
}

export async function deletePage(id: string): Promise<void> {
  await requireDb().execute("DELETE FROM pages WHERE id = $1", [id]);
}

export async function updatePageScene(
  id: string,
  scene_data: string,
): Promise<void> {
  await requireDb().execute(
    "UPDATE pages SET scene_data = $1, updated_at = $2 WHERE id = $3",
    [scene_data, Date.now(), id],
  );
}

export async function getMeta(key: string): Promise<string | null> {
  const rows = await requireDb().select<{ value: string }[]>(
    "SELECT value FROM meta WHERE key = $1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setMeta(key: string, value: string): Promise<void> {
  await requireDb().execute(
    "INSERT INTO meta (key, value) VALUES ($1, $2) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    [key, value],
  );
}

let bootstrapPromise: Promise<PageMeta[]> | null = null;

export async function bootstrapPages(): Promise<{
  pages: PageMeta[];
  theme: "light" | "dark";
  activeId: string;
  activeScene: string;
}> {
  if (!bootstrapPromise) {
    bootstrapPromise = (async () => {
      await initDb();
      let pages = await listPages();
      if (pages.length === 0) {
        const p = await createPage("P1");
        await setMeta("last_active_page_id", p.id);
        pages = [p];
      }
      return pages;
    })();
  }
  const pages = await bootstrapPromise;
  const themeMeta = await getMeta("theme");
  const theme = themeMeta === "dark" ? "dark" : "light";
  let activeId = await getMeta("last_active_page_id");
  if (!activeId || !pages.some((p) => p.id === activeId)) {
    activeId = pages[0].id;
  }
  const activeScene = await getPageScene(activeId);
  return { pages, theme, activeId, activeScene };
}

export function emptyScene(): SceneData {
  return { elements: [], appState: {}, files: {} };
}

export function parseScene(raw: string): SceneData {
  try {
    const data = JSON.parse(raw) as SceneData;
    return {
      elements: Array.isArray(data.elements) ? data.elements : [],
      appState:
        data.appState && typeof data.appState === "object" ? data.appState : {},
      files: data.files && typeof data.files === "object" ? data.files : {},
    };
  } catch {
    return emptyScene();
  }
}
