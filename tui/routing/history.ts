import type { SessionMessageInfo } from "@opencode/client";
import type { JudgeConfig } from "../../tools/definitions/routing/index.ts";
import {
  judgeRef,
  NONE_CRITERION,
  NONE_LABEL,
  QUESTION_INSTRUCTIONS,
} from "../../tools/definitions/routing/index.ts";
import { activeMessages } from "../render.ts";
import type { Profile } from "./data.ts";

/**
 * Routing history for one session, derived from its messages.
 *
 * A routing decision reaches the transcript in one of two shapes. When the
 * host lists the tool itself, it is a `spectre_routing` part whose completed
 * state carries the tool's declared output as the JSON text of its single text
 * part (`normalizeContent` in `packages/core/src/tool/runtime.ts` at v2.4.2).
 * Code mode is the default, though: there the session calls the catalog name
 * `spectre.routing` inside the host's `execute` tool, and the completed
 * `execute` part carries the inner call in its `metadata.toolCalls` with the
 * program's return — the routing page, when the program passed the answer
 * through — as its text content (`packages/core/src/codemode/tool.ts` at
 * v2.4.2). The fold reads both. No second copy of a decision is kept
 * anywhere.
 */

/** The tool part's name when the host lists the tool itself: the `spectre` namespace plus `routing`. */
export const ROUTING_TOOL = "spectre_routing";

/** The code-mode catalog name the same tool is called by inside an `execute` program. */
const ROUTING_CATALOG_NAME = "spectre.routing";

/** The host's code-mode runner; its completed parts carry inner calls in `metadata.toolCalls`. */
const EXECUTE_TOOL = "execute";

export type JudgeAnswer =
  | {
      readonly status: "used";
      readonly profile: string;
      readonly confidence: number | undefined;
      readonly escalated: boolean | undefined;
      readonly effort: string | undefined;
      readonly alternatives: ReadonlyArray<{
        readonly profile: string;
        readonly probability: number;
      }>;
    }
  | { readonly status: "skipped"; readonly reason: string };

export type Spent = {
  readonly ref: string;
  readonly rung: string | undefined;
  readonly pinned: boolean;
  readonly steppedUp: boolean;
  /** The second opinion the same profile row resolved, when it resolved one. */
  readonly crosscheck: string | undefined;
};

export type RoutingCall = {
  readonly id: string;
  readonly at: number | undefined;
  readonly task: string | undefined;
  readonly namedProfile: string | undefined;
  readonly status: "resolved" | "problems" | "setup" | "declined" | "error" | "running" | "unknown";
  readonly judge: JudgeAnswer | undefined;
  readonly spent: Spent | undefined;
  /** The status word's detail: a problem line, an error message, or why the answer could not be read. */
  readonly detail: string | undefined;
};

type AssistantMessage = Extract<SessionMessageInfo, { readonly type: "assistant" }>;
type ToolPart = Extract<AssistantMessage["content"][number], { readonly type: "tool" }>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null;

const stringOf = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const numberOrUndefined = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const booleanOrUndefined = (value: unknown): boolean | undefined =>
  typeof value === "boolean" ? value : undefined;

/** The judge field, or `undefined` when the answer does not hold one that reads. */
const judgeOf = (value: unknown): JudgeAnswer | undefined => {
  if (!isRecord(value)) return undefined;
  if (value.status === "used") {
    const profile = stringOf(value.profile);
    if (profile === undefined) return undefined;
    const alternatives = Array.isArray(value.alternatives)
      ? value.alternatives.flatMap((one) => {
          if (!isRecord(one)) return [];
          const name = stringOf(one.profile);
          const probability = numberOrUndefined(one.probability);
          return name !== undefined && probability !== undefined
            ? [{ profile: name, probability }]
            : [];
        })
      : [];
    return {
      status: "used",
      profile,
      confidence: numberOrUndefined(value.confidence),
      escalated: booleanOrUndefined(value.escalated),
      effort: stringOf(value.effort),
      alternatives,
    };
  }
  if (value.status === "skipped") {
    const reason = stringOf(value.reason);
    return reason === undefined ? undefined : { status: "skipped", reason };
  }
  return undefined;
};

