import type { Transcript } from "../opencode";
import { REPO } from "../resume/docker";
import { type Live, startLive } from "../resume/live";
import { preparePlugin } from "../resume/plugin";
import type { WorkspacePath } from "../resume/scenario";
import { resolveIn } from "../resume/workspace";
import { observeRun } from "./observe";
import type { DelegationScenario } from "./scenario";
import { type ABComparisonReport, compareArms, scoreTrial, type TrialObservation } from "./score";

export interface LiveABOptions {
  readonly baselineRef: string;
  readonly model: string;
  readonly trials: number;
  readonly runsDir: string;
  readonly scenarios: ReadonlyArray<DelegationScenario>;
  readonly keep?: boolean;
}

const parseModelRef = (ref: string) => {
  const match = /^([^/#]+)\/([^#]+)(?:#(.+))?$/.exec(ref);
  const providerID = match?.[1];
  const id = match?.[2];
  const variant = match?.[3];
  if (providerID === undefined || id === undefined) {
    throw new Error(`bad model ref "${ref}": expected provider/id#variant`);
  }
  return { providerID, id, ...(variant === undefined ? {} : { variant }) };
};

export const defaultLiveModel = async (): Promise<string> => {
  for (const name of ["spectre.json", "spectre.default.json"]) {
    const file = Bun.file(`${REPO}/${name}`);
    if (!(await file.exists())) continue;
    const parsed = (await file.json()) as {
      readonly models?: Record<string, string>;
      readonly priority?: ReadonlyArray<string>;
    };
    const firstAlias = parsed.priority?.[0];
    if (firstAlias !== undefined && parsed.models?.[firstAlias] !== undefined) {
      return parsed.models[firstAlias];
    }
    const first = Object.values(parsed.models ?? {})[0];
    if (first !== undefined) return first;
  }
  return "opencode-go/kimi-k3";
};

const loadRepoSpectreConfig = async (): Promise<
  | {
      readonly models: Readonly<Record<string, string>>;
      readonly priority: ReadonlyArray<string>;
      readonly crosscheck?: ReadonlyArray<string>;
    }
  | undefined
> => {
  const file = Bun.file(`${REPO}/spectre.json`);
  if (!(await file.exists())) return undefined;
  const parsed = (await file.json()) as {
    readonly models?: Readonly<Record<string, string>>;
    readonly priority?: ReadonlyArray<string>;
    readonly crosscheck?: ReadonlyArray<string>;
  };
  if (parsed.models === undefined || parsed.priority === undefined) return undefined;
  return {
    models: parsed.models,
    priority: parsed.priority,
    ...(parsed.crosscheck === undefined ? {} : { crosscheck: parsed.crosscheck }),
  };
};

export const materializeBaselinePlugin = async (
  baselineRef: string,
  targetDir: string,
): Promise<string> => {
  const verify = await Bun.$`git -C ${REPO} rev-parse --verify ${baselineRef}`.nothrow().quiet();
  if (verify.exitCode !== 0) {
    throw new Error(`baseline ref "${baselineRef}" not found: ${verify.stderr.toString().trim()}`);
  }

  const pluginDir = `${targetDir}/plugin`;
  await Bun.$`mkdir -p ${pluginDir}`.quiet();

  const archived = await Bun.$`git -C ${REPO} archive ${baselineRef} | tar -x -C ${pluginDir}`
    .nothrow()
    .quiet();
  if (archived.exitCode !== 0) {
    throw new Error(`git archive ${baselineRef} failed: ${archived.stderr.toString().trim()}`);
  }

  const nodeModules = `${REPO}/node_modules`;
  const linked = await Bun.$`ln -sfn ${nodeModules} ${pluginDir}/node_modules`.nothrow().quiet();
  if (linked.exitCode !== 0) {
    throw new Error(`symlink node_modules failed: ${linked.stderr.toString().trim()}`);
  }

  return pluginDir;
};

const runCommand = async (workspace: string, command: string): Promise<number> => {
  const proc = Bun.spawn(["sh", "-c", command], {
    cwd: workspace,
    stdout: "pipe",
    stderr: "pipe",
  });
  return proc.exited;
};

const runArmTrial = async (input: {
  readonly arm: "baseline" | "candidate";
  readonly trial: number;
  readonly scenario: DelegationScenario;
  readonly pluginDir: string;
  readonly model: string;
  readonly runDir: string;
  readonly repoConfig:
    | {
        readonly models: Readonly<Record<string, string>>;
        readonly priority: ReadonlyArray<string>;
        readonly crosscheck?: ReadonlyArray<string>;
      }
    | undefined;
  readonly baselineCostUnits?: number;
  readonly keep?: boolean;
}): Promise<TrialObservation> => {
  const workspace = `${input.runDir}/workspace`;
  const configDir = `${input.runDir}/config`;
  await Bun.$`mkdir -p ${workspace} ${configDir}`.quiet();

  for (const [path, content] of Object.entries(input.scenario.setup)) {
    await Bun.write(resolveIn(workspace, path as WorkspacePath), content);
  }

  const spectreConfig = input.repoConfig ?? input.scenario.spectreConfig;
  await Bun.write(`${workspace}/spectre.json`, `${JSON.stringify(spectreConfig, null, 2)}\n`);

  let server: Live | undefined;
  try {
    server = await startLive({
      directory: workspace,
      configDir,
      pluginDir: input.pluginDir,
      model: input.model,
    });
    const client = server.client;
    const session = await client.session.create({
      title: `${input.scenario.id}-${input.arm}-${input.trial}`,
      agent: "spectre",
      model: parseModelRef(input.model),
      location: { directory: workspace },
    });

    const extractChildIds = (transcript: Transcript): Array<string> => {
      const ids = new Set<string>();
      for (const message of transcript.messages) {
        for (const part of message.content) {
          if (part.type !== "tool" || part.name !== "subagent" || part.state.status === "streaming")
            continue;
          const metaId = part.state.metadata?.sessionID;
          if (typeof metaId === "string" && metaId !== "") ids.add(metaId);
          if (part.state.status !== "running") {
            for (const item of part.state.content ?? []) {
              if (item.type !== "text") continue;
              const match = item.text.match(/sessionID[=":\s]+(ses_[A-Za-z0-9]+)/);
              if (match?.[1] !== undefined) ids.add(match[1]);
            }
          }
        }
      }
      return [...ids];
    };

    const waitUntilSettled = async (): Promise<Transcript> => {
      const waited = new Set<string>();
      for (let round = 0; round < 4; round++) {
        await client.experimental.session.wait({ sessionID: session.id });
        const snap = await client.transcript(session.id);
        const pending = extractChildIds(snap).filter((id) => !waited.has(id));
        if (pending.length === 0) return snap;
        for (const childId of pending) {
          waited.add(childId);
          await client.experimental.session.wait({ sessionID: childId });
        }
        await Bun.sleep(500);
      }
      await client.experimental.session.wait({ sessionID: session.id });
      return client.transcript(session.id);
    };

    for (const turn of input.scenario.turns) {
      const prompt = turn.prompt.replaceAll("/workspace", workspace);
      await client.session.prompt({ sessionID: session.id, text: prompt });
      await waitUntilSettled();
    }

    const parent = await client.transcript(session.id);
    const childIds = new Set<string>(extractChildIds(parent));

    const children = new Map<string, Transcript>();
    for (const childId of childIds) {
      children.set(childId, await client.transcript(childId));
    }

    const verifyExitCode =
      input.scenario.verifyCommand === undefined
        ? undefined
        : await runCommand(workspace, input.scenario.verifyCommand);

    const observed = await observeRun({
      scenario: input.scenario,
      workspace,
      parent,
      children,
    });

    const scored = scoreTrial({
      scenario: input.scenario,
      arm: input.arm,
      trial: input.trial,
      observed,
      verifyExitCode,
      baselineCostUnits: input.baselineCostUnits,
    });

    await Bun.write(
      `${input.runDir}/observation.json`,
      `${JSON.stringify({ observed, scored }, null, 2)}\n`,
    );
    await Bun.write(`${input.runDir}/server.log`, await server.logs());
    return scored;
  } finally {
    if (input.keep && server !== undefined) {
      console.log(`  kept ${input.arm} server; artifacts ${input.runDir}`);
    } else if (server !== undefined) {
      await server.stop();
    }
  }
};

export const runLiveAB = async (options: LiveABOptions): Promise<ABComparisonReport> => {
  const baselinePlugin = await materializeBaselinePlugin(
    options.baselineRef,
    `${options.runsDir}/baseline`,
  );
  const candidatePlugin = await preparePlugin(`${options.runsDir}/candidate`, "live");
  const repoConfig = await loadRepoSpectreConfig();

  const baselineTrials: Array<TrialObservation> = [];
  const candidateTrials: Array<TrialObservation> = [];

  for (const scenario of options.scenarios) {
    for (let trial = 1; trial <= options.trials; trial++) {
      console.log(`  [${scenario.id}] trial ${trial}/${options.trials} — baseline`);
      const baseObs = await runArmTrial({
        arm: "baseline",
        trial,
        scenario,
        pluginDir: baselinePlugin,
        model: options.model,
        runDir: `${options.runsDir}/baseline/${scenario.id}/trial-${trial}`,
        repoConfig,
        keep: options.keep,
      });
      baselineTrials.push(baseObs);

      console.log(`  [${scenario.id}] trial ${trial}/${options.trials} — candidate`);
      const candObs = await runArmTrial({
        arm: "candidate",
        trial,
        scenario,
        pluginDir: candidatePlugin,
        model: options.model,
        runDir: `${options.runsDir}/candidate/${scenario.id}/trial-${trial}`,
        repoConfig,
        baselineCostUnits: baseObs.catalogueCostUnits,
        keep: options.keep,
      });
      candidateTrials.push(candObs);
    }
  }

  const report = compareArms({
    baselineRef: options.baselineRef,
    orchestratorModel: options.model,
    trialsPerScenario: options.trials,
    scenarios: options.scenarios,
    baselineTrials,
    candidateTrials,
  });

  await Bun.write(`${options.runsDir}/report.json`, `${JSON.stringify(report, null, 2)}\n`);
  return report;
};
