import type { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect, Schema, type Scope } from "effect";
import { attachContext } from "./context";
import { CONTRACT } from "./contract";
import { attachGuard } from "./guard";
import { argv, type Route } from "./policy";
import { probe } from "./probe";
import { run, scope } from "./run";
import { rerouted } from "./state";

export const SearchInput = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "A code question in words, answered with the enclosing symbol.",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description: "A symbol, literal, or regex already in hand. `ripgrep`'s own field name, kept so a rerouted call decodes.",
  }),
  kind: Schema.optional(Schema.Literals(["task", "literal", "regex"])).annotate({
    description: "How to read `pattern`. `query` is always a task. Omit for a literal.",
  }),
  path: Schema.optional(Schema.String).annotate({
    description: "Scope the search to this path, relative to the project directory or absolute.",
  }),
  budget: Schema.optional(Schema.Number).annotate({
    description: "Token budget for a task answer. Default 2000.",
  }),
  fresh: Schema.optional(Schema.Boolean).annotate({
    description: "Re-read the index instead of using the cache.",
  }),
  include: Schema.optional(Schema.String).annotate({
    description: "Declared so a rerouted `ripgrep` payload decodes. Ignored: the code index does not filter by it.",
  }),
  literal: Schema.optional(Schema.Boolean).annotate({
    description: "Declared so a rerouted `ripgrep` payload decodes. Ignored here: a direct call already chose the instrument.",
  }),
  caseSensitive: Schema.optional(Schema.Boolean).annotate({
    description: "Declared so a rerouted `ripgrep` payload decodes. Ignored: the code index decides case handling.",
  }),
  limit: Schema.optional(Schema.Number).annotate({
    description: "Declared so a rerouted `ripgrep` payload decodes. Ignored: the answer carries what the index ranked.",
  }),
});

export const SearchOutput = Schema.Struct({
  tool: Schema.Literals(["spectre_search"]),
  verb: Schema.Literals(["for", "grep", "regex"]).annotate({
    description: "Which ripwire verb answered: `for` a task, `grep` a literal, `regex` a pattern.",
  }),
  status: Schema.Literals(["answered", "empty", "partial", "absent", "refused"]),
  command: Schema.String.annotate({
    description: "The argv that ran, joined. Empty when nothing ran.",
  }),
  answer: Schema.String.annotate({
    description: "What the index said, prefixed with the sentinel when a rerouted `ripgrep` call was answered.",
  }),
  rerouted: Schema.optional(Schema.Boolean).annotate({
    description: "True when this answer settled a `ripgrep` call the guard renamed.",
  }),
  reason: Schema.String,
  note: Schema.optional(Schema.String),
});

const verbOf = (route: Route): "for" | "grep" | "regex" => {
  switch (route.kind) {
    case "task":
      return "for";
    case "literal":
      return "grep";
    case "regex":
      return "regex";
  }
};

const ignoredOf = (input: typeof SearchInput.Type): string => {
  const ignored: Array<string> = [];
  if (input.include !== undefined) ignored.push("include");
  if (input.caseSensitive !== undefined) ignored.push("caseSensitive");
  if (input.limit !== undefined) ignored.push("limit");
  return ignored.length === 0
    ? ""
    : `Ignored ${ignored.join(", ")}: the code index does not filter by ${ignored.length === 1 ? "it" : "them"}.`;
};

const withIgnored = (note: string | undefined, ignored: string): { note?: string } => {
  if (ignored === "") return note === undefined ? {} : { note };
  return { note: note === undefined ? ignored : `${note} ${ignored}` };
};

/**
 * The direct code-search tool. A code question (`query`) runs as a task; a
 * `pattern` with `kind: "regex"` runs as a regex; anything else runs as a
 * literal. `scope` refuses a path outside the root before the spawn, and a
 * non-ready probe is `absent` without spawning. When the guard renamed a
 * `ripgrep` call, its id sits in `rerouted`: the sentinel prefixes the
 * answer so the model sees which instrument answered.
 */
export const search = (ctx: Plugin.Context): Tool.Info<typeof SearchInput, typeof SearchOutput> => ({
  name: "search",
  description: CONTRACT.search,
  input: SearchInput,
  output: SearchOutput,
  options: { namespace: "spectre", codemode: false, permission: "read" },
  execute: (input, context) =>
    Effect.gen(function* () {
      const root = ctx.location.directory;
      // A missing path is the whole tree, not an escape: scope returns
      // `undefined` for both, so branch before calling it.
      const scoped = input.path === undefined ? root : scope(root, input.path);
      if (scoped === undefined) {
        const output = {
          tool: "spectre_search" as const,
          verb: "grep" as const,
          status: "refused" as const,
          command: "",
          answer: "",
          reason: "outside-root",
          note: `${input.path} is outside ${root}, so no code index was read.`,
        };
        return { output, content: output.answer };
      }

      const health = yield* Effect.promise(() => probe());
      if (health.kind !== "ready") {
        const output = {
          tool: "spectre_search" as const,
          verb: "grep" as const,
          status: "absent" as const,
          command: "",
          answer: "",
          reason: "no-instrument",
          note:
            health.kind === "stale"
              ? `${health.binary} is version ${health.version}, older than 0.6.10. Run ripwire --doctor.`
              : health.why,
        };
        return { output, content: output.answer };
      }

      const text = input.query ?? input.pattern ?? "";
      if (text === "") {
        const output = {
          tool: "spectre_search" as const,
          verb: "grep" as const,
          status: "refused" as const,
          command: "",
          answer: "",
          reason: "empty-query",
          note: "Neither query nor pattern was given, so nothing was asked.",
        };
        return { output, content: output.answer };
      }

      const route: Route =
        input.query !== undefined && input.query !== ""
          ? { kind: "task", task: input.query }
          : input.kind === "regex"
            ? { kind: "regex", pattern: text }
            : { kind: "literal", text };
      const verb = verbOf(route);
      const reason = input.query !== undefined && input.query !== "" ? "query" : input.kind === "regex" ? "kind" : "pattern";
      const ignored = ignoredOf(input);
      const result = yield* Effect.promise(() =>
        run(root, argv(route, scoped, input.budget ?? 2000), {
          ...(input.fresh === undefined ? {} : { fresh: input.fresh }),
        }),
      );

      const wasRerouted = rerouted.delete(context.id);
      const answer = wasRerouted ? `${CONTRACT.sentinel}\n${result.answer}` : result.answer;
      const output = {
        tool: "spectre_search" as const,
        verb,
        status: result.status,
        command: result.command,
        answer,
        ...(wasRerouted ? { rerouted: true as const } : {}),
        reason,
        ...withIgnored(result.note, ignored),
      };
      return { output, content: output.answer };
    }),
});

export const attachSearch = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* attachContext(ctx);
    yield* attachGuard(ctx);
  });
