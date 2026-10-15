/** Shared types for Smart Ink (handwriting → styled text). */

export type InkMode = "auto" | "preview" | "manual";

export type TextAlign = "left" | "center" | "right";

/**
 * User-facing text style for converted handwriting. Native Excalidraw fields
 * (fontFamily code, fontSize, color → strokeColor, align, lineHeight) map onto
 * real text-element properties; the rest are rendered via decoration elements.
 */
export type InkTextStyle = {
  /** FONT_FAMILY code — a built-in (1..9) or a registered custom code (>=100). */
  fontFamily: number;
  fontSize: number;
  color: string;
  align: TextAlign;
  /** Unitless line-height multiplier (Excalidraw convention). */
  lineHeight: number;
  bold: boolean;
  italic: boolean;
  underline: boolean;
  strikethrough: boolean;
  /** CSS color for a per-line highlight box, or null. */
  highlight: string | null;
  /** Extra letter tracking in em units (0..0.4). Rendered as thin spaces. */
  letterSpacing: number;
};

export const DEFAULT_INK_STYLE: InkTextStyle = {
  fontFamily: 100, // Assistant
  fontSize: 24,
  color: "#1e293b",
  align: "left",
  lineHeight: 1.25,
  bold: false,
  italic: false,
  underline: false,
  strikethrough: false,
  highlight: null,
  letterSpacing: 0,
};

export type InkStylePreset = { name: string; style: InkTextStyle };

export type SmartInkSettings = {
  enabled: boolean;
  mode: InkMode;
  /** Pause before auto/preview recognition fires (ms). */
  delayMs: number;
  /** Auto-commit confidence gate 0..1 (auto mode only). */
  confidence: number;
  /** Apply conservative dictionary/ambiguity correction. */
  spellFix: boolean;
  style: InkTextStyle;
  presets: InkStylePreset[];
};

export const DEFAULT_SMART_INK: SmartInkSettings = {
  enabled: false,
  mode: "auto",
  delayMs: 900,
  confidence: 0.7,
  spellFix: true,
  style: DEFAULT_INK_STYLE,
  presets: [
    {
      name: "Notes",
      style: { ...DEFAULT_INK_STYLE, fontFamily: 100, fontSize: 22 },
    },
    {
      name: "Handwritten",
      style: {
        ...DEFAULT_INK_STYLE,
        fontFamily: 102, // Caveat
        fontSize: 30,
        lineHeight: 1.15,
      },
    },
    {
      name: "Heading",
      style: {
        ...DEFAULT_INK_STYLE,
        fontFamily: 106, // Tinos base → bold resolves to the Bold cut (107)
        fontSize: 40,
        bold: true,
      },
    },
  ],
};

/** One freedraw stroke lifted into scene coordinates. */
export type InkStroke = {
  id: string;
  /** [x, y, pressure?] triples in scene coords. */
  points: [number, number, number][];
  strokeWidth: number;
  /** bounding box */
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  /** element.updated (ms) — used for recency ordering */
  updated: number;
};

export type InkLine = { strokes: InkStroke[]; minX: number; minY: number; maxX: number; maxY: number };
export type InkBlock = { lines: InkLine[]; minX: number; minY: number; maxX: number; maxY: number };

export type RecognizedLine = {
  text: string;
  /** 0..1 mean per-char softmax confidence */
  confidence: number;
  /** per-character confidences aligned to `text` (spaces included) */
  charConfs: number[];
  line: InkLine;
};

export type RecognizedBlock = {
  lines: RecognizedLine[];
  text: string;
  confidence: number;
  block: InkBlock;
};

/** Worker → main recognition request payload. */
export type InkLineImage = {
  /** RGB bytes, w*h*3 */
  pixels: ArrayBuffer;
  width: number;
  height: number;
};

export type InkWorkerOut =
  | { type: "ready" }
  | { type: "init-error"; error: string }
  | {
      type: "result";
      job: number;
      lines: { text: string; confidence: number; charConfs: number[] }[];
    }
  | { type: "result-error"; job: number; error: string };

export type InkWorkerIn =
  | { type: "init"; model: ArrayBuffer; dict: string }
  | { type: "recognize"; job: number; images: InkLineImage[] }
  | { type: "dispose" };

export function parseInkStyle(value: unknown, fallback: InkTextStyle): InkTextStyle {
  const p = (value ?? {}) as Partial<InkTextStyle>;
  const num = (v: unknown, d: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : d;
  const hex = (v: unknown, d: string) =>
    typeof v === "string" && /^#[\da-f]{6}$/i.test(v) ? v : d;
  return {
    fontFamily: num(p.fontFamily, fallback.fontFamily, 1, 999),
    fontSize: num(p.fontSize, fallback.fontSize, 6, 160),
    color: hex(p.color, fallback.color),
    align:
      p.align === "center" || p.align === "right" ? p.align : "left",
    lineHeight: num(p.lineHeight, fallback.lineHeight, 0.9, 2.5),
    bold: p.bold === true,
    italic: p.italic === true,
    underline: p.underline === true,
    strikethrough: p.strikethrough === true,
    highlight:
      typeof p.highlight === "string" && /^#[\da-f]{6}$/i.test(p.highlight)
        ? p.highlight
        : null,
    letterSpacing: num(p.letterSpacing, fallback.letterSpacing, 0, 0.4),
  };
}

export function parseSmartInkSettings(value: unknown): SmartInkSettings {
  const d = DEFAULT_SMART_INK;
  if (!value || typeof value !== "object") return structuredClone(d);
  const p = value as Partial<SmartInkSettings>;
  const num = (v: unknown, def: number, lo: number, hi: number) =>
    typeof v === "number" && Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : def;
  return {
    enabled: p.enabled === true,
    mode: p.mode === "preview" || p.mode === "manual" ? p.mode : "auto",
    delayMs: num(p.delayMs, d.delayMs, 300, 4000),
    confidence: num(p.confidence, d.confidence, 0.4, 0.99),
    spellFix: p.spellFix !== false,
    style: parseInkStyle(p.style, d.style),
    presets: Array.isArray(p.presets)
      ? p.presets
          .filter(
            (x): x is InkStylePreset =>
              !!x && typeof x === "object" && typeof x.name === "string",
          )
          .map((x) => ({ name: x.name.slice(0, 40), style: parseInkStyle(x.style, d.style) }))
          .slice(0, 24)
      : structuredClone(d.presets),
  };
}
