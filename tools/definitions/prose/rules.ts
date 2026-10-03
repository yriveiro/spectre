/**
 * The ASD-STE100 rules this set writes by, as checkable predicates.
 *
 * Every rule here is structural, so it can be verified from the text alone. The
 * lexical half of the standard needs the ~900-word dictionary, which Issue 9 does
 * not let this project carry, so those rules are prose judgement and are not here.
 *
 * Nothing in this file flags a hedge. `may`, `might` and `could` are the author's
 * stated confidence, so a check that pressured them out would rewrite claims.
 */

export const WORD_LIMIT = 25; // STE 6.3. The 20-word instruction cap (5.1) needs a context a linter cannot read.

export type Level = "hard" | "advisory";

export type Finding = {
  readonly rule: string;
  readonly level: Level;
  readonly line: number;
  readonly text: string;
  readonly why: string;
};

type Spec = { rule: string; level: Level; pattern: RegExp; why: string };

const RULES: ReadonlyArray<Spec> = [
  {
    rule: "semicolon",
    level: "hard",
    pattern: /;/,
    why: "STE 8.1 bans the semicolon outright. Every other standard mark is permitted. Use two sentences, or a connecting word.",
  },
  {
    rule: "phrasal-verb",
    level: "hard",
    pattern:
      /\b(?:spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing) back|touch(?:ing|es)? base|hand(?:ing|ed)? off|rule[ds]? out|look(?:ing|s|ed)? into|set up)\b/i,
    why: "STE 9.3. A verb plus a preposition has a meaning the parts do not predict. Use the single plain verb.",
  },
  {
    rule: "nominalization",
    level: "hard",
    pattern:
      /\b(?:perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out|provide assistance to|gives? an indication of)\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b/i,
    why: "STE 3.7. Use the verb that names the action, not a noun built from it.",
  },
  {
    rule: "marketing-adjective",
    level: "hard",
    pattern:
      /\b(?:seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er)|best-in-class)\b/i,
    why: "Claiming quality instead of showing it. Delete it, or replace it with the measurement that earns the claim.",
  },
  {
    rule: "passive-voice",
    level: "advisory",
    pattern:
      /\b(?:is|are|was|were|been|being)\s+(\w+ed|given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put)\b/i,
    why: "STE 3.6. Name the actor. Passive is correct when the actor is unknown or irrelevant.",
  },
  {
    rule: "present-perfect",
    level: "advisory",
    pattern:
      /\b(?:has|have|had)\s+(?:been\s+)?(?:read|written|verified|measured|confirmed|tested|checked|seen|found|done|added|removed|left|held|kept|set|run|made|taken|given|shown|built|sent|put)\b/i,
    why: "STE 3.2 permits simple tenses only. Advisory because 'has not been read at source' carries a hedge the simple past cannot.",
  },
];

/** `matchAll` needs the global flag, and the table above reads better without it. */
const SPECS: ReadonlyArray<Spec> = RULES.map((one) => ({
  ...one,
  pattern: new RegExp(one.pattern.source, `${one.pattern.flags}g`),
}));

export const RULE_NAMES: ReadonlyArray<string> = [...SPECS.map((one) => one.rule), "long-sentence"];

/** Word count under STE 8.4 to 8.7: an inline code span, a link and a hyphenated compound each count as one word. */
const wordList = (text: string): Array<string> =>
  text
    .replace(/`[^`]*`/g, " code ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " link ")
    .split(/\s+/)
    .filter(Boolean);

export const countWords = (text: string): number => wordList(text).length;

/** Markdown-aware: fenced code, tables, blockquotes and headings are not prose. */
const proseLines = (text: string): ReadonlyArray<{ line: number; text: string }> => {
  const out: Array<{ line: number; text: string }> = [];
  let fence = false;
  text.split("\n").forEach((raw, i) => {
    const trimmed = raw.trim();
    if (trimmed.startsWith("```") || trimmed.startsWith("~~~")) {
      fence = !fence;
      return;
    }
    if (fence) return;
    if (/^[|>#]/.test(trimmed)) return;
    out.push({ line: i + 1, text: raw });
  });
  return out;
};

const LIST_MARKER = /^(?<indent> {0,3})(?<marker>[-*+]|\d+[.)])(?= )/;

/** A line whose only content is a list marker, a table row or a rule id is structure, not a sentence. */
const isStructural = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  const withoutList = trimmed.replace(LIST_MARKER, "").trim();
  if (withoutList.length === 0) return true;
  if (/^\|/.test(withoutList)) return true;
  return /^[*_`#]/.test(withoutList);
};

/**
 * Sentinels, not dots. A dot is not a full stop when it sits inside an abbreviation,
 * a version, a path or a filename, so those dots are swapped first and restored after.
 * Two sentinels, because a version and an initial must not collapse into one.
 */
const ABBREV_DOT = "";
const NUM_DOT = "";

export const sentences = (line: string): Array<string> =>
  line
    .replace(/(\b[A-Za-z])\.(?=\s*[A-Za-z])/g, `$1${ABBREV_DOT}`)
    .replace(/(\d)\.(\d)/g, `$1${NUM_DOT}$2`)
    .split(/(?<=[.!?])\s+(?=[A-Z*`([])/)
    .filter((s) => s.trim().length > 0)
    .map((s) => s.split(ABBREV_DOT).join(".").split(NUM_DOT).join("."));

/**
 * Drop inline code spans, carrying the span state between lines. A per-line
 * `[^`]*` match cannot see a closing backtick on the next line, so a semicolon
 * inside a TypeScript type literal would read as prose. A per-character walk is
 * what makes the span state survive the line break; `inSpan` is returned because
 * the next line continues whatever this one left open.
 */
const stripSpans = (
  lines: ReadonlyArray<{ line: number; text: string }>,
): ReadonlyArray<{
  line: number;
  text: string;
}> => {
  const out: Array<{ line: number; text: string }> = [];
  let inSpan = false;

  for (const { line, text: raw } of lines) {
    if (isStructural(raw)) continue;
    const stripped = raw.replace(/\[[^\]]*\]\([^)]*\)/g, " link ");
    let bare = "";
    for (const ch of stripped) {
      if (ch === "`") {
        inSpan = !inSpan;
        if (!inSpan) bare += " code ";
        continue;
      }
      if (!inSpan) bare += ch;
    }
    if (bare.trim().length > 0) out.push({ line, text: bare });
  }

  return out;
};

const ruleFindings = (
  line: number,
  bare: string,
  disabled: ReadonlySet<string>,
): Array<Finding> => {
  const out: Array<Finding> = [];

  for (const spec of SPECS) {
    if (disabled.has(spec.rule)) continue;
    for (const m of bare.matchAll(spec.pattern)) {
      out.push({ rule: spec.rule, level: spec.level, line, text: m[0].trim(), why: spec.why });
    }
  }
  for (const sentence of sentences(bare)) {
    const n = wordList(sentence).length;
    if (n <= WORD_LIMIT) continue;
    out.push({
      rule: "long-sentence",
      level: "hard",
      line,
      text: `${n} words`,
      why: `STE 6.3 caps descriptive prose at ${WORD_LIMIT} words. Split it.`,
    });
  }

  return out;
};

export const lint = (text: string, disabled: ReadonlySet<string> = new Set()): Array<Finding> =>
  stripSpans(proseLines(text)).flatMap(({ line, text }) => ruleFindings(line, text, disabled));
