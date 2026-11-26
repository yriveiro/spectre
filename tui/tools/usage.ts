import type { SessionMessageInfo } from "@opencode/client";
import { activeMessages } from "../render.ts";

/**
 * Tool-call accounting for one session, derived from its messages.
 *
 * OpenCode records token usage per assistant message
 * (`TokenUsage.Info` on `Session.Message.Assistant` at v2.4.2) and tool calls
 * as `tool` parts inside that same message, so a message that fires three
 * tools carries one usage number. Per-tool tokens are therefore pro-rated:
 * every tool part in the message is charged an equal share. A tool called
 * alone is charged the whole message. The alternative, charging each tool the
 * full message, double-counts and the totals stop checking against the
 * session's own usage.
 */

export type TokenTotals = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

export type ToolUsage = {
  /** The raw tool part name, as the transcript records it. */
  readonly name: string;
  readonly calls: number;
  /** Calls whose assistant message also called other tools. Their tokens are pro-rated. */
  readonly shared: number;
  readonly tokens: TokenTotals;
};

export type Usage = {
  /** Sorted by calls descending, then by name. */
  readonly tools: ReadonlyArray<ToolUsage>;
  readonly totals: {
    readonly calls: number;
  } & TokenTotals;
  /**
   * Assistant tokens in messages that called no tool. The table does not own
   * them, and this number says so instead of silently claiming 100%.
   */
  readonly prose: number;
};

type AssistantMessage = Extract<SessionMessageInfo, { readonly type: "assistant" }>;

type ToolPart = Extract<AssistantMessage["content"][number], { readonly type: "tool" }>;

const zero = (): TokenTotals => ({
  input: 0,
  output: 0,
  reasoning: 0,
  cacheRead: 0,
  cacheWrite: 0,
});

type Accumulator = {
  calls: number;
  shared: number;
  tokens: TokenTotals;
};

/** A pure merge: `into` is never mutated, and the result carries the share added. */
const addShare = (
  into: TokenTotals,
  from: NonNullable<AssistantMessage["tokens"]>,
  share: number,
): TokenTotals => ({
  input: into.input + from.input * share,
  output: into.output + from.output * share,
  reasoning: into.reasoning + from.reasoning * share,
  cacheRead: into.cacheRead + from.cache.read * share,
  cacheWrite: into.cacheWrite + from.cache.write * share,
});

export const totalTokens = (tokens: TokenTotals): number =>
  tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;

export const toolUsage = (
  messages: ReadonlyArray<SessionMessageInfo>,
  boundary?: string,
): Usage => {
  const byTool = new Map<string, Accumulator>();
  const totals = { calls: 0, ...zero() };
  let prose = 0;

  for (const message of activeMessages(messages, boundary)) {
    if (message.type !== "assistant") continue;
    const parts = message.content.filter((part): part is ToolPart => part.type === "tool");
    const tokens = message.tokens;
    if (parts.length === 0) {
      if (tokens !== undefined) prose += totalTokens(addShare(zero(), tokens, 1));
      continue;
    }
    const share = tokens === undefined ? 0 : 1 / parts.length;
    for (const part of parts) {
      const one = byTool.get(part.name) ?? { calls: 0, shared: 0, tokens: zero() };
      one.calls += 1;
      if (parts.length > 1) one.shared += 1;
      if (tokens !== undefined) one.tokens = addShare(one.tokens, tokens, share);
      byTool.set(part.name, one);
      totals.calls += 1;
    }
    if (tokens !== undefined) Object.assign(totals, addShare(totals, tokens, 1));
  }

  const tools = [...byTool.entries()]
    .map(([name, one]) => ({ name, calls: one.calls, shared: one.shared, tokens: one.tokens }))
    .sort((a, b) => b.calls - a.calls || a.name.localeCompare(b.name));

  return { tools, totals, prose };
};

const compact = new Intl.NumberFormat("en-US", {
  notation: "compact",
  maximumFractionDigits: 1,
});

/** `8123` reads as `8.1K`; the columns are narrow and the exact number is one keypress away. */
export const formatTokens = (value: number): string => compact.format(Math.round(value));

/**
 * `spectre_brain_assert` reads as `brain_assert`. Another plugin's tool keeps
 * its full name: the cut is a courtesy for the plugin's own noisy namespace,
 * not a rule about names.
 */
export const displayName = (name: string): string =>
  name.startsWith("spectre_") ? name.slice("spectre_".length) : name;
