import type { ModelRef, SessionInfo, SessionMessageInfo, TokenUsageInfo } from "@opencode/client";
import { activeMessages, trimPrefix } from "../render.ts";

/**
 * Session usage grouped by routing profile, main agent, and whatever else
 * spent tokens, derived from the host data domain and the project's routing
 * config.
 *
 * The host records what this report needs at three levels: `Session.Info`
 * carries the session's own token and cost totals, each assistant message
 * carries the agent, model ref, token usage, and cost of its own model call,
 * and a transcript marks every execution boundary with an `idle` message
 * (`Session.Message.Idle` at v2.3.0, with the outcome of that execution).
 *
 * A run is therefore the span from one admitted prompt to the next `idle`:
 * the `subagent` tool prompts a child once per invocation, and a follow-up
 * that arrives while the child is busy steers the execution in progress, so
 * it carries no `idle` of its own and stays inside the run it joined.
 *
 * The rows partition the session: the main agent's own runs are rows, the
 * children's runs are matched to routing profiles, a run that matches no
 * profile lands in an unrouted row named after its agent, and compaction
 * spend lands in its own row — completed and failed compactions both, since
 * the host bills the failed ones too. Every assistant message and every
 * billed compaction lands in exactly one row, so the tokens column sums to
 * the footer total. Profiles that share a routing signature stay separate
 * rows; a run matching both is booked on the first in config order.
 */

export type TokenTotals = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export type SubagentRun = {
  readonly index: number;
  /** First line of the prompt that started the run, without the subagent preamble. */
  readonly prompt: string;
  /** The whole prompt text, preamble stripped; the label is its clipped first line. */
  readonly promptText: string;
  /** The agent that produced the run's last model call. */
  readonly agent: string;
  readonly models: ReadonlyArray<string>;
  readonly tokens: TokenTotals;
  readonly cost: number;
  readonly started?: number;
  readonly ended?: number;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly running: boolean;
};

/** A profile as the routing config resolves it: name, agent, spent ref. */
export type ProfileRouting = {
  readonly name: string;
  readonly agent: string;
  /** `provider/model#rung`, or undefined when the profile failed to resolve. */
  readonly ref: string | undefined;
};

export type ProfileRun = {
  /** The child session's description, or `main` for the root's own runs. */
  readonly child: string;
  readonly run: SubagentRun;
};

export type UsageRowKind = "profile" | "main" | "compaction";

export type ProfileUsage = {
  readonly kind: UsageRowKind;
  /** The profile's name. Profile rows only; unrouted rows carry none. */
  readonly name: string | undefined;
  readonly agent: string;
  readonly ref: string | undefined;
  /** Profile rows only: no routing signature claimed these runs. */
  readonly unrouted: boolean;
  readonly tokens: TokenTotals;
  readonly cost: number;
  readonly runs: ReadonlyArray<ProfileRun>;
  /** Distinct sessions that landed in this row. */
  readonly children: number;
  readonly running: boolean;
};

export type SessionUsage = {
  /** Sorted by tokens descending, then label. */
  readonly rows: ReadonlyArray<ProfileUsage>;
  /** The sum of the rows: the tokens column adds up to this by construction. */
  readonly totals: {
    readonly runs: number;
    readonly tokens: TokenTotals;
    readonly cost: number;
  };
};

const PREAMBLE = "You are a subagent spawned by another session.";

const zero = (): TokenTotals => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

const addTokens = (into: TokenTotals, from: TokenUsageInfo): TokenTotals => ({
  input: into.input + from.input,
  output: into.output + from.output,
  reasoning: into.reasoning + from.reasoning,
  cacheRead: into.cacheRead + from.cache.read,
  cacheWrite: into.cacheWrite + from.cache.write,
});

const addTotals = (into: TokenTotals, from: TokenTotals): TokenTotals => ({
  input: into.input + from.input,
  output: into.output + from.output,
  reasoning: into.reasoning + from.reasoning,
  cacheRead: into.cacheRead + from.cacheRead,
  cacheWrite: into.cacheWrite + from.cacheWrite,
});

export const totalTokens = (tokens: TokenTotals): number =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;

export const modelRef = (ref: ModelRef): string =>
  `${ref.providerID}/${ref.id}${ref.variant === undefined ? "" : `#${ref.variant}`}`;

const baseRef = (ref: string): string => ref.split("#")[0] ?? ref;

/** The prompt message's whole body, with the subagent preamble stripped.
 * The run's row label is its first line clipped; the expanded section
 * under a clicked row reads the whole text. */
const runBody = (text: string): string => {
  const body = trimPrefix(text, PREAMBLE);
  return body === text ? text : body.trimStart();
};

const runLabel = (body: string): string => (body.split("\n")[0] ?? "").trim().slice(0, 60);

type RunBuilder = {
  /** The prompt's whole body; the run's label is its clipped first line. */
  body: string;
  agent: string;
  models: string[];
  tokens: TokenTotals;
  cost: number;
  started?: number;
  ended?: number;
  outcome?: "succeeded" | "failed" | "interrupted";
};

