import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { historyTool } from "../../tools/definitions/history";

/**
 * `ownership` reads a file's whole history, and the numbers it reports are the
 * defect literature's predictor, so the computation must be exact. A scratch
 * repository with a known author mix is the only fixture that can pin it: the
 * repo's own files change owners as the project moves.
 */

const scratch = async (): Promise<string> => {
  const base = `${process.env.TMPDIR ?? "/tmp"}opencode`;
  const dir = `${base}/history-test-${Math.random().toString(36).slice(2)}`;
  await Bun.$`mkdir -p ${dir}`.quiet();
  await Bun.$`git init -q -b main`.cwd(dir);
  await Bun.$`git config user.email test@example.com`.cwd(dir).quiet();
  await Bun.$`git config user.name Test`.cwd(dir).quiet();
  return dir;
};

const commit = async (
  dir: string,
  file: string,
  author: string,
  message: string,
): Promise<void> => {
  await Bun.$`sh -c 'echo ${"line " + Math.random()} >> ${file}'`.cwd(dir).quiet();
  await Bun.$`git add ${file}`.cwd(dir).quiet();
  await Bun.$`git commit -q --author=${author} -m ${message}`.cwd(dir).quiet();
};

const call = async (
  dir: string,
  input: Parameters<ReturnType<typeof historyTool>["execute"]>[0],
) => {
  const tool = historyTool(dir);
  const result = await Effect.runPromise(
    tool.execute(input, {
      sessionID: "ses_test" as never,
      agent: "build" as never,
      messageID: "msg_test" as never,
      id: "call_test" as never,
      progress: () => Effect.void,
    } as never),
  );
  if (result.output === undefined) throw new Error("the tool returned no output");
  return result.output;
};

describe("ownership", () => {
  test("counts the whole history, not the window the caller saw", async () => {
    const dir = await scratch();
    const ada = "Ada Lovelace <ada@example.com>";
    const bo = "Bo Tenant <bo@example.com>";
    for (let n = 0; n < 20; n++) await commit(dir, "notes.md", ada, `ada ${n}`);
    await commit(dir, "notes.md", bo, "bo once");
    const out = await call(dir, { path: "notes.md" });
    if (!("ownership" in out) || out.found !== true) throw new Error("unexpected output");
    expect(out.ownership).toEqual({
      commits: 21,
      authors: 2,
      major: { author: "Ada Lovelace", commits: 20, share: 20 / 21 },
      minor: 1,
    });
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("authors on the surface stays a window, and ownership does not", async () => {
    const dir = await scratch();
    const ada = "Ada Lovelace <ada@example.com>";
    const bo = "Bo Tenant <bo@example.com>";
    for (let n = 0; n < 20; n++) await commit(dir, "notes.md", ada, `ada ${n}`);
    await commit(dir, "notes.md", bo, "bo once");
    const out = await call(dir, { path: "notes.md", limit: 1 });
    if (!("ownership" in out) || out.found !== true) throw new Error("unexpected output");
    expect(out.authors).toEqual(["Bo Tenant"]);
    expect(out.ownership?.authors).toBe(2);
    await Bun.$`rm -rf ${dir}`.quiet();
  });

  test("an untracked path carries no ownership", async () => {
    const out = await call(process.cwd(), { path: "no-such-file.ts" });
    expect(out.found).toBe(false);
    expect(out.ownership).toBeUndefined();
  });
});