/** The model row the answer spent, by profile name. */
const spentOf = (rows: unknown, name: string | undefined): Spent | undefined => {
  if (name === undefined || !Array.isArray(rows)) return undefined;
  const row = rows.find((one) => isRecord(one) && one.name === name);
  if (!isRecord(row)) return undefined;
  const model = row.model;
  if (!isRecord(model)) return undefined;
  const ref = stringOf(model.ref);
  if (ref === undefined) return undefined;
  return {
    ref,
    rung: stringOf(model.rung),
    pinned: model.pinned === true,
    steppedUp: model.steppedUp === true,
    crosscheck: isRecord(row.crosscheck) ? stringOf(row.crosscheck.ref) : undefined,
  };
};

type CallBase = Pick<RoutingCall, "id" | "at" | "task" | "namedProfile">;

const unknownCall = (base: CallBase, detail: string): RoutingCall => ({
  ...base,
  status: "unknown",
  judge: undefined,
  spent: undefined,
  detail,
});

/** The persisted answer, mapped by the status word it carries. */
const callFromPage = (base: CallBase, page: Record<string, unknown>): RoutingCall => {
  const status = stringOf(page.status);
  if (status === "problems")
    return {
      ...base,
      status: "problems",
      judge: undefined,
      spent: undefined,
      detail: stringOf(page.problems),
    };
  if (status === "setup" || status === "declined")
    return { ...base, status, judge: undefined, spent: undefined, detail: undefined };
  if (status !== "resolved")
    return unknownCall(
      base,
      `the persisted answer carries the status "${String(status ?? "absent")}"`,
    );
  const judge = judgeOf(page.judge);
  const spent = spentOf(
    page.profiles,
    judge?.status === "used" ? judge.profile : base.namedProfile,
  );
  return { ...base, status: "resolved", judge, spent, detail: undefined };
};

/** The JSON of a persisted answer, or `undefined` when the text is neither. */
const parsePage = (text: string): Record<string, unknown> | undefined => {
  try {
    const page: unknown = JSON.parse(text);
    return isRecord(page) ? page : undefined;
  } catch {
    return undefined;
  }
};

const textOf = (state: {
  readonly content: ReadonlyArray<{ readonly type: string; readonly text?: string }>;
}) => state.content.map((one) => (one.type === "text" ? one.text : "")).join("");

/** A direct `spectre_routing` part, the shape a session writes when the host lists the tool itself. */
const callOf = (part: ToolPart): RoutingCall => {
  const state = part.state;
  const input = isRecord(state.input) ? state.input : {};
  const base: CallBase = {
    id: part.id,
    at:
      state.status === "completed" || state.status === "error"
        ? (part.time.completed ?? part.time.ran ?? part.time.created)
        : (part.time.ran ?? part.time.created),
    task: stringOf(input.task),
    namedProfile: stringOf(input.profile),
  };

  if (state.status === "completed") {
    const page = parsePage(textOf(state));
    if (page === undefined)
      return unknownCall(base, "the persisted answer is not JSON or not an object");
    return callFromPage(base, page);
  }
  if (state.status === "error") {
    return {
      ...base,
      status: "error",
      judge: undefined,
      spent: undefined,
      detail: stringOf(state.error?.message) ?? "the call failed",
    };
  }
  return { ...base, status: "running", judge: undefined, spent: undefined, detail: undefined };
};

type ExecuteRow = {
  readonly status: "running" | "completed" | "error";
  readonly input: Record<string, unknown> | undefined;
};