const runsOf = (
  messages: ReadonlyArray<SessionMessageInfo>,
  running: boolean,
  /** The agent for a run that produced no model call, so an empty run still
   * lands under the right section instead of inheriting another's name. */
  fallbackAgent: string,
): ReadonlyArray<SubagentRun> => {
  const runs: RunBuilder[] = [];

  const open = (body: string, started?: number): RunBuilder => {
    const run: RunBuilder = { body, agent: "", models: [], tokens: zero(), cost: 0, started };
    runs.push(run);
    return run;
  };

  for (const message of messages) {
    if (message.type === "user") {
      if (runs.length === 0 || runs.at(-1)?.outcome !== undefined)
        open(runBody(message.text), message.time.created);
      continue;
    }
    if (message.type === "assistant") {
      // An assistant message before any admitted prompt still counts, and so
      // does one that arrives after the previous run closed without a new
      // prompt: the tokens were spent, and a run that owns them is the
      // honest row. A closed run never absorbs new spend.
      const last = runs.at(-1);
      const run =
        last === undefined || last.outcome !== undefined ? open("", message.time.created) : last;
      run.agent = message.agent;
      run.models.push(modelRef(message.model));
      if (message.tokens !== undefined) run.tokens = addTokens(run.tokens, message.tokens);
      run.cost += message.cost ?? 0;
      if (message.time.completed !== undefined) run.ended = message.time.completed;
      continue;
    }
    if (message.type === "idle") {
      const run = runs.at(-1);
      if (run !== undefined && run.outcome === undefined) {
        run.outcome = message.outcome;
        run.ended = message.time.created;
      }
    }
  }

  return runs.map((run, index) => ({
    index,
    prompt: runLabel(run.body),
    promptText: run.body,
    agent: run.agent === "" ? fallbackAgent : run.agent,
    models: [...new Set(run.models)],
    tokens: run.tokens,
    cost: run.cost,
    started: run.started,
    ended: run.ended,
    outcome: run.outcome,
    running: running && index === runs.length - 1 && run.outcome === undefined,
  }));
};

type CompactionSpend = { tokens: TokenTotals; cost: number };

const compactionSpend = (
  messages: ReadonlyArray<SessionMessageInfo>,
): { tokens: TokenTotals; cost: number } => {
  let tokens = zero();
  let cost = 0;
  for (const message of messages) {
    // The host bills failed compactions too, so the running form is the only
    // one without usage: completed and failed both carry the request's own
    // spend, and dropping it would break the row partition.
    if (message.type !== "compaction" || message.status === "running") continue;
    if (message.tokens !== undefined) tokens = addTokens(tokens, message.tokens);
    cost += message.cost ?? 0;
  }
  return { tokens, cost };
};

type RowBuilder = {
  kind: UsageRowKind;
  name: string | undefined;
  agent: string;
  ref: string | undefined;
  unrouted: boolean;
  tokens: TokenTotals;
  cost: number;
  runs: ProfileRun[];
  children: Set<string>;
};

/** One stable key per row, so the report folds each run into the row that
 * already owns its routing signature. The unrouted key carries its own
 * prefix: a configured profile may share a name with an agent, and the two
 * must never claim the same row. */
export const rowKey = (row: {
  readonly kind: UsageRowKind;
  readonly name: string | undefined;
  readonly agent: string;
  readonly ref: string | undefined;
}): string => {
  switch (row.kind) {
    case "profile":
      return row.name === undefined ? `profile:unrouted:${row.agent}` : `profile:${row.name}`;
    case "main":
      return `main:${row.agent}:${row.ref}`;
    case "compaction":
      return "compaction";
  }
};

/**
 * The routing profile a child run matched, or undefined when nothing matches.
 * Profiles that share a signature stay separate rows; config order decides
 * which row the run is booked on.
 */
const attribution = (
  routing: ReadonlyArray<ProfileRouting>,
  childAgent: string,
  runModels: ReadonlyArray<string>,
): (ProfileRouting & { readonly ref: string }) | undefined => {
  const forAgent = routing.filter((one) => one.agent === childAgent && one.ref !== undefined);
  const exact = forAgent.filter((one) => runModels.includes(one.ref as string));
  if (exact.length > 0) return exact[0] as ProfileRouting & { readonly ref: string };
  const bases = new Set(runModels.map(baseRef));
  const base = forAgent.filter((one) => bases.has(baseRef(one.ref as string)));
  if (base.length > 0) return base[0] as ProfileRouting & { readonly ref: string };
  return undefined;
};

