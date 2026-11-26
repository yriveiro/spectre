import { join } from "node:path";
import { runLiveAblation } from "./runner";
import { loadScenario } from "./scenario";
import { runSelfTest } from "./selftest";

interface CliOptions {
  readonly help: boolean;
  readonly selfTest: boolean;
  readonly live: boolean;
  readonly trials?: number;
  readonly model?: string;
  readonly judgeModel?: string;
  readonly noJudge: boolean;
  readonly allowSameFamily: boolean;
  readonly useRepoConfig: boolean;
  readonly configPath?: string;
  readonly keep: boolean;
}

const USAGE = `Usage:
  bun run eval:ablation -- --self-test [--trials=2]
  bun run eval:ablation -- --live [--trials=3] [--model=provider/id#variant] [--judge-model=provider/id] [--no-judge] [--allow-same-family] [--use-repo-config] [--config=path] [--keep]
`;

const parseCli = (argv: ReadonlyArray<string>): CliOptions => {
  const values = new Map<string, string>();
  const flags = new Set<string>();
  for (const raw of argv) {
    if (!raw.startsWith("--")) {
      if (raw === "-h") flags.add("help");
      continue;
    }
    const eq = raw.indexOf("=");
    if (eq === -1) flags.add(raw.slice(2));
    else values.set(raw.slice(2, eq), raw.slice(eq + 1));
  }

  const rawTrials = values.get("trials");
  let trials: number | undefined;
  if (rawTrials !== undefined) {
    const parsed = Number.parseInt(rawTrials, 10);
    if (!Number.isInteger(parsed) || parsed < 1) {
      throw new Error(`Invalid --trials value: ${rawTrials}`);
    }
    trials = parsed;
  }

  return {
    help: flags.has("help"),
    selfTest: flags.has("self-test"),
    live: flags.has("live"),
    trials,
    model: values.get("model"),
    judgeModel: values.get("judge-model"),
    noJudge: flags.has("no-judge"),
    allowSameFamily: flags.has("allow-same-family"),
    useRepoConfig: flags.has("use-repo-config"),
    configPath: values.get("config"),
    keep: flags.has("keep"),
  };
};

const main = async (): Promise<void> => {
  let cli: CliOptions;
  try {
    cli = parseCli(Bun.argv.slice(2));
  } catch (cause) {
    console.error(cause instanceof Error ? cause.message : String(cause));
    console.error(USAGE);
    process.exit(2);
  }

  if (cli.help) {
    console.log(USAGE);
    return;
  }

  if (cli.selfTest === cli.live) {
    console.error("Specify exactly one of --self-test or --live.\n");
    console.error(USAGE);
    process.exit(2);
  }

  const trials = cli.trials ?? (cli.selfTest ? 2 : 3);

  if (cli.selfTest) {
    const result = await runSelfTest({ trials });
    console.log(result.markdown);
    if (!result.passed) process.exit(1);
    return;
  }

  const scenario = await loadScenario(join(import.meta.dir, "scenarios/tdd-bugfix.json"));
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const runsDir = join(import.meta.dir, ".runs", stamp);

  const output = await runLiveAblation({
    scenario,
    trials,
    model: cli.model,
    judgeModel: cli.judgeModel,
    enableJudge: !cli.noJudge,
    allowSameFamily: cli.allowSameFamily,
    useRepoConfig: cli.useRepoConfig,
    configPath: cli.configPath,
    runsDir,
    keep: cli.keep,
  });

  console.log(output.markdown);
  if (!output.summary.validity.allPassed) process.exit(1);
};

await main();
