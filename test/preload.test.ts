import { describe, expect, test } from "bun:test";
import { useTempDirs } from "./fixture";

const temp = useTempDirs("preload-gpg");

const configBool = (cwd: string, key: string): string => {
  const done = Bun.spawnSync(["git", "config", "--bool", key], {
    cwd,
    stdout: "pipe",
    stderr: "pipe",
    env: Bun.env,
  });
  if (!done.success) {
    throw new Error(
      `git config --bool ${key} exited ${done.exitCode}: ${done.stderr.toString().trim()}`,
    );
  }
  return done.stdout.toString().trim();
};

describe("test preload git gpg isolation", () => {
  test("disables commit.gpgsign and tag.gpgsign in temporary git repos", async () => {
    const dir = temp();
    await Bun.$`mkdir -p ${dir}`.quiet();
    const init = Bun.spawnSync(["git", "init", "-q"], { cwd: dir, stdout: "pipe", stderr: "pipe" });
    if (!init.success) throw new Error(`git init failed: ${init.stderr.toString()}`);

    expect(configBool(dir, "commit.gpgsign")).toBe("false");
    expect(configBool(dir, "tag.gpgsign")).toBe("false");

    const localOverride = Bun.spawnSync(["git", "config", "commit.gpgsign", "true"], {
      cwd: dir,
      stdout: "pipe",
      stderr: "pipe",
      env: Bun.env,
    });
    if (!localOverride.success) {
      throw new Error(`git config override failed: ${localOverride.stderr.toString()}`);
    }
    expect(configBool(dir, "commit.gpgsign")).toBe("true");
  });

  test("strips GIT_DIR, GIT_WORK_TREE, GIT_INDEX_FILE, and GIT_COMMON_DIR", () => {
    for (const key of ["GIT_DIR", "GIT_WORK_TREE", "GIT_INDEX_FILE", "GIT_COMMON_DIR"] as const) {
      expect(Bun.env[key]).toBeUndefined();
      expect(process.env[key]).toBeUndefined();
    }

    const done = Bun.spawnSync(
      [
        "bun",
        "-e",
        'import "./test/preload"; console.log(JSON.stringify({ dir: Bun.env.GIT_DIR ?? null, workTree: Bun.env.GIT_WORK_TREE ?? null, index: Bun.env.GIT_INDEX_FILE ?? null, common: Bun.env.GIT_COMMON_DIR ?? null }))',
      ],
      {
        stdout: "pipe",
        stderr: "pipe",
        env: {
          ...Bun.env,
          GIT_DIR: "/fake/.git",
          GIT_WORK_TREE: "/fake",
          GIT_INDEX_FILE: "/fake/.git/index",
          GIT_COMMON_DIR: "/fake/.git",
        },
      },
    );
    if (!done.success) {
      throw new Error(`preload subprocess failed: ${done.stderr.toString().trim()}`);
    }
    expect(JSON.parse(done.stdout.toString().trim())).toEqual({
      dir: null,
      workTree: null,
      index: null,
      common: null,
    });
  });
});
