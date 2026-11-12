import { ensureImage, start, type Running } from "./docker";
import { startLive, type Live } from "./live";
import { startMock, type Mock } from "./mock";
import { assertScenario, observed, readFiles, subagentCalls, type Observed } from "./observe";
import { preparePlugin } from "./plugin";
import { findScenario, listScenarios, type Scenario, type WorkspacePath } from "./scenario";
import { resolveIn } from "./workspace";

const args = Bun.argv.slice(2);
const flagged = (name: string) => args.some((arg) => arg === `--${name}`);
const value = (name: string) => args.find((arg) => arg.startsWith(`--${name}=`))?.slice(name.length + 3);

const BUILD = flagged("build");
const RECORD = flagged("record");
const KEEP = flagged("keep");
const LIVE = flagged("live");
const MODE = LIVE ? "live" : "mock";
const ONLY = value("scenario");
const LIVE_MODEL =
  value("model") ?? Bun.env.SPECTRE_EVAL_LIVE_MODEL ?? "opencode-go/deepseek-v4.1-flash#high";

const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const RUNS = `${import.meta.dir}/.runs/${stamp}`;
const GOLDEN = `${import.meta.dir}/golden`;

type Mode = "mock" | "live";

type Result = {
  readonly scenario: Scenario;
  readonly run: Observed;
  readonly findings: Array<string>;
  readonly directory: string;
};

const parseRef = (ref: string) => {
  const [providerID, rest] = ref.split("/");
  const [id, variant] = (rest ?? "").split("#");
  if (providerID === undefined || id === undefined || providerID === "" || id === "")
    throw new Error(`bad model ref "${ref}": expected provider/id#variant`);
  return { providerID, id, ...(variant === undefined ? {} : { variant }) };
};

const runOne = async (scenario: Scenario, mode: Mode): Promise<Result> => {
  const live = mode === "live";
  const directory = `${RUNS}/${mode}/${scenario.id}`;
  const workspace = `${directory}/workspace`;
  const configDir = `${directory}/config`;
  await Bun.write(`${workspace}/.keep`, "");
  const pluginDir = await preparePlugin(directory, mode);

  for (const [path, content] of Object.entries(scenario.setup))
    await Bun.write(resolveIn(workspace, path as WorkspacePath), content);

  let mock: Mock | undefined;
  let server: Running | Live | undefined;
  try {
    if (live) {
      server = await startLive({ directory, configDir, pluginDir, model: LIVE_MODEL });
    } else {
      mock = startMock(scenario);
      server = await start({ workspace, configDir, pluginDir, mockBaseURL: mock.baseURL });
    }
    const client = server.client;
    const model = live ? parseRef(LIVE_MODEL) : { providerID: "mock", id: "resume" };

    const session = await client.session(model);
    for (const turn of scenario.turns) {
      // The fixture names the container's mount. A live run stands on the host,
      // so the same prompt has to name the host's directory.
      const prompt = live ? turn.prompt.replaceAll("/workspace", workspace) : turn.prompt;
      await client.prompt(session.id, prompt);
      await client.wait(session.id);
    }

    const parent = await client.transcript(session.id);
    const calls = subagentCalls(parent.messages);
    const files = await readFiles(workspace, scenario.expect.files);
    const run = observed({
      scenario,
      mode,
      model: live ? LIVE_MODEL : "mock/resume",
      calls,
      files,
    });

    const findings = [...assertScenario(scenario, run)];

    if (parent.failure !== undefined) findings.push(`parent turn failed: ${parent.failure.reason}`);

    await Bun.write(
      `${directory}/parent.json`,
      `${JSON.stringify({ session: session.id, mode, calls, transcript: parent, observed: run }, null, 2)}\n`,
    );

    const children = [
      ...new Set(calls.flatMap((call) => (call.outputSessionID === undefined ? [] : [call.outputSessionID]))),
    ];
    let index = 0;
    for (const child of children) {
      const transcript = await client.transcript(child);
      await Bun.write(
        `${directory}/child-${index++}.json`,
        `${JSON.stringify({ session: child, transcript }, null, 2)}\n`,
      );
    }

    await Bun.write(`${directory}/observed.json`, `${JSON.stringify(run, null, 2)}\n`);
    const logs = await server.logs();
    await Bun.write(`${directory}/server.log`, logs);

    return { scenario, run, findings, directory };
  } finally {
    if (KEEP && server !== undefined) {
      if ("name" in server) console.log(`  kept   ${server.name} on 127.0.0.1:${server.hostPort}; artifacts ${directory}`);
      else console.log(`  kept   the live server; artifacts ${directory}`);
    } else {
      if (server !== undefined) await server.stop();
    }
    mock?.stop();
  }
};

const main = async () => {
  if (!LIVE) await ensureImage(BUILD);

  const scenarios = ONLY === undefined ? await listScenarios() : [await findScenario(ONLY)];
  const results: Array<Result> = [];

  for (const scenario of scenarios) {
    process.stdout.write(`\n  ${scenario.id} (${MODE}): ${scenario.description}\n`);
    const result = await runOne(scenario, MODE);
    results.push(result);

    const goldenPath = `${GOLDEN}/${MODE === "live" ? "live/" : ""}${scenario.id}.json`;
    if (RECORD) {
      if (result.findings.length === 0) {
        await Bun.write(goldenPath, `${JSON.stringify(result.run, null, 2)}\n`);
        console.log(`  golden ${goldenPath}`);
      }
    } else {
      const goldenFile = Bun.file(goldenPath);
      if (!(await goldenFile.exists())) {
        result.findings.push(`${goldenPath}: no golden. Run with --record on a passing run.`);
      } else {
        const golden = (await goldenFile.json()) as unknown;
        if (!Bun.deepEquals(golden, result.run))
          result.findings.push(
            `${scenario.id}: the golden changed.\n    expected ${JSON.stringify(golden)}\n    actual   ${JSON.stringify(result.run)}`,
          );
      }
    }

    const verdict = result.findings.length === 0 ? "PASS" : "FAIL";
    console.log(`  ${verdict}  calls=${result.run.calls.length} children=${result.run.childSessions}`);
    for (const finding of result.findings) console.log(`    - ${finding}`);
  }

  const failed = results.filter((result) => result.findings.length > 0);
  console.log(
    `\n  ${results.length - failed.length} of ${results.length} scenarios passed. Artifacts: ${RUNS}\n`,
  );
  if (failed.length > 0) process.exit(1);
};

await main();
