import { InstructionEntry } from "@opencode/schema/instruction-entry";

export type EscalationReason = "AMBIGUITY" | "SCOPE" | "FAILURE_CAP";
export type RecommendedNext = "orchestrator_decision" | "higher_profile";

export type WorkerReport =
  | {
      readonly kind: "done";
      readonly sessionID?: string | undefined;
      readonly touched: ReadonlyArray<string>;
      readonly verified: string;
      readonly outcome: string;
    }
  | {
      readonly kind: "escalate";
      readonly sessionID?: string | undefined;
      readonly reason: EscalationReason;
      readonly blocker: string;
      readonly optionsOrAttempts: string;
      readonly touched: ReadonlyArray<string>;
      readonly recommendedNext: RecommendedNext;
    }
  | {
      readonly kind: "unstructured";
      readonly sessionID?: string | undefined;
    };

export const ESCALATION_SENTINEL = "[spectre:escalation-handled]";
export const DELEGATION_KEY = InstructionEntry.Key.make("spectre.delegation");

export type DriftKind = "search" | "worker" | "mechanical";

export interface TurnDriftState {
  readonly readFiles: ReadonlySet<string>;
  readonly mutatedFiles: ReadonlySet<string>;
  readonly mechanicalRuns: number;
  readonly nudged: boolean;
}

export type DriftSignal =
  | { readonly kind: "prompt-reset" }
  | { readonly kind: "read-code"; readonly path: string }
  | { readonly kind: "mutate-file"; readonly path: string }
  | { readonly kind: "shell-mechanical" }
  | { readonly kind: "subagent-called" };

export type DriftVerdict =
  | { readonly action: "none" }
  | { readonly action: "put"; readonly drift: DriftKind; readonly text: string }
  | { readonly action: "clear" };

export const DRIFT_THRESHOLDS = {
  searchReads: 4,
  workerMutations: 3,
  mechanicalRuns: 2,
} as const;

export const emptyDriftState = (): TurnDriftState => ({
  readFiles: new Set(),
  mutatedFiles: new Set(),
  mechanicalRuns: 0,
  nudged: false,
});

const renderDriftNudge = (drift: DriftKind, state: TurnDriftState): string => {
  if (drift === "worker") {
    return `Delegation drift: ${state.mutatedFiles.size} files mutated inline this turn. For bounded >=3-file edits, load model-router, call tools.spectre.routing, and delegate to operator (worker profile).`;
  }
  if (drift === "mechanical") {
    return `Delegation drift: ${state.mechanicalRuns} mechanical test/build/check commands run inline this turn. Delegate suite and check runs to operator (mechanical profile) via model-router and tools.spectre.routing.`;
  }
  return `Delegation drift: ${state.readFiles.size} files read inline with no edits this turn. For >=3-file discovery, load model-router, call tools.spectre.routing, and delegate to operator (search profile).`;
};

export const advanceDrift = (
  prev: TurnDriftState,
  signal: DriftSignal,
): { readonly state: TurnDriftState; readonly verdict: DriftVerdict } => {
  if (signal.kind === "prompt-reset" || signal.kind === "subagent-called") {
    return {
      state: emptyDriftState(),
      verdict: prev.nudged ? { action: "clear" } : { action: "none" },
    };
  }

  const readFiles =
    signal.kind === "read-code" ? new Set([...prev.readFiles, signal.path]) : prev.readFiles;
  const mutatedFiles =
    signal.kind === "mutate-file"
      ? new Set([...prev.mutatedFiles, signal.path])
      : prev.mutatedFiles;
  const mechanicalRuns =
    signal.kind === "shell-mechanical" ? prev.mechanicalRuns + 1 : prev.mechanicalRuns;

  const base: TurnDriftState = { ...prev, readFiles, mutatedFiles, mechanicalRuns };
  if (prev.nudged) return { state: base, verdict: { action: "none" } };

  const drift: DriftKind | undefined =
    mutatedFiles.size >= DRIFT_THRESHOLDS.workerMutations
      ? "worker"
      : mechanicalRuns >= DRIFT_THRESHOLDS.mechanicalRuns
        ? "mechanical"
        : readFiles.size >= DRIFT_THRESHOLDS.searchReads && mutatedFiles.size === 0
          ? "search"
          : undefined;

  if (drift === undefined) return { state: base, verdict: { action: "none" } };

  const text = renderDriftNudge(drift, base);
  return {
    state: { ...base, nudged: true },
    verdict: { action: "put", drift, text },
  };
};

