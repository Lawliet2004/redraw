import test from "node:test";
import assert from "node:assert/strict";
import { parseDiagram } from "../src/diagram.ts";
const node = (id = "a") => ({ id, label: "Start", shape: "rectangle" });
test("accepts fenced JSON and cycles without interpreting labels as markup", () => {
  const diagram = {
    nodes: [{ ...node(), label: "<script>alert(1)</script>" }, node("b")],
    edges: [
      { from: "a", to: "b" },
      { from: "b", to: "a", label: "Retry" },
    ],
  };
  assert.deepEqual(
    parseDiagram("```json\n" + JSON.stringify(diagram) + "\n```"),
    diagram,
  );
});
test("rejects malformed JSON and schema", () => {
  for (const raw of [
    "garbage",
    "null",
    "[]",
    "{}",
    JSON.stringify({ nodes: [{ ...node(), shape: "triangle" }], edges: [] }),
  ])
    assert.throws(() => parseDiagram(raw));
});
test("rejects duplicate ids and missing edge references", () => {
  assert.throws(
    () => parseDiagram(JSON.stringify({ nodes: [node(), node()], edges: [] })),
    /unique/,
  );
  assert.throws(
    () =>
      parseDiagram(
        JSON.stringify({
          nodes: [node()],
          edges: [{ from: "a", to: "missing" }],
        }),
      ),
    /reference/,
  );
});
test("enforces graph, identifier, and label limits", () => {
  for (const nodes of [
    [],
    Array.from({ length: 41 }, (_, i) => node(String(i))),
    [node("x".repeat(65))],
    [{ ...node(), label: "x".repeat(201) }],
  ])
    assert.throws(() => parseDiagram(JSON.stringify({ nodes, edges: [] })));
  assert.throws(() =>
    parseDiagram(
      JSON.stringify({
        nodes: [node()],
        edges: Array.from({ length: 81 }, () => ({ from: "a", to: "a" })),
      }),
    ),
  );
  assert.throws(() =>
    parseDiagram(
      JSON.stringify({
        nodes: [node()],
        edges: [{ from: "a", to: "a", label: "x".repeat(201) }],
      }),
    ),
  );
});
test("rejects unexpected properties rather than forwarding provider instructions or coordinates", () => {
  assert.throws(
    () =>
      parseDiagram(
        JSON.stringify({ nodes: [{ ...node(), x: 10 }], edges: [] }),
      ),
    /unexpected/i,
  );
});
