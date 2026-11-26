import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { buildLiveEnv, hasModel, waitForLiveModel } from "../../resume/live";
import { isolatedServerEnv, trialServerEnv } from "../runner";

describe("live ablation database isolation (OPENCODE_DB)", () => {
  test("isolatedServerEnv strips inherited OPENCODE_DB while preserving host auth vars", () => {
    const baseEnv: Record<string, string | undefined> = {
      HOME: "/Users/tester",
      XDG_DATA_HOME: "/Users/tester/.local/share",
      ANTHROPIC_API_KEY: "secret-key",
      OPENCODE_DB: "/Users/tester/.local/share/opencode/opencode.db",
      OPENCODE_CONFIG: "/Users/tester/custom.json",
    };

    const env = buildLiveEnv({
      configDir: "/tmp/cfg",
      password: "pw",
      env: isolatedServerEnv(),
      baseEnv,
    });

    expect("OPENCODE_DB" in env).toBe(false);
    expect("OPENCODE_CONFIG" in env).toBe(false);
    expect(env.HOME).toBe("/Users/tester");
    expect(env.XDG_DATA_HOME).toBe("/Users/tester/.local/share");
    expect(env.ANTHROPIC_API_KEY).toBe("secret-key");
  });

  test("each live trial env receives a distinct trial-scoped OPENCODE_DB path", () => {
    const baseEnv: Record<string, string | undefined> = {
      HOME: "/Users/tester",
      XDG_DATA_HOME: "/Users/tester/.local/share",
      OPENCODE_DB: "/Users/tester/.local/share/opencode/opencode.db",
    };

    const trialA = "/tmp/ablation/run-a";
    const trialB = "/tmp/ablation/run-b";
    const envA = buildLiveEnv({
      configDir: join(trialA, "cfg"),
      password: "pw-a",
      env: trialServerEnv(trialA),
      baseEnv,
    });
    const envB = buildLiveEnv({
      configDir: join(trialB, "cfg"),
      password: "pw-b",
      env: trialServerEnv(trialB),
      baseEnv,
    });

    expect(envA.OPENCODE_DB).toBe(join(trialA, "opencode.db"));
    expect(envB.OPENCODE_DB).toBe(join(trialB, "opencode.db"));
    expect(envA.OPENCODE_DB).not.toBe(envB.OPENCODE_DB);
    expect(envA.OPENCODE_DB).not.toBe(baseEnv.OPENCODE_DB);
    expect(envA.XDG_DATA_HOME).toBe("/Users/tester/.local/share");
    expect(envB.XDG_DATA_HOME).toBe("/Users/tester/.local/share");
  });
});

describe("live server model catalogue readiness polling", () => {
  test("hasModel matches provider/id and optional variant including nested ids", () => {
    const catalogue = [
      { providerID: "opencode", id: "big-pickle", variants: [] },
      { providerID: "mock", id: "ablation", variants: [{ id: "high" }] },
      { providerID: "openrouter", id: "anthropic/claude-sonnet", variants: [{ id: "fast" }] },
    ];

    expect(hasModel(catalogue, "mock/ablation")).toBe(true);
    expect(hasModel(catalogue, "mock/ablation#high")).toBe(true);
    expect(hasModel(catalogue, "mock/ablation#missing")).toBe(false);
    expect(hasModel(catalogue, "openrouter/anthropic/claude-sonnet#fast")).toBe(true);
    expect(hasModel(catalogue, "mock/other")).toBe(false);
    expect(hasModel(catalogue, "invalid-ref")).toBe(false);
  });

  test("keeps polling past early HTTP 200 catalogues until custom provider registers", async () => {
    const sleeps: Array<number> = [];
    let calls = 0;
    const result = await waitForLiveModel({
      model: "mock/ablation",
      maxAttempts: 10,
      delayMs: 300,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchModels: async () => {
        calls += 1;
        if (calls === 1) throw new Error("ECONNREFUSED");
        if (calls <= 3) {
          return [{ providerID: "opencode", id: "big-pickle", variants: [] }];
        }
        return [
          { providerID: "opencode", id: "big-pickle", variants: [] },
          { providerID: "mock", id: "ablation", variants: [] },
        ];
      },
    });

    expect(result.ok).toBe(true);
    expect(calls).toBe(4);
    expect(sleeps).toEqual([300, 300, 300]);
  });

  test("fails with missing-model only after exhausting maxAttempts", async () => {
    const sleeps: Array<number> = [];
    let calls = 0;
    const result = await waitForLiveModel({
      model: "mock/ablation",
      maxAttempts: 4,
      delayMs: 300,
      sleep: async (ms) => {
        sleeps.push(ms);
      },
      fetchModels: async () => {
        calls += 1;
        return [{ providerID: "opencode", id: "big-pickle", variants: [] }];
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("missing-model");
    }
    expect(calls).toBe(4);
    expect(sleeps).toEqual([300, 300, 300]);
  });

  test("fails with unreachable when fetchModels never succeeds", async () => {
    let calls = 0;
    const result = await waitForLiveModel({
      model: "mock/ablation",
      maxAttempts: 3,
      delayMs: 300,
      sleep: async () => {},
      fetchModels: async () => {
        calls += 1;
        throw new Error("still booting");
      },
    });

    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unreachable");
    }
    expect(calls).toBe(3);
  });
});
