const TIMEOUT_MS = 2_500;
const BASES = ["origin/HEAD", "origin/main", "main"] as const;

type CmdResult = { readonly ok: boolean; readonly out: string };

const git = async (cwd: string, args: ReadonlyArray<string>): Promise<CmdResult> => {
  let proc: Bun.Subprocess<"ignore", "pipe", "ignore">;
  try {
    proc = Bun.spawn(["git", ...args], {
      cwd,
      stdin: "ignore",
      stdout: "pipe",
      stderr: "ignore",
      env: { ...Bun.env, GIT_TERMINAL_PROMPT: "0" },
    });
  } catch {
    return { ok: false, out: "" };
  }

  const timer = Bun.sleep(TIMEOUT_MS).then(() => {
    proc.kill();
    return "timeout" as const;
  });

  const winner = await Promise.race([
    Promise.all([new Response(proc.stdout).text(), proc.exited]),
    timer,
  ]);

  if (winner === "timeout") return { ok: false, out: "" };
  const [out, code] = winner;
  return { ok: code === 0, out: out.trim() };
};

const capLines = (text: string, max: number): string => {
  if (text === "") return "(none)";
  const lines = text.split("\n");
  if (lines.length <= max) return text;
  return `${lines.slice(0, max).join("\n")}\n... (${lines.length - max} more lines)`;
};

export const forgeOf = (remoteUrl: string): "github" | "gitlab" | "unknown" => {
  const lower = remoteUrl.toLowerCase();
  if (lower.includes("gitlab")) return "gitlab";
  if (lower.includes("github") || lower.includes(".ghe.")) return "github";
  return "unknown";
};

const firstResolvingBase = async (cwd: string): Promise<string | undefined> => {
  for (const candidate of BASES) {
    const check = await git(cwd, ["rev-parse", "--verify", "--quiet", `${candidate}^{commit}`]);
    if (check.ok) return candidate.replace(/^origin\//, "");
  }
  return undefined;
};

const isMainWorktree = (porcelain: string, toplevel: string): boolean => {
  const blocks = porcelain.trim().split(/\n\n+/);
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.some((l) => l === "bare")) continue;
    const wt = lines.find((l) => l.startsWith("worktree "))?.slice("worktree ".length);
    return wt === toplevel;
  }
  return false;
};

export const collectPreflight = async (directory: string): Promise<string | undefined> => {
  const [branchRun, topRun] = await Promise.all([
    git(directory, ["rev-parse", "--abbrev-ref", "HEAD"]),
    git(directory, ["rev-parse", "--show-toplevel"]),
  ]);
  if (!branchRun.ok || !topRun.ok) return undefined;

  const [remoteRun, gpgRun, statusRun, wtRun, base] = await Promise.all([
    git(directory, ["remote", "get-url", "origin"]),
    git(directory, ["config", "--bool", "--get", "commit.gpgsign"]),
    git(directory, ["status", "--short", "--branch"]),
    git(directory, ["worktree", "list", "--porcelain"]),
    firstResolvingBase(directory),
  ]);

  const compareRef = base ?? "HEAD";
  const [commitsRun, branchDiffRun, worktreeDiffRun] = await Promise.all([
    base === undefined
      ? Promise.resolve({ ok: true, out: "" })
      : git(directory, ["log", "--oneline", `${compareRef}...HEAD`]),
    base === undefined
      ? Promise.resolve({ ok: true, out: "" })
      : git(directory, ["diff", `${compareRef}...HEAD`, "--stat"]),
    git(directory, ["diff", "HEAD", "--stat"]),
  ]);

  const forge = remoteRun.ok ? forgeOf(remoteRun.out) : "unknown";
  const gpgsign = gpgRun.ok && gpgRun.out === "true";
  const mainCheckout = wtRun.ok ? isMainWorktree(wtRun.out, topRun.out) : false;
  const ripwire = Bun.which("ripwire") !== null ? "installed" : "absent";

  return [
    "<pr-preflight>",
    `directory: ${topRun.out}`,
    `branch: ${branchRun.out}`,
    `main-worktree: ${mainCheckout}`,
    `base: ${base ?? "unresolved"}`,
    `forge: ${forge}`,
    `gpgsign: ${gpgsign}`,
    `ripwire: ${ripwire}`,
    "status:",
    capLines(statusRun.out, 40),
    "commits-ahead:",
    capLines(commitsRun.out, 25),
    "branch-diff-stat:",
    capLines(branchDiffRun.out, 35),
    "uncommitted-diff-stat:",
    capLines(worktreeDiffRun.out, 35),
    "</pr-preflight>",
  ].join("\n");
};