const MECHANICAL_PATTERNS: ReadonlyArray<RegExp> = [
  /^(?:bun|npm|pnpm|yarn)\s+(?:test|t|run\s+(?:test|typecheck|check|lint|build|format|fmt)|x\s+tsc|tsc)\b/i,
  /^(?:bunx|npx|pnpx)\s+(?:tsc|vitest|jest|biome|eslint|prettier|playwright)\b/i,
  /^(?:tsc|vitest|jest|pytest|mypy|ruff|flake8|black|eslint|prettier|biome|playwright)\b/i,
  /^cargo\s+(?:test|check|clippy|build|fmt)\b/i,
  /^go\s+(?:test|build|vet)\b/i,
  /^(?:make|just)\s+(?:test|check|lint|build|typecheck)\b/i,
  /^uv\s+run\s+(?:pytest|ruff|mypy|ty)\b/i,
];

export const classifyShellMechanical = (command: string): boolean => {
  const segments = command.split(/(?:&&|\|\||[;\n|])/);
  for (const rawSegment of segments) {
    const stripped = rawSegment.trim().replace(/^(?:[A-Za-z_][A-Za-z0-9_]*=\S+\s+)+/, "");
    if (stripped === "") continue;
    if (MECHANICAL_PATTERNS.some((pattern) => pattern.test(stripped))) return true;
  }
  return false;
};

const KNOWN_KEYS = new Set([
  "STATUS",
  "REASON",
  "BLOCKER",
  "OPTIONS_OR_ATTEMPTS",
  "TOUCHED",
  "VERIFIED",
  "OUTCOME",
  "RECOMMENDED_NEXT",
]);

const parseKeyedLines = (inner: string): Map<string, string> => {
  const fields = new Map<string, string>();
  let currentKey: string | undefined;
  for (const line of inner.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:[-*]\s+)?(?:\*\*([A-Za-z_]+):\*\*|([A-Za-z_]+):)\s*(.*)$/);
    const rawKey = (match?.[1] ?? match?.[2])?.toUpperCase();
    if (rawKey !== undefined && KNOWN_KEYS.has(rawKey)) {
      currentKey = rawKey;
      fields.set(rawKey, (match?.[3] ?? "").trim());
      continue;
    }
    if (currentKey !== undefined) {
      const trimmed = line.trim();
      if (trimmed !== "") {
        const prev = fields.get(currentKey) ?? "";
        fields.set(currentKey, prev === "" ? trimmed : `${prev}\n${trimmed}`);
      }
    }
  }
  return fields;
};

const splitPaths = (raw: string | undefined): ReadonlyArray<string> => {
  if (raw === undefined) return [];
  const trimmed = raw.trim();
  if (trimmed === "" || /^none$/i.test(trimmed)) return [];
  return trimmed
    .split(/[,\n]/)
    .map((entry) =>
      entry
        .trim()
        .replace(/^[-*]\s+/, "")
        .replace(/^`+|`+$/g, "")
        .trim(),
    )
    .filter((entry) => entry !== "" && !/^none$/i.test(entry));
};

const SUBAGENT_OPEN_RE = /<(?:subagent|background-result(?=[^>]*\bkind="subagent"))\b[^>]*>/;

