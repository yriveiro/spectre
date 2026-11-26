import { mkdir, realpath, rm } from "node:fs/promises";
import { dirname, join, sep } from "node:path";
import type { WorkspacePath } from "../resume/scenario";
import { resolveIn } from "../resume/workspace";
import type { AblationScenario } from "./scenario";

export interface BoundedCommandResult {
  readonly exitCode: number | null;
  readonly timedOut: boolean;
  readonly stdout: string;
  readonly stderr: string;
  readonly truncated: boolean;
  readonly durationMs: number;
}

export interface AllowlistedFileDiff {
  readonly path: WorkspacePath;
  readonly changed: boolean;
  readonly before: string;
  readonly after: string;
}

export interface PristineVerification {
  readonly ok: boolean;
  readonly baselineSuitePassed: boolean;
  readonly pristineOracleFailed: boolean;
  readonly baselineOutput: string;
  readonly oracleOutput: string;
  readonly findings: ReadonlyArray<string>;
}

export interface WorkspaceVerification {
  readonly passed: boolean;
  readonly actorSuitePassed: boolean;
  readonly trustedOraclePassed: boolean;
  readonly actorSpecFailsPreFix: boolean;
  readonly allowedMutationsOnly: boolean;
  readonly unexpectedFiles: ReadonlyArray<string>;
  readonly verifyTimedOut: boolean;
  readonly actorSuiteExitCode: number | null;
  readonly oracleExitCode: number | null;
  readonly preFixSpecExitCode: number | null;
  readonly actorSuiteOutput: string;
  readonly oracleOutput: string;
  readonly preFixSpecOutput: string;
  readonly diffs: ReadonlyArray<AllowlistedFileDiff>;
  readonly failureReasons: ReadonlyArray<string>;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_OUTPUT_BYTES = 256 * 1024;

const SYNTAX_OR_SETUP_PATTERNS: ReadonlyArray<RegExp> = [
  /\bSyntaxError\b/,
  /\bReferenceError\b/,
  /\bTypeError:\s+.*is not a module\b/i,
  /Cannot find module/i,
  /Cannot find package/i,
  /Failed to resolve/i,
  /\bResolveMessage\b/,
  /Unexpected token/i,
  /Unterminated string/i,
  /error:\s+Expected\b/,
  /command not found/i,
  /\bENOENT\b/,
  /No tests found/i,
  /0 tests ran/i,
];

const ASSERTION_FAILURE_PATTERNS: ReadonlyArray<RegExp> = [
  /\b[1-9]\d*\s+fail\b/i,
  /\bAssertionError\b/,
  /Expected:\s/,
  /Received:\s/,
  /expect\([^)]*\)\./,
];

export const isSyntaxOrSetupError = (output: string): boolean =>
  SYNTAX_OR_SETUP_PATTERNS.some((pattern) => pattern.test(output));

export const hasAssertionFailureEvidence = (output: string): boolean =>
  !isSyntaxOrSetupError(output) &&
  ASSERTION_FAILURE_PATTERNS.some((pattern) => pattern.test(output));

export const hasPassingTestEvidence = (output: string): boolean =>
  !isSyntaxOrSetupError(output) &&
  /\b[1-9]\d*\s+pass\b/i.test(output) &&
  !/\b[1-9]\d*\s+fail\b/i.test(output);

const drainCapped = async (
  stream: ReadableStream<Uint8Array>,
  maxBytes: number,
): Promise<{ readonly text: string; readonly truncated: boolean }> => {
  const reader = stream.getReader();
  const decoder = new TextDecoder();
  let keptBytes = 0;
  let truncated = false;
  let text = "";

  try {
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      const bytes = chunk.value;
      if (keptBytes < maxBytes) {
        const remaining = maxBytes - keptBytes;
        const slice = bytes.byteLength <= remaining ? bytes : bytes.subarray(0, remaining);
        text += decoder.decode(slice, { stream: true });
        keptBytes += slice.byteLength;
        if (bytes.byteLength > remaining) truncated = true;
      } else {
        truncated = true;
      }
    }
    text += decoder.decode();
  } catch {
    return { text, truncated };
  } finally {
    reader.releaseLock();
  }

  return { text, truncated };
};

