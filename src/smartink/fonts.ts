/**
 * Font catalog for Smart Ink text.
 *
 * Excalidraw 0.18 maps `fontFamily` (a number) to a CSS family name through the
 * mutable exported `FONT_FAMILY` table. We extend that table with locally
 * bundled fonts (public/fonts/**) and register them with `document.fonts`
 * ourselves — canvas rendering, editing, zoom and PNG export all keep working
 * because the browser resolves the family name directly.
 *
 * Bold/italic are modelled as separate registered faces (the classic
 * pre-variable-font trick): `resolveFamily` swaps the element's fontFamily code
 * for the real styled cut when one exists for the chosen base family.
 */
import { FONT_FAMILY } from "@excalidraw/excalidraw";

export type FontKind = "sans" | "serif" | "mono" | "hand";

type Variant = {
  /** Excalidraw fontFamily code */
  code: number;
  /** CSS font-family the canvas will resolve */
  css: string;
  /** bundled woff2 for custom faces; undefined = Excalidraw/OS built-in */
  file?: string;
};

export type InkFont = {
  label: string;
  kind: FontKind;
  variants: {
    regular: Variant;
    bold?: Variant;
    italic?: Variant;
    boldItalic?: Variant;
  };
};

/**
 * Custom family codes are FIXED constants ≥100 — they persist inside saved
 * scenes, so they must never shift when fonts are added or reordered.
 * (Built-in codes 1–9 come from Excalidraw's own FONT_FAMILY.)
 */
export const INK_FONTS: InkFont[] = [
  {
    label: "Assistant",
    kind: "sans",
    variants: {
      regular: { code: 100, css: "Assistant", file: "/fonts/Assistant/Assistant-Regular.woff2" },
      bold: { code: 101, css: "Assistant Bold", file: "/fonts/Assistant/Assistant-Bold.woff2" },
    },
  },
  {
    label: "Caveat",
    kind: "hand",
    variants: {
      regular: { code: 102, css: "Caveat", file: "/fonts/Caveat/Caveat-Regular.woff2" },
      bold: { code: 103, css: "Caveat Bold", file: "/fonts/Caveat/Caveat-Bold.woff2" },
    },
  },
  {
    label: "Kalam",
    kind: "hand",
    variants: {
      regular: { code: 104, css: "Kalam", file: "/fonts/Kalam/Kalam-Regular.woff2" },
      bold: { code: 105, css: "Kalam Bold", file: "/fonts/Kalam/Kalam-Bold.woff2" },
    },
  },
  {
    label: "Tinos",
    kind: "serif",
    variants: {
      regular: { code: 106, css: "Tinos", file: "/fonts/Tinos/Tinos-Regular.woff2" },
      bold: { code: 107, css: "Tinos Bold", file: "/fonts/Tinos/Tinos-Bold.woff2" },
      italic: { code: 108, css: "Tinos Italic", file: "/fonts/Tinos/Tinos-Italic.woff2" },
      boldItalic: { code: 109, css: "Tinos Bold Italic", file: "/fonts/Tinos/Tinos-BoldItalic.woff2" },
    },
  },
  { label: "Virgil", kind: "hand", variants: { regular: { code: 1, css: "Virgil" } } },
  { label: "Excalifont", kind: "hand", variants: { regular: { code: 5, css: "Excalifont" } } },
  { label: "Comic Shanns", kind: "hand", variants: { regular: { code: 8, css: "Comic Shanns" } } },
  { label: "Nunito", kind: "sans", variants: { regular: { code: 6, css: "Nunito" } } },
  { label: "Helvetica", kind: "sans", variants: { regular: { code: 2, css: "Helvetica" } } },
  { label: "Liberation Sans", kind: "sans", variants: { regular: { code: 9, css: "Liberation Sans" } } },
  { label: "Lilita One", kind: "sans", variants: { regular: { code: 7, css: "Lilita One" } } },
  { label: "Cascadia", kind: "mono", variants: { regular: { code: 3, css: "Cascadia Code" } } },
];