const unwrapSubagentBody = (
  raw: string,
): { readonly sessionID?: string | undefined; readonly inner: string } => {
  const tagMatch = raw.match(SUBAGENT_OPEN_RE);
  if (tagMatch === null) return { inner: raw.trim() };
  const tag = tagMatch[0];
  const sessionID = tag.match(/\bsessionID="([^"]+)"/)?.[1];
  const closeTag = tag.startsWith("<background-result") ? "</background-result>" : "</subagent>";
  const afterOpen = raw.slice((tagMatch.index ?? 0) + tag.length).replace(/^\r?\n/, "");
  const closePattern = new RegExp(`\\r?\\n?${closeTag}\\s*$`);
  return { sessionID, inner: afterOpen.replace(closePattern, "").trim() };
};

export const parseWorkerReport = (raw: string): WorkerReport => {
  const { sessionID, inner } = unwrapSubagentBody(raw);

  const head = inner
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .slice(0, 5)
    .join("\n");
  const header = head.match(/^\s*(?:\*\*STATUS:\*\*|STATUS:)\s*(DONE|ESCALATE)\b/im);
  if (header?.[1] === undefined) return { kind: "unstructured", sessionID };

  const fields = parseKeyedLines(inner);
  if (header[1].toUpperCase() === "DONE") {
    return {
      kind: "done",
      sessionID,
      touched: splitPaths(fields.get("TOUCHED")),
      verified: fields.get("VERIFIED") ?? "",
      outcome: fields.get("OUTCOME") ?? "",
    };
  }

  const rawReason = (fields.get("REASON") ?? "").toUpperCase();
  const reason: EscalationReason =
    rawReason === "AMBIGUITY" || rawReason === "SCOPE" || rawReason === "FAILURE_CAP"
      ? rawReason
      : "FAILURE_CAP";
  const rawNext = (fields.get("RECOMMENDED_NEXT") ?? "").toLowerCase();
  const recommendedNext: RecommendedNext =
    rawNext === "higher_profile" || rawNext === "orchestrator_decision"
      ? rawNext
      : reason === "FAILURE_CAP"
        ? "higher_profile"
        : "orchestrator_decision";

  return {
    kind: "escalate",
    sessionID,
    reason,
    blocker: fields.get("BLOCKER") ?? "",
    optionsOrAttempts: fields.get("OPTIONS_OR_ATTEMPTS") ?? "",
    touched: splitPaths(fields.get("TOUCHED")),
    recommendedNext,
  };
};

export interface MutableContextMessage {
  readonly role?: string;
  readonly metadata?: Readonly<Record<string, unknown>>;
  content?: unknown;
}

export const shapeEscalationMessages = (
  messages: ReadonlyArray<MutableContextMessage> | undefined,
): number => {
  if (!Array.isArray(messages)) return 0;
  let decorated = 0;
  for (const message of messages) {
    if (message.role !== "user" || !Array.isArray(message.content)) continue;
    const first = message.content[0] as { type?: unknown; text?: unknown } | undefined;
    if (first?.type !== "text" || typeof first.text !== "string") continue;
    if (first.text.includes(ESCALATION_SENTINEL)) continue;
    const isSubagent = message.metadata?.source === "subagent" || SUBAGENT_OPEN_RE.test(first.text);
    if (!isSubagent) continue;

    const report = parseWorkerReport(first.text);
    if (report.kind !== "escalate") continue;

    const target = report.sessionID ?? String(message.metadata?.childID ?? "the child sessionID");
    const guidance =
      report.reason === "FAILURE_CAP" || report.recommendedNext === "higher_profile"
        ? `${ESCALATION_SENTINEL} Worker ${target} hit ${report.reason}. Inspect OPTIONS_OR_ATTEMPTS: if 1 read settles the defect, resume sessionID="${target}" omitting model; if the model is the defect, call tools.spectre.routing for a higher profile (judgment, thinking, refactor, or deep) and resume sessionID="${target}" with that profile's model.ref.`
        : `${ESCALATION_SENTINEL} Worker ${target} stopped cleanly on ${report.reason}. Decide the contract or scope here (or ask the user once if user intent is undecided), then resume sessionID="${target}" omitting model so the worker finishes with its existing context.`;

    message.content[0] = { ...first, text: `${first.text}\n\n${guidance}` };
    decorated += 1;
  }
  return decorated;
};
