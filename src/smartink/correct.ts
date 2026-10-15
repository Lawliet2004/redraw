/**
 * Conservative post-recognition correction — no LLM, no paraphrasing.
 * - character-pair disambiguation driven by lexical context (0/O, 1/l/I, 5/S …)
 * - whitespace normalization around punctuation
 * - optional dictionary rescue for clearly-misread alpha words (edit distance 1)
 * All pure functions.
 */

const ALPHA = /[A-Za-z]/;
const DIGIT = /[0-9]/;

/** ambiguous char classes: digit forms that double as letters */
const CONFUSABLE: Record<string, { alpha: string; digit: string }> = {
  O: { alpha: "O", digit: "0" },
  o: { alpha: "o", digit: "0" },
  l: { alpha: "l", digit: "1" },
  I: { alpha: "I", digit: "1" },
  S: { alpha: "S", digit: "5" },
  s: { alpha: "s", digit: "5" },
  B: { alpha: "B", digit: "8" },
  Z: { alpha: "Z", digit: "2" },
  g: { alpha: "g", digit: "9" },
  b: { alpha: "b", digit: "6" },
};

/** Does `token` read as a numeric/math token? */
function isNumericToken(token: string): boolean {
  return /^[\d.,:;+\-*/=()^%]+$/.test(token) && DIGIT.test(token);
}

/**
 * Resolve confusable characters inside one token using its surrounding
 * character classes. Only swaps when it makes the token consistent.
 */
export function disambiguateToken(token: string): string {
  if (token.length < 2) {
    // single char: leave as recognized (nothing to infer from)
    return token;
  }
  const chars = [...token];
  const hasDigit = chars.some((c) => DIGIT.test(c));
  const hasAlpha = chars.some((c) => ALPHA.test(c));
  if (!hasDigit && !hasAlpha) return token;
  for (let i = 0; i < chars.length; i++) {
    const c = chars[i];
    const rule = CONFUSABLE[c];
    if (!rule) continue;
    const isLetterForm = c === rule.alpha;
    // look at neighbours
    const prev = chars[i - 1];
    const next = chars[i + 1];
    const nearDigit =
      (prev && DIGIT.test(prev)) || (next && DIGIT.test(next)) ||
      (prev === "=" || prev === "+" || prev === "-" || next === "=" || next === "+");
    const nearAlpha = (prev && ALPHA.test(prev)) || (next && ALPHA.test(next));
    if (isLetterForm && hasDigit && (nearDigit || !nearAlpha) && isNumericToken(token)) {
      chars[i] = rule.digit; // "x4l"→ keep? only inside numeric token
    } else if (!isLetterForm && hasAlpha && nearAlpha) {
      chars[i] = rule.alpha;
    }
  }
  return chars.join("");
}

/** Line-level pass over tokens (words stay in place, order untouched). */
export function disambiguateLine(text: string): string {
  return text
    .split(" ")
    .map((tok) => (/^[A-Za-z0-9=+^*/().,%-]+$/.test(tok) ? disambiguateToken(tok) : tok))
    .join(" ");
}

/** Normalize spacing around punctuation without touching content. */
export function tidySpaces(text: string): string {
  return text
    .replace(/\s{2,}/g, " ")
    .replace(/ +([,.;:!?%)\]}»])/g, "$1")
    .replace(/([(\[{«]) +/g, "$1")
    .replace(/(\d) ?([:.,]) ?(\d)/g, "$1$2$3") // "12 . 50" → "12.50"
    .trim();
}

/* ————— dictionary rescue ————— */

let wordSet: Set<string> | null = null;
let deletesIndex: Map<string, string[]> | null = null;

export function loadWordList(text: string): void {
  wordSet = new Set(
    text
      .split(/\r?\n/)
      .map((w) => w.trim().toLowerCase())
      .filter((w) => w.length > 0),
  );
  deletesIndex = new Map();
  for (const w of wordSet) {
    for (let i = 0; i < w.length; i++) {
      const key = w.slice(0, i) + w.slice(i + 1);
      const list = deletesIndex.get(key);
      if (list) list.push(w);
      else deletesIndex.set(key, [w]);
    }
  }
}

/** words that should never be "corrected" (names, code, technical) */
const looksSpecial = (w: string) =>
  /[0-9_]/.test(w) || /[A-Z]/.test(w.slice(1)) || /^[A-Z]{2,}$/.test(w);

function dictCandidates(word: string): string[] {
  if (!wordSet || !deletesIndex) return [];
  const lower = word.toLowerCase();
  if (wordSet.has(lower)) return [];
  const found = new Set<string>();
  // deletion-1 neighbours both directions
  for (let i = 0; i < lower.length; i++) {
    const key = lower.slice(0, i) + lower.slice(i + 1);
    if (wordSet.has(key)) found.add(key);
    const cand = deletesIndex.get(key);
    if (cand) for (const c of cand) found.add(c);
  }
  // transposition neighbours
  for (let i = 0; i + 1 < lower.length; i++) {
    const t = lower.slice(0, i) + lower[i + 1] + lower[i] + lower.slice(i + 2);
    if (wordSet.has(t)) found.add(t);
  }
  return [...found];
}

/**
 * Replace a low-confidence alpha word with a dictionary word when exactly one
 * sensible candidate exists. Returns original word when unsure.
 */
export function rescueWord(word: string): string {
  if (!wordSet || word.length < 3 || word.length > 14) return word;
  if (!/^[a-zA-Z]+$/.test(word) || looksSpecial(word)) return word;
  const cands = dictCandidates(word);
  if (cands.length === 1) {
    const fix = cands[0];
    // preserve capitalization style
    if (/^[A-Z][a-z]*$/.test(word)) return fix[0].toUpperCase() + fix.slice(1);
    return word === word.toUpperCase() ? fix.toUpperCase() : fix;
  }
  return word;
}

export function correctLine(
  text: string,
  wordConfs: { word: string; conf: number; start: number; end: number }[],
  opts: { spellFix: boolean },
): string {
  let line = disambiguateLine(text);
  line = tidySpaces(line);
  if (!opts.spellFix || !wordSet) return line;
  // rescue only low-confidence plain words
  const low = new Map(
    wordConfs
      .filter((w) => w.conf < 0.9 && /^[A-Za-z]+$/.test(w.word))
      .map((w) => [w.word, w.conf]),
  );
  if (!low.size) return line;
  return line
    .split(" ")
    .map((tok) => (low.has(tok) ? rescueWord(tok) : tok))
    .join(" ");
}
