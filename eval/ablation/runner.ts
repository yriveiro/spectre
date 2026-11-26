import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { parseRegistered } from "../boot";
import { defaultLiveModel } from "../delegation/ab";
import { systemic } from "../guard";
import type { Opencode, Transcript } from "../opencode";
import { REPO } from "../resume/docker";
import { type Live, startLive } from "../resume/live";
import {
  artifactFromVerification,
  createSessionJudgeTransport,
  type JudgePairResult,
  judgePairSwapped,
  parseModelRefString,
  type ResolvedJudgeModel,
  resolveJudgeModel,
  type SpectreModelConfig,
} from "./judge";
import { type ReportMetadata, writeAblationArtifacts } from "./report";
import type { AblationScenario } from "./scenario";
import {
  type AblationSummary,
  buildTrialSchedule,
  type ScheduledTrial,
  summarizeAblation,
  type TrialCompletionStatus,
  type TrialRecord,
  type ValidityGates,
} from "./score";
import {
  assertExactSkillSet,
  auditStagedPlugin,
  type ExactSetCheck,
  sourceSkillIds,
  type StagedAuditResult,
  type StagedPluginArm,
  stagePluginArm,
} from "./stage";
import { extractTrajectory } from "./trajectory";
import {
  verifyPristineScenario,
  verifyTrialWorkspace,
  type WorkspaceVerification,
  writeWorkspaceFiles,
} from "./verify";

export interface HostRegistrationProof {
  readonly ok: boolean;
  readonly logSetCheck: ExactSetCheck;
  readonly hostSkillIds: ReadonlyArray<string>;
  readonly missingFromHost: ReadonlyArray<string>;
  readonly leakedInHost: ReadonlyArray<string>;
  readonly ambientHostSkills: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<string>;
}

export interface PluginlessJudgeProof {
  readonly ok: boolean;
  readonly hasSpectreAgent: boolean;
  readonly leakedSpectreSkills: ReadonlyArray<string>;
  readonly findings: ReadonlyArray<string>;
}

export interface LiveAblationOptions {
  readonly scenario: AblationScenario;
  readonly trials: number;
  readonly model?: string;
  readonly judgeModel?: string;
  readonly enableJudge?: boolean;
  readonly allowSameFamily?: boolean;
  readonly useRepoConfig?: boolean;
  readonly configPath?: string;
  readonly runsDir: string;
  readonly keep?: boolean;
  readonly actorTurnTimeoutMs?: number;
  readonly childSettleTimeoutMs?: number;
  readonly verifyTimeoutMs?: number;
  readonly judgePassTimeoutMs?: number;
}

export interface LiveAblationOutput {
  readonly summary: AblationSummary;
  readonly metadata: ReportMetadata;
  readonly markdown: string;
  readonly runsDir: string;
}

const DEFAULT_ACTOR_TIMEOUT_MS = 180_000;
const DEFAULT_CHILD_TIMEOUT_MS = 60_000;
const DEFAULT_VERIFY_TIMEOUT_MS = 30_000;
const DEFAULT_JUDGE_TIMEOUT_MS = 60_000;
const DEFAULT_REG_POLL_MS = 15_000;

export const isolatedServerEnv = (
  extra?: Readonly<Record<string, string | undefined>>,
): Readonly<Record<string, string | undefined>> => ({
  OPENCODE_CONFIG: undefined,
  OPENCODE_CONFIG_CONTENT: undefined,
  OPENCODE_DISABLE_CLAUDE_CODE: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_SKILLS: "1",
  OPENCODE_DISABLE_CLAUDE_CODE_PROMPT: "1",
  ...(extra ?? {}),
});

