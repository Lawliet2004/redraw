import test from "node:test";
import assert from "node:assert/strict";
import { SaveQueue } from "../src/saveQueue.ts";

test("a failed save retries identical data and does not block later writes", async () => {
  const writes = [];
  const queue = new SaveQueue(async (id, payload) => {
    writes.push([id, payload]);
    if (writes.length === 1) throw new Error("disk unavailable");
  });
  await assert.rejects(queue.save("page", "scene"), /disk unavailable/);
  await queue.save("page", "scene");
  await queue.save("other", "next");
  assert.deepEqual(writes, [
    ["page", "scene"],
    ["page", "scene"],
    ["other", "next"],
  ]);
});

test("concurrent saves serialize and successful duplicate payloads are skipped per page", async () => {
  const writes = [];
  let release;
  const first = new Promise((resolve) => {
    release = resolve;
  });
  const queue = new SaveQueue(async (id, payload) => {
    writes.push([id, payload]);
    if (writes.length === 1) await first;
  });
  const a = queue.save("page", "one");
  const b = queue.save("page", "two");
  const c = queue.save("page", "two");
  const d = queue.save("other", "two");
  await new Promise((resolve) => setImmediate(resolve));
  assert.deepEqual(writes, [["page", "one"]]);
  release();
  await Promise.all([a, b, c, d]);
  assert.deepEqual(writes, [
    ["page", "one"],
    ["page", "two"],
    ["other", "two"],
  ]);
});

test("returning to an older payload persists the actual newest state", async () => {
  const writes = [];
  const queue = new SaveQueue(async (_id, payload) => {
    writes.push(payload);
  });
  await queue.save("page", "one");
  await queue.save("page", "two");
  await queue.save("page", "one");
  assert.deepEqual(writes, ["one", "two", "one"]);
});
