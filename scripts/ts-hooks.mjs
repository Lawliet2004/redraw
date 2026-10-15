/**
 * Node module hooks that let `node --test` import the project's .ts sources.
 * This Node build lacks type stripping, so each .ts file is transpiled with
 * esbuild (already a dependency via Vite). Registered by register-ts.mjs.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { transformSync } from "esbuild";

export function load(url, context, nextLoad) {
  if (!url.endsWith(".ts")) return nextLoad(url, context);
  const source = readFileSync(fileURLToPath(url), "utf8");
  const { code } = transformSync(source, {
    loader: "ts",
    format: "esm",
    target: "es2022",
    sourcemap: "inline",
  });
  return { format: "module", source: code, shortCircuit: true };
}
