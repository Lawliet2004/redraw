export type LlmConfig = {
  baseUrl: string;
  apiKey: string;
  model: string;
};

export const DEFAULT_LLM: LlmConfig = {
  baseUrl: "http://localhost:1234/v1",
  apiKey: "",
  model: "local",
};

export const GEMINI_OPENAI_BASE =
  "https://generativelanguage.googleapis.com/v1beta/openai";
export const GEMINI_DEFAULT_MODEL = "gemini-2.0-flash";

export function resolveConfig(c: LlmConfig): LlmConfig {
  const apiKey = c.apiKey.trim();
  let baseUrl = c.baseUrl.trim().replace(/\/+$/, "");
  let model = c.model.trim();
  const geminiKey = apiKey.startsWith("AIza");
  const geminiHost = /generativelanguage\.googleapis\.com/i.test(baseUrl);
  if (geminiKey || geminiHost) {
    const local =
      !baseUrl ||
      baseUrl === DEFAULT_LLM.baseUrl ||
      /localhost|127\.0\.0\.1/i.test(baseUrl);
    if (local || (geminiHost && !/\/openai/i.test(baseUrl))) {
      baseUrl = GEMINI_OPENAI_BASE;
    }
    if (!model || model === "local") model = GEMINI_DEFAULT_MODEL;
  }
  return { baseUrl, apiKey, model };
}

export const SYSTEM_PROMPT =
  "You write on a whiteboard. Match their notation: math stays math. If they left an unfinished line (2 + 2 =, the best food is), only write the missing part, not the whole line. No markdown, bullets, lists, fences, or headings. Short. Don't restate the question.";

export const DRAW_PROMPT =
  "Read the handwriting or drawing. If they left an unfinished line, only write the missing part.";

export function chatUserContent(
  prompt: string,
  image?: string,
): string | { type: string; text?: string; image_url?: { url: string } }[] {
  if (!image) return prompt;
  return [
    { type: "text", text: prompt },
    { type: "image_url", image_url: { url: image } },
  ];
}

export function joinInlineAnswer(prefix: string, addition: string): string {
  const p = prefix.replace(/\s+$/, "");
  const a = addition.trim();
  if (!a) return prefix;
  if (a.startsWith(p) || a.startsWith(prefix.trim())) return a;
  return `${p} ${a}`;
}

/** Next line only when the answer can't sit beside the prompt. */
export function answerGoesBelow(answer: string): boolean {
  const t = answer.trim();
  if (!t || t === "…") return false;
  if (/[\n\r]/.test(t)) return true;
  return t.length > 40;
}

export function asidePos(
  below: boolean,
  b: { minX: number; minY: number; maxX: number; maxY: number },
  height: number,
  gap: number,
): { x: number; y: number } {
  if (below) return { x: b.minX, y: b.maxY + gap };
  const selH = b.maxY - b.minY;
  return {
    x: b.maxX + gap,
    y: b.minY + Math.max(0, (selH - height) / 2),
  };
}

export function completionsUrl(baseUrl: string): string {
  const u = baseUrl.trim().replace(/\/+$/, "");
  if (u.endsWith("/chat/completions")) return u;
  return `${u}/chat/completions`;
}

export function stripAiMarkdown(s: string): string {
  let t = s.replace(/```[\s\S]*?```/g, (block) =>
    block
      .replace(/^```[a-zA-Z0-9]*\n?/, "")
      .replace(/```$/, "")
      .trim(),
  );
  t = t.replace(/^#{1,6}\s+/gm, "");
  t = t.replace(/\*\*([^*]+)\*\*/g, "$1");
  t = t.replace(/__([^_]+)__/g, "$1");
  t = t.replace(/(^|\s)\*([^*]+)\*/g, "$1$2");
  t = t.replace(/^[-*]\s+/gm, "");
  t = t.replace(/^\d+\.\s+/gm, "");
  return t.trim();
}

/** One SSE `data:` line → token, DONE, or null. */
export function parseSseDataLine(line: string): string | "DONE" | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("data:")) return null;
  const payload = trimmed.slice(5).trim();
  if (payload === "[DONE]") return "DONE";
  try {
    const json = JSON.parse(payload) as {
      choices?: { delta?: { content?: unknown } }[];
    };
    const content = json.choices?.[0]?.delta?.content;
    return typeof content === "string" ? content : null;
  } catch {
    return null;
  }
}

