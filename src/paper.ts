export type Paper = {
  color: string;
  pattern: "plain" | "dots" | "grid" | "ruled";
  spacing: number;
};
export const DEFAULT_PAPER: Paper = {
  color: "#ffffff",
  pattern: "plain",
  spacing: 24,
};
export function parsePaper(
  value: unknown,
  fallback: Paper = DEFAULT_PAPER,
): Paper {
  if (!value || typeof value !== "object") return { ...fallback };
  const p = value as Partial<Paper>;
  return {
    color:
      typeof p.color === "string" && /^#[\da-f]{6}$/i.test(p.color)
        ? p.color
        : fallback.color,
    pattern:
      p.pattern && ["plain", "dots", "grid", "ruled"].includes(p.pattern)
        ? p.pattern
        : fallback.pattern,
    spacing:
      typeof p.spacing === "number" && Number.isFinite(p.spacing)
        ? Math.max(12, Math.min(80, p.spacing))
        : fallback.spacing,
  };
}
export function paperInk(color: string): string {
  const rgb = color
    .slice(1)
    .match(/../g)!
    .map((part) => parseInt(part, 16));
  return rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 125
    ? "#ffffff"
    : "#1e293b";
}
export function paperImage(paper: Paper): string {
  const ink = paperInk(paper.color);
  const s = paper.spacing;
  const shape =
    paper.pattern === "dots"
      ? '<circle cx="1" cy="1" r="1"/>'
      : paper.pattern === "grid"
        ? `<path d="M ${s} 0 H 0 V ${s}" fill="none" stroke="${ink}"/>`
        : paper.pattern === "ruled"
          ? `<path d="M 0 ${s - 0.5} H ${s}" stroke="${ink}"/>`
          : "";
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${s}" height="${s}" viewBox="0 0 ${s} ${s}"><g fill="${ink}" opacity=".16">${shape}</g></svg>`;
  return `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;
}
