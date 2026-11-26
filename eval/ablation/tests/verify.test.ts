import { afterEach, describe, expect, test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { join } from "node:path";
import { loadScenario } from "../scenario";
import {
  runBoundedCommand,
  verifyPristineScenario,
  verifyTrialWorkspace,
  writeWorkspaceFiles,
} from "../verify";

const SCENARIO_PATH = `${import.meta.dir}/../scenarios/tdd-bugfix.json`;
const scratchDirs: Array<string> = [];

const makeDir = async (tag: string): Promise<string> => {
  const dir = join(
    Bun.env.TMPDIR ?? "/tmp",
    `spectre-verify-${tag}-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(dir, { recursive: true });
  scratchDirs.push(dir);
  return dir;
};

afterEach(async () => {
  while (scratchDirs.length > 0) {
    const dir = scratchDirs.pop()!;
    await rm(dir, { recursive: true, force: true });
  }
});

describe("bounded command verifier and process-group cleanup", () => {
  test("drains stdout and stderr concurrently and caps large output", async () => {
    const dir = await makeDir("drain");
    const result = await runBoundedCommand({
      command:
        "bun -e 'process.stdout.write(\"A\".repeat(40000)); process.stderr.write(\"B\".repeat(40000));'",
      cwd: dir,
      timeoutMs: 10_000,
      maxOutputBytes: 4096,
    });
    expect(result.timedOut).toBe(false);
    expect(result.exitCode).toBe(0);
    expect(result.truncated).toBe(true);
    expect(result.stdout.length).toBeLessThanOrEqual(4096);
    expect(result.stderr.length).toBeLessThanOrEqual(4096);
  });

  test("kills entire grandchild process group on timeout and cleans up verifier temp dirs", async () => {
    const dir = await makeDir("timeout");
    const pidFile = join(dir, "grandchild.pid");
    const result = await runBoundedCommand({
      command: `sleep 30 & echo $! > "${pidFile}"; wait`,
      cwd: dir,
      timeoutMs: 300,
    });
    expect(result.timedOut).toBe(true);

    const pidText = (await Bun.file(pidFile).text()).trim();
    const childPid = Number(pidText);
    expect(Number.isInteger(childPid) && childPid > 0).toBe(true);
    await Bun.sleep(150);
    let alive = true;
    try {
      process.kill(childPid, 0);
    } catch {
      alive = false;
    }
    expect(alive).toBe(false);
  });

  test("cleans up temporary verification directories even when an injected verifier timeout occurs", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const workspace = await makeDir("ws-timeout");
    const scratchBase = await makeDir("verify-scratch");
    await writeWorkspaceFiles(workspace, scenario.setup);

    const slowScenario = {
      ...scenario,
      verifyCommand: "sleep 30",
    };

    const verification = await verifyTrialWorkspace({
      scenario: slowScenario,
      workspaceDir: workspace,
      timeoutMs: 250,
      scratchBaseDir: scratchBase,
    });

    expect(verification.passed).toBe(false);
    expect(verification.verifyTimedOut).toBe(true);
    const remaining = [...new Bun.Glob("*").scanSync({ cwd: scratchBase, onlyFiles: false })];
    expect(remaining).toEqual([]);
  });
});

describe("pristine and post-trial oracle verification", () => {
  test("confirms pristine baseline passes actor suite and fails trusted oracle", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const check = await verifyPristineScenario(scenario);
    expect(check.ok).toBe(true);
    expect(check.baselineSuitePassed).toBe(true);
    expect(check.pristineOracleFailed).toBe(true);
  });

  test("passes on genuine fix + regression spec, rejects tautological spec and unexpected writes", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const workspace = await makeDir("fixed");
    await writeWorkspaceFiles(workspace, scenario.setup);

    const rawLimiter = scenario.setup["src/limiter.ts" as never] as string | undefined;
    const baseSpec = scenario.setup["spec/limiter.spec.ts" as never] as string | undefined;
    if (rawLimiter === undefined || baseSpec === undefined) {
      throw new Error("expected setup files missing");
    }
    const fixedLimiter = rawLimiter.replace("ts >= cutoff", "ts > cutoff");
    const lastClose = baseSpec.lastIndexOf("});");
    const regressionSpec = `${baseSpec.slice(0, lastClose)}
  it("expires a hit arriving at exact nowMs - windowMs", () => {
    const limiter = new SlidingWindowLimiter({ limit: 1, windowMs: 1000 });
    expect(limiter.check("alpha", 1000).allowed).toBe(true);
    expect(limiter.check("alpha", 2000)).toEqual({ allowed: true, remaining: 0, retryAfterMs: 0 });
  });
});
`;

    await Bun.write(join(workspace, "src/limiter.ts"), fixedLimiter);
    await Bun.write(join(workspace, "spec/limiter.spec.ts"), regressionSpec);

    const okResult = await verifyTrialWorkspace({ scenario, workspaceDir: workspace });
    expect(okResult.passed).toBe(true);
    expect(okResult.actorSuitePassed).toBe(true);
    expect(okResult.trustedOraclePassed).toBe(true);
    expect(okResult.actorSpecFailsPreFix).toBe(true);
    expect(okResult.allowedMutationsOnly).toBe(true);
    expect(okResult.unexpectedFiles).toEqual([]);

    const tautologicalWorkspace = await makeDir("tautological");
    await writeWorkspaceFiles(tautologicalWorkspace, scenario.setup);
    await Bun.write(join(tautologicalWorkspace, "src/limiter.ts"), fixedLimiter);

    const tautResult = await verifyTrialWorkspace({
      scenario,
      workspaceDir: tautologicalWorkspace,
    });
    expect(tautResult.passed).toBe(false);
    expect(tautResult.trustedOraclePassed).toBe(true);
    expect(tautResult.actorSpecFailsPreFix).toBe(false);

    await Bun.write(join(workspace, "stray-note.txt"), "unexpected file\n");
    const strayResult = await verifyTrialWorkspace({ scenario, workspaceDir: workspace });
    expect(strayResult.passed).toBe(false);
    expect(strayResult.allowedMutationsOnly).toBe(false);
    expect(strayResult.unexpectedFiles).toContain("stray-note.txt");
  });
});