const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number, label: string): Promise<T> => {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`${label} timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
};

export const verifyHostRegistration = async (input: {
  readonly server: Live;
  readonly expectedIds: ReadonlyArray<string>;
  readonly strippedIds: ReadonlyArray<string>;
  readonly directory: string;
  readonly timeoutMs?: number;
}): Promise<HostRegistrationProof> => {
  const deadline = Date.now() + (input.timeoutMs ?? DEFAULT_REG_POLL_MS);
  let registered: ReadonlyArray<string> = [];
  while (Date.now() < deadline) {
    registered = parseRegistered(await input.server.logs());
    if (registered.length > 0) break;
    await Bun.sleep(150);
  }

  const logSetCheck = assertExactSkillSet(registered, input.expectedIds, "host-registered-log");

  const hostSkillsResp = await withTimeout(
    input.server.client.skill.list({ location: { directory: input.directory } }),
    input.timeoutMs ?? DEFAULT_REG_POLL_MS,
    "client.skill.list",
  );
  const hostSkillIds = hostSkillsResp.data.map((item) => item.id as string).toSorted();
  const hostSet = new Set(hostSkillIds);
  const expectedSet = new Set(input.expectedIds);

  const missingFromHost = input.expectedIds.filter((id) => !hostSet.has(id)).toSorted();
  const leakedInHost = input.strippedIds.filter((id) => hostSet.has(id)).toSorted();
  const ambientHostSkills = hostSkillIds.filter((id) => !expectedSet.has(id)).toSorted();

  const findings: Array<string> = [...logSetCheck.findings];
  if (missingFromHost.length > 0) {
    findings.push(`host /api/skill missing expected ids: ${missingFromHost.join(", ")}`);
  }
  if (leakedInHost.length > 0) {
    findings.push(`host /api/skill still exposes stripped ids: ${leakedInHost.join(", ")}`);
  }

  return {
    ok: findings.length === 0,
    logSetCheck,
    hostSkillIds,
    missingFromHost,
    leakedInHost,
    ambientHostSkills,
    findings,
  };
};

export const verifyPluginlessJudgeServer = async (input: {
  readonly client: Opencode;
  readonly directory: string;
  readonly spectreSkillIds?: ReadonlyArray<string>;
}): Promise<PluginlessJudgeProof> => {
  const spectreSet = new Set(input.spectreSkillIds ?? sourceSkillIds());
  const [agentsResp, skillsResp] = await Promise.all([
    withTimeout(
      input.client.agent.list({ location: { directory: input.directory } }),
      DEFAULT_REG_POLL_MS,
      "judge client.agent.list",
    ),
    withTimeout(
      input.client.skill.list({ location: { directory: input.directory } }),
      DEFAULT_REG_POLL_MS,
      "judge client.skill.list",
    ),
  ]);

  const hasSpectreAgent = agentsResp.data.some((agent) => agent.id === "spectre");
  const leakedSpectreSkills = skillsResp.data
    .map((skill) => skill.id as string)
    .filter((id) => spectreSet.has(id))
    .toSorted();

  const findings: Array<string> = [];
  if (hasSpectreAgent) findings.push('plugin-less judge server exposed "spectre" agent');
  if (leakedSpectreSkills.length > 0) {
    findings.push(
      `plugin-less judge server exposed Spectre skills: ${leakedSpectreSkills.slice(0, 10).join(", ")}`,
    );
  }

  return {
    ok: findings.length === 0,
    hasSpectreAgent,
    leakedSpectreSkills,
    findings,
  };
};

const extractSubagentChildIds = (transcript: Transcript): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const message of transcript.messages) {
    for (const part of message.content) {
      if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming") {
        continue;
      }
      const metaId =
        typeof part.state.metadata?.sessionID === "string" && part.state.metadata.sessionID !== ""
          ? part.state.metadata.sessionID
          : undefined;
      const inputId =
        typeof part.state.input?.sessionID === "string" && part.state.input.sessionID !== ""
          ? part.state.input.sessionID
          : undefined;
      if (metaId !== undefined) ids.add(metaId);
      else if (inputId !== undefined) ids.add(inputId);
    }
  }
  return [...ids];
};

const settleBounded = async (input: {
  readonly client: Opencode;
  readonly sessionID: string;
  readonly actorTimeoutMs: number;
  readonly childTimeoutMs: number;
}): Promise<{
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
}> => {
  const seenChildren = new Set<string>();
  for (let round = 0; round < 6; round++) {
    await withTimeout(
      input.client.experimental.session.wait({ sessionID: input.sessionID }),
      input.actorTimeoutMs,
      "parent session.wait",
    );
    const snap = await withTimeout(
      input.client.transcript(input.sessionID),
      30_000,
      "parent transcript",
    );
    const pending = extractSubagentChildIds(snap).filter((id) => !seenChildren.has(id));
    if (pending.length === 0) {
      const children = new Map<string, Transcript>();
      for (const childId of seenChildren) {
        children.set(
          childId,
          await withTimeout(input.client.transcript(childId), 30_000, `child transcript ${childId}`),
        );
      }
      return { parent: snap, children };
    }
    for (const childId of pending) {
      seenChildren.add(childId);
      await withTimeout(
        input.client.experimental.session.wait({ sessionID: childId }),
        input.childTimeoutMs,
        `child session.wait ${childId}`,
      );
    }
    await Bun.sleep(300);
  }

  await withTimeout(
    input.client.experimental.session.wait({ sessionID: input.sessionID }),
    input.actorTimeoutMs,
    "parent final session.wait",
  );
  const parent = await withTimeout(
    input.client.transcript(input.sessionID),
    30_000,
    "parent final transcript",
  );
  const children = new Map<string, Transcript>();
  for (const childId of new Set([...seenChildren, ...extractSubagentChildIds(parent)])) {
    children.set(
      childId,
      await withTimeout(input.client.transcript(childId), 30_000, `child transcript ${childId}`),
    );
  }
  return { parent, children };
};

export const loadSpectreModelConfig = async (options?: {
  readonly configPath?: string;
  readonly useRepoConfig?: boolean;
}): Promise<SpectreModelConfig | undefined> => {
  const candidates: Array<{ readonly path: string; readonly required: boolean }> = [];
  if (options?.configPath !== undefined) {
    candidates.push({ path: options.configPath, required: true });
  } else {
    if (options?.useRepoConfig === true) {
      candidates.push({ path: join(REPO, "spectre.json"), required: false });
    }
    candidates.push({ path: join(REPO, "spectre.default.json"), required: false });
  }

  for (const entry of candidates) {
    const file = Bun.file(entry.path);
    if (!(await file.exists())) {
      if (entry.required) throw new Error(`spectre config file not found: ${entry.path}`);
      continue;
    }
    const parsed = (await file.json()) as {
      readonly models?: Readonly<Record<string, string>>;
      readonly priority?: ReadonlyArray<string>;
      readonly crosscheck?: ReadonlyArray<string>;
    };
    if (parsed.models === undefined) {
      if (entry.required) throw new Error(`${entry.path}: missing "models" map`);
      continue;
    }
    return {
      models: parsed.models,
      ...(parsed.priority === undefined ? {} : { priority: parsed.priority }),
      ...(parsed.crosscheck === undefined ? {} : { crosscheck: parsed.crosscheck }),
    };
  }

  return undefined;
};

const emptyWorkspaceVerification = (reason: string): WorkspaceVerification => ({
  passed: false,
  actorSuitePassed: false,
  trustedOraclePassed: false,
  actorSpecFailsPreFix: false,
  allowedMutationsOnly: false,
  unexpectedFiles: [],
  verifyTimedOut: false,
  actorSuiteExitCode: null,
  oracleExitCode: null,
  preFixSpecExitCode: null,
  actorSuiteOutput: "",
  oracleOutput: "",
  preFixSpecOutput: "",
  diffs: [],
  failureReasons: [reason],
});

const driveActorTurns = async (input: {
  readonly client: Opencode;
  readonly sessionID: string;
  readonly scenario: AblationScenario;
  readonly workspaceDir: string;
  readonly actorTimeoutMs: number;
  readonly childTimeoutMs: number;
}): Promise<{
  readonly status: TrialCompletionStatus;
  readonly reason?: string;
  readonly parent: Transcript;
  readonly children: ReadonlyMap<string, Transcript>;
}> => {
  let parent: Transcript = { activated: [], messages: [] };
  let children: ReadonlyMap<string, Transcript> = new Map();

  for (const turn of input.scenario.turns) {
    const prompt = turn.prompt.replaceAll("/workspace", input.workspaceDir);
    try {
      await withTimeout(
        input.client.session.prompt({ sessionID: input.sessionID, text: prompt }),
        30_000,
        "actor session.prompt",
      );
      const settled = await settleBounded({
        client: input.client,
        sessionID: input.sessionID,
        actorTimeoutMs: input.actorTimeoutMs,
        childTimeoutMs: input.childTimeoutMs,
      });
      parent = settled.parent;
      children = settled.children;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : String(cause);
      await input.client.session.interrupt({ sessionID: input.sessionID }).catch(() => {});
      parent = await input.client.transcript(input.sessionID).catch(() => parent);
      return {
        status: /timed out/i.test(message) ? "timed_out" : "host_error",
        reason: message,
        parent,
        children,
      };
    }
  }

  if (parent.failure !== undefined) {
    return { status: "host_error", reason: parent.failure.reason, parent, children };
  }
  return { status: "completed", parent, children };
};

const executeSingleTrial = async (input: {
  readonly scheduled: ScheduledTrial;
  readonly stage: StagedPluginArm;
  readonly scenario: AblationScenario;
  readonly actorModel: string;
  readonly scratchRoot: string;
  readonly runsDir: string;
  readonly keep: boolean;
  readonly actorTimeoutMs: number;
  readonly childTimeoutMs: number;
  readonly verifyTimeoutMs: number;
  readonly activeServers: Set<Live>;
  readonly forbiddenLeakTokens: Set<string>;
  readonly onCatalogue: (models: Awaited<ReturnType<Opencode["models"]>>) => void;
}): Promise<{ readonly record: TrialRecord; readonly registrationOk: boolean }> => {
  const startedAt = performance.now();
  const trialRoot = join(input.scratchRoot, `run-${crypto.randomUUID().slice(0, 8)}`);
  const workspaceDir = join(trialRoot, "app");
  const configDir = join(trialRoot, "cfg");
  const artifactDir = join(
    input.runsDir,
    "trials",
    `trial-${input.scheduled.trialIndex}`,
    input.scheduled.arm,
  );
  input.forbiddenLeakTokens.add(trialRoot);
  input.forbiddenLeakTokens.add(workspaceDir);

  await mkdir(workspaceDir, { recursive: true });
  await mkdir(configDir, { recursive: true });
  await mkdir(artifactDir, { recursive: true });
  await writeWorkspaceFiles(workspaceDir, input.scenario.setup);

  let server: Live | undefined;
  let completionStatus: TrialCompletionStatus = "completed";
  let completionReason: string | undefined;
  let registrationOk = false;
  let parentTranscript: Transcript = { activated: [], messages: [] };
  let childTranscripts: ReadonlyMap<string, Transcript> = new Map();

  try {
    server = await startLive({
      directory: workspaceDir,
      configDir,
      pluginDir: input.stage.pluginDir,
      model: input.actorModel,
      env: isolatedServerEnv(),
    });
    input.activeServers.add(server);
    input.onCatalogue(await server.client.models());

    const session = await withTimeout(
      server.client.session.create({
        title: input.scenario.sessionTitle,
        agent: "spectre",
        model: parseModelRefString(input.actorModel),
        location: { directory: workspaceDir },
      }),
      30_000,
      "actor session.create",
    );

    const regProof = await verifyHostRegistration({
      server,
      expectedIds: input.stage.expectedIds,
      strippedIds: input.stage.strippedIds,
      directory: workspaceDir,
    });
    registrationOk = regProof.ok;
    await Bun.write(join(artifactDir, "registration.json"), `${JSON.stringify(regProof, null, 2)}\n`);

    if (!regProof.ok) {
      completionStatus = "host_error";
      completionReason = `registration verification failed: ${regProof.findings.join("; ")}`;
    } else {
      const outcome = await driveActorTurns({
        client: server.client,
        sessionID: session.id,
        scenario: input.scenario,
        workspaceDir,
        actorTimeoutMs: input.actorTimeoutMs,
        childTimeoutMs: input.childTimeoutMs,
      });
      completionStatus = outcome.status;
      completionReason = outcome.reason;
      parentTranscript = outcome.parent;
      childTranscripts = outcome.children;
    }
    await Bun.write(join(artifactDir, "server.log"), await server.logs());
  } catch (cause) {
    completionStatus = "host_error";
    completionReason = cause instanceof Error ? cause.message : String(cause);
  } finally {
    if (server !== undefined) {
      await server.stop().catch(() => {});
      input.activeServers.delete(server);
    }
  }

  let workspaceVerification: WorkspaceVerification;
  if (completionStatus === "completed") {
    workspaceVerification = await verifyTrialWorkspace({
      scenario: input.scenario,
      workspaceDir,
      timeoutMs: input.verifyTimeoutMs,
    });
    if (workspaceVerification.verifyTimedOut) {
      completionStatus = "timed_out";
      completionReason = "verifier timed out";
    }
  } else {
    workspaceVerification = emptyWorkspaceVerification(
      completionReason ?? `trial ended with status ${completionStatus}`,
    );
  }

  const extracted = extractTrajectory({
    scenario: input.scenario,
    parent: parentTranscript,
    children: childTranscripts,
    workspaceDir,
  });

  const record: TrialRecord = {
    trialIndex: input.scheduled.trialIndex,
    arm: input.scheduled.arm,
    scenarioId: input.scenario.id,
    completion: {
      status: completionStatus,
      ...(completionReason === undefined ? {} : { reason: completionReason }),
    },
    registrationVerified: registrationOk,
    activation: extracted.activation,
    trajectory: extracted.trajectory,
    workspace: workspaceVerification,
    cost: extracted.cost,
    durationMs: Math.round(performance.now() - startedAt),
  };

  await Bun.write(join(artifactDir, "trial.json"), `${JSON.stringify(record, null, 2)}\n`);
  if (!input.keep) {
    await rm(trialRoot, { recursive: true, force: true }).catch(() => {});
  }
  return { record, registrationOk };
};

const runJudgeComparisonPhase = async (input: {
  readonly scenario: AblationScenario;
  readonly trialsPerArm: number;
  readonly trials: ReadonlyArray<TrialRecord>;
  readonly actorModel: string;
  readonly judgeModel?: string;
  readonly allowSameFamily?: boolean;
  readonly configPath?: string;
  readonly useRepoConfig?: boolean;
  readonly catalogue: Awaited<ReturnType<Opencode["models"]>>;
  readonly scratchRoot: string;
  readonly judgeTimeoutMs: number;
  readonly forbiddenTokens: ReadonlyArray<string>;
  readonly activeServers: Set<Live>;
}): Promise<{
  readonly resolvedJudge: ResolvedJudgeModel;
  readonly judgeAB: ReadonlyArray<JudgePairResult>;
  readonly judgeAA: ReadonlyArray<JudgePairResult>;
}> => {
  const spectreConfig = await loadSpectreModelConfig({
    configPath: input.configPath,
    useRepoConfig: input.useRepoConfig,
  });
  const resolvedJudge = resolveJudgeModel({
    catalogue: input.catalogue,
    actorModelRef: input.actorModel,
    judgeModelRef: input.judgeModel,
    spectreConfig,
    allowSameFamily: input.allowSameFamily,
  });

  const judgeRoot = join(input.scratchRoot, `review-${crypto.randomUUID().slice(0, 8)}`);
  const judgeDir = join(judgeRoot, "app");
  const judgeCfg = join(judgeRoot, "cfg");
  await mkdir(judgeDir, { recursive: true });
  await mkdir(judgeCfg, { recursive: true });

  let judgeServer: Live | undefined;
  try {
    judgeServer = await startLive({
      directory: judgeDir,
      configDir: judgeCfg,
      pluginDir: undefined,
      model: resolvedJudge.judgeRef,
      env: isolatedServerEnv(),
    });
    input.activeServers.add(judgeServer);

    const judgeProof = await verifyPluginlessJudgeServer({
      client: judgeServer.client,
      directory: judgeDir,
    });
    if (!judgeProof.ok) {
      throw new Error(`judge server isolation failed: ${judgeProof.findings.join("; ")}`);
    }

    const transport = createSessionJudgeTransport({
      client: judgeServer.client,
      model: parseModelRefString(resolvedJudge.judgeRef),
      timeoutMs: input.judgeTimeoutMs,
    });

    const judgeAB: Array<JudgePairResult> = [];
    const judgeAA: Array<JudgePairResult> = [];
    const findComplete = (index: number, arm: TrialRecord["arm"]) =>
      input.trials.find(
        (t) => t.trialIndex === index && t.arm === arm && t.completion.status === "completed",
      );

    for (let i = 0; i < input.trialsPerArm; i++) {
      const presentTrial = findComplete(i, "present");
      const strippedTrial = findComplete(i, "stripped");
      const replicateTrial = findComplete(i, "replicate");

      if (presentTrial !== undefined && strippedTrial !== undefined) {
        judgeAB.push(
          await judgePairSwapped({
            scenario: input.scenario,
            left: artifactFromVerification(presentTrial.workspace),
            right: artifactFromVerification(strippedTrial.workspace),
            transport,
            forbiddenTokens: input.forbiddenTokens,
          }),
        );
      }
      if (presentTrial !== undefined && replicateTrial !== undefined) {
        judgeAA.push(
          await judgePairSwapped({
            scenario: input.scenario,
            left: artifactFromVerification(presentTrial.workspace),
            right: artifactFromVerification(replicateTrial.workspace),
            transport,
            forbiddenTokens: input.forbiddenTokens,
          }),
        );
      }
    }

    return { resolvedJudge, judgeAB, judgeAA };
  } finally {
    if (judgeServer !== undefined) {
      await judgeServer.stop().catch(() => {});
      input.activeServers.delete(judgeServer);
    }
  }
};

export const runLiveAblation = async (
  options: LiveAblationOptions,
): Promise<LiveAblationOutput> => {
  const actorModel = options.model ?? (await defaultLiveModel());
  const enableJudge = options.enableJudge ?? true;
  const actorTimeoutMs = options.actorTurnTimeoutMs ?? DEFAULT_ACTOR_TIMEOUT_MS;
  const childTimeoutMs = options.childSettleTimeoutMs ?? DEFAULT_CHILD_TIMEOUT_MS;
  const verifyTimeoutMs = options.verifyTimeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const judgeTimeoutMs = options.judgePassTimeoutMs ?? DEFAULT_JUDGE_TIMEOUT_MS;

  const pristine = await verifyPristineScenario(options.scenario, verifyTimeoutMs);
  if (!pristine.ok) {
    throw new Error(`pristine scenario check failed: ${pristine.findings.join("; ")}`);
  }

  const scratchRoot = join(
    Bun.env.TMPDIR ?? "/tmp",
    `work-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(scratchRoot, { recursive: true });
  await mkdir(options.runsDir, { recursive: true });

  const activeServers = new Set<Live>();
  const cleanupAll = async (): Promise<void> => {
    await Promise.all([...activeServers].map((server) => server.stop().catch(() => {})));
    activeServers.clear();
    if (options.keep !== true) {
      await rm(scratchRoot, { recursive: true, force: true }).catch(() => {});
    }
  };

  const handleInterrupt = () => {
    void cleanupAll().finally(() => process.exit(130));
  };
  process.once("SIGINT", handleInterrupt);
  process.once("SIGTERM", handleInterrupt);

  try {
    const stageBase = join(scratchRoot, "bundles");
    await mkdir(stageBase, { recursive: true });
    const presentStage = await stagePluginArm({
      baseDir: stageBase,
      arm: "present",
      targetSkill: options.scenario.targetSkill,
    });
    const strippedStage = await stagePluginArm({
      baseDir: stageBase,
      arm: "stripped",
      targetSkill: options.scenario.targetSkill,
    });

    const presentAudit: StagedAuditResult = await auditStagedPlugin(presentStage);
    const strippedAudit: StagedAuditResult = await auditStagedPlugin(strippedStage);
    const stagedAuditPassed = presentAudit.ok && strippedAudit.ok;
    if (!stagedAuditPassed) {
      throw new Error(
        `staged plugin audit failed: ${[...presentAudit.findings, ...strippedAudit.findings].join("; ")}`,
      );
    }

    const trials: Array<TrialRecord> = [];
    const failureReasons: Array<string | undefined> = [];
    const forbiddenLeakTokens = new Set<string>([
      scratchRoot,
      options.runsDir,
      presentStage.bundleDir,
      strippedStage.bundleDir,
      actorModel,
    ]);

    let hostRegistrationVerified = true;
    let systemicReason: string | undefined;
    let firstModelCatalogue: Awaited<ReturnType<Opencode["models"]>> | undefined;

    for (const scheduled of buildTrialSchedule(options.trials)) {
      const result = await executeSingleTrial({
        scheduled,
        stage: scheduled.arm === "stripped" ? strippedStage : presentStage,
        scenario: options.scenario,
        actorModel,
        scratchRoot,
        runsDir: options.runsDir,
        keep: options.keep === true,
        actorTimeoutMs,
        childTimeoutMs,
        verifyTimeoutMs,
        activeServers,
        forbiddenLeakTokens,
        onCatalogue: (models) => {
          if (firstModelCatalogue === undefined) firstModelCatalogue = models;
        },
      });
      if (!result.registrationOk) hostRegistrationVerified = false;
      trials.push(result.record);
      failureReasons.push(
        result.record.completion.status === "completed"
          ? undefined
          : result.record.completion.reason,
      );
      systemicReason = systemic(failureReasons, 3);
      if (systemicReason !== undefined) break;
    }

    let resolvedJudge: ResolvedJudgeModel | undefined;
    let judgeAB: ReadonlyArray<JudgePairResult> | undefined;
    let judgeAA: ReadonlyArray<JudgePairResult> | undefined;
    let crossFamilyJudgeVerified = true;

    if (enableJudge && systemicReason === undefined && firstModelCatalogue !== undefined) {
      const judged = await runJudgeComparisonPhase({
        scenario: options.scenario,
        trialsPerArm: options.trials,
        trials,
        actorModel,
        judgeModel: options.judgeModel,
        allowSameFamily: options.allowSameFamily,
        configPath: options.configPath,
        useRepoConfig: options.useRepoConfig,
        catalogue: firstModelCatalogue,
        scratchRoot,
        judgeTimeoutMs,
        forbiddenTokens: [...forbiddenLeakTokens],
        activeServers,
      });
      resolvedJudge = judged.resolvedJudge;
      judgeAB = judged.judgeAB;
      judgeAA = judged.judgeAA;
      crossFamilyJudgeVerified = !resolvedJudge.sameFamilyOverride;
    }

    const validity: ValidityGates = {
      stagedAuditPassed,
      hostRegistrationVerified,
      blindingVerified: true,
      crossFamilyJudgeVerified,
      zeroSystemicFailures: systemicReason === undefined,
      allPassed:
        stagedAuditPassed &&
        hostRegistrationVerified &&
        crossFamilyJudgeVerified &&
        systemicReason === undefined,
    };

    const summary = summarizeAblation({
      scenarioId: options.scenario.id,
      targetSkill: options.scenario.targetSkill,
      trialsPerArm: options.trials,
      trials,
      ...(judgeAB === undefined ? {} : { judgeAB }),
      ...(judgeAA === undefined ? {} : { judgeAA }),
      validity,
    });

    const metadata: ReportMetadata = {
      mode: "live",
      actorModel,
      ...(resolvedJudge === undefined
        ? {}
        : {
            actorFamily: resolvedJudge.actorFamily,
            judgeModel: resolvedJudge.judgeRef,
            judgeFamily: resolvedJudge.judgeFamily,
            sameFamilyOverride: resolvedJudge.sameFamilyOverride,
          }),
      runsDir: options.runsDir,
    };

    const written = await writeAblationArtifacts({
      runsDir: options.runsDir,
      summary,
      metadata,
      payload: {
        metadata,
        pristine,
        presentAudit,
        strippedAudit,
        summary,
        trials,
        ...(judgeAB === undefined ? {} : { judgeAB }),
        ...(judgeAA === undefined ? {} : { judgeAA }),
        ...(systemicReason === undefined ? {} : { systemicReason }),
      },
    });

    return {
      summary,
      metadata,
      markdown: written.markdown,
      runsDir: options.runsDir,
    };
  } finally {
    process.off("SIGINT", handleInterrupt);
    process.off("SIGTERM", handleInterrupt);
    await cleanupAll();
  }
};
