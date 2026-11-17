import type { Tool } from "@opencode/plugin/effect";
import { Schema } from "effect";

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
      "Why the change exists, in plain words. It goes under the `## Summary` heading the body writes, so bring no heading of your own. One paragraph or several short ones. The body describes the change, not the commits: no SHA, no numbered commit list.",
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
      "The `## Validation` bullets. One entry per command that ran, and what it returned. At least one; an empty list is a claim of evidence that does not exist. A branch that changed a code file adds one entry for `ripwire . --quality-delta` and one for `ripwire . --affected=<paths>`, both run after the last change.",
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

export const DESCRIPTION = `Compose, lint, push, and open or update a GitHub pull request from structured conventional-commit fields.
Validates title and body against playbook-opening-a-pr before pushing, never force-pushes or opens drafts, and converges idempotently on re-runs. Code changes require validation entries for \`ripwire . --quality-delta\` and \`ripwire . --affected=<paths>\`. A branch that changed no code file states that fact in its test validation entry.`;

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
    description:
      "True when a pull request exists and GitHub made it a draft despite no draft flag. It is never created as one.",
  }),
  directory: Schema.optional(Schema.String),
});

export const Output = Schema.Union([Lint, Verdict, Failed]);

export type Output = typeof Output.Type;

export type Info = Tool.Info<typeof Input, typeof Output>;
