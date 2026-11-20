import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { brain } from "../../tools/definitions/brain";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("brain-tool");

const git = (root: string, args: ReadonlyArray<string>): void => {
  const done = Bun.spawnSync({
    cmd: ["git", "-C", root, "-c", "user.email=worker@spectre", "-c", "user.name=worker", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!done.success) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
};

const setup = async () => {
  const directory = temp();
  await Bun.write(`${directory}/src/feature.ts`, "export const ok = 1;\n");
  git(directory, ["init", "-q"]);
  git(directory, ["add", "src/feature.ts"]);
  git(directory, ["commit", "-q", "-m", "init"]);
  const ctx = {
    location: {
      directory,
      project: { id: "proj_brain", directory, canonical: directory },
    },
  } as never;
  const tool = brain(ctx);
  const call = async (input: Parameters<typeof tool.execute>[0]) => {
    const result = await Effect.runPromise(tool.execute(input, {} as never));
    if (result.output === undefined) throw new Error("missing tool output");
    return result.output;
  };
  return { directory, call };
};

describe("tools.spectre.brain end-to-end", () => {
  test("assert writes markdown body to disk while recall returns only the headline", async () => {
    const { call } = await setup();
    const asserted = await call({
      action: "assert",
      kind: "feature",
      subject: ["src/feature.ts"],
      claim: "Feature module owns the public entry.",
      body: "## Sub-points\n\n- Entry stays synchronous\n- Errors map at the boundary",
    });
    expect(asserted.status).toBe("asserted");
    if (asserted.status !== "asserted") return;

    const onDisk = await Bun.file(asserted.path).text();
    expect(onDisk).toContain("## Sub-points");
    expect(onDisk).toContain("- Entry stays synchronous");

    const recalled = await call({ action: "recall", query: "Feature module public entry" });
    expect(recalled.status).toBe("recalled");
    if (recalled.status !== "recalled") return;
    expect(recalled.claims.map((one) => one.claim)).toEqual(["Feature module owns the public entry."]);
  });

  test("demote hides a claim from recall until its window expires", async () => {
    const { call } = await setup();
    const asserted = await call({
      action: "assert",
      kind: "gotcha",
      subject: ["src/feature.ts"],
      claim: "Temporary upstream bug breaks batch mode.",
    });
    expect(asserted.status).toBe("asserted");
    if (asserted.status !== "asserted") return;

    const demoted = await call({
      action: "demote",
      id: asserted.id,
      why: "upstream patched",
      until: "2999-01-01T00:00:00.000Z",
    });
    expect(demoted.status).toBe("demoted");

    const hidden = await call({ action: "recall", query: "Temporary upstream bug batch" });
    expect(hidden.status).toBe("recalled");
    if (hidden.status === "recalled") expect(hidden.claims).toEqual([]);

    const expired = await setup();
    const second = await expired.call({
      action: "assert",
      kind: "gotcha",
      subject: ["src/feature.ts"],
      claim: "Expired demotion returns to recall.",
    });
    if (second.status !== "asserted") return;
    await expired.call({
      action: "demote",
      id: second.id,
      why: "briefly muted",
      until: "2020-01-01T00:00:00.000Z",
    });
    const restored = await expired.call({ action: "recall", query: "Expired demotion returns" });
    expect(restored.status).toBe("recalled");
    if (restored.status === "recalled")
      expect(restored.claims.map((one) => one.id)).toEqual([second.id]);
  });

  test("a 3-hop supersede chain returns the newest claim when querying the oldest headline", async () => {
    const { call } = await setup();
    const v1 = await call({
      action: "assert",
      kind: "constraint",
      subject: ["src/feature.ts"],
      claim: "Zebra legacy token rule v1.",
    });
    const v2 = await call({
      action: "assert",
      kind: "constraint",
      subject: ["src/feature.ts"],
      claim: "Session header rule v2.",
    });
    const v3 = await call({
      action: "assert",
      kind: "constraint",
      subject: ["src/feature.ts"],
      claim: "Cookie boundary rule v3.",
    });
    const v4 = await call({
      action: "assert",
      kind: "decision",
      subject: ["src/feature.ts"],
      claim: "Bearer rotation contract v4.",
    });
    if (
      v1.status !== "asserted" ||
      v2.status !== "asserted" ||
      v3.status !== "asserted" ||
      v4.status !== "asserted"
    )
      return;

    await call({ action: "supersede", from: v1.id, to: v2.id, why: "moved to header" });
    await call({ action: "supersede", from: v2.id, to: v3.id, why: "moved to cookie" });
    await call({ action: "supersede", from: v3.id, to: v4.id, why: "settled on bearer" });

    const recalled = await call({ action: "recall", query: "Zebra legacy token" });
    expect(recalled.status).toBe("recalled");
    if (recalled.status === "recalled") {
      expect(recalled.claims.map((one) => one.id)).toEqual([v4.id]);
    }
  });
});
