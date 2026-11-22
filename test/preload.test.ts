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
});
