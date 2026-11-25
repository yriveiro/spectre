import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import { type EscalationReason, parseWorkerReport } from "../../tools/definitions/routing";
import { summarizeUsage, type Transcript, type UsageSummary } from "../opencode";
import { readFiles } from "../resume/observe";
import type { WorkspacePath } from "../resume/scenario";
import type { DelegationScenario } from "./scenario";

export interface SubagentCallObservation {
  readonly agent?: string;
  readonly model?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly hasInputSessionID: boolean;
  readonly inputSessionID?: string;
  readonly outputSessionID?: string;
  readonly switchedModelOnResume: boolean;
  readonly status?: string;
  readonly outputText: string;
}

export interface EscalationObservation {
  readonly childSessionID: string;
  readonly structured: boolean;
  readonly reason?: EscalationReason;
  readonly childAssistantTurns: number;
  readonly continuedSameSession: boolean;
  readonly upgradedModel: boolean;
}

export interface ObservedDelegation {
  readonly scenarioId: string;
  readonly loadedModelRouter: boolean;
  readonly routingCalls: number;
  readonly subagentCalls: ReadonlyArray<SubagentCallObservation>;
  readonly operatorSpawns: number;
  readonly escalations: ReadonlyArray<EscalationObservation>;
  readonly outOfScopeMutations: ReadonlyArray<string>;
  readonly parentPeakInputTokens: number;
  readonly parentTotalTokens: number;
  readonly childTotalTokens: number;
  readonly frontierTokenShare: number;
  readonly catalogueCostUnits: number;
  readonly parentFinalText: string;
  readonly parentFailed: boolean;
  readonly workspaceFiles: Readonly<Record<string, string>>;
}

const asString = (value: unknown): string | undefined =>
  typeof value === "string" && value.length > 0 ? value : undefined;

const toolOutputText = (state: SessionMessageAssistantTool["state"]): string => {
  if (state.status === "streaming" || state.status === "running") return "";
  const parts: Array<string> = [];
  for (const part of state.content ?? []) {
    if (part.type === "text" && typeof part.text === "string") parts.push(part.text);
  }
  return parts.join("\n");
};

const assistantText = (message: SessionMessageAssistant): string =>
  message.content
    .filter(
      (part): part is { type: "text"; text: string } =>
        part.type === "text" && typeof part.text === "string",
    )
    .map((part) => part.text)
    .join("\n");

export const didLoadModelRouter = (
  transcript: Pick<Transcript, "activated" | "messages">,
): boolean => {
  if (transcript.activated.includes("model-router")) return true;
  for (const message of transcript.messages) {
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "skill") continue;
      if (part.state.status === "streaming") continue;
      const id = asString(part.state.input?.id) ?? asString(part.state.input?.name);
      if (id === "model-router") return true;
    }
  }
  return false;
};

export const countRoutingCalls = (messages: ReadonlyArray<SessionMessageAssistant>): number => {
  let count = 0;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool") continue;
      if (part.name === "spectre.routing" || part.name === "tools.spectre.routing") {
        count += 1;
        continue;
      }
      if (part.name === "execute" && part.state.status !== "streaming") {
        const metadataTools = part.state.metadata?.toolCalls;
        if (Array.isArray(metadataTools)) {
          count += metadataTools.filter((name) => name === "spectre.routing").length;
          continue;
        }
        const code = asString(part.state.input?.code);
        if (code !== undefined) {
          const matches = code.match(/tools\.spectre\.routing\s*\(/g);
          if (matches !== null) count += matches.length;
        }
      }
    }
  }
  return count;
};

export const extractSubagentCalls = (
  messages: ReadonlyArray<SessionMessageAssistant>,
): ReadonlyArray<SubagentCallObservation> => {
  const raw: Array<{
    readonly at: number;
    readonly order: number;
    readonly agent?: string;
    readonly model?: string;
    readonly description?: string;
    readonly prompt?: string;
    readonly inputSessionID?: string;
    readonly outputSessionID?: string;
    readonly status?: string;
    readonly outputText: string;
  }> = [];

  let order = 0;
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent") continue;
      const input = part.state.status === "streaming" ? undefined : part.state.input;
      const outputText = toolOutputText(part.state);
      const metaSessionID =
        part.state.status === "streaming" ? undefined : asString(part.state.metadata?.sessionID);
      const outputSessionID = metaSessionID ?? outputText.match(/sessionID="([^"]+)"/)?.[1];

      raw.push({
        at: part.time.created,
        order: order++,
        agent: asString(input?.agent),
        model: asString(input?.model),
        description: asString(input?.description),
        prompt: asString(input?.prompt),
        inputSessionID: asString(input?.sessionID),
        outputSessionID,
        status: part.state.status,
        outputText,
      });
    }
  }

  const sorted = raw.toSorted((a, b) => a.at - b.at || a.order - b.order);
  const initialModelBySession = new Map<string, string | undefined>();

  return sorted.map((call) => {
    const hasInputSessionID = call.inputSessionID !== undefined;
    const sessionKey = call.inputSessionID ?? call.outputSessionID;
    const priorModel =
      call.inputSessionID === undefined
        ? undefined
        : initialModelBySession.get(call.inputSessionID);
    const switchedModelOnResume =
      hasInputSessionID && call.model !== undefined && call.model !== priorModel;

    if (sessionKey !== undefined && !initialModelBySession.has(sessionKey)) {
      initialModelBySession.set(sessionKey, call.model);
    }

    return {
      agent: call.agent,
      model: call.model,
      description: call.description,
      prompt: call.prompt,
      hasInputSessionID,
      inputSessionID: call.inputSessionID,
      outputSessionID: call.outputSessionID,
      switchedModelOnResume,
      status: call.status,
      outputText: call.outputText,
    };
  });
};

