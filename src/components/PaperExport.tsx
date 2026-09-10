import { useState } from "react";
import type { ExcalidrawImperativeAPI } from "@excalidraw/excalidraw/types";
import { paperImage, type Paper } from "../paper";
import Dialog from "./Dialog";

export default function PaperExport({
  api,
  paper,
  name,
  onClose,
}: {
  api: ExcalidrawImperativeAPI;
  paper: Paper;
  name: string;
  onClose: () => void;
}) {
  const [background, setBackground] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function save(format: "png" | "svg") {
    setBusy(true);
    setError("");
    try {
      const { exportToCanvas, exportToSvg, getCommonBounds } = await import(
        "@excalidraw/excalidraw"
      );
      const elements = api.getSceneElements();
      if (!elements.length) throw new Error("Draw something before exporting.");
      const options = {
        elements,
        files: api.getFiles(),
        appState: {
          ...api.getAppState(),
          exportBackground: false,
          exportWithDarkMode: false,
        },
        exportPadding: 24,
      };
      const [x, y] = getCommonBounds(elements);
      const offsetX = 24 - x,
        offsetY = 24 - y;
      let blob: Blob;
      if (format === "png") {
        const drawing = await exportToCanvas(options);
        const canvas = document.createElement("canvas");
        canvas.width = drawing.width;
        canvas.height = drawing.height;
        const ctx = canvas.getContext("2d")!;
        if (background) {
          ctx.fillStyle = paper.color;
          ctx.fillRect(0, 0, canvas.width, canvas.height);
          if (paper.pattern !== "plain") {
            const tile = new Image();
            tile.src = paperImage(paper).slice(5, -2);
            await tile.decode();
            const pattern = ctx.createPattern(tile, "repeat")!;
            pattern.setTransform(new DOMMatrix().translate(offsetX, offsetY));
            ctx.fillStyle = pattern;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
          }
        }
        ctx.drawImage(drawing, 0, 0);
        blob = await new Promise<Blob>((resolve, reject) =>
          canvas.toBlob(
            (b) => (b ? resolve(b) : reject(new Error("Image export failed"))),
            "image/png",
          ),
        );
      } else {
        const svg = await exportToSvg(options);
        if (background) {
          const ns = "http://www.w3.org/2000/svg";
          const rect = document.createElementNS(ns, "rect");
          rect.setAttribute("width", "100%");
          rect.setAttribute("height", "100%");
          rect.setAttribute("fill", paper.color);
          svg.insertBefore(rect, svg.firstChild);
          if (paper.pattern !== "plain") {
            const defs = document.createElementNS(ns, "defs");
            const pattern = document.createElementNS(ns, "pattern");
            pattern.id = "redraw-paper";
            pattern.setAttribute("patternUnits", "userSpaceOnUse");
            pattern.setAttribute("width", String(paper.spacing));
            pattern.setAttribute("height", String(paper.spacing));
            pattern.setAttribute("x", String(offsetX));
            pattern.setAttribute("y", String(offsetY));
            const tile = document.createElementNS(ns, "image");
            tile.setAttribute("href", paperImage(paper).slice(5, -2));
            tile.setAttribute("width", String(paper.spacing));
            tile.setAttribute("height", String(paper.spacing));
            pattern.append(tile);
            defs.append(pattern);
            svg.insertBefore(defs, rect);
            const overlay = rect.cloneNode() as SVGRectElement;
            overlay.setAttribute("fill", "url(#redraw-paper)");
            rect.after(overlay);
          }
        }
        blob = new Blob([new XMLSerializer().serializeToString(svg)], {
          type: "image/svg+xml",
        });
      }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = `${name.replace(/[<>:"/\\|?*]/g, "_")}.${format}`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <Dialog title="Export image" onClose={onClose}>
      <p className="muted">
        Export the drawing with its page color and paper pattern, or use a
        transparent background.
      </p>
      <label className="switch-row">
        Include paper background
        <input
          type="checkbox"
          checked={background}
          onChange={(e) => setBackground(e.target.checked)}
        />
      </label>
      {error && <p role="alert">{error}</p>}
      <footer className="dialog-actions">
        <button disabled={busy} onClick={() => void save("svg")}>
          Export SVG
        </button>
        <button
          disabled={busy}
          className="primary"
          onClick={() => void save("png")}
        >
          Export PNG
        </button>
      </footer>
    </Dialog>
  );
}
