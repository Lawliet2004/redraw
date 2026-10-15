import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

// @ts-expect-error process is a nodejs global
const host = process.env.TAURI_DEV_HOST;

export default defineConfig(async () => ({
  plugins: [react()],
  define: {
    "process.env.IS_PREACT": JSON.stringify(false),
  },
  optimizeDeps: {
    include: ["@excalidraw/excalidraw", "onnxruntime-web"],
  },
  build: {
    target: "esnext",
    minify: "esbuild",
    cssMinify: true,
    chunkSizeWarningLimit: 2000,
  },
  worker: {
    // module workers so Smart Ink's recognizer can code-split (safe in all
    // Tauri webviews; iife would forbid the worker's imports)
    format: "es",
  },
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: "ws",
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
}));
