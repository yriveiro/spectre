#!/usr/bin/env bun
/**
 * Deterministic linter for the mechanical ASD-STE100 rules that
 * `skills/definitions/grammar-*` cite. Regex heuristics, not a parser.
 *
 * Two rules are deliberately absent. There is no noun-cluster rule, because
 * capping a noun stack at 3 words needs part-of-speech tagging and a regex
 * false-positives on every hyphenated compound. There is no dropped-article
 * rule, because noticing a missing article needs semantics.
 *
 * Hedges and modality (may, might, could) are never flagged. The standard
 * treats the author's confidence as content, so a linter that pressured hedges
 * out would rewrite claims. STE 3.2 bans the present perfect, but this file
 * reports it as advisory for the same reason.
 *
 * Usage:
 *   bun run lint/prose.ts FILE...            # exit 1 when hard findings exceed the baseline
 *   echo "text" | bun run lint/prose.ts      # reads stdin
 *   bun run lint/prose.ts --json FILE...     # structured output
 *   bun run lint/prose.ts --baseline 5 FILE # tolerate 5 hard findings, for adopting on prose that predates it
 *   bun run lint/prose.ts --disable passive-voice FILE
 *   bun run lint/prose.ts --selftest
 */

export const WORD_LIMIT = 25; // STE 6.3. The 20-word instruction cap (5.1) needs a context the linter has no way to read.

type Level = "hard" | "advisory";

export type Finding = {
  rule: string;
  level: Level;
  line: number;
  text: string;
  why: string;
};

type Spec = { rule: string; level: Level; pattern: RegExp; why: string };

/** `matchAll` needs the global flag, and the rule table reads better without it on every line. */
const globalise = (one: Spec): Spec => ({ ...one, pattern: new RegExp(one.pattern.source, `${one.pattern.flags}g`) });

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
    pattern: /\b(?:spin(?:ning|s)? up|spun up|reach(?:ing|es|ed)? out|div(?:e|es|ing|ed) into|dove into|kick(?:ing|s|ed)? off|circl(?:e|es|ing) back|touch(?:ing|es)? base|hand(?:ing|ed)? off|rule[ds]? out|look(?:ing|s|ed)? into|set up)\b/i,
    why: "STE 9.3. A verb plus a preposition has a meaning the parts do not predict. Use the single plain verb.",
  },
  {
    rule: "nominalization",
    level: "hard",
    pattern: /\b(?:perform|performs|performed|conduct|conducts|conducted|carry out|carries out|carried out|provide assistance to|gives? an indication of)\s+(?:a|an|the)\s+\w+(?:tion|sion|ment|ance|ence|ysis)\b/i,
    why: "STE 3.7. Use the verb that names the action, not a noun built from it.",
  },
  {
    rule: "marketing-adjective",
    level: "hard",
    pattern: /\b(?:seamless(?:ly)?|robust(?:ly)?|cutting-edge|effortless(?:ly)?|blazing[- ]fast|world-class|state-of-the-art|game-chang(?:ing|er)|best-in-class)\b/i,
    why: "Claiming quality instead of showing it. Delete it, or replace it with the measurement that earns the claim.",
  },
  {
    rule: "passive-voice",
    level: "advisory",
    pattern: /\b(?:is|are|was|were|been|being)\s+(\w+ed|given|taken|made|done|found|seen|known|shown|written|built|sent|set|run|read|kept|held|left|put)\b/i,
    why: "STE 3.6. Name the actor. Passive is correct when the actor is unknown or irrelevant.",
  },
  {
    rule: "present-perfect",
    level: "advisory",
    pattern: /\b(?:has|have|had)\s+(?:been\s+)?(?:read|written|verified|measured|confirmed|tested|checked|seen|found|done|added|removed|left|held|kept|set|run|made|taken|given|shown|built|sent|put)\b/i,
    why: "STE 3.2 permits simple tenses only. Advisory because 'has not been read at source' carries a hedge the simple past cannot.",
  },
];

const SPECS: ReadonlyArray<Spec> = RULES.map(globalise);

const RULE_BY_NAME = new Map(SPECS.map((one) => [one.rule, one]));

/** Word count under STE 8.4 to 8.7: an inline code span, a link and a hyphenated compound each count as one word. */
export const countWords = (text: string): number => wordList(text).length;

const wordList = (text: string): Array<string> =>
  text
    .replace(/`[^`]*`/g, " code ")
    .replace(/\[[^\]]*\]\([^)]*\)/g, " link ")
    .split(/\s+/)
    .filter(Boolean);

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

/**
 * Split prose into sentences. A dot is not a full stop when it sits inside an
 * abbreviation, a version, a path or a filename, so those dots are swapped for a
 * sentinel first and restored afterwards. Two sentinels, because a version
 * (`2.0.21`) and an initial (`e.g.`) must not collapse into the same one.
 */
const ABBREV_DOT = "\u0001";
const NUM_DOT = "\u0002";

export const sentences = (line: string): Array<string> =>
  line
    .replace(/(\b[A-Za-z])\.(?=\s*[A-Za-z])/g, `$1${ABBREV_DOT}`)
    .replace(/(\d)\.(\d)/g, `$1${NUM_DOT}$2`)
    .split(/(?<=[.!?])\s+(?=[A-Z*`(\[])/)
    .filter((s) => s.trim().length > 0)
    .map((s) => s.split(ABBREV_DOT).join(".").split(NUM_DOT).join("."));

