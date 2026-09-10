import test from "node:test";
import assert from "node:assert/strict";
import { parsePaper, paperImage, paperInk } from "../src/paper.ts";
test("paper parsing rejects invalid saved colors and patterns", () => {
  assert.deepEqual(
    parsePaper({
      color: "url(javascript:bad)",
      pattern: "bad",
      spacing: Infinity,
    }),
    { color: "#ffffff", pattern: "plain", spacing: 24 },
  );
  assert.deepEqual(
    parsePaper(null, { color: "#fff8e7", pattern: "grid", spacing: 30 }),
    { color: "#fff8e7", pattern: "grid", spacing: 30 },
  );
  assert.equal(parsePaper({ spacing: 1 }).spacing, 12);
  assert.equal(parsePaper({ spacing: 1000 }).spacing, 80);
});
test("paper grid is a self-contained SVG tile with contrasting ink", () => {
  assert.equal(paperInk("#000000"), "#ffffff");
  assert.equal(paperInk("#ffffff"), "#1e293b");
  const tile = decodeURIComponent(
    paperImage(parsePaper({ pattern: "grid", spacing: 32 })),
  );
  assert.ok(tile.includes('width="32"'));
  assert.ok(tile.includes("M 32 0 H 0 V 32"));
  assert.ok(!tile.includes("<script"));
});
