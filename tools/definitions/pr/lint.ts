import { countWords, lintProse } from "../prose";
import type { Commit, Fields, Finding } from "./fields";
import type { Draft } from "./render";

const MAX_TITLE = 72;
const MAX_BODY_LINES = 40;
const MIN_COMMIT_DESC_WORDS = 8;
const MAX_COMMIT_DESC_WORDS = 25;
const MAX_COMMIT_CHANGES = 4;

const TITLE =
  /^(feat|fix|refactor|docs|style|test|build|ci|chore|perf|revert)(\([^)]+\))?!?: [^ ].*/;

const SHA = /\b[0-9a-f]{7,40}\b/;
const NUMBERED = /^\s*\d+\.\s/m;
const HEADING = /^\s*#{1,6}\s/m;
const NO_CODE_NOTE =
  /\b(?:no|zero)\s+(?:source\s+)?code\s+(?:files?|changes?|paths?|edits?)\b|\b(?:docs?|markdown|config|non-code)[-\s]+only\b/i;
const RIPWIRE_DELTA = /\bripwire\b.*--quality-delta(?:=|\s|$)/i;
const RIPWIRE_AFFECTED = /\bripwire\b.*--affected(?:=|\s|$)/i;

const CLOSERS: ReadonlyArray<[RegExp, string]> = [
  [/\band\b/i, "an `and`"],
  [/;/, "a `;`"],
  [/,/, "a `,`"],
];

const finding = (rule: string, detail: string): Finding => ({ rule, detail });

const proseRule = (name: string, text: string | undefined): Array<Finding> => {
  if (text === undefined || text.trim() === "") return [];
  return lintProse(text)
    .filter((one) => one.level === "hard")
    .map((one) => finding(`prose-${one.rule}`, `\`${name}\` (${one.text}): ${one.why}`));
};

const titleRule = (fields: Fields, draft: Draft): Array<Finding> => {
  const found: Array<Finding> = [];
  const { title } = draft;

  if (title.length > MAX_TITLE)
    found.push(
      finding("title-length", `${title.length} characters, over the ${MAX_TITLE} this tool allows`),
    );
  if (title.endsWith("."))
    found.push(
      finding("title-period", "the title ends with a period, which the pattern does not carry"),
    );
  if (!TITLE.test(title))
    found.push(
      finding(
        "title-pattern",
        "the title does not match `<type>(<scope>)!: <subject>` with a type this repository uses",
      ),
    );

  for (const [pattern, name] of CLOSERS)
    if (pattern.test(fields.subject))
      found.push(
        finding(
          "title-one-clause",
          `${name} in the subject joins two changes, which is two pull requests`,
        ),
      );

  if (fields.scope !== fields.scope.toLowerCase() || fields.scope === "")
    found.push(finding("scope-lowercase", "`scope` is a lowercase noun naming the changed area"));

  return found;
};

const bodyRule = (fields: Fields, draft: Draft): Array<Finding> => {
  const found: Array<Finding> = [];
  const { body } = draft;

  const lines = body.split("\n");
  if (lines.length > MAX_BODY_LINES)
    found.push(
      finding(
        "body-length",
        `${lines.length} lines, over the ${MAX_BODY_LINES} a reviewer will read`,
      ),
    );
  if (SHA.test(body))
    found.push(
      finding("body-no-sha", "a commit SHA is in the body, and `git log` already holds that text"),
    );
  if (NUMBERED.test(body))
    found.push(
      finding("body-no-commit-list", "a numbered list is a changelog in a pull request's clothes"),
    );

  if (HEADING.test(fields.summary))
    found.push(
      finding(
        "summary-carries-a-heading",
        "`summary` brings its own heading, and one is already above it",
      ),
    );
  if (fields.review.includes("\n"))
    found.push(finding("review-one-line", "`review` is the one line of feedback you want"));
  if (fields.scopeItems.length === 0)
    found.push(
      finding("scope-items", "`scopeItems` is empty, so the body names no symbol or path"),
    );
  if (fields.validation.length === 0)
    found.push(
      finding(
        "validation-evidence",
        "`validation` is empty, which reports no evidence rather than good news",
      ),
    );

  for (const [name, text] of [
    ["tradeoffs", fields.tradeoffs],
    ["breaking", fields.breaking],
  ] as const)
    if (text !== undefined && /^\s*none\.?\s*$/i.test(text))
      found.push(
        finding(`${name}-not-none`, `\`${name}\` is \`None.\`, so leave the field out instead`),
      );

  found.push(
    ...proseRule("summary", fields.summary),
    ...proseRule("review", fields.review),
    ...proseRule("risk", fields.risk),
    ...proseRule("tradeoffs", fields.tradeoffs),
    ...proseRule("breaking", fields.breaking),
  );

  return found;
};

const commitRule = (commit: Commit | undefined): Array<Finding> => {
  if (commit === undefined) return [];
  const found: Array<Finding> = [];

  if (commit.files.length === 0 || commit.files.some((f) => f.trim() === "" || f.includes("\0"))) {
    found.push(
      finding("commit-files", "`commit.files` must name at least one non-empty project path"),
    );
  }

  const desc = commit.description.trim();
  const words = countWords(desc);
  if (desc.includes("\n") || HEADING.test(desc)) {
    found.push(
      finding("commit-description-line", "`commit.description` must be a single line without `#`"),
    );
  }
  if (words < MIN_COMMIT_DESC_WORDS || words > MAX_COMMIT_DESC_WORDS) {
    found.push(
      finding(
        "commit-description-length",
        `\`commit.description\` has ${words} words; use ${MIN_COMMIT_DESC_WORDS} to ${MAX_COMMIT_DESC_WORDS} words`,
      ),
    );
  }
  found.push(...proseRule("commit.description", desc));

  if (commit.changes.length === 0 || commit.changes.length > MAX_COMMIT_CHANGES) {
    found.push(
      finding(
        "commit-changes-count",
        `\`commit.changes\` must have 1 to ${MAX_COMMIT_CHANGES} bullets`,
      ),
    );
  } else if (commit.changes.some((c) => c.trim() === "" || c.includes("\n"))) {
    found.push(
      finding("commit-changes-line", "each `commit.changes` entry must be one non-empty line"),
    );
  } else {
    for (const [idx, line] of commit.changes.entries()) {
      found.push(...proseRule(`commit.changes[${idx}]`, line));
    }
  }

  return found;
};

const validationRule = (validation: Fields["validation"]): Array<Finding> => {
  if (validation.length === 0) return [];
  if (validation.some((one) => NO_CODE_NOTE.test(`${one.check} ${one.result}`))) return [];
  const hasDelta = validation.some((one) => RIPWIRE_DELTA.test(one.check));
  const hasAffected = validation.some((one) => RIPWIRE_AFFECTED.test(one.check));
  if (hasDelta && hasAffected) return [];
  const missing = [
    ...(hasDelta ? [] : ["`ripwire . --quality-delta`"]),
    ...(hasAffected ? [] : ["`ripwire . --affected=<paths>`"]),
  ];
  return [
    finding(
      "validation-ripwire",
      `\`validation\` must include ${missing.join(" and ")}, or state that the branch changed no code file`,
    ),
  ];
};

export const lint = (fields: Fields, draft: Draft): ReadonlyArray<Finding> => [
  ...titleRule(fields, draft),
  ...bodyRule(fields, draft),
  ...validationRule(fields.validation),
  ...commitRule(fields.commit),
];
