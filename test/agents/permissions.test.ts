import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { agentIds, update } from "../../agents";

type Rule = { action: string; resource: string; effect: string };
type Agent = { id: string; permissions: Rule[] } & Record<string, unknown>;

const HOME = Bun.env.HOME ?? Bun.env.USERPROFILE ?? "";
const ROOT = `${HOME}/.local/share/spectre`;

/** Mirrors `Agent.State`'s editor at v2.0.21: `get(id) ?? fresh`, then the mutation runs. */
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
      expect(rules).toEqual([
        { action: "external_directory", resource: `${ROOT}/*`, effect: "allow" },
        { action: "read", resource: `${ROOT}/*`, effect: "allow" },
        { action: "edit", resource: `${ROOT}/*`, effect: "allow" },
      ]);
    }
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
