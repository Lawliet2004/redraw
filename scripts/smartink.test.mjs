/**
 * Smart Ink unit tests — exercises the pure modules (stroke grouping, CTC
 * decode, correction, settings parsing, spacing/decoration layout).
 *
 * The src modules are TypeScript, which this node build can't import
 * directly, so we transpile the dependency-free subset with esbuild first.
 * `@excalidraw/excalidraw` is aliased to a tiny stub — only FONT_FAMILY is
 * needed at runtime by fonts.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";
import { fileURLToPath } from "node:url";
import path from "node:path";

const dir = path.dirname(fileURLToPath(import.meta.url));
const root = path.join(dir, "..");
const out = path.join(dir, ".smartink.bundle.mjs");

await build({
  stdin: {
    contents: `
      export * as strokes from "./src/smartink/strokes";
      export * as decode from "./src/smartink/decode";
      export * as correct from "./src/smartink/correct";
      export * as types from "./src/smartink/types";
      export * as decorate from "./src/smartink/decorate";
    `,
    resolveDir: root,
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "neutral",
  target: "es2022",
  outfile: out,
  alias: {
    "@excalidraw/excalidraw": path.join(dir, "stubs/excalidraw-stub.mjs"),
  },
  logLevel: "silent",
});

const { strokes, decode, correct, types, decorate } = await import(
  `file://${out}`
);

/* ——— helpers ——— */

const mkStroke = (id, x0, y0, x1, y1, updated = 1) => {
  const points = [];
  const steps = 4;
  for (let i = 0; i <= steps; i++)
    points.push([x0 + ((x1 - x0) * i) / steps, y0 + ((y1 - y0) * i) / steps, 0.5]);
  return {
    id,
    points,
    strokeWidth: 2,
    minX: Math.min(x0, x1),
    minY: Math.min(y0, y1),
    maxX: Math.max(x0, x1),
    maxY: Math.max(y0, y1),
    updated,
  };
};

const mkEl = (id, pts, x = 0, y = 0, extra = {}) => ({
  id,
  type: "freedraw",
  isDeleted: false,
  x,
  y,
  points: pts,
  pressures: [],
  strokeWidth: 2,
  updated: 1,
  ...extra,
});

/* ——— stroke extraction & grouping ——— */

test("isInkStrokeElement filters non-freedraw, deleted and decorations; taps count", () => {
  const good = mkEl("a", [[0, 0], [5, 0], [9, 2]]);
  assert.equal(strokes.isInkStrokeElement(good), true);
  assert.equal(
    strokes.isInkStrokeElement({ ...good, type: "rectangle" }),
    false,
  );
  assert.equal(strokes.isInkStrokeElement({ ...good, isDeleted: true }), false);
  assert.equal(
    strokes.isInkStrokeElement({ ...good, customData: { inkDeco: {} } }),
    false,
  );
  // single-point taps are kept — they are how dots on i/j and periods land
  assert.equal(strokes.isInkStrokeElement({ ...good, points: [[0, 0]] }), true);
  assert.equal(strokes.isInkStrokeElement({ ...good, points: [] }), false);
});

test("strokeFromElement lifts local points into scene coordinates", () => {
  const s = strokes.strokeFromElement(
    mkEl("s", [[0, 0], [10, 0], [10, 5]], 100, 50),
  );
  assert.deepEqual(s.points[0], [100, 50, 0]);
  assert.deepEqual(s.points[2], [110, 55, 0]);
  assert.equal(s.minX, 100);
  assert.equal(s.maxY, 55);
});

test("clusterLines groups strokes on one baseline and orders left→right", () => {
  const word = [
    mkStroke("b", 60, 0, 90, 30), // "orld" written after "W" on the same line
    mkStroke("a", 0, 2, 50, 28),
  ];
  const lines = strokes.clusterLines(word);
  assert.equal(lines.length, 1);
  assert.deepEqual(lines[0].strokes.map((s) => s.id), ["a", "b"]);
});

