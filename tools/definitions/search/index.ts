import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Effect, Schema, type Scope } from "effect";
import { attachCatalogue, attachGuard } from "./apply";
import { CONTRACT, INSTALL } from "./contract";
import { attachMeasure } from "./measure";
import { argv, type Health, type Route } from "./policy";
import { probe } from "./probe";
import { rootOf } from "./root";
import { type RunResult, run, scope } from "./run";
import { rerouted } from "./state";

export { ripwire } from "./ripwire";

export const SearchInput = Schema.Struct({
  query: Schema.optional(Schema.String).annotate({
    description: "A code question in words, answered with the enclosing symbol.",
  }),
  pattern: Schema.optional(Schema.String).annotate({
    description: "A symbol, literal, or regex already in hand. `ripgrep`'s own field name, kept so a rerouted call decodes.",
  }),
  expand: Schema.optional(Schema.String).annotate({
    description: "Symbol selector (such as path:name or path::scope::name) to fetch its full body via ripwire --expand.",
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
  verb: Schema.Literals(["for", "grep", "regex", "expand"]).annotate({
    description: "Which ripwire verb answered: `for` a task, `grep` a literal, `regex` a pattern, `expand` a symbol body.",
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

type SearchInputValue = typeof SearchInput.Type;

interface SelectedRoute {
  readonly route: Route;
  readonly verb: "for" | "grep" | "regex" | "expand";
  readonly reason: string;
}

const HEADER_AT = 8_192;

const routeOf = (input: SearchInputValue): SelectedRoute | undefined => {
  if (input.expand !== undefined && input.expand !== "") {
    return { route: { kind: "expand", symbol: input.expand }, verb: "expand", reason: "expand" };
  }
  const text = input.query ?? input.pattern ?? "";
  if (text === "") return undefined;
  if (input.query !== undefined && input.query !== "") {
    return { route: { kind: "task", task: input.query }, verb: "for", reason: "query" };
  }
  if (input.kind === "regex") {
    return { route: { kind: "regex", pattern: text }, verb: "regex", reason: "kind" };
  }
  return { route: { kind: "literal", text }, verb: "grep", reason: "pattern" };
};

const ignoredOf = (input: SearchInputValue): string => {
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

const contentOf = (output: {
  readonly status: (typeof SearchOutput.Type)["status"];
  readonly reason: string;
  readonly answer: string;
  readonly note?: string;
}): string => {
  if (output.answer !== "") {
    return output.note !== undefined && output.note !== ""
      ? `${output.answer}\n[${output.note}]`
      : output.answer;
  }
  return `[spectre_search:${output.status}] (${output.reason}) ${output.note ?? ""}`.trim();
};

const refusedOutput = (reason: string, note: string) => {
  const output = {
    tool: "spectre_search" as const,
    verb: "grep" as const,
    status: "refused" as const,
    command: "",
    answer: "",
    reason,
    note,
  };
  return { output, content: contentOf(output) };
};

const absentOutput = (health: Exclude<Health, { readonly kind: "ready" }>) => {
  const note =
    health.kind === "stale"
      ? `${health.binary} is version ${health.version}, older than 0.6.10. Run ripwire --doctor.`
      : `${health.why}. Install it:\n${INSTALL}`;
  const output = {
    tool: "spectre_search" as const,
    verb: "grep" as const,
    status: "absent" as const,
    command: "",
    answer: "",
    reason: "no-instrument",
    note,
  };
  return { output, content: contentOf(output) };
};

const thinCoverage = (result: RunResult): number | undefined => {
  if (result.status !== "answered" && result.status !== "partial") return undefined;
  const match = /<(?:ctx|for)\b[^>]*\bcoverage="(\d+)"/.exec(result.answer.slice(0, HEADER_AT));
  if (match?.[1] === undefined) return undefined;
  const coverage = Number(match[1]);
  return coverage < 50 ? coverage : undefined;
};

const mergeWidened = (initial: RunResult, widened: RunResult, coverage: number): RunResult => {
  if (widened.status !== "answered" && widened.status !== "partial") return initial;
  const status = initial.status === "partial" || widened.status === "partial" ? "partial" : "answered";
  const widenNote = `Widened with --limit=40 because initial coverage was ${coverage}% (<50%).`;
  const note = [initial.note, widened.note, widenNote]
    .filter((part): part is string => part !== undefined && part !== "")
    .join(" ");
  return {
    status,
    command: `${initial.command} && ${widened.command}`,
    answer: widened.answer,
    ...(note === "" ? {} : { note }),
  };
};

const runSearchRoute = async (params: {
  readonly root: string;
  readonly scoped: string;
  readonly route: Route;
  readonly budget: number;
  readonly fresh?: boolean;
}): Promise<RunResult> => {
  const options = params.fresh === undefined ? {} : { fresh: params.fresh };
  const initial = await run(
    params.root,
    argv({ route: params.route, root: params.scoped, budget: params.budget }),
    options,
  );
  if (params.route.kind !== "task") return initial;
  const coverage = thinCoverage(initial);
  if (coverage === undefined) return initial;
  const widened = await run(
    params.root,
    [
      params.scoped,
      `--for=${params.route.task}`,
      `--token-budget=${params.budget}`,
      "--limit=40",
      "--legend=compact",
    ],
    options,
  );
  return mergeWidened(initial, widened, coverage);
};

const formatSearchResult = (
  selected: SelectedRoute,
  result: RunResult,
  ignored: string,
  callID: Tool.CallID,
) => {
  const wasRerouted = rerouted.delete(callID);
  const answer = wasRerouted ? `${CONTRACT.sentinel}\n${result.answer}` : result.answer;
  const output = {
    tool: "spectre_search" as const,
    verb: selected.verb,
    status: result.status,
    command: result.command,
    answer,
    ...(wasRerouted ? { rerouted: true as const } : {}),
    reason: selected.reason,
    ...withIgnored(result.note, ignored),
  };
  return { output, content: contentOf(output) };
};

/**
 * The direct code-search tool. `expand` fetches a symbol's full body; `query`
 * runs as a task and widens thin `<50%` coverage answers automatically; `pattern`
 * with `kind: "regex"` runs as a regex; anything else runs as a literal. `scope`
 * refuses a path outside the root before the spawn, and a non-ready probe is
 * `absent` without spawning.
 */
export const search = (ctx: Plugin.Context): Tool.Info<typeof SearchInput, typeof SearchOutput> => ({
  name: "search",
  description: CONTRACT.search,
  input: SearchInput,
  output: SearchOutput,
  options: { namespace: "spectre", codemode: false, permission: "read" },
  execute: (input, context) =>
    Effect.gen(function* () {
      const root = yield* rootOf(ctx, context.sessionID);
      // A missing path is the whole tree, not an escape: scope returns
      // `undefined` for both, so branch before calling it.
      const scoped = input.path === undefined ? root : scope(root, input.path);
      if (scoped === undefined) {
        return refusedOutput("outside-root", `${input.path} is outside ${root}, so no code index was read.`);
      }

      yield* ctx.permission.assert({
        sessionID: context.sessionID,
        agent: context.agent,
        action: "read",
        resources: [scoped],
        source: { type: "tool", messageID: context.messageID, id: context.id },
      });

      const health = yield* Effect.promise(() => probe());
      if (health.kind !== "ready") return absentOutput(health);

      const selected = routeOf(input);
      if (selected === undefined) {
        return refusedOutput("empty-query", "Neither query, pattern, nor expand was given, so nothing was asked.");
      }

      const result = yield* Effect.promise(() =>
        runSearchRoute({
          root,
          scoped,
          route: selected.route,
          budget: input.budget ?? 2000,
          ...(input.fresh === undefined ? {} : { fresh: input.fresh }),
        }),
      );
      return formatSearchResult(selected, result, ignoredOf(input), context.id);
    }),
});

export const attachSearch = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* attachCatalogue(ctx);
    yield* attachGuard(ctx);
    yield* attachMeasure(ctx);
  });