/** A line whose only content is a list marker, a table row or a rule id is structure, not a sentence. */
const isStructural = (raw: string): boolean => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return true;
  const withoutList = trimmed.replace(LIST_MARKER, "").trim();
  if (withoutList.length === 0) return true;
  if (/^\|/.test(withoutList)) return true;
  return /^[*_`#]/.test(withoutList);
};
export const lint = (text: string, disabled: ReadonlySet<string> = new Set()): Array<Finding> => {
  const findings: Array<Finding> = [];

  for (const { line, text: raw } of proseLines(text)) {
    if (isStructural(raw)) continue;
    const bare = raw.replace(/`[^`]*`/g, " code ").replace(/\[[^\]]*\]\([^)]*\)/g, " link ");
    for (const spec of SPECS) {
      if (disabled.has(spec.rule)) continue;
      for (const m of bare.matchAll(spec.pattern)) {
        findings.push({ rule: spec.rule, level: spec.level, line, text: m[0].trim(), why: spec.why });
      }
    }
    for (const sentence of sentences(bare)) {
      const n = wordList(sentence).length;
      if (n > WORD_LIMIT) {
        findings.push({
          rule: "long-sentence",
          level: "hard",
          line,
          text: `${n} words`,
          why: `STE 6.3 caps descriptive prose at ${WORD_LIMIT} words. Split it.`,
        });
      }
    }
  }

  return findings;
};

export const selftest = (): boolean => {
  const clean = [
    "The agent deletes the file.",
    "Read the configured strategy.",
    "Your request may have failed. The cause may be a data format that does not match.",
    "An old client can cause the mismatch.",
  ].join("\n");
  const semicolon = lint("The agent deletes the file; then it logs the path.");
  const dash = lint("The fix is a one-line change — and it touches two files.");
  const hedge = lint("The job may have failed and could still be running.");

  const checks: ReadonlyArray<readonly [boolean, string]> = [
    [lint(clean).length === 0, "clean prose reports nothing"],
    [semicolon.some((f) => f.rule === "semicolon"), "a semicolon is found"],
    [dash.every((f) => f.rule !== "semicolon"), "an em dash is not a semicolon, and STE permits it"],
    [hedge.every((f) => !/may|could/.test(f.text)), "modality is never flagged"],
  ];
  for (const [ok, what] of checks) {
    if (!ok) {
      console.error(`selftest failed: ${what}`);
      return false;
    }
  }
  return true;
};

const main = async (argv: ReadonlyArray<string>): Promise<number> => {
  const args = [...argv];
  const flag = (name: string): boolean => {
    const i = args.indexOf(name);
    if (i === -1) return false;
    args.splice(i, 1);
    return true;
  };
  const value = (name: string, fallback: string): string => {
    const i = args.indexOf(name);
    if (i === -1) return fallback;
    const v = args[i + 1] ?? fallback;
    args.splice(i, 2);
    return v;
  };

  if (flag("--help")) {
    console.log("bun run lint/prose.ts [--json] [--baseline N] [--disable r1,r2] FILE...\n\nSTE structural rules that need no dictionary. Hedges are never flagged.");
    return 0;
  }
  const json = flag("--json");
  const baseline = Number(value("--baseline", "0"));
  const disabled = new Set(
    value("--disable", "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
  );
  for (const name of disabled) {
    if (!RULE_BY_NAME.has(name)) {
      console.error(`unknown rule: ${name}\nknown: ${[...SPECS.map((r) => r.rule), "long-sentence"].join(", ")}`);
      return 2;
    }
  }
  if (flag("--selftest")) return selftest() ? 0 : 1;

  const paths = args.filter((a) => !a.startsWith("-"));
  const sources: Array<{ name: string; text: string }> = [];
  if (paths.length === 0) sources.push({ name: "<stdin>", text: await Bun.stdin.text() });
  for (const p of paths) sources.push({ name: p, text: await Bun.file(p).text() });

  const all = sources.flatMap(({ name, text }) =>
    lint(text, disabled).map((f) => ({ ...f, file: name })),
  );
  const hard = all.filter((f) => f.level === "hard");

  if (json) {
    console.log(JSON.stringify({ findings: all, hard: hard.length }, null, 2));
  } else {
    for (const f of all) {
      const where = f.file === "<stdin>" ? f.line : `${f.file}:${f.line}`;
      console.log(`${where}: ${f.level === "hard" ? "error" : "warn "} [${f.rule}] ${f.text}`);
      console.log(`    ${f.why}`);
    }
    const byRule = new Map<string, number>();
    for (const f of all) byRule.set(f.rule, (byRule.get(f.rule) ?? 0) + 1);
    if (byRule.size > 0) {
      console.log(
        `\n${hard.length} hard, ${all.length - hard.length} advisory across ${sources.length} file(s): ` +
          [...byRule].map(([r, n]) => `${r} ${n}`).join(", "),
      );
    }
  }

  return hard.length > baseline ? 1 : 0;
};

if (import.meta.main) process.exit(await main(process.argv.slice(2)));