/**
 * Model asset store: lazily downloads the recognition model once, verifies its
 * checksum, and caches it in Tauri's app-local data dir (desktop/mobile) or
 * IndexedDB (plain-browser fallback). Nothing happens until Smart Ink is used.
 */

export const MODEL = {
  /**
   * Bundled ONNX export of PaddleOCR PP-OCRv5 mobile English recognizer —
   * upstream mirror: huggingface.co/OllmOne/PP-OCRv5 @ c829ee2 (Apache-2.0).
   * Ships inside the app bundle so recognition works offline from first run;
   * the sha256 pin below still guards against corruption.
   */
  url: "/models/en_pp-ocrv5_mobile_rec.onnx",
  sha256: "8307465d3c9ef2ba4055c3bd0be55aafe11f518630212b7598b70ccb376028ac",
  bytes: 7876014,
  fileName: "en_pp-ocrv5_mobile_rec.onnx",
  label: "PP-OCRv5 mobile (English)",
} as const;

export function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function sha256Hex(buf: ArrayBuffer): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/* ————— IndexedDB cache (browser dev / non-Tauri) ————— */

function idb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("redraw-assets", 1);
    req.onupgradeneeded = () => req.result.createObjectStore("models");
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet(key: string): Promise<ArrayBuffer | null> {
  try {
    const db = await idb();
    return await new Promise((res) => {
      const tx = db.transaction("models", "readonly");
      const rq = tx.objectStore("models").get(key);
      rq.onsuccess = () => res((rq.result as ArrayBuffer) ?? null);
      rq.onerror = () => res(null);
    });
  } catch {
    return null;
  }
}

async function idbPut(key: string, value: ArrayBuffer): Promise<void> {
  try {
    const db = await idb();
    await new Promise<void>((res, rej) => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").put(value, key);
      tx.oncomplete = () => res();
      tx.onerror = () => rej(tx.error);
    });
  } catch {
    /* caching is best-effort */
  }
}

/* ————— Tauri fs cache ————— */

async function tauriCachePath(): Promise<string | null> {
  try {
    const { appLocalDataDir, join } = await import("@tauri-apps/api/path");
    const { mkdir, BaseDirectory } = await import("@tauri-apps/plugin-fs");
    await mkdir("models", { baseDir: BaseDirectory.AppLocalData, recursive: true });
    return await join(await appLocalDataDir(), "models", MODEL.fileName);
  } catch {
    return null;
  }
}

async function tauriRead(path: string): Promise<ArrayBuffer | null> {
  try {
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const data = await readFile(path);
    return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength) as ArrayBuffer;
  } catch {
    return null;
  }
}

async function tauriWrite(path: string, buf: ArrayBuffer): Promise<void> {
  const { writeFile } = await import("@tauri-apps/plugin-fs");
  await writeFile(path, new Uint8Array(buf));
}

/** Is the model already cached locally? */
export async function isModelCached(): Promise<boolean> {
  if (isTauri()) {
    const p = await tauriCachePath();
    if (p && (await tauriRead(p))) return true;
  }
  return (await idbGet(MODEL.fileName)) !== null;
}

export type DownloadProgress = { loaded: number; total: number };

async function fetchModel(
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const res = await fetch(MODEL.url, { signal });
  if (!res.ok) throw new Error(`Model download failed (${res.status})`);
  const total = Number(res.headers.get("content-length")) || MODEL.bytes;
  const reader = res.body?.getReader();
  if (!reader) return await res.arrayBuffer();
  const chunks: Uint8Array[] = [];
  let loaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    loaded += value.length;
    onProgress?.({ loaded, total });
  }
  const out = new Uint8Array(loaded);
  let off = 0;
  for (const c of chunks) {
    out.set(c, off);
    off += c.length;
  }
  return out.buffer;
}

/**
 * Get model bytes — cache hit or a fresh verified download.
 * Progress callback receives {loaded,total} during download.
 */
export async function loadModel(
  onProgress?: (p: DownloadProgress) => void,
  signal?: AbortSignal,
): Promise<ArrayBuffer> {
  const tauriPath = isTauri() ? await tauriCachePath() : null;
  let bytes: ArrayBuffer | null = null;
  if (tauriPath) bytes = await tauriRead(tauriPath);
  bytes ??= await idbGet(MODEL.fileName);
  if (bytes) {
    if (bytes.byteLength === MODEL.bytes) {
      onProgress?.({ loaded: MODEL.bytes, total: MODEL.bytes });
      return bytes;
    }
    bytes = null; // truncated/corrupt cache → redownload
  }
  bytes = await fetchModel(onProgress, signal);
  if (bytes.byteLength !== MODEL.bytes)
    throw new Error("Downloaded model has unexpected size.");
  const digest = await sha256Hex(bytes);
  if (digest !== MODEL.sha256)
    throw new Error("Downloaded model failed integrity check.");
  if (tauriPath) await tauriWrite(tauriPath, bytes).catch(() => {});
  await idbPut(MODEL.fileName, bytes).catch(() => {});
  return bytes;
}

export async function clearModelCache(): Promise<void> {
  const tauriPath = isTauri() ? await tauriCachePath() : null;
  if (tauriPath) {
    try {
      const { remove, BaseDirectory } = await import("@tauri-apps/plugin-fs");
      await remove(`models/${MODEL.fileName}`, { baseDir: BaseDirectory.AppLocalData });
    } catch {
      /* best effort */
    }
  }
  try {
    const db = await idb();
    await new Promise<void>((res) => {
      const tx = db.transaction("models", "readwrite");
      tx.objectStore("models").delete(MODEL.fileName);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
  } catch {
    /* ignore */
  }
}

/** The character dictionary ships inside the app bundle. */
export async function loadDict(): Promise<string> {
  const res = await fetch("/ppocrv5_en_dict.txt");
  if (!res.ok) throw new Error("Couldn't load the recognition dictionary.");
  return await res.text();
}

export async function loadWordList(): Promise<string> {
  const res = await fetch("/words.txt");
  if (!res.ok) return "";
  return await res.text();
}
