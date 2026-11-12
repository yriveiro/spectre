const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

export const git = async (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

export const toplevel = async (path: string) => {
  const found = await git(path, ["rev-parse", "--path-format=absolute", "--show-toplevel"]);
  return found.out;
};

/**
 * The repository's own shape, plus the three places a goal must refuse:
 * a linked worktree on the trunk, a detached worktree, and the bare repository.
 */
export const layout = async () => {
  const base = `${TMP}/spectre-goal-${process.pid}-${seq++}`;
  roots.push(base);
  const bare = `${base}/spectre`;
  const main = `${base}/spectre-worktrees/main`;
  const feature = `${base}/spectre-worktrees/feat`;
  const detached = `${base}/spectre-worktrees/detached`;

  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "--bare", bare]);
  await git(base, ["clone", "-q", bare, `${base}/seed`]);
  await Bun.write(`${base}/seed/a.txt`, "one\n");
  await git(`${base}/seed`, ["add", "."]);
  await git(`${base}/seed`, [
    "-c",
    "user.email=t@t",
    "-c",
    "user.name=t",
    "commit",
    "-q",
    "-m",
    "first",
  ]);
  await git(`${base}/seed`, ["push", "-q", bare, "HEAD:refs/heads/main"]);
  await git(bare, ["worktree", "add", "-q", main, "main"]);
  await git(bare, ["worktree", "add", "-q", "-b", "feat", feature]);
  await git(bare, ["worktree", "add", "-q", "--detach", detached, "main"]);
  await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

  // Git's spelling, not the shell's. On macOS TMPDIR is `/var/...` and git
  // reports `/private/var/...`; the tool returns what git printed.
  return {
    base,
    bare,
    main: await toplevel(main),
    feature: await toplevel(feature),
    detached: await toplevel(detached),
  };
};

export const normal = async () => {
  const base = `${TMP}/spectre-goal-normal-${process.pid}-${seq++}`;
  roots.push(base);
  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q"]);
  await Bun.write(`${base}/a.txt`, "one\n");
  await git(base, ["add", "."]);
  await git(base, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first"]);
  return { base, root: await toplevel(base) };
};

export const cleanup = async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
};