const spawnInProcessGroup = (command: string, cwd: string) => {
  const setsid = Bun.which("setsid");
  if (setsid !== null) {
    return Bun.spawn([setsid, "sh", "-c", command], {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    });
  }
  const perl = Bun.which("perl");
  if (perl !== null) {
    return Bun.spawn(
      [perl, "-MPOSIX=setsid", "-e", "setsid() or die; exec @ARGV", "sh", "-c", command],
      {
        cwd,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
  }
  return Bun.spawn(["sh", "-c", command], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
  });
};

const killProcessGroup = (pid: number, signal: "SIGTERM" | "SIGKILL"): void => {
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      return;
    }
  }
};

export const runBoundedCommand = async (input: {
  readonly command: string;
  readonly cwd: string;
  readonly timeoutMs?: number;
  readonly maxOutputBytes?: number;
}): Promise<BoundedCommandResult> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxOutputBytes = input.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES;
  const started = performance.now();

  const proc = spawnInProcessGroup(input.command, input.cwd);
  const stdoutPromise = drainCapped(proc.stdout, maxOutputBytes);
  const stderrPromise = drainCapped(proc.stderr, maxOutputBytes);

  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | undefined;

  const waitOutcome = Promise.race([
    proc.exited.then((code) => ({ timedOut: false as const, code })),
    new Promise<{ timedOut: true; code: null }>((resolve) => {
      timer = setTimeout(() => {
        timedOut = true;
        resolve({ timedOut: true, code: null });
      }, timeoutMs);
    }),
  ]);

  const outcome = await waitOutcome;
  if (timer !== undefined) clearTimeout(timer);

  if (outcome.timedOut) {
    killProcessGroup(proc.pid, "SIGTERM");
    const graceful = await Promise.race([
      proc.exited.then(() => true),
      Bun.sleep(250).then(() => false),
    ]);
    if (!graceful) {
      killProcessGroup(proc.pid, "SIGKILL");
      await Promise.race([proc.exited, Bun.sleep(1000)]);
    }
  }

  const [stdout, stderr] = await Promise.race([
    Promise.all([stdoutPromise, stderrPromise]),
    Bun.sleep(1000).then(
      () =>
        [
          { text: "", truncated: true },
          { text: "", truncated: true },
        ] as const,
    ),
  ]);

  return {
    exitCode: timedOut ? null : outcome.code,
    timedOut,
    stdout: stdout.text,
    stderr: stderr.text,
    truncated: stdout.truncated || stderr.truncated,
    durationMs: Math.round(performance.now() - started),
  };
};

export const writeWorkspaceFiles = async (
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const [rel, body] of Object.entries(files)) {
    const dest = resolveIn(root, rel as WorkspacePath);
    await mkdir(dirname(dest), { recursive: true });
    await Bun.write(dest, body);
  }
};

export const snapshotWorkspaceFiles = async (
  workspaceDir: string,
): Promise<ReadonlyMap<string, string>> => {
  const realRoot = await realpath(workspaceDir);
  const files = new Map<string, string>();
  const glob = new Bun.Glob("**/*");

  for await (const entry of glob.scan({ cwd: realRoot, dot: true, onlyFiles: true })) {
    const normalized = entry.replaceAll("\\", "/");
    if (
      normalized === ".git" ||
      normalized.startsWith(".git/") ||
      normalized === "node_modules" ||
      normalized.startsWith("node_modules/")
    ) {
      continue;
    }
    const full = join(realRoot, normalized);
    const resolved = await realpath(full);
    if (!resolved.startsWith(`${realRoot}${sep}`)) {
      throw new Error(`workspace file "${normalized}" escapes workspace root via symlink`);
    }
    files.set(normalized, await Bun.file(resolved).text());
  }

  return files;
};

