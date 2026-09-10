import {
  completionsUrl,
  DEFAULT_LLM,
  GEMINI_DEFAULT_MODEL,
  GEMINI_OPENAI_BASE,
  parseSseDataLine,
  resolveConfig,
  stripAiMarkdown,
  joinInlineAnswer,
  chatUserContent,
  answerGoesBelow,
  asidePos,
} from "./llm.ts";

function assert(cond: unknown, msg: string): asserts cond {
  if (!cond) throw new Error(msg);
}

assert(
  completionsUrl("http://localhost:1234/v1/") ===
    "http://localhost:1234/v1/chat/completions",
  "join v1",
);
assert(
  completionsUrl("http://localhost:1234/v1/chat/completions") ===
    "http://localhost:1234/v1/chat/completions",
  "already complete",
);
assert(parseSseDataLine("event: x") === null, "ignore non-data");
assert(parseSseDataLine("data: [DONE]") === "DONE", "done");
assert(
  parseSseDataLine('data: {"choices":[{"delta":{"content":"Hi"}}]}') === "Hi",
  "delta",
);
assert(
  stripAiMarkdown("**bold**\n# title\n- item\n```js\ncode\n```") ===
    "bold\ntitle\nitem\ncode",
  "strip",
);
assert(chatUserContent("2 + 2 =") === "2 + 2 =", "text only");
assert(
  JSON.stringify(chatUserContent("read", "data:image/png;base64,xx")) ===
    JSON.stringify([
      { type: "text", text: "read" },
      { type: "image_url", image_url: { url: "data:image/png;base64,xx" } },
    ]),
  "vision parts",
);
assert(joinInlineAnswer("2 + 2 =", "4") === "2 + 2 = 4", "join missing part");
assert(joinInlineAnswer("2 + 2 =", "2 + 2 = 4") === "2 + 2 = 4", "join restated");
assert(
  joinInlineAnswer("the best food is", "pizza.") === "the best food is pizza.",
  "join sentence",
);
assert(!answerGoesBelow("4"), "short stays right");
assert(!answerGoesBelow("…"), "placeholder stays right");
assert(answerGoesBelow("one\ntwo"), "newline goes below");
assert(
  answerGoesBelow("x".repeat(41)),
  "long goes below",
);
assert(
  JSON.stringify(
    asidePos(false, { minX: 0, minY: 0, maxX: 100, maxY: 40 }, 20, 12),
  ) === JSON.stringify({ x: 112, y: 10 }),
  "right centered",
);
assert(
  JSON.stringify(
    asidePos(true, { minX: 0, minY: 0, maxX: 100, maxY: 40 }, 20, 16),
  ) === JSON.stringify({ x: 0, y: 56 }),
  "below left",
);

assert(
  resolveConfig({
    ...DEFAULT_LLM,
    apiKey: "AIzaSyDummyKeyForTestxxxxxxxx",
  }).baseUrl === GEMINI_OPENAI_BASE,
  "gemini key rewrites localhost",
);
assert(
  resolveConfig({
    ...DEFAULT_LLM,
    apiKey: "AIzaSyDummyKeyForTestxxxxxxxx",
  }).model === GEMINI_DEFAULT_MODEL,
  "gemini default model",
);
assert(
  resolveConfig({
    baseUrl: "https://generativelanguage.googleapis.com/v1beta",
    apiKey: "x",
    model: "gemini-2.5-flash",
  }).baseUrl === GEMINI_OPENAI_BASE,
  "gemini host gets /openai",
);
assert(
  resolveConfig({
    baseUrl: "http://localhost:1234/v1",
    apiKey: "",
    model: "local",
  }).baseUrl === "http://localhost:1234/v1",
  "local unchanged",
);

console.log("llm.selfcheck ok");