const executeRows = (value: unknown): ReadonlyArray<ExecuteRow> => {
  if (!Array.isArray(value)) return [];
  return value.flatMap((one) => {
    if (!isRecord(one) || one.tool !== ROUTING_CATALOG_NAME) return [];
    const status = one.status;
    if (status !== "running" && status !== "completed" && status !== "error") return [];
    return [{ status, input: isRecord(one.input) ? one.input : undefined }];
  });
};

/**
 * The calls one completed `execute` part made through the routing tool. Code
 * mode is the default, so this is the shape the common session writes: the
 * inner calls sit in the part's `metadata.toolCalls` under the catalog name,
 * and the program's return — a routing page when the program passed the call's
 * answer through — is the part's text content.
 */
const callsOfExecute = (part: ToolPart): ReadonlyArray<RoutingCall> => {
  const state = part.state;
  if (state.status !== "completed") return [];
  const entries = executeRows(state.metadata?.toolCalls);
  if (entries.length === 0) return [];
  const page = parsePage(textOf(state));
  // A program's return is the call's answer only when it is a routing page.
  // Anything else the program returned is not this call's record.
  const known =
    page !== undefined &&
    ["resolved", "problems", "setup", "declined"].includes(stringOf(page.status) ?? "");
  const at = part.time.completed ?? part.time.ran ?? part.time.created;
  return entries.flatMap((entry, index) => {
    const base: CallBase = {
      id: `${part.id}:${index}`,
      at,
      task: stringOf(entry.input?.task),
      namedProfile: stringOf(entry.input?.profile),
    };
    if (entry.status === "running")
      return [
        { ...base, status: "running", judge: undefined, spent: undefined, detail: undefined },
      ];
    if (entry.status === "error")
      return [
        {
          ...base,
          status: "error",
          judge: undefined,
          spent: undefined,
          detail: "the call failed inside the program",
        },
      ];
    if (known && page !== undefined && index === entries.length - 1)
      return [callFromPage(base, page)];
    return [
      unknownCall(
        base,
        known
          ? "the transcript keeps only the program's return, not this call's answer"
          : "the program did not return this call's answer",
      ),
    ];
  });
};

/**
 * One routing call per call the transcript records — a direct
 * `spectre_routing` part, or the rows an `execute` part carries in its
 * metadata — in transcript order, cut at the revert boundary the same way the
 * tool-usage table is.
 */
export const routingCalls = (
  messages: ReadonlyArray<SessionMessageInfo>,
  boundary?: string | undefined,
): ReadonlyArray<RoutingCall> => {
  const calls: Array<RoutingCall> = [];
  for (const message of activeMessages(messages, boundary)) {
    if (message.type !== "assistant") continue;
    for (const part of message.content) {
      if (part.type !== "tool") continue;
      if (part.name === ROUTING_TOOL) calls.push(callOf(part));
      else if (part.name === EXECUTE_TOOL) calls.push(...callsOfExecute(part));
    }
  }
  return calls;
};

export const routingTotals = (
  calls: ReadonlyArray<RoutingCall>,
): {
  readonly calls: number;
  readonly judged: number;
  readonly agentChosen: number;
} => {
  let judged = 0;
  let agentChosen = 0;
  for (const one of calls) {
    if (one.judge?.status === "used") judged += 1;
    else if (one.judge !== undefined) agentChosen += 1;
  }
  return { calls: calls.length, judged, agentChosen };
};

/** The question an arm was asked, reconstructed from the config the session runs on now. */
export type JudgeView = {
  readonly kind: "jev" | "lexical" | "off";
  readonly model: string;
  readonly instructions: string | undefined;
  readonly choices: ReadonlyArray<{
    readonly profile: string;
    readonly description: string;
  }>;
};

/**
 * The question the arm would ask for a task, read off the same surface the arm
 * reads: each enabled profile's `match` line, and the way out a JEV question
 * always carries. The transcript does not hold the literal question, so this
 * is a reconstruction and the blade says so.
 */
