import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { brain } from "../../tools/definitions/brain";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const git = async (cwd: string, ...args: ReadonlyArray<string>): Promise<void> => {
  const proc = Bun.spawn(
    ["git", "-c", "commit.gpgsign=false", "-c", "tag.gpgsign=false", ...args],
    {
      cwd,
      stdout: "pipe",
      stderr: "pipe",
    },
  );
  const code = await proc.exited;
  if (code !== 0) {
    const stderr = await new Response(proc.stderr).text();
    throw new Error(`git ${args.join(" ")} failed: ${stderr}`);
  }
};

const setupProject = async (): Promise<string> => {
  const dir = `${TMP}/spectre-brain-status-${process.pid}-${seq++}`;
  roots.push(dir);
  await Bun.write(join(dir, "src", "alpha.ts"), "export const alpha = 1;\n");
  await Bun.write(join(dir, "src", "beta.ts"), "export const beta = 2;\n");
  await git(dir, "init");
  await git(dir, "config", "user.name", "Test");
  await git(dir, "config", "user.email", "test@local");
  await git(dir, "add", ".");
  await git(dir, "commit", "-m", "init");
  return dir;
};

const makeContext = (directory: string): Plugin.Context =>
  ({
    location: {
      directory,
      project: { id: "proj_test", directory, canonical: directory },
    },
  }) as unknown as Plugin.Context;

const callContext = (): Tool.Context =>
  ({
    sessionID: "ses_status_test",
    agent: "spectre",
    messageID: "msg_status_test",
    id: "call_status_test",
    progress: () => Effect.void,
  }) as unknown as Tool.Context;

describe("tools.spectre.brain status", () => {
  test("returns zeroed totals on an empty brain", async () => {
    const dir = await setupProject();
    const tool = brain(makeContext(dir));
    const res = await Effect.runPromise(tool.execute({ action: "status" }, callContext()));
    expect(res.output?.status).toBe("status");
    if (res.output?.status !== "status") throw new Error("expected status");
    expect(res.output.totals).toEqual({
      total: 0,
      active: 0,
      superseded: 0,
      demoted: 0,
      edges: 0,
      isolatedActive: 0,
      subjects: 0,
      missingSubjects: 0,
    });
    expect(res.output.cortex).toEqual({
      shown: 0,
      total: 0,
      usedTokens: 0,
      cap: 600,
    });
    expect(res.output.anomalies).toEqual([]);
    expect(res.output.latentBridges).toEqual([]);
  });

  test("reports active neurons, cortex window usage, latent bridges, and anomalies", async () => {
    const dir = await setupProject();
    const tool = brain(makeContext(dir));

    const first = await Effect.runPromise(
      tool.execute(
        {
          action: "assert",
          kind: "gotcha",
          subject: ["src/alpha.ts"],
          claim: "Alpha module requires explicit initialization before use.",
        },
        callContext(),
      ),
    );
    if (first.output?.status !== "asserted") throw new Error("expected asserted");

    const second = await Effect.runPromise(
      tool.execute(
        {
          action: "assert",
          kind: "feature",
          subject: ["src/alpha.ts", "src/beta.ts"],
          claim: "Beta module depends on alpha initialization.",
        },
        callContext(),
      ),
    );
    if (second.output?.status !== "asserted") throw new Error("expected asserted");

    const res = await Effect.runPromise(tool.execute({ action: "status" }, callContext()));
    expect(res.output?.status).toBe("status");
    if (res.output?.status !== "status") throw new Error("expected status");

    expect(res.output.totals.total).toBe(2);
    expect(res.output.totals.active).toBe(2);
    expect(res.output.totals.isolatedActive).toBe(2);
    expect(res.output.totals.subjects).toBe(2);
    expect(res.output.cortex.shown).toBe(2);
    expect(res.output.cortex.total).toBe(2);
    expect(res.output.cortex.cap).toBe(600);
    expect(res.output.cortex.usedTokens).toBeGreaterThan(0);
    expect(res.output.latentBridges).toEqual([
      {
        from: first.output.id,
        to: second.output.id,
        shared: ["src/alpha.ts"],
      },
    ]);
    expect(res.output.anomalies).toEqual([]);
  });
});

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});