test("clusterLines separates vertically distinct lines", () => {
  const lines = strokes.clusterLines([
    mkStroke("l2", 0, 60, 80, 90),
    mkStroke("l1", 0, 0, 80, 28),
  ]);
  assert.equal(lines.length, 2);
  assert.equal(lines[0].strokes[0].id, "l1");
});

test("linesToBlocks splits far-apart lines into separate blocks", () => {
  const one = strokes.clusterLines([
    mkStroke("a", 0, 0, 100, 25),
    mkStroke("b", 0, 40, 100, 65),
    mkStroke("far", 0, 400, 100, 425),
  ]);
  const blocks = strokes.linesToBlocks(one, 1.5);
  assert.equal(blocks.length, 2);
  assert.equal(blocks[0].lines.length, 2);
  assert.equal(blocks[1].lines.length, 1);
});

test("spatialClusters joins touching strokes, splits distant ones", () => {
  const clusters = strokes.spatialClusters(
    [
      mkStroke("w1a", 0, 0, 40, 20),
      mkStroke("w1b", 45, 0, 90, 20),
      mkStroke("w2", 400, 300, 460, 320),
    ],
    20,
  );
  assert.equal(clusters.length, 2);
  assert.ok(clusters.some((c) => c.length === 2 && c[0].id.startsWith("w1")));
});

test("collectStrokes mixes scene elements and keeps order", () => {
  const els = [
    mkEl("x", [[0, 0], [4, 0]]),
    { id: "r", type: "rectangle", isDeleted: false },
    mkEl("d", [[0, 0], [4, 0]], 0, 0, { isDeleted: true }),
  ];
  const out = strokes.collectStrokes(els);
  assert.equal(out.length, 1);
  assert.equal(out[0].id, "x");
});

/* ——— CTC decode ——— */

const DICT = ["a", "b", "c", " "]; // demo dict; class k→dict[k-1], C-1 = space
const encode = (ids, C = 6, T = 30) => {
  const logits = new Float32Array(T * C).fill(-10);
  ids.forEach((cls, t) => {
    logits[t * C + cls] = 10; // strong argmax
  });
  return { logits, T, C };
};

test("ctcDecode maps classes, collapses repeats, skips blanks", () => {
  // classes: blank, a, a, blank, b, space-class(5), c
  const ids = new Array(30).fill(0);
  [1, 2].forEach((t) => (ids[t] = 1));
  [10, 11].forEach((t) => (ids[t] = 1)); // second 'a' after blank → kept
  [12, 13].forEach((t) => (ids[t] = 2));
  [16, 17].forEach((t) => (ids[t] = 5)); // space class (C-1)
  [20].forEach((t) => (ids[t] = 3));
  const { text, confidence, charConfs } = decode.ctcDecode(
    encode(ids).logits,
    30,
    6,
    DICT,
  );
  assert.equal(text, "aab c");
  assert.equal(charConfs.length, 5);
  assert.ok(confidence > 0.9);
});

test("ctcDecode produces spaces via the final class", () => {
  const ids = new Array(12).fill(0);
  ids[2] = 1; // a
  ids[5] = 5; // space (C-1)
  ids[8] = 2; // b
  assert.equal(decode.ctcDecode(encode(ids, 6, 12).logits, 12, 6, DICT).text, "a b");
});

test("wordConfidences reports per-word minimum confidence", () => {
  const out = decode.wordConfidences("ab cd", [0.9, 0.8, 0.5, 0.7]);
  assert.deepEqual(
    out.map((w) => [w.word, w.conf]),
    [["ab", 0.8], ["cd", 0.5]],
  );
});

/* ——— correction ——— */

test("tidySpaces repairs spacing around punctuation", () => {
  assert.equal(correct.tidySpaces("hello ,  world !"), "hello, world!");
  assert.equal(correct.tidySpaces("12 . 50"), "12.50");
  assert.equal(correct.tidySpaces("( 3 + 2 )"), "(3 + 2)");
});

test("disambiguateLine resolves letter/digit lookalikes by context", () => {
  assert.equal(correct.disambiguateLine("l23"), "l23"); // alpha+digit stays (codes, ids)
  assert.equal(correct.disambiguateLine("te5t"), "te5t"); // digit inside alpha word kept? token stays alpha → digit→alpha
});

