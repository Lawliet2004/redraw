import test from "node:test";
import assert from "node:assert/strict";
import * as llm from "../src/llm.ts";
const config = {
  baseUrl: "http://localhost:1234/v1",
  apiKey: "",
  model: "local",
};
const enc = new TextEncoder();
function response(chunks, close = true) {
  return new Response(
    new ReadableStream({
      start(c) {
        for (const x of chunks) c.enqueue(enc.encode(x));
        if (close) c.close();
      },
    }),
    { headers: { "content-type": "text/event-stream" } },
  );
}
test("final DONE without newline never becomes answer text", async () => {
  globalThis.fetch = async () =>
    response([
      'data: {"choices":[{"delta":{"content":"hello"}}]}\n\ndata: [DONE]',
    ]);
  assert.equal(
    await llm.streamChat({ config, prompt: "x", onDelta() {} }),
    "hello",
  );
});
test("literal DONE content remains valid text", async () => {
  globalThis.fetch = async () =>
    response([
      'data: {"choices":[{"delta":{"content":"DONE"}}]}\n\ndata: [DONE]\n',
    ]);
  assert.equal(
    await llm.streamChat({ config, prompt: "x", onDelta() {} }),
    "DONE",
  );
});
test("provider stream errors are surfaced", async () => {
  globalThis.fetch = async () =>
    response(['data: {"error":{"message":"quota exceeded"}}\n\n']);
  await assert.rejects(
    llm.streamChat({ config, prompt: "x", onDelta() {} }),
    /quota exceeded/,
  );
});
test("rejects insecure remote endpoints", () => {
  assert.throws(
    () =>
      llm.validateLlmConfig({ ...config, baseUrl: "http://example.com/v1" }),
    /HTTPS/,
  );
});
test("cancellation interrupts a stalled response reader", async () => {
  globalThis.fetch = async () => response([], false);
  const controller = new AbortController();
  const result = llm.streamChat({
    config,
    prompt: "x",
    signal: controller.signal,
    onDelta() {},
  });
  setTimeout(() => controller.abort(), 10);
  await assert.rejects(result, { name: "AbortError" });
});
test("idle timeout interrupts a stalled response", async () => {
  globalThis.fetch = async () => response([], false);
  await assert.rejects(
    llm.streamChat({ config, prompt: "x", idleTimeoutMs: 10, onDelta() {} }),
    /stalled/,
  );
});
test("total timeout interrupts fetch even when transport ignores abort", async () => {
  globalThis.fetch = async () => new Promise(() => {});
  await assert.rejects(
    llm.streamChat({ config, prompt: "x", timeoutMs: 10, onDelta() {} }),
    /timed out/,
  );
});
test("stream is decoded across arbitrary chunks and CRLF", async () => {
  globalThis.fetch = async () =>
    response([
      'data: {"choices":[{"delta":{"con',
      'tent":"Hi"}}]}\r\n\r\ndata: [DONE]\r\n',
    ]);
  assert.equal(
    await llm.streamChat({ config, prompt: "x", onDelta() {} }),
    "Hi",
  );
});
test("response size bound prevents unbounded output", async () => {
  globalThis.fetch = async () =>
    response([
      "data: " +
        JSON.stringify({
          choices: [{ delta: { content: "x".repeat(100001) } }],
        }) +
        "\n",
    ]);
  await assert.rejects(
    llm.streamChat({ config, prompt: "x", onDelta() {} }),
    /size limit/,
  );
});
test("JSON responses and custom prompts work", async () => {
  globalThis.fetch = async (_url, init) => {
    assert.equal(JSON.parse(init.body).messages[0].content, "Explain");
    return Response.json({ choices: [{ message: { content: "answer" } }] });
  };
  assert.equal(
    await llm.streamChat({
      config,
      prompt: "x",
      systemPrompt: "Explain",
      onDelta() {},
    }),
    "answer",
  );
});
test("model listing deduplicates and connection verifies selected model", async () => {
  globalThis.fetch = async () =>
    Response.json({ data: [{ id: "local" }, { id: "local" }, { id: "abc" }] });
  assert.deepEqual(await llm.listModels(config), ["abc", "local"]);
  await llm.testConnection(config);
  await assert.rejects(
    llm.testConnection({ ...config, model: "missing" }),
    /not listed/,
  );
});
test("validation allows loopback but rejects embedded credentials and missing model", () => {
  assert.equal(
    llm.validateLlmConfig({ ...config, baseUrl: "http://[::1]:1234/v1" }).model,
    "local",
  );
  assert.throws(
    () =>
      llm.validateLlmConfig({
        ...config,
        baseUrl: "https://key@example.com/v1",
      }),
    /credentials/,
  );
  assert.throws(() => llm.validateLlmConfig({ ...config, model: "" }), /model/);
});
test("named SSE error events are surfaced", async () => {
  globalThis.fetch = async () =>
    response(['event: error\ndata: {"message":"service unavailable"}\n\n']);
  await assert.rejects(
    llm.streamChat({ config, prompt: "x", onDelta() {} }),
    /service unavailable/,
  );
});
test("model discovery accepts a blank model before the user has chosen one", async () => {
  globalThis.fetch = async () =>
    Response.json({ data: [{ id: "available-model" }] });
  assert.deepEqual(await llm.listModels({ ...config, model: "" }), [
    "available-model",
  ]);
  await assert.rejects(
    llm.streamChat({
      config: { ...config, model: "" },
      prompt: "x",
      onDelta() {},
    }),
    /model/,
  );
});
