/**
 * CTC greedy decode for the PP-OCRv5 recognizer output.
 * Model output: [1, T, C] logits. Class 0 = CTC blank, class C-1 = space,
 * classes 1..C-2 map to dict[k-1]. Pure — tested in node.
 */
export type DecodeResult = {
  text: string;
  /** mean of per-char confidence scores (0..1) */
  confidence: number;
  charConfs: number[];
};

/**
 * PP-OCR emits near-uniform logits, so softmax probabilities hover ~1/C even
 * for perfect reads — useless as confidence. The reliable signal is the
 * argmax margin (top1−top2 logit gap): correct chars typically exceed ~0.9,
 * misreads sit ≤0.7. Map 0.45→0 and 0.95→1.
 */
export function marginToConfidence(margin: number): number {
  return Math.min(1, Math.max(0, (margin - 0.45) / 0.5));
}

export function ctcDecode(
  logits: Float32Array | number[],
  T: number,
  C: number,
  dict: readonly string[],
): DecodeResult {
  let prev = -1;
  let text = "";
  const charConfs: number[] = [];
  const confs: number[] = [];
  for (let t = 0; t < T; t++) {
    let best = 0;
    let bv = -Infinity;
    let second = -Infinity;
    const row = t * C;
    for (let c = 0; c < C; c++) {
      const v = logits[row + c];
      if (v > bv) {
        second = bv;
        bv = v;
        best = c;
      } else if (v > second) {
        second = v;
      }
    }
    if (best !== 0 && best !== prev) {
      const ch = best === C - 1 ? " " : best - 1 >= 0 && best - 1 < dict.length ? dict[best - 1] : "";
      if (ch) {
        text += ch;
        const p = marginToConfidence(bv - second);
        confs.push(p);
        charConfs.push(p);
      }
    }
    prev = best;
  }
  return {
    text,
    confidence: confs.length ? confs.reduce((a, b) => a + b, 0) / confs.length : 0,
    charConfs,
  };
}

/** Per-word confidence: min of member char confidences (spaces split words). */
export function wordConfidences(
  text: string,
  charConfs: number[],
): { word: string; conf: number; start: number; end: number }[] {
  const out: { word: string; conf: number; start: number; end: number }[] = [];
  let start = -1;
  let min = 1;
  for (let i = 0; i <= text.length; i++) {
    const ch = text[i];
    if (ch === " " || i === text.length) {
      if (start >= 0) out.push({ word: text.slice(start, i), conf: min, start, end: i });
      start = -1;
      min = 1;
      continue;
    }
    if (start < 0) start = i;
    const c = charConfs[i] ?? 0.5;
    if (c < min) min = c;
  }
  return out;
}
