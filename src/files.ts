import type {
  BinaryFileData,
  ExcalidrawImperativeAPI,
} from "@excalidraw/excalidraw/types";
import type { ExcalidrawElementSkeleton } from "@excalidraw/excalidraw/data/transform";
import { isTauri } from "./platform";

const MAX_IMAGE_BYTES = 20 * 1024 * 1024;
const MAX_IMAGE_SIDE = 600;
const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "svg"];

function mimeFromName(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  if (ext === "jpg") return "image/jpeg";
  if (ext === "svg") return "image/svg+xml";
  return IMAGE_EXTENSIONS.includes(ext) ? `image/${ext}` : "";
}

/** Android returns content:// URIs without extensions — sniff magic bytes. */
function sniffMime(b: Uint8Array): string {
  if (b[0] === 0x89 && b[1] === 0x50) return "image/png";
  if (b[0] === 0xff && b[1] === 0xd8) return "image/jpeg";
  if (b[0] === 0x47 && b[1] === 0x49) return "image/gif";
  if (b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
  if (/<svg|<\?xml/i.test(new TextDecoder().decode(b.slice(0, 256)))) return "image/svg+xml";
  return "";
}

export async function saveBlob(
  fileName: string,
  blob: Blob,
  filters: { name: string; extensions: string[] }[],
): Promise<boolean> {
  if (isTauri()) {
    const { save } = await import("@tauri-apps/plugin-dialog");
    const { writeFile } = await import("@tauri-apps/plugin-fs");
    const path = await save({ defaultPath: fileName, filters });
    if (!path) return false;
    await writeFile(path, new Uint8Array(await blob.arrayBuffer()));
    return true;
  }
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
  return true;
}

export async function pickImageFiles(): Promise<File[]> {
  if (isTauri()) {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const { readFile } = await import("@tauri-apps/plugin-fs");
    const picked = await open({
      multiple: true,
      filters: [{ name: "Images", extensions: IMAGE_EXTENSIONS }],
    });
    if (!picked) return [];
    const paths = Array.isArray(picked) ? picked : [picked];
    const files: File[] = [];
    for (const path of paths) {
      const name = decodeURIComponent(path.split(/[\\/]/).pop() || "image");
      const bytes = await readFile(path);
      const type = mimeFromName(name) || sniffMime(bytes);
      if (!type) throw new Error(`${name} isn't a supported image.`);
      files.push(new File([bytes], name, { type }));
    }
    return files;
  }
  return new Promise<File[]>((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    const done = (files: File[]) => {
      input.remove();
      resolve(files);
    };
    input.addEventListener("change", () => done(Array.from(input.files ?? [])));
    input.addEventListener("cancel", () => done([]));
    document.body.append(input);
    input.click();
  });
}

function readDataURL(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error(`Couldn't read ${file.name}.`));
    reader.readAsDataURL(file);
  });
}

function measure(dataURL: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () =>
      resolve({ width: img.naturalWidth, height: img.naturalHeight });
    img.onerror = () => reject(new Error("Couldn't read that image."));
    img.src = dataURL;
  });
}

export async function insertImages(
  api: ExcalidrawImperativeAPI,
  files: File[],
): Promise<void> {
  if (!files.length) return;
  for (const file of files)
    if (file.size > MAX_IMAGE_BYTES)
      throw new Error(`${file.name} is larger than 20 MB.`);
  const { convertToExcalidrawElements } =
    await import("@excalidraw/excalidraw");
  const state = api.getAppState();
  const centerX = -state.scrollX + state.width / state.zoom.value / 2;
  const centerY = -state.scrollY + state.height / state.zoom.value / 2;
  const added: ExcalidrawElementSkeleton[] = [];
  const binaries: BinaryFileData[] = [];
  for (const [index, file] of files.entries()) {
    const dataURL = await readDataURL(file);
    const natural = await measure(dataURL);
    const scale = Math.min(
      1,
      MAX_IMAGE_SIDE / Math.max(natural.width, natural.height, 1),
    );
    const width = Math.round(natural.width * scale);
    const height = Math.round(natural.height * scale);
    const fileId = crypto.randomUUID() as BinaryFileData["id"];
    binaries.push({
      id: fileId,
      dataURL: dataURL as BinaryFileData["dataURL"],
      mimeType: (file.type ||
        mimeFromName(file.name)) as BinaryFileData["mimeType"],
      created: Date.now(),
    });
    const offset = index * 24;
    added.push({
      type: "image",
      x: Math.round(centerX - width / 2 + offset),
      y: Math.round(centerY - height / 2 + offset),
      width,
      height,
      fileId,
      status: "saved",
    });
  }
  api.addFiles(binaries);
  const created = convertToExcalidrawElements(added);
  api.updateScene({
    elements: [...api.getSceneElementsIncludingDeleted(), ...created],
    appState: {
      selectedElementIds: Object.fromEntries(
        created.map((el) => [el.id, true]),
      ),
    },
    captureUpdate: "IMMEDIATELY",
  });
}
