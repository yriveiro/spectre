import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import { DEFAULT_LIMIT, history } from "./read";

const Input = Schema.Struct({
  path: Schema.String.annotate({
    description: "File to read the history of, relative to the project directory or absolute.",
  }),
  line: Schema.optional(Schema.Number).annotate({
    description: "Also blame this line, which answers who last changed it and when.",
  }),
  contains: Schema.optional(Schema.String).annotate({
    description:
      "Only commits whose MESSAGE contains this. Use it to find the one that explained itself.",
  }),
  matches: Schema.optional(Schema.String).annotate({
    description:
      "Only commits whose DIFF added or removed this exact text. This is the pickaxe, and it is how you find the commit that introduced a line nobody wrote a message about.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: `Commits to return, newest first. Default ${DEFAULT_LIMIT}.`,
  }),
});

const Commit = Schema.Struct({
  sha: Schema.String,
  short: Schema.String,
  date: Schema.String,
  author: Schema.String,
  subject: Schema.String,
  body: Schema.String,
  reverts: Schema.Boolean,
});

const Output = Schema.Struct({
  path: Schema.String,
  found: Schema.Boolean,
  introducedBy: Schema.optional(Commit),
  commits: Schema.Array(Commit),
  blame: Schema.optional(
    Schema.Struct({
      line: Schema.Number,
      sha: Schema.String,
      author: Schema.String,
      date: Schema.String,
      summary: Schema.String,
    }),
  ),
  reverts: Schema.Number,
  authors: Schema.Array(Schema.String),
  first: Schema.optional(Schema.String),
  last: Schema.optional(Schema.String),
  bodies: Schema.Number,
  problems: Schema.optional(Schema.String),
});

const DESCRIPTION = `Read the git history of one file and hand back the commits that explain it.

\`ripwire\` answers who last touched a file and what changes alongside it. Neither
answers the question this is for, which is why a line looks the way it does. The
rationale lives in commit messages, so this reads them.

  const h = await tools.spectre.history({ path: "src/auth.ts", line: 42 })
  h.bodies         // 0 means git holds no rationale for this file
  h.commits        // the reason that line is shaped like that
  h.blame          // who last touched this exact line, and when

  // The commit that introduced a line, found in the diff rather than a message,
  // which is the only place the answer lives when nobody wrote one.
  const origin = await tools.spectre.history({ path: "src/auth.ts", matches: "refreshToken" })

## What comes back

- \`commits\`, newest first. \`body\` is the rationale, and it is the field worth
  reading: a subject says what changed, a body says why, and the why is what you
  cannot recover from the code.
- \`introducedBy\`, the commit that created the file. Read this before changing a
  shape you do not recognise; the original commit usually says what the shape was
  for, and a later commit is usually the one that broke it.
- \`blame\`, when you passed \`line\`. It is one commit, not a distribution: who
  last touched that exact line, and what they said they were doing.
- \`reverts\`, how many of the commits returned are reverts. A file with reverts in
  its recent history has been argued about, and the losing argument is often still
  in the tree.
- \`bodies\`, how many of the commits returned carry a body. **A history of
  subjects and no bodies cannot answer why**, and this is the number that says so
  before you read a row. Zero means the rationale is not in git for this file, and
  the honest answer is that the reason is unrecoverable here.
- \`authors\` and \`first\` / \`last\`, for "who knows this" and "how old is this".

## Two ways to narrow, and they ask different questions

\`contains\` asks the commit **message**. \`matches\` asks the **diff**: the pickaxe,
which returns the commits that added or removed that exact text. They are not
redundant, and the second is usually the one that works.

A line nobody wrote a message about has no \`contains\` answer, because the
rationale was never typed. Its origin is still in the diff, so \`matches\` on a
literal from the line finds the commit that introduced it. Use \`contains\` for
"fix", "revert", "keep", "for now", "temporary", which finds the commits that
argued. Use \`matches\` for the shape nobody explained.

## Reading it

\`problems\` carries the signals that change how much the answer is worth. A file
whose commits are mostly under 90 days old is still moving, and a reason recorded
last month may already be wrong. Read the warnings before quoting the history as
the reason something is the way it is.

## What it will not do

It does not read pull request bodies, issues, or review threads. Those live
outside git, and a local clone does not have them. A commit message that says
"see #412" is a commit message that will not answer anything here, and the tool
cannot tell you that. \`ripwire.stray_content\` and \`ripwire.owners\` cover the
cross-branch and bus-factor halves.

## Determinism

Everything here is a function of the repository as committed. No network, no clock
except the ninety-day window in \`problems\`, and the same clone gives the same
answer. A file with uncommitted edits reports the history of what was committed,
which is the point, and the working tree is not consulted beyond existence.`;

export const historyTool = (directory: string): Tool.Info<typeof Input, typeof Output> => ({
  name: "history",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, pinned: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => {
      const { problems, introducedBy, blame, first, last, ...rest } = await history(
        directory,
        input,
      );
      return {
        output: {
          ...rest,
          ...(introducedBy === null ? {} : { introducedBy }),
          ...(blame === null ? {} : { blame }),
          ...(first === null ? {} : { first }),
          ...(last === null ? {} : { last }),
          ...(problems.length > 0 ? { problems: problems.join("\n") } : {}),
        },
      };
    }),
});