function httpError(status: number, body: string): string {
  try {
    const j = JSON.parse(body) as {
      error?: { message?: unknown };
      message?: unknown;
    };
    const m = j.error?.message ?? j.message;
    if (typeof m === "string" && m.trim()) return m.trim().slice(0, 200);
  } catch {
    /* not json */
  }
  return `LLM HTTP ${status}`;
}

function jsonMessage(json: unknown): string {
  const j = json as {
    choices?: {
      message?: { content?: unknown };
      delta?: { content?: unknown };
    }[];
  };
  const msg =
    j.choices?.[0]?.message?.content ?? j.choices?.[0]?.delta?.content;
  return typeof msg === "string" ? msg : "";
}

export function validateLlmConfig(input: LlmConfig): LlmConfig {
  const config = resolveConfig(input);
  let url: URL;
  try {
    url = new URL(config.baseUrl);
  } catch {
    throw new Error("Enter a valid AI base URL.");
  }
  const loopback =
    url.hostname === "localhost" ||
    url.hostname === "[::1]" ||
    /^127(?:\.\d{1,3}){3}$/.test(url.hostname);
  if (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) {
    throw new Error(
      "Use HTTPS for remote AI endpoints. HTTP is allowed only for localhost.",
    );
  }
  if (url.username || url.password || url.search || url.hash)
    throw new Error(
      "AI base URL cannot contain credentials, query parameters, or a fragment.",
    );
  if (!config.model) throw new Error("Choose an AI model.");
  return config;
}

const MAX_RESPONSE = 100_000;
function providerError(json: unknown): void {
  const error = (json as { error?: unknown } | null)?.error;
  if (error) {
    const message =
      typeof error === "string"
        ? error
        : (error as { message?: unknown }).message;
    throw new Error(
      typeof message === "string"
        ? message.slice(0, 200)
        : "The AI provider returned an error.",
    );
  }
}
function bounded(text: string): string {
  if (text.length > MAX_RESPONSE)
    throw new Error(
      "AI response exceeded the size limit. Try a smaller request.",
    );
  return text;
}

/** Owns cancellation for both native and browser fetch, including stalled readers. */
function requestScope(
  external?: AbortSignal,
  timeoutMs = 90_000,
  idleTimeoutMs = 20_000,
) {
  const controller = new AbortController();
  const abort = () =>
    controller.abort(
      external?.reason ?? new DOMException("Request canceled", "AbortError"),
    );
  if (external?.aborted) abort();
  else external?.addEventListener("abort", abort, { once: true });
  const timer = setTimeout(
    () => controller.abort(new Error("AI request timed out. Try again.")),
    timeoutMs,
  );
  const wait = <T>(promise: Promise<T>): Promise<T> =>
    new Promise((resolve, reject) => {
      const signal = controller.signal;
      const stopped = () => {
        cleanup();
        reject(signal.reason);
      };
      const idle = setTimeout(
        () => controller.abort(new Error("AI connection stalled. Try again.")),
        idleTimeoutMs,
      );
      const cleanup = () => {
        clearTimeout(idle);
        signal.removeEventListener("abort", stopped);
      };
      if (signal.aborted) {
        stopped();
        return;
      }
      signal.addEventListener("abort", stopped, { once: true });
      promise.then(
        (value) => {
          cleanup();
          resolve(value);
        },
        (error) => {
          cleanup();
          reject(error);
        },
      );
    });
  return {
    signal: controller.signal,
    wait,
    dispose() {
      clearTimeout(timer);
      external?.removeEventListener("abort", abort);
      controller.abort();
    },
  };
}
type RequestScope = ReturnType<typeof requestScope>;