test("rescueWord fixes only unique single-edit dictionary slips", () => {
  correct.loadWordList("the\nquick\nbrown\nfox\nmeeting\nhouse\nhello\nworld");
  assert.equal(correct.rescueWord("teh"), "the");
  assert.equal(correct.rescueWord("hellp"), "hello");
  assert.equal(correct.rescueWord("McLaren"), "McLaren"); // mixed case left alone
  assert.equal(correct.rescueWord("x1"), "x1");
});

test("correctLine leaves confident text untouched", () => {
  correct.loadWordList("hello\nworld");
  const out = correct.correctLine(
    "hello world",
    [
      { word: "hello", conf: 0.99, start: 0, end: 5 },
      { word: "world", conf: 0.99, start: 6, end: 11 },
    ],
    { spellFix: true },
  );
  assert.equal(out, "hello world");
});

/* ——— settings parsing ——— */

test("parseSmartInkSettings fills defaults and clamps ranges", () => {
  const d = types.parseSmartInkSettings(undefined);
  assert.equal(d.enabled, false);
  assert.equal(d.mode, "auto");
  const p = types.parseSmartInkSettings({
    enabled: true,
    mode: "auto",
    delayMs: 50, // below min → clamped
    confidence: 2, // above max → clamped
    style: { fontSize: 999, color: "red", align: "right", bold: true },
  });
  assert.equal(p.enabled, true);
  assert.equal(p.delayMs, 300);
  assert.equal(p.confidence, 0.99);
  assert.equal(p.style.fontSize, 160);
  assert.equal(p.style.color, "#1e293b"); // invalid → default
  assert.equal(p.style.align, "right");
  assert.equal(p.style.bold, true);
});

/* ——— decorate spacing helpers ——— */

test("applySpacing adds thin spaces and stripSpacing removes them", () => {
  const spaced = decorate.applySpacing("hi you", 0.2);
  assert.ok([...spaced].some((c) => "     ​﻿".includes(c)));
  assert.equal(decorate.stripSpacing(spaced), "hi you");
  assert.equal(decorate.stripSpacing("plain"), "plain");
  // near-zero tracking → unchanged
  assert.equal(decorate.applySpacing("hi", 0.01), "hi");
});

test("decoSignature changes with position and text", () => {
  const el = {
    x: 0,
    y: 0,
    width: 100,
    height: 30,
    fontSize: 20,
    fontFamily: 100,
    lineHeight: 1.25,
    textAlign: "left",
    angle: 0,
  };
  const style = { ...types.DEFAULT_INK_STYLE, underline: true };
  const a = decorate.decoSignature(el, style, "hello");
  const moved = { ...el, x: 40 };
  assert.notEqual(decorate.decoSignature(moved, style, "hello"), a);
  assert.notEqual(decorate.decoSignature(el, style, "hello!"), a);
  assert.equal(decorate.decoSignature(el, style, "hello"), a);
});

test("styledTextSkeletons emits text + underline/highlight decos in one group", () => {
  const style = {
    ...types.DEFAULT_INK_STYLE,
    underline: true,
    highlight: "#fff176",
  };
  const { textId, skeletons } = decorate.styledTextSkeletons(
    "hello\nworld",
    style,
    10,
    20,
  );
  const text = skeletons.find((s) => s.type === "text");
  assert.equal(text.id, textId);
  assert.equal(text.text, "hello\nworld");
  assert.ok(text.customData.redrawInk.rawText === "hello\nworld");
  const decos = skeletons.filter(
    (s) => s.type !== "text" && s.customData?.inkDeco?.parent === textId,
  );
  // 2 lines × (underline + highlight)
  assert.equal(decos.length, 4);
  const group = text.groupIds[0];
  assert.ok(decos.every((d) => d.groupIds.includes(group)));
  // highlights come before the text, strokes after
  const roles = decos.map((d) => d.customData.inkDeco.role);
  assert.deepEqual(roles.sort(), ["highlight", "highlight", "underline", "underline"]);
});
