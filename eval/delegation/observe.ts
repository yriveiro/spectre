import type { SessionMessageAssistant, SessionMessageAssistantTool } from "@opencode/client";
import {
  classifyShellMechanical,
  type EscalationReason,
  effortOf,
  KNOWN_ORDER,
  parseWorkerReport,
} from "../../tools/definitions/routing";
import { summarizeUsage, type Transcript, type UsageSummary } from "../opencode";
import { readFiles } from "../resume/observe";
import type { WorkspacePath } from "../resume/scenario";
import { resolveIn } from "../resume/workspace";
import { type DelegationScenario, record } from "./scenario";

export interface RoutedProfileObservation {
  readonly profile: string;
  readonly agent?: string;
  readonly effort?: string;
  readonly modelRef?: string;
  readonly costInput?: number;
  readonly costOutput?: number;
}

export interface SubagentCallObservation {
  readonly agent?: string;
  readonly model?: string;
  readonly description?: string;
  readonly prompt?: string;
  readonly hasInputSessionID: boolean;
  readonly inputSessionID?: string;
  readonly outputSessionID?: string;
  readonly switchedModelOnResume: boolean;
  readonly upgradedModelOnResume?: boolean;
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
  readonly switchedModel?: boolean;
}

export interface ObservedDelegation {
  readonly scenarioId: string;
  readonly loadedModelRouter: boolean;
  readonly routingCalls: number;
  readonly routedProfiles?: ReadonlyArray<RoutedProfileObservation>;
  readonly subagentCalls: ReadonlyArray<SubagentCallObservation>;
  readonly operatorSpawns: number;
  readonly escalations: ReadonlyArray<EscalationObservation>;
  readonly outOfScopeMutations: ReadonlyArray<string>;
  readonly unexpectedFileMutations: ReadonlyArray<string>;
  readonly verifiedAfterLastEdit: boolean;
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

const splitModelRef = (ref: string): { readonly base: string; readonly variant?: string } => {
  const hash = ref.indexOf("#");
  if (hash === -1) return { base: ref };
  const variant = ref.slice(hash + 1);
  return { base: ref.slice(0, hash), ...(variant === "" ? {} : { variant }) };
};

const EFFORT_WEIGHTS: Readonly<Record<string, number>> = {
  none: 0.7,
  minimal: 0.75,
  low: 0.8,
  medium: 1,
  high: 1.25,
  xhigh: 1.5,
  max: 2,
};

const priorityWeightFor = (
  base: string,
  spectreConfig: DelegationScenario["spectreConfig"] | undefined,
): number => {
  if (spectreConfig === undefined || spectreConfig.priority.length < 2) return 0.5;
  const alias = Object.entries(spectreConfig.models).find(
    ([, configured]) => splitModelRef(configured).base === base,
  )?.[0];
  const idx = alias === undefined ? -1 : spectreConfig.priority.indexOf(alias);
  return idx < 0 ? 0.5 : 0.25 + (0.75 * idx) / (spectreConfig.priority.length - 1);
};

export const modelTierWeight = (
  modelRef: string | undefined,
  spectreConfig?: DelegationScenario["spectreConfig"],
): number => {
  if (modelRef === undefined) return 1;
  const { base, variant } = splitModelRef(modelRef);
  const lower = base.toLowerCase();

  let baseWeight = priorityWeightFor(base, spectreConfig);
  if (/flash|mini|haiku|nano|lite|-free\b|small/.test(lower)) baseWeight = 0.25;
  else if (/opus|pro|kimi|k3|gpt-5|sonnet|deep/.test(lower)) baseWeight = 1;
  else if (/spark|contributor|mid/.test(lower)) baseWeight = 0.5;

  const effortMultiplier = variant === undefined ? 1 : (EFFORT_WEIGHTS[variant] ?? 1);
  return baseWeight * effortMultiplier;
};

export const estimateProxyCost = (usage: UsageSummary, tierWeight = 1): number => {
  if (usage.total <= 0) return 0;
  const effectiveInput = usage.input + usage.cacheWrite + usage.cacheRead * 0.1;
  const effectiveOutput = usage.output + usage.reasoning;
  const raw = (effectiveInput * 1e-6 + effectiveOutput * 5e-6) * tierWeight;
  return raw > 0 ? raw : usage.total * 1e-6 * tierWeight;
};

const knownRank = (effort: string | undefined): number | undefined => {
  if (effort === undefined) return undefined;
  const parsed = effortOf(effort);
  return parsed.kind === "known" ? parsed.rank : undefined;
};

const compareSameBaseUpgrade = (
  priorVariant: string | undefined,
  nextVariant: string | undefined,
): boolean => {
  const nextRank = knownRank(nextVariant);
  if (nextRank === undefined) return false;
  if (priorVariant === undefined) return nextRank >= KNOWN_ORDER.indexOf("high");
  const priorRank = knownRank(priorVariant);
  return priorRank !== undefined && nextRank > priorRank;
};

export const isModelUpgrade = (
  priorModel: string | undefined,
  nextModel: string | undefined,
  spectreConfig?: DelegationScenario["spectreConfig"],
  routedProfiles?: ReadonlyArray<RoutedProfileObservation>,
): boolean => {
  if (priorModel === undefined || nextModel === undefined || priorModel === nextModel) {
    return false;
  }
  const prior = splitModelRef(priorModel);
  const next = splitModelRef(nextModel);
  if (prior.base === next.base) return compareSameBaseUpgrade(prior.variant, next.variant);

  const priorRoutedRank = knownRank(
    routedProfiles?.find((row) => row.modelRef === priorModel)?.effort,
  );
  const nextRoutedRank = knownRank(
    routedProfiles?.find((row) => row.modelRef === nextModel)?.effort,
  );
  if (
    priorRoutedRank !== undefined &&
    nextRoutedRank !== undefined &&
    priorRoutedRank !== nextRoutedRank
  ) {
    return nextRoutedRank > priorRoutedRank;
  }

  const priorWeight = modelTierWeight(priorModel, spectreConfig);
  const nextWeight = modelTierWeight(nextModel, spectreConfig);
  return nextWeight === priorWeight ? true : nextWeight > priorWeight;
};

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

const parseProfileRow = (raw: unknown): RoutedProfileObservation | undefined => {
  if (!record(raw)) return undefined;
  const profile = asString(raw.name) ?? asString(raw.profile);
  if (profile === undefined) return undefined;
  const model = record(raw.model) ? raw.model : undefined;
  const cost = record(model?.cost) ? model.cost : undefined;
  return {
    profile,
    agent: asString(raw.agent),
    effort: asString(raw.effort),
    modelRef: asString(model?.ref) ?? asString(raw.modelRef),
    costInput: typeof cost?.input === "number" ? cost.input : undefined,
    costOutput: typeof cost?.output === "number" ? cost.output : undefined,
  };
};

const parseJsonPayloadRows = (text: string): ReadonlyArray<RoutedProfileObservation> => {
  if (!text.startsWith("{") && !text.startsWith("[")) return [];
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (err) {
    if (err instanceof SyntaxError) return [];
    throw err;
  }
  const candidates = Array.isArray(parsed)
    ? parsed
    : record(parsed) && Array.isArray(parsed.profiles)
      ? parsed.profiles
      : [parsed];
  return candidates.flatMap((item) => {
    const row = parseProfileRow(item);
    return row === undefined ? [] : [row];
  });
};

const extractProfilesFromPart = (
  part: SessionMessageAssistantTool,
): ReadonlyArray<RoutedProfileObservation> => {
  if (part.state.status === "streaming") return [];
  const text = toolOutputText(part.state).trim();
  const fromJson = parseJsonPayloadRows(text);
  if (fromJson.length > 0) return fromJson;

  const directProfile = asString(part.state.input?.profile);
  const codeProfile = asString(part.state.input?.code)?.match(
    /profile\s*:\s*["']([a-z0-9-]+)["']/,
  )?.[1];
  const askedProfile = directProfile ?? codeProfile;
  if (askedProfile === undefined) return [];
  const cleanRef = text.replace(/^["']|["']$/g, "");
  const modelRef = /^[^/\s#]+\/[^/\s]+$/.test(cleanRef) ? cleanRef : undefined;
  return [{ profile: askedProfile, ...(modelRef === undefined ? {} : { modelRef }) }];
};

const isRoutingToolPart = (part: SessionMessageAssistantTool): boolean => {
  if (part.name === "spectre.routing" || part.name === "tools.spectre.routing") return true;
  if (part.name !== "execute" || part.state.status === "streaming") return false;
  const metaTools = part.state.metadata?.toolCalls;
  if (Array.isArray(metaTools) && metaTools.includes("spectre.routing")) return true;
  return /tools\.spectre\.routing\s*\(/.test(asString(part.state.input?.code) ?? "");
};

export const extractRoutedProfiles = (
  messages: ReadonlyArray<SessionMessageAssistant>,
): ReadonlyArray<RoutedProfileObservation> => {
  const seen = new Map<string, RoutedProfileObservation>();
  for (const message of messages) {
    for (const part of message.content) {
      if (part.type !== "tool" || !isRoutingToolPart(part)) continue;
      for (const row of extractProfilesFromPart(part)) {
        const key = `${row.profile}::${row.modelRef ?? ""}`;
        if (!seen.has(key)) seen.set(key, row);
      }
    }
  }
  return [...seen.values()];
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
  spectreConfig?: DelegationScenario["spectreConfig"],
  routedProfiles?: ReadonlyArray<RoutedProfileObservation>,
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
  const modelBySession = new Map<string, string | undefined>();

  return sorted.map((call) => {
    const hasInputSessionID = call.inputSessionID !== undefined;
    const sessionKey = call.inputSessionID ?? call.outputSessionID;
    const priorModel =
      call.inputSessionID === undefined ? undefined : modelBySession.get(call.inputSessionID);
    const switchedModelOnResume =
      hasInputSessionID &&
      priorModel !== undefined &&
      call.model !== undefined &&
      call.model !== priorModel;
    const upgradedModelOnResume =
      hasInputSessionID && isModelUpgrade(priorModel, call.model, spectreConfig, routedProfiles);

    if (sessionKey !== undefined && (!modelBySession.has(sessionKey) || call.model !== undefined)) {
      modelBySession.set(sessionKey, call.model);
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
      upgradedModelOnResume,
      status: call.status,
      outputText: call.outputText,
    };
  });
};

const findFirstChildEscalation = (messages: ReadonlyArray<SessionMessageAssistant>) => {
  for (const [msgIndex, message] of messages.entries()) {
    const body = assistantText(message);
    if (body === "") continue;
    const parsed = parseWorkerReport(body);
    if (parsed.kind === "escalate") {
      return { report: parsed, turnsAtStop: msgIndex + 1, messageIndex: msgIndex };
    }
  }
  return undefined;
};

const buildEscalationObs = (
  childID: string,
  reason: EscalationReason,
  turnsAtStop: number,
  followUp: SubagentCallObservation | undefined,
): EscalationObservation => ({
  childSessionID: childID,
  structured: true,
  reason,
  childAssistantTurns: turnsAtStop,
  continuedSameSession: followUp !== undefined,
  upgradedModel: followUp?.upgradedModelOnResume ?? followUp?.switchedModelOnResume === true,
  switchedModel: followUp?.switchedModelOnResume === true,
});

export const extractEscalations = (
  calls: ReadonlyArray<SubagentCallObservation>,
  children: ReadonlyMap<string, Transcript>,
): ReadonlyArray<EscalationObservation> => {
  const escalations: Array<EscalationObservation> = [];
  const seenChildren = new Set<string>();

  for (const [index, call] of calls.entries()) {
    const childID = call.outputSessionID ?? call.inputSessionID;
    if (childID === undefined || seenChildren.has(childID)) continue;

    const childTranscript = children.get(childID);
    const childFound =
      childTranscript === undefined
        ? undefined
        : findFirstChildEscalation(childTranscript.messages);
    const callParsed = call.outputText !== "" ? parseWorkerReport(call.outputText) : undefined;
    const report = callParsed?.kind === "escalate" ? callParsed : childFound?.report;
    if (report === undefined || report.kind !== "escalate") continue;

    seenChildren.add(childID);
    const followUp = calls.slice(index + 1).find((later) => later.inputSessionID === childID);
    escalations.push(
      buildEscalationObs(childID, report.reason, childFound?.turnsAtStop ?? 1, followUp),
    );
  }

  for (const [childID, transcript] of children) {
    if (seenChildren.has(childID)) continue;
    const childFound = findFirstChildEscalation(transcript.messages);
    if (childFound === undefined) continue;
    seenChildren.add(childID);
    const followUp = calls.find(
      (call) => call.hasInputSessionID && call.inputSessionID === childID,
    );
    escalations.push(
      buildEscalationObs(childID, childFound.report.reason, childFound.turnsAtStop, followUp),
    );
  }

  return escalations;
};

const matchesCleanTarget = (rawPath: string, target: string, workspace?: string): boolean => {
  const slash = rawPath.replaceAll("\\", "/").trim();
  const basePrefix = workspace === undefined ? undefined : `${workspace.replace(/\/+$/, "")}/`;
  const stripped =
    basePrefix !== undefined && slash.startsWith(basePrefix)
      ? slash.slice(basePrefix.length)
      : slash;
  const clean = stripped.replace(/^\/workspace\//, "").replace(/^\.\//, "");
  return clean === target || slash.endsWith(`/${target}`);
};

const mutationTargetFromPart = (
  part: SessionMessageAssistant["content"][number],
): string | undefined => {
  if (part.type !== "tool" || part.state.status === "streaming") return undefined;
  if (part.name !== "edit" && part.name !== "write") return undefined;
  return asString(part.state.input?.path) ?? asString(part.state.input?.filePath);
};

const preEscalationPathsFromChild = (transcript: Transcript): ReadonlyArray<string> => {
  const firstEsc = findFirstChildEscalation(transcript.messages);
  const preMessages =
    firstEsc === undefined
      ? transcript.messages
      : transcript.messages.slice(0, firstEsc.messageIndex + 1);
  const touched = preMessages.flatMap((message) =>
    message.content.flatMap((part) => {
      const target = mutationTargetFromPart(part);
      return target === undefined ? [] : [target];
    }),
  );
  return firstEsc === undefined ? touched : [...touched, ...firstEsc.report.touched];
};

const unescalatedWorkspaceViolations = (
  cleanTargets: ReadonlyArray<WorkspacePath>,
  setup: DelegationScenario["setup"],
  workspaceFiles: Readonly<Record<string, string>>,
): ReadonlyArray<string> =>
  cleanTargets.filter((target) => {
    const initial = (setup[target] ?? "").trimEnd();
    const current = workspaceFiles[target];
    return current !== undefined && current.trimEnd() !== initial;
  });

const collectPreEscalationMutations = (input: {
  readonly cleanTargets: ReadonlyArray<WorkspacePath>;
  readonly calls: ReadonlyArray<SubagentCallObservation>;
  readonly children: ReadonlyMap<string, Transcript>;
  readonly escalations: ReadonlyArray<EscalationObservation>;
  readonly setup: DelegationScenario["setup"];
  readonly workspaceFiles: Readonly<Record<string, string>>;
  readonly workspace?: string;
}): ReadonlyArray<string> => {
  if (input.cleanTargets.length === 0) return [];
  const callPaths = input.calls.flatMap((call) => {
    if (call.outputText === "") return [];
    const parsed = parseWorkerReport(call.outputText);
    return parsed.kind === "escalate" ? parsed.touched : [];
  });
  const childPaths = [...input.children.values()].flatMap(preEscalationPathsFromChild);
  const candidates = [...callPaths, ...childPaths];

  const violated = new Set<string>(
    input.children.size > 0 && input.escalations.length === 0
      ? unescalatedWorkspaceViolations(input.cleanTargets, input.setup, input.workspaceFiles)
      : [],
  );
  for (const candidate of candidates) {
    for (const target of input.cleanTargets) {
      if (matchesCleanTarget(candidate, target, input.workspace)) violated.add(target);
    }
  }
  return input.cleanTargets.filter((target) => violated.has(target));
};

const IGNORED_WORKSPACE_FILES = new Set(["spectre.json", "spectre.jsonc"]);

const isIgnoredWorkspacePath = (path: string): boolean =>
  IGNORED_WORKSPACE_FILES.has(path) ||
  path.startsWith("node_modules/") ||
  path.startsWith(".git/") ||
  path.startsWith(".spectre/") ||
  path.startsWith(".opencode/");

const isSafeWorkspacePath = (path: string): path is WorkspacePath =>
  path.length > 0 &&
  !path.includes("\0") &&
  !path.includes("\\") &&
  !path.startsWith("/") &&
  !/^[A-Za-z]:/.test(path) &&
  !path.split("/").some((part) => part === "" || part === "." || part === "..");

const collectUnexpectedMutations = (
  scenario: DelegationScenario,
  workspaceFiles: Readonly<Record<string, string>>,
  deletedSetupFiles: ReadonlyArray<string>,
): ReadonlyArray<string> => {
  const allowed = new Set<string>([
    ...Object.keys(scenario.expect.expectedFiles ?? {}),
    ...(scenario.expect.allowedMutatedFiles ?? []),
  ]);
  const unexpected = new Set<string>();

  for (const [path, content] of Object.entries(workspaceFiles)) {
    if (isIgnoredWorkspacePath(path) || allowed.has(path)) continue;
    if (!Object.hasOwn(scenario.setup, path)) {
      unexpected.add(path);
      continue;
    }
    const initial = (scenario.setup[path as WorkspacePath] ?? "").trimEnd();
    if (content.trimEnd() !== initial) unexpected.add(path);
  }

  for (const deleted of deletedSetupFiles) {
    if (!allowed.has(deleted)) unexpected.add(deleted);
  }

  return [...unexpected].toSorted();
};

const classifyToolLifecycle = (
  part: SessionMessageAssistant["content"][number],
): "edit" | "verify" | undefined => {
  if (part.type !== "tool" || part.state.status !== "completed") return undefined;
  if (part.name === "edit" || part.name === "write") return "edit";
  if (part.name !== "shell" && part.name !== "bash") return undefined;
  const command = asString(part.state.input?.command);
  return command !== undefined && classifyShellMechanical(command) ? "verify" : undefined;
};

const checkVerifiedAfterLastEdit = (
  parent: Transcript,
  children: ReadonlyMap<string, Transcript>,
): boolean => {
  const events: Array<{
    readonly at: number;
    readonly seq: number;
    readonly kind: "edit" | "verify";
  }> = [];
  let seq = 0;

  for (const transcript of [parent, ...children.values()]) {
    for (const message of transcript.messages) {
      for (const part of message.content) {
        const kind = classifyToolLifecycle(part);
        if (kind !== undefined && part.type === "tool") {
          events.push({ at: part.time.created, seq: seq++, kind });
        }
      }
    }
  }

  if (!events.some((event) => event.kind === "edit")) return true;
  const sorted = events.toSorted((a, b) => a.at - b.at || a.seq - b.seq);
  return sorted.at(-1)?.kind === "verify";
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

const childModelFor = (
  childID: string,
  calls: ReadonlyArray<SubagentCallObservation>,
): string | undefined => {
  let latest: string | undefined;
  for (const call of calls) {
    if (
      (call.outputSessionID === childID || call.inputSessionID === childID) &&
      call.model !== undefined
    ) {
      latest = call.model;
    }
  }
  return latest;
};

const summarizeTranscriptUsage = (
  parent: Transcript,
  children: ReadonlyMap<string, Transcript>,
  calls: ReadonlyArray<SubagentCallObservation>,
  spectreConfig: DelegationScenario["spectreConfig"],
) => {
  const parentUsage: UsageSummary = parent.usage ?? summarizeUsage(parent.messages);
  const parentCost = parentUsage.cost > 0 ? parentUsage.cost : estimateProxyCost(parentUsage, 1);

  let childTotalTokens = 0;
  let childCost = 0;
  for (const [childID, child] of children) {
    const usage = child.usage ?? summarizeUsage(child.messages);
    childTotalTokens += usage.total;
    const tier = modelTierWeight(childModelFor(childID, calls), spectreConfig);
    childCost += usage.cost > 0 ? usage.cost : estimateProxyCost(usage, tier);
  }

  const totalTokens = parentUsage.total + childTotalTokens;
  return {
    parentTotalTokens: parentUsage.total,
    childTotalTokens,
    frontierTokenShare: totalTokens === 0 ? 0 : parentUsage.total / totalTokens,
    catalogueCostUnits: parentCost + childCost,
  };
};

export const observeTranscript = (input: {
  readonly scenario: DelegationScenario;
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
  readonly workspaceFiles: Readonly<Record<string, string>>;
  readonly deletedSetupFiles?: ReadonlyArray<string>;
  readonly workspace?: string;
}): ObservedDelegation => {
  const routedProfiles = extractRoutedProfiles(input.parent.messages);
  const calls = extractSubagentCalls(
    input.parent.messages,
    input.scenario.spectreConfig,
    routedProfiles,
  );
  const escalations = extractEscalations(calls, input.children);
  const totals = summarizeTranscriptUsage(
    input.parent,
    input.children,
    calls,
    input.scenario.spectreConfig,
  );
  const lastAssistant = input.parent.messages.at(-1);

  return {
    scenarioId: input.scenario.id,
    loadedModelRouter: didLoadModelRouter(input.parent),
    routingCalls: countRoutingCalls(input.parent.messages),
    routedProfiles,
    subagentCalls: calls,
    operatorSpawns: calls.filter((c) => c.agent === "operator" && !c.hasInputSessionID).length,
    escalations,
    outOfScopeMutations: collectPreEscalationMutations({
      cleanTargets: input.scenario.expect.escalation?.mustPreserveCleanFiles ?? [],
      calls,
      children: input.children,
      escalations,
      setup: input.scenario.setup,
      workspaceFiles: input.workspaceFiles,
      workspace: input.workspace,
    }),
    unexpectedFileMutations: collectUnexpectedMutations(
      input.scenario,
      input.workspaceFiles,
      input.deletedSetupFiles ?? [],
    ),
    verifiedAfterLastEdit: checkVerifiedAfterLastEdit(input.parent, input.children),
    parentPeakInputTokens: peakInputTokens(input.parent.messages),
    ...totals,
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
    ...(input.scenario.expect.allowedMutatedFiles ?? []),
    ...(input.scenario.expect.escalation?.mustPreserveCleanFiles ?? []),
  ]);

  const deletedSetupFiles: Array<string> = [];
  for (const rawSetupPath of Object.keys(input.scenario.setup) as WorkspacePath[]) {
    const exists = await Bun.file(resolveIn(input.workspace, rawSetupPath)).exists();
    if (exists) pathsToRead.add(rawSetupPath);
    else deletedSetupFiles.push(rawSetupPath);
  }

  for await (const entry of new Bun.Glob("**/*").scan({
    cwd: input.workspace,
    dot: false,
    onlyFiles: true,
  })) {
    const normalized = entry.replaceAll("\\", "/");
    if (!isIgnoredWorkspacePath(normalized) && isSafeWorkspacePath(normalized)) {
      pathsToRead.add(normalized);
    }
  }

  const requested = Object.fromEntries([...pathsToRead].map((path) => [path, ""])) as Readonly<
    Record<WorkspacePath, string>
  >;
  const workspaceFiles = await readFiles(input.workspace, requested);
  return observeTranscript({
    scenario: input.scenario,
    parent: input.parent,
    children: input.children,
    workspaceFiles,
    deletedSetupFiles,
    workspace: input.workspace,
  });
};
