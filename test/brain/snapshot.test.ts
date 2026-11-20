import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { snapshot } from "../../tools/definitions/brain";
import { ledger } from "../../tools/definitions/brain/ledger";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("brain-snapshot");

const git = (root: string, args: ReadonlyArray<string>): void => {
  const done = Bun.spawnSync({
    cmd: ["git", "-C", root, "-c", "user.email=worker@spectre", "-c", "user.name=worker", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!done.success) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
};

describe("brain snapshot", () => {
  test("reads markdown bodies, computes cortex membership, latent file bridges, and fork anomalies", async () => {
    const dir = temp();
    await Bun.write(`${dir}/src/shared.ts`, "export const a = 1;\n");
    await Bun.write(`${dir}/src/other.ts`, "export const b = 2;\n");
    git(dir, ["init", "-q"]);
    git(dir, ["add", "src/shared.ts", "src/other.ts"]);
    git(dir, ["commit", "-q", "-m", "init"]);

    const book = ledger(AbsolutePath.make(dir));
    const root = await Effect.runPromise(
      book.mint({
        kind: "constraint",
        claim: "Original constraint v1.",
        subject: ["src/shared.ts"],
      }),
    );
    const branchA = await Effect.runPromise(
      book.mint({
        kind: "constraint",
        claim: "Forked constraint A.",
        subject: ["src/shared.ts"],
        body: "- Point one\n- Point two",
      }),
    );
    const branchB = await Effect.runPromise(
      book.mint({
        kind: "constraint",
        claim: "Forked constraint B.",
        subject: ["src/shared.ts", "src/other.ts"],
      }),
    );
    const peer = await Effect.runPromise(
      book.mint({
        kind: "gotcha",
        claim: "Unwired peer touching other.",
        subject: ["src/other.ts"],
      }),
    );

    await Effect.runPromise(
      book.append({
        kind: "supersedes",
        from: root.id,
        to: branchA.id,
        why: "split A",
        at: "2026-10-10T00:00:00.000Z",
        until: null,
      }),
    );
    await Effect.runPromise(
      book.append({
        kind: "supersedes",
        from: root.id,
        to: branchB.id,
        why: "split B",
        at: "2026-10-11T00:00:00.000Z",
        until: null,
      }),
    );

    const snap = await Effect.runPromise(snapshot(dir));
    expect(snap.totals.total).toBe(4);
    expect(snap.totals.active).toBe(3);
    expect(snap.totals.superseded).toBe(1);

    const nodeA = snap.neurons.find((one) => one.id === branchA.id);
    expect(nodeA?.body).toBe("- Point one\n- Point two");
    expect(nodeA?.inCortex).toBe(true);

    expect(snap.latentBridges.some((b) =>
      (b.from === branchB.id && b.to === peer.id) || (b.from === peer.id && b.to === branchB.id),
    )).toBe(true);

    expect(snap.anomalies.some((a) => a.kind === "supersedes-fork" && a.neuronIds.includes(branchA.id))).toBe(true);
  });
});