const byCode = new Map<number, { font: InkFont; variant: Variant; role: "regular" | "bold" | "italic" | "boldItalic" }>();
for (const font of INK_FONTS)
  for (const [role, v] of Object.entries(font.variants) as [keyof InkFont["variants"], Variant][])
    if (v) byCode.set(v.code, { font, variant: v, role: role as "regular" });

/** Register custom families into Excalidraw's name resolver (idempotent). */
export function registerInkFonts(): void {
  const table = FONT_FAMILY as Record<string, number>;
  for (const { variant } of byCode.values())
    if (variant.file && table[variant.css] !== variant.code)
      table[variant.css] = variant.code;
}

const loadedFaces = new Set<number>();
const pendingLoads = new Map<number, Promise<void>>();

/** Load the woff2 for a custom family code (no-op for built-ins). */
export function ensureFontLoaded(codeN: number): Promise<void> {
  const entry = byCode.get(codeN);
  if (!entry?.variant.file || loadedFaces.has(codeN)) return Promise.resolve();
  let p = pendingLoads.get(codeN);
  if (!p) {
    const face = new FontFace(entry.variant.css, `url(${entry.variant.file})`, {
      display: "swap",
    });
    p = face
      .load()
      .then((f) => {
        document.fonts.add(f);
        loadedFaces.add(codeN);
      })
      .catch(() => {
        pendingLoads.delete(codeN);
      });
    pendingLoads.set(codeN, p);
  }
  return p;
}

export function isCustomFont(codeN: number): boolean {
  const v = byCode.get(codeN);
  return !!v?.variant.file;
}

export function fontLabel(codeN: number): string {
  return byCode.get(codeN)?.font.label ?? "Custom";
}

/** CSS family name for a (possibly variant) code. */
export function cssFamily(codeN: number): string {
  return byCode.get(codeN)?.variant.css ?? "Assistant";
}

export type VariantSupport = { bold: boolean; italic: boolean };

/** Which style toggles exist for the base family containing `codeN`. */
export function variantSupport(codeN: number): VariantSupport {
  const f = byCode.get(codeN)?.font;
  return { bold: !!f?.variants.bold, italic: !!f?.variants.italic };
}

/**
 * Resolve the real fontFamily code for a base code + bold/italic flags.
 * Falls back to regular when the requested cut doesn't exist.
 */
export function resolveFamily(baseCode: number, bold: boolean, italic: boolean): number {
  const f = byCode.get(baseCode)?.font;
  if (!f) return baseCode;
  const pick = (bold && italic && f.variants.boldItalic) ||
    (bold && f.variants.bold) ||
    (italic && f.variants.italic) ||
    f.variants.regular;
  return pick!.code;
}

/** The family's regular (base) code for any variant code. */
export function baseCodeOf(codeN: number): number {
  return byCode.get(codeN)?.font.variants.regular.code ?? codeN;
}

/** Bold/italic flags implied by a concrete variant code. */
export function roleOf(codeN: number): { bold: boolean; italic: boolean } {
  const role = byCode.get(codeN)?.role ?? "regular";
  return { bold: role === "bold" || role === "boldItalic", italic: role === "italic" || role === "boldItalic" };
}

/** Fonts the scene's text elements actually use — preload custom faces. */
export async function preloadSceneFonts(families: Iterable<number>): Promise<void> {
  await Promise.all([...new Set(families)].filter(isCustomFont).map(ensureFontLoaded));
}

let measureCtx: CanvasRenderingContext2D | null = null;
/** Width of `text` rendered at `fontSize` in family `code` (canvas units). */
export function measureLine(text: string, codeN: number, fontSize: number): number {
  if (!measureCtx && typeof document !== "undefined")
    measureCtx = document.createElement("canvas").getContext("2d");
  if (!measureCtx) return text.length * fontSize * 0.55;
  measureCtx.font = `${fontSize}px ${cssFamily(codeN)}, sans-serif`;
  return measureCtx.measureText(text).width;
}