const combineOutput = (result: BoundedCommandResult): string =>
  [result.stdout.trim(), result.stderr.trim()].filter((part) => part !== "").join("\n");

const formatSanitizedLog = (
  text: string,
  roots: ReadonlyArray<string>,
  maxChars = 4000,
): string => {
  let clean = text;
  for (const root of roots) {
    if (root !== "") clean = clean.replaceAll(root, "/project");
  }
  return clean.length <= maxChars ? clean : `${clean.slice(0, maxChars)}\n...[truncated]`;
};

export const verifyPristineScenario = async (
  scenario: AblationScenario,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<PristineVerification> => {
  const base = join(
    Bun.env.TMPDIR ?? "/tmp",
    `spectre-pristine-${crypto.randomUUID().slice(0, 8)}`,
  );
  await mkdir(base, { recursive: true });
  try {
    await writeWorkspaceFiles(base, scenario.setup);
    const baseline = await runBoundedCommand({
      command: scenario.verifyCommand,
      cwd: base,
      timeoutMs,
    });
    const baselineText = combineOutput(baseline);
    const baselineSuitePassed =
      !baseline.timedOut && baseline.exitCode === 0 && hasPassingTestEvidence(baselineText);

    const oraclePath = resolveIn(base, scenario.oracle.path);
    await mkdir(dirname(oraclePath), { recursive: true });
    await Bun.write(oraclePath, scenario.oracle.content);

    const oracle = await runBoundedCommand({
      command: scenario.oracle.command,
      cwd: base,
      timeoutMs,
    });
    const oracleText = combineOutput(oracle);
    const pristineOracleFailed =
      !oracle.timedOut &&
      oracle.exitCode !== null &&
      oracle.exitCode !== 0 &&
      hasAssertionFailureEvidence(oracleText);

    const findings: Array<string> = [];
    if (!baselineSuitePassed) {
      findings.push(
        `pristine baseline suite did not pass (exit=${baseline.exitCode}, timedOut=${baseline.timedOut})`,
      );
    }
    if (!pristineOracleFailed) {
      findings.push(
        `pristine trusted oracle did not fail with assertion evidence (exit=${oracle.exitCode}, timedOut=${oracle.timedOut})`,
      );
    }

    return {
      ok: findings.length === 0,
      baselineSuitePassed,
      pristineOracleFailed,
      baselineOutput: formatSanitizedLog(baselineText, [base]),
      oracleOutput: formatSanitizedLog(oracleText, [base]),
      findings,
    };
  } finally {
    await rm(base, { recursive: true, force: true });
  }
};

export const verifyTrialWorkspace = async (input: {
  readonly scenario: AblationScenario;
  readonly workspaceDir: string;
  readonly timeoutMs?: number;
  readonly scratchBaseDir?: string;
}): Promise<WorkspaceVerification> => {
  const timeoutMs = input.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const scratchRoot = join(
    input.scratchBaseDir ?? Bun.env.TMPDIR ?? "/tmp",
    `spectre-verify-run-${crypto.randomUUID().slice(0, 8)}`,
  );
  const oracleDir = join(scratchRoot, "oracle");
  const preFixDir = join(scratchRoot, "prefix");

  const snapshot = await snapshotWorkspaceFiles(input.workspaceDir);
  const allowedSet = new Set<string>(input.scenario.allowedMutatedFiles);
  const unexpectedFiles: Array<string> = [];

  for (const [file, content] of snapshot.entries()) {
    const initial = input.scenario.setup[file as WorkspacePath];
    if (initial === undefined) {
      if (!allowedSet.has(file)) unexpectedFiles.push(file);
    } else if (content !== initial && !allowedSet.has(file)) {
      unexpectedFiles.push(file);
    }
  }
  for (const file of Object.keys(input.scenario.setup)) {
    if (!snapshot.has(file)) {
      unexpectedFiles.push(`${file} (deleted)`);
    }
  }
  const allowedMutationsOnly = unexpectedFiles.length === 0;
  const diffs = input.scenario.allowedMutatedFiles.map((file) => {
    const before = input.scenario.setup[file] ?? "";
    const after = snapshot.get(file) ?? "";
    return { path: file, changed: before !== after, before, after };
  });

  await mkdir(oracleDir, { recursive: true });
  await mkdir(preFixDir, { recursive: true });

  try {
    const actorSuite = await runBoundedCommand({
      command: input.scenario.verifyCommand,
      cwd: input.workspaceDir,
      timeoutMs,
    });
    const actorSuiteRaw = combineOutput(actorSuite);
    const actorSuitePassed =
      !actorSuite.timedOut && actorSuite.exitCode === 0 && hasPassingTestEvidence(actorSuiteRaw);

    await writeWorkspaceFiles(oracleDir, input.scenario.setup);
    for (const prodFile of input.scenario.productionFiles) {
      const actorContent = snapshot.get(prodFile);
      if (actorContent !== undefined) {
        await Bun.write(resolveIn(oracleDir, prodFile), actorContent);
      }
    }
    const oracleTarget = resolveIn(oracleDir, input.scenario.oracle.path);
    await mkdir(dirname(oracleTarget), { recursive: true });
    await Bun.write(oracleTarget, input.scenario.oracle.content);

    const oracle = await runBoundedCommand({
      command: input.scenario.oracle.command,
      cwd: oracleDir,
      timeoutMs,
    });
    const oracleRaw = combineOutput(oracle);
    const trustedOraclePassed =
      !oracle.timedOut && oracle.exitCode === 0 && hasPassingTestEvidence(oracleRaw);

    await writeWorkspaceFiles(preFixDir, input.scenario.setup);
    for (const testFile of input.scenario.testFiles) {
      const actorTest = snapshot.get(testFile);
      if (actorTest !== undefined) {
        await Bun.write(resolveIn(preFixDir, testFile), actorTest);
      }
    }
    const preFix = await runBoundedCommand({
      command: input.scenario.verifyCommand,
      cwd: preFixDir,
      timeoutMs,
    });
    const preFixRaw = combineOutput(preFix);
    const actorSpecFailsPreFix =
      !preFix.timedOut &&
      preFix.exitCode !== null &&
      preFix.exitCode !== 0 &&
      hasAssertionFailureEvidence(preFixRaw);

    const verifyTimedOut = actorSuite.timedOut || oracle.timedOut || preFix.timedOut;
    const failureReasons: Array<string> = [];
    if (!allowedMutationsOnly) {
      failureReasons.push(`unexpected workspace mutations: ${unexpectedFiles.join(", ")}`);
    }
    if (verifyTimedOut) {
      failureReasons.push("verifier command timed out");
    }
    if (!actorSuitePassed) {
      failureReasons.push(`actor suite failed (exit=${actorSuite.exitCode})`);
    }
    if (!trustedOraclePassed) {
      failureReasons.push(`trusted oracle failed (exit=${oracle.exitCode})`);
    }
    if (!actorSpecFailsPreFix) {
      failureReasons.push(
        `actor regression spec did not fail cleanly against pristine pre-fix code (exit=${preFix.exitCode})`,
      );
    }

    const roots = [input.workspaceDir, oracleDir, preFixDir];
    return {
      passed: failureReasons.length === 0,
      actorSuitePassed,
      trustedOraclePassed,
      actorSpecFailsPreFix,
      allowedMutationsOnly,
      unexpectedFiles: unexpectedFiles.toSorted(),
      verifyTimedOut,
      actorSuiteExitCode: actorSuite.exitCode,
      oracleExitCode: oracle.exitCode,
      preFixSpecExitCode: preFix.exitCode,
      actorSuiteOutput: formatSanitizedLog(actorSuiteRaw, roots),
      oracleOutput: formatSanitizedLog(oracleRaw, roots),
      preFixSpecOutput: formatSanitizedLog(preFixRaw, roots),
      diffs,
      failureReasons,
    };
  } finally {
    await rm(scratchRoot, { recursive: true, force: true });
  }
};
