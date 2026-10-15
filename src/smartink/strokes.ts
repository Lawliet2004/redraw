/**
 * Extract freedraw strokes from scene elements and group them into text
 * lines/blocks using bounding-box geometry. Pure functions — unit tested.
 */
import type {
  ExcalidrawElement,
  ExcalidrawFreeDrawElement,
} from "@excalidraw/excalidraw/element/types";
import type { InkBlock, InkLine, InkStroke } from "./types";

export function isInkStrokeElement(el: ExcalidrawElement): el is ExcalidrawFreeDrawElement {
  return (
    el.type === "freedraw" &&
    !el.isDeleted &&
    !el.customData?.inkDeco &&
    Array.isArray(el.points) &&
    el.points.length >= 1
  );
}

/** Lift a freedraw element into scene-space stroke points (x, y, pressure). */
export function strokeFromElement(el: ExcalidrawFreeDrawElement): InkStroke {
  const pressures = el.pressures ?? [];
  const pts = el.points.map((p, i) => [
    el.x + p[0],
    el.y + p[1],
    pressures[i] ?? 0,
  ]) as [number, number, number][];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [x, y] of pts) {
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
  }
  return {
    id: el.id,
    points: pts,
    strokeWidth: el.strokeWidth || 2,
    minX, minY, maxX, maxY,
    updated: el.updated ?? 0,
  };
}

const bounds = <T extends { minX: number; minY: number; maxX: number; maxY: number }>(
  list: T[],
) => ({
  minX: Math.min(...list.map((s) => s.minX)),
  minY: Math.min(...list.map((s) => s.minY)),
  maxX: Math.max(...list.map((s) => s.maxX)),
  maxY: Math.max(...list.map((s) => s.maxY)),
});

const median = (nums: number[]) => {
  const s = [...nums].sort((a, b) => a - b);
  return s[Math.floor(s.length / 2)] || 0;
};

/**
 * Cluster strokes into horizontal text lines: strokes whose vertical bands
 * overlap (or nearly overlap) belong to the same line. Lines are ordered
 * top→bottom; strokes inside a line are ordered left→right.
 */
export function clusterLines(strokes: InkStroke[]): InkLine[] {
  if (!strokes.length) return [];
  const sorted = [...strokes].sort(
    (a, b) => (a.minY + a.maxY) / 2 - (b.minY + b.maxY) / 2 || a.minX - b.minX,
  );
  const medianH = median(sorted.map((s) => s.maxY - s.minY)) || 1;
  const lines: InkLine[] = [];
  for (const s of sorted) {
    const cy = (s.minY + s.maxY) / 2;
    // candidate lines: vertical overlap of center with line band
    let best: InkLine | null = null;
    let bestDist = Infinity;
    for (const line of lines) {
      const mid = (line.minY + line.maxY) / 2;
      const half = Math.max((line.maxY - line.minY) / 2, medianH * 0.6);
      const dist = Math.abs(cy - mid);
      if (dist < half + medianH * 0.35 && dist < bestDist) {
        best = line;
        bestDist = dist;
      }
    }
    if (best) {
      best.strokes.push(s);
      const b = bounds(best.strokes);
      best.minX = b.minX; best.minY = b.minY; best.maxX = b.maxX; best.maxY = b.maxY;
    } else {
      lines.push({ strokes: [s], minX: s.minX, minY: s.minY, maxX: s.maxX, maxY: s.maxY });
    }
  }
  // merge lines that still overlap heavily (can happen with scattered strokes)
  const merged: InkLine[] = [];
  for (const line of lines.sort((a, b) => a.minY - b.minY)) {
    const prev = merged[merged.length - 1];
    if (prev && line.minY <= prev.maxY - (prev.maxY - prev.minY) * 0.15) {
      prev.strokes.push(...line.strokes);
      const b = bounds(prev.strokes);
      prev.minX = b.minX; prev.minY = Math.min(prev.minY, line.minY);
      prev.maxX = b.maxX; prev.maxY = Math.max(prev.maxY, line.maxY);
    } else merged.push(line);
  }
  for (const line of merged) line.strokes.sort((a, b) => a.minX - b.minX);
  return merged;
}

/**
 * Group lines into blocks. A new block starts when a line sits below a gap
 * larger than `gapFactor` × median line height, or shares no horizontal span
 * with the previous line (side-by-side columns).
 */
export function linesToBlocks(lines: InkLine[], gapFactor = 1.7): InkBlock[] {
  if (!lines.length) return [];
  const sorted = [...lines].sort((a, b) => a.minY - b.minY);
  const medianH = median(sorted.map((l) => l.maxY - l.minY)) || 1;
  const blocks: InkBlock[] = [];
  for (const line of sorted) {
    const prev = blocks[blocks.length - 1];
    const overlapsX = prev && line.minX <= prev.maxX + medianH && prev.minX <= line.maxX + medianH;
    const gap = prev ? line.minY - prev.maxY : Infinity;
    if (prev && gap <= medianH * gapFactor && overlapsX) {
      prev.lines.push(line);
      const b = bounds(prev.lines);
      prev.minX = b.minX; prev.minY = b.minY; prev.maxX = b.maxX; prev.maxY = b.maxY;
    } else {
      blocks.push({ lines: [line], ...bounds([line]) });
    }
  }
  return blocks;
}

/**
 * Spatial connectivity clustering (for auto mode): flood-fill strokes whose
 * boxes are within `gap` of each other. Returns clusters in arbitrary order.
 */
export function spatialClusters(strokes: InkStroke[], gap: number): InkStroke[][] {
  const n = strokes.length;
  const seen = new Array(n).fill(false);
  const clusters: InkStroke[][] = [];
  const near = (a: InkStroke, b: InkStroke) =>
    a.minX - gap <= b.maxX && b.minX - gap <= a.maxX &&
    a.minY - gap <= b.maxY && b.minY - gap <= a.maxY;
  for (let i = 0; i < n; i++) {
    if (seen[i]) continue;
    const cluster = [strokes[i]];
    seen[i] = true;
    for (let k = 0; k < cluster.length; k++)
      for (let j = 0; j < n; j++)
        if (!seen[j] && near(cluster[k], strokes[j])) {
          seen[j] = true;
          cluster.push(strokes[j]);
        }
    clusters.push(cluster);
  }
  return clusters;
}

/** All ink candidate strokes currently in the scene. */
export function collectStrokes(
  elements: readonly ExcalidrawElement[],
): InkStroke[] {
  return elements.filter(isInkStrokeElement).map(strokeFromElement);
}
