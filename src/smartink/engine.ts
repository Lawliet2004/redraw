/**
 * Main-thread handle for the recognition worker. Owns model download,
 * session reuse, job sequencing and cancellation.
 */
import { loadDict, loadModel, loadWordList, MODEL } from "./modelStore";
import { loadWordList as loadCorrectorWords } from "./correct";
import type { InkLineImage, InkWorkerIn, InkWorkerOut } from "./types";

export type InkEngineStatus =
  | "idle"
  | "downloading"
  | "initializing"
  | "ready"
  | "busy"
  | "error";

export type RecognizedLineOut = {
  text: string;
  confidence: number;
  charConfs: number[];
};

export class InkRecognizer {
  private worker: Worker | null = null;
  private readyPromise: Promise<void> | null = null;
  private pending = new Map<
    number,
    { resolve: (l: RecognizedLineOut[]) => void; reject: (e: Error) => void }
  >();
  private jobSeq = 0;
  private activeJob = -1;
  status: InkEngineStatus = "idle";
  statusDetail = "";
  onStatus: (s: InkEngineStatus, detail?: string) => void = () => {};

  private setStatus(s: InkEngineStatus, detail = "") {
    this.status = s;
    this.statusDetail = detail;
    this.onStatus(s, detail);
  }

  /** Download+init the model if needed; resolves when ready. */
  ensureReady(): Promise<void> {
    if (this.status === "ready" || this.status === "busy") return Promise.resolve();
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      this.setStatus("downloading");
      const [model, dict, words] = await Promise.all([
        loadModel((p) =>
          this.setStatus(
            "downloading",
            `${Math.round((p.loaded / p.total) * 100)}% · ${(p.loaded / 1048576).toFixed(1)}/${(p.total / 1048576).toFixed(1)} MB`,
          ),
        ),
        loadDict(),
        loadWordList(),
      ]);
      if (words) loadCorrectorWords(words);
      this.setStatus("initializing");
      const worker = new Worker(new URL("./ink.worker.ts", import.meta.url), {
        type: "module",
      });
      this.worker = worker;
      worker.onmessage = (e: MessageEvent<InkWorkerOut>) => this.onMessage(e.data);
      worker.onerror = (e) => {
        this.setStatus("error", e.message || "Worker error");
      };
      await new Promise<void>((resolve, reject) => {
        const onMsg = (e: MessageEvent<InkWorkerOut>) => {
          if (e.data.type === "ready") {
            worker.removeEventListener("message", onMsg);
            resolve();
          } else if (e.data.type === "init-error") {
            worker.removeEventListener("message", onMsg);
            reject(new Error(e.data.error));
          }
        };
        worker.addEventListener("message", onMsg);
        worker.postMessage({ type: "init", model, dict } satisfies InkWorkerIn, [
          model,
        ]);
      });
      this.setStatus("ready", MODEL.label);
    })().catch((e) => {
      this.readyPromise = null;
      this.worker?.terminate();
      this.worker = null;
      this.setStatus("error", e instanceof Error ? e.message : String(e));
      throw e;
    });
    return this.readyPromise;
  }

  private onMessage(msg: InkWorkerOut) {
    if (msg.type === "result") {
      const p = this.pending.get(msg.job);
      if (!p) return;
      this.pending.delete(msg.job);
      this.activeJob = -1;
      this.setStatus("ready", MODEL.label);
      p.resolve(msg.lines);
    } else if (msg.type === "result-error") {
      const p = this.pending.get(msg.job);
      this.pending.delete(msg.job);
      this.activeJob = -1;
      this.setStatus("ready", MODEL.label);
      p?.reject(new Error(msg.error));
    }
  }

  /** Recognize a batch of pre-rendered line images. Stale jobs are dropped. */
  async recognize(images: InkLineImage[]): Promise<RecognizedLineOut[]> {
    await this.ensureReady();
    if (!this.worker) throw new Error("Recognizer unavailable");
    const job = ++this.jobSeq;
    // cancel a stale pending job
    if (this.activeJob >= 0) {
      const stale = this.pending.get(this.activeJob);
      this.pending.delete(this.activeJob);
      stale?.reject(new Error("superseded"));
    }
    this.activeJob = job;
    this.setStatus("busy");
    return new Promise((resolve, reject) => {
      this.pending.set(job, { resolve, reject });
      const transfers = images.map((i) => i.pixels);
      this.worker!.postMessage(
        { type: "recognize", job, images } satisfies InkWorkerIn,
        transfers,
      );
    });
  }

  /** Drop any in-flight recognition (kept model warm). */
  cancelActive() {
    if (this.activeJob >= 0) {
      const stale = this.pending.get(this.activeJob);
      this.pending.delete(this.activeJob);
      this.activeJob = -1;
      stale?.reject(new Error("cancelled"));
    }
    if (this.status === "busy") this.setStatus("ready", MODEL.label);
  }

  async dispose() {
    this.cancelActive();
    this.readyPromise = null;
    this.worker?.postMessage({ type: "dispose" } satisfies InkWorkerIn);
    this.worker?.terminate();
    this.worker = null;
    this.setStatus("idle");
  }
}
