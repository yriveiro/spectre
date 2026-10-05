import { afterAll, describe, expect, test } from "bun:test";
import { existsSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { worktrees } from "../../tools/definitions/worktrees";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const context = { progress: () => Effect.void } as unknown as Tool.Context;

const git = async (cwd: string, args: ReadonlyArray<string>) => {
  const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "pipe" });
  const [out, err, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { out: out.trim(), err: err.trim(), code };
};

/**
 * This project's own shape: a bare repository, with `main` and its siblings cut from
 * it. The bare entry is what the host used to be handed, because the tool passed no
 * `from` and the host fell back to the project row.
 */
const bareLayout = async () => {
  const base = `${TMP}/spectre-start-${process.pid}-${seq++}`;
  roots.push(base);
  const bare = `${base}/spectre`;
  const main = `${base}/spectre-worktrees/main`;

  await Bun.write(`${base}/.keep`, "");
  await git(base, ["init", "-q", "--bare", bare]);
  await git(base, ["clone", "-q", bare, `${base}/seed`]);
  await Bun.write(`${base}/seed/a.txt`, "one\n");
  await git(`${base}/seed`, ["add", "."]);
  await git(`${base}/seed`, ["-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "first"]);
  await git(`${base}/seed`, ["push", "-q", bare, "HEAD:refs/heads/main"]);
  await git(bare, ["worktree", "add", "-q", main, "main"]);
  await git(main, ["update-ref", "refs/remotes/origin/main", "HEAD"]);
  await Bun.$`rm -rf ${`${base}/seed`}`.quiet();

  // `base` as the shell spells it, and as git reports it. On macOS TMPDIR is
  // `/var/...` and git resolves that to `/private/var/...`, and the tool builds its
  // root from git's own paths, so the guard below has to compare resolved spellings.
  return { base, resolved: realpathSync(base), bare, main };
};

/**
 * The host's discovery step at v2.0.23 (`packages/core/src/git.ts`): walk up from the
 * source directory for a `.git` entry, then `rev-parse` in its parent. A bare
 * repository has no `.git`, so the walk leaves the repository and the parse fails.
 * Reproduced here rather than stubbed, because the whole point is which directory the
 * tool hands over.
 */
const discover = (start: string) => {
  let at = start;
  while (true) {
    if (existsSync(join(at, ".git"))) return at;
    const up = dirname(at);
    if (up === at) return undefined;
    at = up;
  }
};

type CreateInput = {
  readonly from?: string;
  readonly directory: string;
  readonly name?: string;
  readonly branch?: string;
};

/**
 * The host's create, with the fallback it applies when `from` is absent
 * (`packages/core/src/worktree.ts` at v2.0.23: `input.from ?? row.worktree`). The
 * project row for a bare-backed project is the bare repository, so a tool that omits
 * `from` gets the failure this file exists to catch.
 */
const host = (projectRow: string, inside: string, options: { blind?: boolean } = {}) => {
  const asked: Array<CreateInput> = [];
  const create = (input: CreateInput) =>
    Effect.suspend(() => {
      asked.push(input);
      // `blind` drops `from` the way the tool did before it passed one, so the
      // failure being fixed is exercised rather than described.
      const source = options.blind === true ? projectRow : (input.from ?? projectRow);
      const found = discover(source);
      if (found === undefined)
        return Effect.fail({
          _tag: "Worktree.DirectoryUnavailableError",
          directory: AbsolutePath.make(source),
        });

      const at = join(input.directory, input.name ?? "unnamed");
      // The tool hands this path straight back to `attachBranch`, which spawns git
      // with it as a cwd. A fake that returned the wrong directory once made this
      // suite create a branch in the repository it was run from, so the path is
      // checked here rather than trusted.
      if (!at.startsWith(`${inside}/`))
        return Effect.fail({
          _tag: "Worktree.OperationError",
          message: `refusing to create ${at}: outside the fixture ${inside}`,
          directory: AbsolutePath.make(at),
        });

      return Effect.promise(async () => {
        const added = await git(found, [
          "worktree",
          "add",
          "--detach",
          "-q",
          at,
          input.branch ?? "HEAD",
        ]);
        return added.code === 0 ? { directory: AbsolutePath.make(at) } : undefined;
      }).pipe(
        Effect.flatMap((made) =>
          made === undefined
            ? Effect.fail({
                _tag: "Worktree.OperationError",
                message: "git worktree add failed",
                directory: AbsolutePath.make(at),
              })
            : Effect.succeed(made),
        ),
      );
    });

  const moved: Array<string> = [];

  return {
    asked,
    create,
    moved,
    context: (sessionDirectory: string) =>
      ({
        location: {
          project: {
            id: "test",
            directory: AbsolutePath.make(projectRow),
            canonical: AbsolutePath.make(projectRow),
          },
        },
        session: {
          get: () => Effect.succeed({ location: { directory: sessionDirectory } }),
          move: ({ directory }: { directory: string }) =>
            Effect.sync(() => {
              moved.push(directory);
              return {};
            }),
        },
        worktree: { create },
      }) as unknown as Plugin.Context,
  };
};

type Outcome =
  | { readonly status: "opened"; readonly directory: string; readonly branch: string; readonly head: string }
  | {
      readonly status: "unverified" | "rejected" | "failed" | "removed" | "already-gone";
      readonly problems: string;
    };

const start = async (fake: ReturnType<typeof host>, sessionDirectory: string, name: string) => {
  const result = await Effect.runPromise(
    worktrees(fake.context(sessionDirectory)).execute(
      { action: "start", name },
      { ...context, sessionID: "test" as never },
    ),
  );
  return result.output as Outcome;
};

afterAll(async () => {
  for (const one of roots) await Bun.$`rm -rf ${one}`.quiet();
});

describe("start against a bare repository", () => {
  test("it hands the host a source the host can find a repository in", async () => {
    const { resolved, bare, main } = await bareLayout();
    const fake = host(bare, resolved);

    const outcome = await start(fake, main, "fix-login");

    expect(fake.asked.length).toBe(1);
    // The oracle is the host's own command, not a spelling of the path: this is the
    // `rev-parse` `discover` runs once it has walked up to a `.git`.
    const asked = fake.asked[0]!;
    const probe = await git(asked.from!, ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"]);
    expect(probe.code).toBe(0);
    expect(outcome.status).toBe("opened");
  });

  test("the bare repository is the one directory the host cannot use", async () => {
    const { resolved, bare, main } = await bareLayout();
    const fake = host(bare, resolved);
    await start(fake, main, "fix-login");

    // Without this, the first test would also pass against a tool that handed over
    // something useless, because the fixture's own discovery is never consulted.
    expect(discover(bare)).toBeUndefined();
    const fromBare = await git(bare, ["rev-parse", "--git-dir", "--git-common-dir", "--show-toplevel"]);
    expect(fromBare.code).not.toBe(0);
  });

  test("the worktree it opens is on the branch it was asked for", async () => {
    const { resolved, bare, main } = await bareLayout();
    const fake = host(bare, resolved);

    const outcome = await start(fake, main, "fix-login");

    if (outcome.status !== "opened") throw new Error(`expected opened, got ${outcome.problems}`);
    const branch = await git(outcome.directory, ["rev-parse", "--abbrev-ref", "HEAD"]);
    expect(branch.out).toBe("fix-login");
    expect(fake.moved).toEqual([outcome.directory]);
  });

  test("it refuses the same call when the project row is the bare repository and no source is named", async () => {
    const { resolved, bare, main } = await bareLayout();
    const named = await start(host(bare, resolved), main, "with-from");
    expect(named.status).toBe("opened");

    // The regression this fixes, run as its own case: a host that gets the project
    // row and no `from` cannot find a repository, so the start cannot be opened.
    const blind = await start(host(bare, resolved, { blind: true }), main, "without-from");
    expect(blind.status).toBe("failed");
  });
});