export const sessionUsage = (input: {
  readonly rootID: string;
  readonly family: (sessionID: string) => ReadonlyArray<string>;
  readonly get: (sessionID: string) => SessionInfo | undefined;
  readonly status: (sessionID: string) => "idle" | "running";
  readonly messages: (sessionID: string) => ReadonlyArray<SessionMessageInfo>;
  readonly profiles: ReadonlyArray<ProfileRouting>;
}): SessionUsage => {
  const cut = (sessionID: string): ReadonlyArray<SessionMessageInfo> =>
    activeMessages(input.messages(sessionID), input.get(sessionID)?.revert?.messageID);

  const rows = new Map<string, RowBuilder>();
  let compaction: CompactionSpend = { tokens: zero(), cost: 0 };

  const rowOf = (
    kind: UsageRowKind,
    agent: string,
    ref: string | undefined,
    name: string | undefined,
  ): RowBuilder => {
    const key = rowKey({ kind, name, agent, ref });
    const held = rows.get(key);
    if (held !== undefined) return held;
    const fresh: RowBuilder = {
      kind,
      name,
      agent,
      ref,
      unrouted: kind === "profile" && ref === undefined,
      tokens: zero(),
      cost: 0,
      runs: [],
      children: new Set(),
    };
    rows.set(key, fresh);
    return fresh;
  };

  // Profile rows exist only where runs landed: a profile with no usage has
  // no row in the statistics.

  // The main agent's own spend: rows per (agent, model ref) the root answered
  // with, so an agent or model switch splits the row.
  const rootMessages = cut(input.rootID);
  const rootRuns = runsOf(
    rootMessages,
    input.status(input.rootID) === "running",
    input.get(input.rootID)?.agent ?? "main",
  );
  for (const message of rootMessages) {
    if (message.type !== "assistant") continue;
    const row = rowOf("main", message.agent, modelRef(message.model), undefined);
    if (message.tokens !== undefined) row.tokens = addTokens(row.tokens, message.tokens);
    row.cost += message.cost ?? 0;
    row.children.add(input.rootID);
  }
  for (const run of rootRuns) {
    const row = rows.get(
      rowKey({ kind: "main", name: undefined, agent: run.agent, ref: run.models.at(-1) }),
    );
    if (row !== undefined) row.runs.push({ child: "main", run });
  }
  const rootSpend = compactionSpend(rootMessages);
  compaction = {
    tokens: addTotals(compaction.tokens, rootSpend.tokens),
    cost: compaction.cost + rootSpend.cost,
  };

  // The children: runs attributed to routing signatures, or unrouted.
  for (const id of input.family(input.rootID)) {
    const info = input.get(id);
    if (info === undefined) continue;
    if (id === input.rootID || info.parentID === undefined) continue;
    const messages = cut(id);
    const runs = runsOf(messages, input.status(id) === "running", info.agent ?? "subagent");
    const spend = compactionSpend(messages);
    compaction = {
      tokens: addTotals(compaction.tokens, spend.tokens),
      cost: compaction.cost + spend.cost,
    };
    for (const run of runs) {
      // The run's own agent, not the session's current one: a resumed child
      // can switch agents, and `SessionInfo.agent` then mislabels every
      // historical run under the new agent.
      const matched = attribution(input.profiles, run.agent, run.models);
      const row =
        matched === undefined
          ? rowOf("profile", run.agent, undefined, undefined)
          : rowOf("profile", run.agent, matched.ref, matched.name);
      row.tokens = addTotals(row.tokens, run.tokens);
      row.cost += run.cost;
      row.runs.push({ child: info.title ?? info.id, run });
      row.children.add(id);
    }
  }

  // Compaction spend belongs to the session without belonging to any agent,
  // so it owns a row: the column still sums.
  if (totalTokens(compaction.tokens) > 0 || compaction.cost > 0) {
    const row = rowOf("compaction", "", undefined, undefined);
    row.tokens = addTotals(row.tokens, compaction.tokens);
    row.cost += compaction.cost;
  }

  const built = [...rows.values()].map((row) => ({
    kind: row.kind,
    name: row.name,
    agent: row.agent,
    ref: row.ref,
    unrouted: row.unrouted,
    tokens: row.tokens,
    cost: row.cost,
    runs: row.runs,
    children: row.children.size,
    running: row.runs.some((one) => one.run.running),
  }));

  built.sort(
    (a, b) =>
      totalTokens(b.tokens) - totalTokens(a.tokens) ||
      a.kind.localeCompare(b.kind) ||
      profileLabel(a).localeCompare(profileLabel(b)),
  );

  const totals = built.reduce(
    (into, row) => ({
      runs: into.runs + row.runs.length,
      tokens: addTotals(into.tokens, row.tokens),
      cost: into.cost + row.cost,
    }),
    { runs: 0, tokens: zero(), cost: 0 },
  );

  return { rows: built, totals };
};

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

export const formatTokens = (value: number): string => compact.format(Math.round(value));

export const formatCost = (usd: number): string => {
  if (usd <= 0) return "$0.00";
  if (usd < 0.01) return "<$0.01";
  return `$${usd.toFixed(usd < 1 ? 3 : 2)}`;
};

/** The row label: the profile's name, `main` for the root's agent, or the agent when unrouted. */
export const profileLabel = (row: ProfileUsage): string => {
  switch (row.kind) {
    case "main":
      return `main · ${row.agent}`;
    case "compaction":
      return "compaction";
    case "profile":
      return row.name === undefined ? `${row.agent} (unrouted)` : row.name;
  }
};