export const extractEscalations = (
  calls: ReadonlyArray<SubagentCallObservation>,
  children: ReadonlyMap<string, Transcript>,
): ReadonlyArray<EscalationObservation> => {
  const escalations: Array<EscalationObservation> = [];
  const seenChildren = new Set<string>();

  for (const [index, call] of calls.entries()) {
    const childID = call.outputSessionID ?? call.inputSessionID;
    if (childID === undefined) continue;

    const childTranscript = children.get(childID);
    let report = call.outputText !== "" ? parseWorkerReport(call.outputText) : undefined;
    let turnsAtStop = childTranscript?.messages.length ?? 1;

    if ((report === undefined || report.kind === "unstructured") && childTranscript !== undefined) {
      for (const [msgIndex, message] of childTranscript.messages.entries()) {
        const body = assistantText(message);
        if (body === "") continue;
        const parsed = parseWorkerReport(body);
        if (parsed.kind === "escalate") {
          report = parsed;
          turnsAtStop = msgIndex + 1;
          break;
        }
      }
    }

    if (report === undefined || report.kind !== "escalate") continue;
    if (seenChildren.has(childID)) continue;
    seenChildren.add(childID);

    const followUp = calls.slice(index + 1).find((later) => later.inputSessionID === childID);

    escalations.push({
      childSessionID: childID,
      structured: true,
      reason: report.reason,
      childAssistantTurns: turnsAtStop,
      continuedSameSession: followUp !== undefined,
      upgradedModel: followUp?.switchedModelOnResume === true,
    });
  }

  for (const [childID, transcript] of children) {
    if (seenChildren.has(childID)) continue;
    for (const [msgIndex, message] of transcript.messages.entries()) {
      const body = assistantText(message);
      if (body === "") continue;
      const parsed = parseWorkerReport(body);
      if (parsed.kind === "escalate") {
        seenChildren.add(childID);
        const followUp = calls.find(
          (call) => call.hasInputSessionID && call.inputSessionID === childID,
        );
        escalations.push({
          childSessionID: childID,
          structured: true,
          reason: parsed.reason,
          childAssistantTurns: msgIndex + 1,
          continuedSameSession: followUp !== undefined,
          upgradedModel: followUp?.switchedModelOnResume === true,
        });
        break;
      }
    }
  }

  return escalations;
};

const peakInputTokens = (messages: ReadonlyArray<SessionMessageAssistant>): number => {
  let peak = 0;
  for (const message of messages) {
    if (message.tokens === undefined) continue;
    const total = message.tokens.input + message.tokens.cache.read + message.tokens.cache.write;
    if (total > peak) peak = total;
  }
  return peak;
};

export const observeTranscript = (input: {
  readonly scenario: DelegationScenario;
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
  readonly workspaceFiles: Readonly<Record<string, string>>;
}): ObservedDelegation => {
  const calls = extractSubagentCalls(input.parent.messages);
  const operatorSpawns = calls.filter(
    (call) => call.agent === "operator" && !call.hasInputSessionID,
  ).length;
  const escalations = extractEscalations(calls, input.children);

  const cleanTargets = input.scenario.expect.escalation?.mustPreserveCleanFiles ?? [];
  const outOfScopeMutations: Array<string> = [];
  for (const path of cleanTargets) {
    const initial = (input.scenario.setup[path] ?? "").trimEnd();
    const current = input.workspaceFiles[path];
    if (current !== undefined && current !== initial) {
      outOfScopeMutations.push(path);
    }
  }

  const parentUsage: UsageSummary = input.parent.usage ?? summarizeUsage(input.parent.messages);
  let childTotalTokens = 0;
  let childCost = 0;
  for (const child of input.children.values()) {
    const usage = child.usage ?? summarizeUsage(child.messages);
    childTotalTokens += usage.total;
    childCost += usage.cost;
  }

  const totalTokens = parentUsage.total + childTotalTokens;
  const frontierTokenShare = totalTokens === 0 ? 0 : parentUsage.total / totalTokens;
  const lastAssistant = input.parent.messages.at(-1);

  return {
    scenarioId: input.scenario.id,
    loadedModelRouter: didLoadModelRouter(input.parent),
    routingCalls: countRoutingCalls(input.parent.messages),
    subagentCalls: calls,
    operatorSpawns,
    escalations,
    outOfScopeMutations,
    parentPeakInputTokens: peakInputTokens(input.parent.messages),
    parentTotalTokens: parentUsage.total,
    childTotalTokens,
    frontierTokenShare,
    catalogueCostUnits: parentUsage.cost + childCost,
    parentFinalText: lastAssistant === undefined ? "" : assistantText(lastAssistant),
    parentFailed: input.parent.failure !== undefined,
    workspaceFiles: input.workspaceFiles,
  };
};

export const observeRun = async (input: {
  readonly scenario: DelegationScenario;
  readonly workspace: string;
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
}): Promise<ObservedDelegation> => {
  const pathsToRead = new Set<WorkspacePath>([
    ...(Object.keys(input.scenario.expect.expectedFiles ?? {}) as WorkspacePath[]),
    ...(input.scenario.expect.escalation?.mustPreserveCleanFiles ?? []),
  ]);
  const requested = Object.fromEntries([...pathsToRead].map((path) => [path, ""])) as Readonly<
    Record<WorkspacePath, string>
  >;
  const workspaceFiles = await readFiles(input.workspace, requested);
  return observeTranscript({
    scenario: input.scenario,
    parent: input.parent,
    children: input.children,
    workspaceFiles,
  });
};
