import { Schema } from "effect";
import type { Tool } from "@opencode/schema/tool";

/**
 * `Fields` is the type every module below this one takes, so a caller cannot hand them
 * a shape they do not handle without the schema refusing it first. What the text breaks is
 * `lint.ts`'s question, not this file's.
 */

export const TYPES = [
  "feat",
  "fix",
  "refactor",
  "docs",
  "style",
  "test",
  "build",
  "ci",
  "chore",
  "perf",
  "revert",
] as const;

export type Type = (typeof TYPES)[number];

/** The `## Validation` bullet is a pair, because `- check` alone claims nothing ran. */
const Check = Schema.Struct({
  check: Schema.String.annotate({
    description: "The command or check that ran.",
  }),
  result: Schema.String.annotate({
    description: "What it returned. Not `passed`, but what it said.",
  }),
});

const Fields = Schema.Struct({
  type: Schema.Literals([...TYPES]).annotate({
    description: "Conventional-commit type. One of them, not a new one.",
  }),
  scope: Schema.String.annotate({
    description:
      "Lowercase noun naming the changed area, written the way the repository writes it. A real symbol when one carries the change.",
  }),
  subject: Schema.String.annotate({
    description:
      "Imperative subject with no trailing period and no type or scope. One clause: two clauses joined by `and`, `;` or `,` is two pull requests.",
  }),
  summary: Schema.String.annotate({
    description:
      "One paragraph, no heading above it. Why the change exists, in plain words. The body describes the change, not the commits: no SHA, no numbered commit list.",
  }),
  review: Schema.String.annotate({
    description: "The one piece of feedback you want, in one line.",
  }),
  scopeItems: Schema.Array(Schema.String).annotate({
    description:
      "The `## Scope` bullets: real symbols and paths, grouped by what belongs together. At least one.",
  }),
  validation: Schema.Array(Check).annotate({
    description:
      "The `## Validation` bullets. One entry per command that ran, and what it returned. At least one; an empty list is a claim of evidence that does not exist.",
  }),
  risk: Schema.String.annotate({
    description:
      "What it touches, how to revert it, and what stays broken on trunk if it does not land.",
  }),
  tradeoffs: Schema.optional(Schema.String).annotate({
    description:
      "The alternative a reviewer would otherwise ask about, and why this one won. Omit it when there is nothing to say; a section holding `None.` is a section nobody reads.",
  }),
  breaking: Schema.optional(Schema.String).annotate({
    description:
      "What no longer works and the migration it needs. Present puts `!` in the title and renders `## Breaking Changes`; absent leaves both out.",
  }),
  base: Schema.optional(Schema.String).annotate({
    description:
      "Branch this pull request targets. Omit it for the repository default branch. Name a parent branch for a stack.",
  }),
});

export type Fields = typeof Fields.Type;

export const Input = Schema.Struct(Fields.fields);

export type Input = typeof Input.Type;

export const DESCRIPTION = `Open a pull request whose title and body are composed here from structured fields, checked against the rules in \`playbook-opening-a-pr\`, and refused when a rule fails.

  const pr = await tools.spectre.pr({
    type: "feat", scope: "spectre", subject: "compose the pull request title and body",
    summary: "Agents wrote pull requests by hand, so the shape of one was whatever the run produced.",
    review: "Is the lint fail-closed, or does it only warn?",
    scopeItems: ["tools/definitions/pr/render.ts"],
    validation: [{ check: "bun test test/pr", result: "38 pass, 0 fail" }],
    risk: "Adds a tool. Reverting the folder removes it.",
  })
  pr.status === "created"                                                // the URL is in pr.url

The title and body reach GitHub exactly as this tool wrote them. No text the caller
sends is passed through as prose: the fields are assembled into the playbook's shape,
and the lint refuses rather than repairs.

## The order, and why it is that order

1. Compose. One pure function, the same fields to the same bytes every time.
2. Lint. Every rule is a refusal, not a warning. A failure returns the composed
   title and body, so the rule can be read against what it produced.
3. Read. The branch, its upstream, and the base. A detached HEAD is a refusal: no
   branch names the pull request.
4. Push. Only what the remote lacks, and never with a flag that rewrites history.
5. Reconcile. One open pull request on this branch means edit, not create.
6. Write, then read back. An exit code is not a URL.

Nothing is pushed and no pull request exists until step 2 clears, so a failed lint
leaves the remote exactly as it was.

## Running it twice

The operation converges. A second call finds the open pull request for the branch and
rewrites it to the same composed bytes, returning \`status: "updated"\` and
\`changed: false\`. That is the answer a re-run gives, and it is what makes this safe
to call again after a crash: a run that died after the push finds the branch current
and pushes nothing, and a run that died after the create finds the pull request and
converges on it. Nothing reads what the previous attempt was doing.

## What it will not do

It never opens a draft, so there is no input that can express one. \`## Merge Gate\`
is always rendered unticked, because this tool cannot observe a human and will not
report an approval it did not read. It never force-pushes. It never commits. It never
edits a pull request on any other branch, and it never targets a base it was not given
or could read as the default.

A \`gh\` that failed is reported as it failed. \`status: "failed"\` means nothing is
confirmed, not that the pull request was rolled back — a create that succeeded and a
read-back that then failed lands as one, and the URL is in \`problems\` when there is
one. Read it before retrying, because a retry converges rather than duplicating.`;

/** The lint verdict, as the tool reports it. `detail` names the fix, not the rule. */
export const Finding = Schema.Struct({
  rule: Schema.String,
  detail: Schema.String,
});

export type Finding = typeof Finding.Type;

const Lint = Schema.Struct({
  status: Schema.Literals(["lint-failed"]).annotate({
    description: "Nothing was pushed and no pull request exists. `problems` says what to change.",
  }),
  problems: Schema.String,
  title: Schema.String.annotate({
    description: "The title as composed, so a rule can be read against what it produced.",
  }),
  body: Schema.String.annotate({
    description:
      "The body as composed, so a rule can be read against it. A `lint-failed` body is diagnostic: it may carry an empty section, because the rule that refused it is exactly that.",
  }),
});

const Verdict = Schema.Struct({
  status: Schema.Literals(["created", "updated"]),
  number: Schema.Number,
  url: Schema.String,
  branch: Schema.String,
  base: Schema.String,
  title: Schema.String,
  body: Schema.String,
  pushed: Schema.Boolean.annotate({
    description: "False when the remote already held every commit on this branch.",
  }),
  changed: Schema.Boolean.annotate({
    description: "False when the pull request already held this exact title and body.",
  }),
  problems: Schema.optional(Schema.String),
});

const Failed = Schema.Struct({
  status: Schema.Literals(["failed"]),
  problems: Schema.String,
  pushed: Schema.Boolean,
  draft: Schema.Boolean.annotate({
    description: "True when a pull request exists and GitHub made it a draft despite no draft flag. It is never created as one.",
  }),
  directory: Schema.optional(Schema.String),
});

export const Output = Schema.Union([Lint, Verdict, Failed]);

export type Output = typeof Output.Type;

export type Info = Tool.Info<typeof Input, typeof Output>;