export const judgeView = (
  profiles: ReadonlyArray<Profile>,
  judge: JudgeConfig | undefined,
): JudgeView => {
  const choices = profiles.flatMap((one) =>
    one.match === undefined || one.match === ""
      ? []
      : [{ profile: one.name, description: one.match }],
  );
  if (judge === undefined)
    return { kind: "off", model: "Session LLM", instructions: undefined, choices };
  if (judge.kind === "lexical")
    return { kind: "lexical", model: "Lexical (BM25)", instructions: undefined, choices };
  return {
    kind: "jev",
    model: judgeRef(judge.model),
    instructions: QUESTION_INSTRUCTIONS,
    // A choice question with a closed set always answers with one of them, so
    // the way out is a choice too — but only when there is a question at all.
    choices:
      choices.length > 0
        ? [...choices, { profile: NONE_LABEL, description: NONE_CRITERION }]
        : choices,
  };
};

/** `0.82` reads as ` (0.82)`; no confidence reads as nothing. */
export const formatConfidence = (value: number | undefined): string =>
  value === undefined ? "" : ` (${value.toFixed(2)})`;

/** One labelled line of a call's expanded view. */
export type DetailBand = {
  readonly label: string;
  readonly value: string;
};

/**
 * The expanded view of one call, as pure data. Every band names where it comes
 * from: the question is a reconstruction, the answer and the spent model are
 * the transcript's own record.
 */
export const expandBands = (one: RoutingCall, view: JudgeView): ReadonlyArray<DetailBand> => {
  const bands: Array<DetailBand> = [];
  if (one.detail !== undefined) bands.push({ label: "·", value: one.detail });
  if (one.status !== "resolved") return bands;

  const arm =
    view.kind === "jev"
      ? `JEV (${view.model})`
      : view.kind === "lexical"
        ? "Lexical (BM25)"
        : "Session LLM (no judge configured)";

  if (one.judge === undefined) {
    bands.push({ label: "·", value: "the answer carries no readable judge field" });
  } else if (one.judge.status === "used") {
    const judge = one.judge;
    // The transcript's own record leads — the answer, the alternatives, the
    // spent model — and the reconstruction (the question and its choices)
    // follows, because a detail band capped to a constant shape must cut
    // the reconstruction before it cuts the record.
    bands.push({ label: "judge", value: `${arm} (reconstructed)` });
    const escalated =
      judge.escalated === true
        ? `, spent one step above at ${judge.effort ?? "its own effort"}`
        : "";
    bands.push({
      label: "answer",
      value: `${judge.profile}${formatConfidence(judge.confidence)}${escalated}`,
    });
    if (judge.alternatives.length > 0)
      bands.push({
        label: "also",
        value: judge.alternatives
          .map((other) => `${other.profile} ${other.probability.toFixed(2)}`)
          .join(" · "),
      });
    if (view.instructions !== undefined) bands.push({ label: "asked", value: view.instructions });
    for (const choice of view.choices)
      bands.push({ label: "", value: `${choice.profile} — ${choice.description}` });
  } else {
    bands.push({ label: "judge", value: `${arm} (reconstructed)` });
    bands.push({ label: "skipped", value: one.judge.reason });
  }

  if (one.spent !== undefined) {
    const facts = [
      one.spent.pinned ? "pinned" : undefined,
      one.spent.steppedUp ? "stepped up" : undefined,
    ].filter((fact) => fact !== undefined);
    bands.push({
      label: "spent",
      value: facts.length > 0 ? `${one.spent.ref} (${facts.join(", ")})` : one.spent.ref,
    });
    if (one.spent.crosscheck !== undefined)
      bands.push({ label: "crosscheck", value: one.spent.crosscheck });
  }
  if (one.namedProfile !== undefined)
    bands.push({ label: "profile", value: `${one.namedProfile} (named by the caller)` });
  return bands;
};