async function llmFetch(url: string, init: RequestInit): Promise<Response> {
  if (typeof window !== "undefined" && "__TAURI_INTERNALS__" in window) {
    const { fetch: tauriFetch } = await import("@tauri-apps/plugin-http");
    return tauriFetch(url, init);
  }
  return fetch(url, init);
}
function headers(config: LlmConfig): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(config.apiKey ? { Authorization: `Bearer ${config.apiKey}` } : {}),
  };
}
async function readText(res: Response, scope: RequestScope): Promise<string> {
  if (!res.body) return bounded(await scope.wait(res.text()));
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let text = "";
  try {
    for (;;) {
      const { done, value } = await scope.wait(reader.read());
      if (done) return bounded(text + decoder.decode());
      text = bounded(text + decoder.decode(value, { stream: true }));
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
async function checkedFetch(
  url: string,
  init: RequestInit,
  scope: RequestScope,
): Promise<Response> {
  const res = await scope.wait(
    llmFetch(url, { ...init, signal: scope.signal }),
  );
  if (!res.ok)
    throw new Error(httpError(res.status, await readText(res, scope)));
  return res;
}
async function readSse(
  res: Response,
  onDelta: (full: string) => void,
  scope: RequestScope,
): Promise<string> {
  const reader = res.body?.getReader();
  if (!reader) return "";
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";
  let eventType = "";
  const line = (raw: string): boolean => {
    const trimmed = raw.trim();
    if (!trimmed) {
      eventType = "";
      return false;
    }
    if (trimmed.startsWith("event:")) {
      eventType = trimmed.slice(6).trim();
      return false;
    }
    if (!trimmed.startsWith("data:")) return false;
    const payload = trimmed.slice(5).trim();
    if (payload === "[DONE]") return true;
    if (!payload) return false;
    let json: unknown;
    try {
      json = JSON.parse(payload);
    } catch {
      throw new Error("The AI provider sent an invalid stream response.");
    }
    providerError(json);
    if (eventType === "error") throw new Error(httpError(200, payload));
    const piece = jsonMessage(json);
    if (piece) {
      full = bounded(full + piece);
      onDelta(full);
    }
    return false;
  };
  try {
    for (;;) {
      const { done, value } = await scope.wait(reader.read());
      buffer = bounded(buffer + decoder.decode(value, { stream: !done }));
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const item of lines) if (line(item)) return full;
      if (done) {
        if (buffer) line(buffer);
        return full;
      }
    }
  } finally {
    void reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

export async function streamChat(opts: {
  config: LlmConfig;
  prompt: string;
  image?: string;
  signal?: AbortSignal;
  systemPrompt?: string;
  timeoutMs?: number;
  idleTimeoutMs?: number;
  onDelta: (full: string) => void;
}): Promise<string> {
  const config = validateLlmConfig(opts.config);
  const scope = requestScope(opts.signal, opts.timeoutMs, opts.idleTimeoutMs);
  try {
    const res = await checkedFetch(
      completionsUrl(config.baseUrl),
      {
        method: "POST",
        headers: headers(config),
        body: JSON.stringify({
          model: config.model,
          stream: true,
          messages: [
            { role: "system", content: opts.systemPrompt ?? SYSTEM_PROMPT },
            { role: "user", content: chatUserContent(opts.prompt, opts.image) },
          ],
        }),
      },
      scope,
    );
    if ((res.headers.get("content-type") ?? "").includes("application/json")) {
      const json: unknown = JSON.parse(await readText(res, scope));
      providerError(json);
      const text = bounded(jsonMessage(json));
      if (text) opts.onDelta(text);
      return text;
    }
    return await readSse(res, opts.onDelta, scope);
  } finally {
    scope.dispose();
  }
}

export async function listModels(
  input: LlmConfig,
  signal?: AbortSignal,
): Promise<string[]> {
  // Discovery precedes model selection; this sentinel is never sent to the provider.
  const config = validateLlmConfig({
    ...input,
    model: input.model.trim() || "discovery",
  });
  const scope = requestScope(signal, 20_000, 20_000);
  try {
    const base = config.baseUrl.replace(/\/chat\/completions$/, "");
    const res = await checkedFetch(
      `${base}/models`,
      { headers: headers(config) },
      scope,
    );
    const json = JSON.parse(await readText(res, scope)) as {
      data?: { id?: unknown }[];
    };
    providerError(json);
    if (!Array.isArray(json.data))
      throw new Error(
        "Provider did not return a model list. Enter a model manually.",
      );
    return [
      ...new Set(
        json.data.flatMap((item) =>
          typeof item.id === "string" ? [item.id] : [],
        ),
      ),
    ].sort();
  } finally {
    scope.dispose();
  }
}

export async function testConnection(
  config: LlmConfig,
  signal?: AbortSignal,
): Promise<void> {
  const models = await listModels(config, signal);
  if (!models.includes(resolveConfig(config).model))
    throw new Error(
      "Connected, but the selected model was not listed. Check the model name.",
    );
}
