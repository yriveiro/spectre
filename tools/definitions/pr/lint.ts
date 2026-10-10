import type { Fields, Finding } from "./fields";
import type { Draft } from "./render";

/**
 * The rules that a composition can still break, checked in code because a rule in a
 * skill is a rule the agent follows when it remembers. Every rule here fails on text
 * this tool produced itself, from fields a caller controls, so each one is reachable
 * by an input and none of them is decoration.
 *
 * Rules the composition cannot break are not restated here. A missing heading is
 * absent from the list because `render.ts` always writes it; re-checking it would be a
 * guard nothing can reach. What is left is what a caller can get wrong.
 */

const MAX_TITLE = 72;
const MAX_BODY_LINES = 40;

/** The eleven types the playbook names, in the shape it requires them. */
const TITLE = /^(feat|fix|refactor|docs|style|test|build|ci|chore|perf|revert)(\([^)]+\))?!?: [^ ].*/;

const SHA = /\b[0-9a-f]{7,40}\b/;

const NUMBERED = /^\s*\d+\.\s/m;

const CLOSERS: ReadonlyArray<[RegExp, string]> = [
  [/\band\b/i, "an `and`"],
  [/;/, "a `;`"],
  [/,/, "a `,`"],
];

const finding = (rule: string, detail: string): Finding => ({ rule, detail });

const titleRule = (fields: Fields, draft: Draft): Array<Finding> => {
  const found: Array<Finding> = [];
  const { title } = draft;

  if (title.length > MAX_TITLE)
    found.push(
      finding("title-length", `${title.length} characters, over the ${MAX_TITLE} this tool allows`),
    );
  if (title.endsWith("."))
    found.push(finding("title-period", "the title ends with a period, which the pattern does not carry"));
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
        finding("title-one-clause", `${name} in the subject joins two changes, which is two pull requests`),
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
      finding("body-length", `${lines.length} lines, over the ${MAX_BODY_LINES} a reviewer will read`),
    );
  if (SHA.test(body))
    found.push(finding("body-no-sha", "a commit SHA is in the body, and `git log` already holds that text"));
  if (NUMBERED.test(body))
    found.push(finding("body-no-commit-list", "a numbered list is a changelog in a pull request's clothes"));

  if (fields.summary.includes("\n"))
    found.push(finding("summary-one-paragraph", "`summary` is one paragraph with no heading above it"));
  if (fields.review.includes("\n"))
    found.push(finding("review-one-line", "`review` is the one line of feedback you want"));
  if (fields.scopeItems.length === 0)
    found.push(finding("scope-items", "`scopeItems` is empty, so the body names no symbol or path"));
  if (fields.validation.length === 0)
    found.push(
      finding("validation-evidence", "`validation` is empty, which reports no evidence rather than good news"),
    );

  for (const [name, text] of [
    ["tradeoffs", fields.tradeoffs],
    ["breaking", fields.breaking],
  ] as const)
    if (text !== undefined && /^\s*none\.?\s*$/i.test(text))
      found.push(finding(`${name}-not-none`, `\`${name}\` is \`None.\`, so leave the field out instead`));

  return found;
};

/** Fail-closed: any finding refuses the create, and `problems` names each rule. */
export const lint = (fields: Fields, draft: Draft): ReadonlyArray<Finding> => [
  ...titleRule(fields, draft),
  ...bodyRule(fields, draft),
];