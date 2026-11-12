import { afterAll, describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import type { Goal } from "@opencode/schema/goal";
import { Effect } from "effect";
import { goal } from "../../tools/definitions/goal";
import { compose, parseContract } from "../../tools/definitions/goal/contract";
import { cleanup, layout, normal } from "./fixture";

afterAll(cleanup);

const raw = {
  action: "arm" as const,
  objective: "Make the retry queue pass its tests",
  predicate: "bun test returns zero failures",
  check: "bun test",
};

const fake = (directory: string, parentID?: string, failAfterWrite = false) => {
  const state: {
    goal: Goal.State | null;
    commands: Array<{ sessionID: string; name: string; text: string }>;
  } = { goal: null, commands: [] };

  const ctx = {
    location: { project: { id: "test", directory }, directory },
    session: {
      get: () =>
        Effect.succeed({
          parentID,
          location: { directory },
        }),
      command: (input: { sessionID: string; name: string; text: string }) =>
        Effect.gen(function* () {
          state.commands.push(input);
          state.goal = {
            id: "goal-1",
            objective: input.text,
            status: "active",
            rounds: 0,
            maxRounds: 50,
            boot: "boot",
            updatedAt: 0,
          };
          if (failAfterWrite) return yield* Effect.fail(new Error("kickoff failed"));
        }),
    },
    rpc: Object.assign(() => ({ get: () => Effect.succeed(state.goal) }), {
      register: () => Effect.die("unused"),
    }),
  } as unknown as Plugin.Context;

  return { ctx, state };
};

type Outcome =
  | {
      readonly status: "armed";
      readonly goal: { id: string; objective: string };
      readonly ledger: string;
      readonly problems?: string;
    }
  | {
      readonly status: "read";
      readonly goal: { id: string; status: string; rounds: number } | null;
      readonly remaining: number | null;
      readonly ledger: string;
      readonly ledgerExists: boolean;
    }
  | { readonly status: "rejected"; readonly problems: string }
  | { readonly status: "failed"; readonly problems: string };

const run = async (ctx: Plugin.Context, input: unknown) => {
  const result = await Effect.runPromise(
    goal(ctx).execute(input as never, { sessionID: "ses_goal" } as never),
  );
  return result.output as Outcome;
};

const composed = (feature: string) => {
  const contract = parseContract(raw);
  if (!contract.ok) throw new Error(contract.problems.join("\n"));
  const text = compose(contract.value, { kind: "feature", directory: feature, branch: "feat" });
  if (!text.ok) throw new Error(text.problems.join("\n"));
  return text.value;
};

describe("arming a goal", () => {
  test("a feature worktree arms the built-in command and writes the ledger", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("armed");
    expect(state.commands).toHaveLength(1);
    expect(state.commands[0]?.name).toBe("goal");
    expect(state.commands[0]?.text).toContain("bun test");
    if (outcome.status === "armed") {
      expect(outcome.goal.objective).toBe(composed(feature));
      expect(await Bun.file(outcome.ledger).exists()).toBe(true);
      expect(await Bun.file(outcome.ledger).text()).toContain("## Goal goal-1");
    }
  });

  test("the read-back is the gate: a command that does not change state is a failure", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);
    // A shadowed `goal` command returns without writing state.
    (ctx.session as unknown as { command: unknown }).command = () => Effect.void;

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("failed");
    if (outcome.status === "failed") expect(outcome.problems).toContain("did not read back");
    expect(state.commands).toHaveLength(0);
  });

  test("a different active goal is refused", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);
    state.goal = {
      id: "other",
      objective: "something else",
      status: "active",
      rounds: 0,
      maxRounds: 50,
      boot: "boot",
      updatedAt: 0,
    };

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected")
      expect(outcome.problems).toContain("different goal is active");
    expect(state.commands).toHaveLength(0);
  });

  test("the same active objective is idempotent and writes no second section", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);

    const first = await run(ctx, raw);
    expect(first.status).toBe("armed");
    expect(state.commands).toHaveLength(1);

    const second = await run(ctx, raw);

    expect(second.status).toBe("armed");
    expect(state.commands).toHaveLength(1);
    if (second.status === "armed") {
      const ledger = await Bun.file(second.ledger).text();
      expect(ledger.match(/## Goal goal-1/g)).toHaveLength(1);
    }
  });

  test("a command that fails after writing still reports the live goal", async () => {
    const { feature } = await layout();
    const { ctx } = fake(feature, undefined, true);

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("armed");
    if (outcome.status === "armed")
      expect(outcome.problems).toContain("after the goal was written");
  });

  test("a failed ledger header still returns armed with problems", async () => {
    const { feature } = await layout();
    await Bun.write(`${feature}/.spectre`, "not a directory");
    const { ctx } = fake(feature);

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("armed");
    if (outcome.status === "armed")
      expect(outcome.problems).toContain("ledger header could not be written");
  });

  test("a paused goal is refused, not overwritten", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);
    state.goal = {
      id: "goal-1",
      objective: "paused work",
      status: "paused",
      rounds: 1,
      maxRounds: 50,
      boot: "boot",
      updatedAt: 0,
    };

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.problems).toContain("paused goal");
  });

  test("the main worktree is refused before the host command is called", async () => {
    const { root } = await normal();
    const { ctx, state } = fake(root);

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.problems).toContain("main worktree");
    expect(state.commands).toHaveLength(0);
  });

  test("a child session cannot arm a goal", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature, "ses_parent");

    const outcome = await run(ctx, raw);

    expect(outcome.status).toBe("rejected");
    if (outcome.status === "rejected") expect(outcome.problems).toContain("child session");
    expect(state.commands).toHaveLength(0);
  });
});

describe("reading the goal", () => {
  test("status reads no goal and the ledger path", async () => {
    const { feature } = await layout();
    const { ctx } = fake(feature);

    const outcome = await run(ctx, { action: "status" });

    expect(outcome.status).toBe("read");
    if (outcome.status === "read") {
      expect(outcome.goal).toBeNull();
      expect(outcome.remaining).toBeNull();
      expect(outcome.ledger).toBe(`${feature}/.spectre/run.md`);
      expect(outcome.ledgerExists).toBe(false);
    }
  });

  test("status reads the active goal and the remaining rounds", async () => {
    const { feature } = await layout();
    const { ctx, state } = fake(feature);
    state.goal = {
      id: "goal-1",
      objective: "active work",
      status: "active",
      rounds: 5,
      maxRounds: 50,
      boot: "boot",
      updatedAt: 0,
    };

    const outcome = await run(ctx, { action: "status" });

    expect(outcome.status).toBe("read");
    if (outcome.status === "read") {
      expect(outcome.goal?.id).toBe("goal-1");
      expect(outcome.goal?.status).toBe("active");
      expect(outcome.remaining).toBe(45);
    }
  });
});
