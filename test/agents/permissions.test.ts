import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { agentIds, update } from "../../agents";

type Rule = { action: string; resource: string; effect: string };
type Agent = { id: string; permissions: Rule[] } & Record<string, unknown>;

const HOME = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
const ROOT = `${HOME}/.local/share/spectre`;
const BRAIN = ".spectre/brain/*";

/** Mirrors `Agent.State`'s editor at v2.0.26: `get(id) ?? fresh`, then the mutation runs. */
const register = async (): Promise<Map<string, Agent>> => {
  const agents = new Map<string, Agent>();
  const ctx = {
    agent: {
      transform: (callback: (editor: unknown) => void) =>
        Effect.sync(() => {
          callback({
            update: (id: string, mutate: (agent: Agent) => void) => {
              const agent = agents.get(id) ?? { id, permissions: [] };
              mutate(agent);
              agents.set(id, agent);
            },
          });
          return { dispose: Effect.void };
        }),
    },
  } as unknown as Pick<Plugin.Context, "agent">;

  await Effect.runPromise(Effect.scoped(update(ctx)));
  return agents;
};

describe("data root permissions", () => {
  test("every registered agent gets external_directory, read and edit on the data root", async () => {
    const agents = await register();
    expect([...agents.keys()].toSorted()).toEqual([...agentIds].toSorted());

    for (const id of agentIds) {
      const rules = agents.get(id)?.permissions ?? [];
      expect(rules.slice(0, 3)).toEqual([
        { action: "external_directory", resource: `${ROOT}/*`, effect: "allow" },
        { action: "read", resource: `${ROOT}/*`, effect: "allow" },
        { action: "edit", resource: `${ROOT}/*`, effect: "allow" },
      ]);
    }
  });

  test("only mnemonic may write the brain, and the allow lands after the deny", async () => {
    const agents = await register();
    const brain = (id: string) =>
      (agents.get(id)?.permissions ?? []).filter((rule) => rule.resource === BRAIN);

    for (const id of agentIds.filter((one) => one !== "mnemonic"))
      expect(brain(id)).toEqual([{ action: "edit", resource: BRAIN, effect: "deny" }]);

    expect(brain("mnemonic")).toEqual([
      { action: "edit", resource: BRAIN, effect: "deny" },
      { action: "edit", resource: BRAIN, effect: "allow" },
    ]);

    // The matcher takes the last rule that matches, so an allow before the deny
    // would be dead. Order is the whole mechanism, not a formatting detail.
    for (const id of agentIds)
      expect((agents.get(id)?.permissions ?? []).some((rule) => rule.resource === BRAIN && rule.effect === "allow")).toBe(
        id === "mnemonic",
      );
  });

  test("the brain glob is project-relative, because a project file's resource is too", async () => {
    const agents = await register();
    for (const id of agentIds)
      for (const rule of agents.get(id)?.permissions ?? [])
        if (rule.resource === BRAIN) expect(rule.resource).not.toMatch(/^\//);
  });

  test("a subagent gets them too, because it never inherits the parent's", async () => {
    const agents = await register();
    const subagent = agents.get("sicko");
    expect(subagent?.permissions.some((rule) => rule.resource.startsWith(ROOT))).toBe(true);
  });

  test("no rule names a home-relative path, which the config loader expands and a plugin does not", async () => {
    const agents = await register();
    for (const agent of agents.values())
      for (const rule of agent.permissions) expect(rule.resource).not.toContain("~");
  });

  test("bash is not ruled on, because its resource is shell text and no path pattern matches it", async () => {
    const agents = await register();
    for (const agent of agents.values())
      for (const rule of agent.permissions) expect(rule.action).not.toBe("bash");
  });

  test("the rule is a prefix of the resource OpenCode requests for a candidate directory", async () => {
    const agents = await register();
    // The exact string `FileAccess.resolve` builds: the resolved directory, then "/*".
    const requested = `${ROOT}/main/arenas/playbook-tools/seat-1/*`;
    const rules = agents.get("spectre")?.permissions ?? [];
    expect(rules.some((rule) => requested.startsWith(rule.resource.slice(0, -1)))).toBe(true);
  });
});
