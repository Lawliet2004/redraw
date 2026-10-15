/**
 * Recognition worker — keeps ONNX inference off the UI thread.
 * Receives pre-rendered RGB strips (one per text line), runs the PP-OCRv5
 * model, returns CTC-decoded text with per-character confidence.
 */
import type { InkWorkerIn, InkWorkerOut } from "./types";
import { ctcDecode } from "./decode";
// bundled ORT wasm backend assets — vite emits these as content-hashed files
import ortMjsUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.mjs?url";
import ortWasmUrl from "../../node_modules/onnxruntime-web/dist/ort-wasm-simd-threaded.jsep.wasm?url";

type OrtModule = typeof import("onnxruntime-web");
let ort: OrtModule | null = null;
let session: import("onnxruntime-web").InferenceSession | null = null;
let dict: string[] = [];
let jobGen = 0;

const post = (m: InkWorkerOut) => self.postMessage(m);

async function init(model: ArrayBuffer, dictText: string) {
  ort = await import("onnxruntime-web");
  // ORT 1.21 dynamically imports its wasm glue module; give it the bundled
  // asset URLs so it works in dev, build, and the Tauri webview alike
  ort.env.wasm.wasmPaths = { mjs: ortMjsUrl, wasm: ortWasmUrl } as never;
  ort.env.wasm.numThreads = 1;
  ort.env.logLevel = "error";
  dict = dictText.split(/\r?\n/).filter((l) => l.length > 0);
  session = await ort.InferenceSession.create(model, {
    executionProviders: ["wasm"],
    graphOptimizationLevel: "all",
  });
}

function preprocess(img: { pixels: ArrayBuffer; width: number; height: number }) {
  const { pixels, width: w, height: h } = img;
  const src = new Uint8Array(pixels);
  const data = new Float32Array(3 * h * w);
  for (let c = 0; c < 3; c++)
    for (let i = 0; i < w * h; i++) data[c * w * h + i] = src[i * 3 + c] / 255;
  return new ort!.Tensor("float32", data, [1, 3, h, w]);
}

self.onmessage = async (e: MessageEvent<InkWorkerIn>) => {
  const msg = e.data;
  try {
    if (msg.type === "init") {
      await init(msg.model, msg.dict);
      post({ type: "ready" });
    } else if (msg.type === "recognize") {
      if (!session || !ort) throw new Error("Recognizer not initialized");
      const gen = ++jobGen;
      const lines: { text: string; confidence: number; charConfs: number[] }[] = [];
      for (const img of msg.images) {
        if (gen !== jobGen) return; // superseded
        const input = preprocess(img);
        const res = await session.run({ x: input });
        const out = res[session.outputNames[0]];
        const dims = out.dims;
        const T = dims.length === 3 ? dims[1] : dims[0];
        const C = dims.length === 3 ? dims[2] : dims[1];
        lines.push(ctcDecode(out.data as Float32Array, T, C, dict));
        input.dispose();
        out.dispose();
      }
      post({ type: "result", job: msg.job, lines });
    } else if (msg.type === "dispose") {
      await session?.release();
      session = null;
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    if (msg.type === "init") post({ type: "init-error", error });
    else post({ type: "result-error", job: msg.type === "recognize" ? msg.job : -1, error });
  }
};
