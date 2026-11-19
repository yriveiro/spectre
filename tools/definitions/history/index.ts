import type { Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { DEFAULT_LIMIT, DEFAULT_MAX_BODY_CHARS, history } from "./read";

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
  maxBodyChars: Schema.optional(Schema.Number).annotate({
    description: `Maximum characters per commit body before truncation. Default ${DEFAULT_MAX_BODY_CHARS}.`,
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
  ownership: Schema.optional(
    Schema.Struct({
      commits: Schema.Number,
      authors: Schema.Number,
      major: Schema.Struct({
        author: Schema.String,
        commits: Schema.Number,
        share: Schema.Number,
      }),
      minor: Schema.Number,
    }),
  ),
  reverts: Schema.Number,
  authors: Schema.Array(Schema.String),
  first: Schema.optional(Schema.String),
  last: Schema.optional(Schema.String),
  bodies: Schema.Number,
  problems: Schema.optional(Schema.String),
});

const DESCRIPTION = `Read a file's git commit history, line blame, diff pickaxe origin, and authorship to explain why code exists.
Returns commits with full message bodies, file creation commit (introducedBy), single-line blame, revert counts, and contributor ownership share. Filter commit messages with contains, or search diffs with matches (git pickaxe) to find which commit introduced or removed an unexplained line.`;

export const historyTool = (directory: string): Tool.Info<typeof Input, typeof Output> => ({
  name: "history",
  description: DESCRIPTION,
  input: Input,
  output: Output,
  options: { namespace: "spectre", codemode: true, permission: "read" },
  execute: (input) =>
    Effect.promise(async () => {
      const { problems, introducedBy, blame, first, last, ownership, ...rest } = await history(
        directory,
        input,
      );
      return {
        output: {
          ...rest,
          ...(introducedBy === null ? {} : { introducedBy }),
          ...(blame === null ? {} : { blame }),
          ...(ownership === null ? {} : { ownership }),
          ...(first === null ? {} : { first }),
          ...(last === null ? {} : { last }),
          ...(problems.length > 0 ? { problems: problems.join("\n") } : {}),
        },
      };
    }),
});
