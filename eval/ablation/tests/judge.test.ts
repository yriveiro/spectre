import { describe, expect, test } from "bun:test";
import type { ModelInfo } from "@opencode/client";
import {
  assertJudgePayloadClean,
  buildJudgePrompt,
  createSessionJudgeTransport,
  type JudgeSubmissionArtifact,
  type JudgeTransport,
  judgePairSwapped,
  reconcileSwappedPasses,
  resolveJudgeModel,
} from "../judge";
import { loadScenario } from "../scenario";

const SCENARIO_PATH = `${import.meta.dir}/../scenarios/tdd-bugfix.json`;

const makeModel = (input: {
  readonly providerID: string;
  readonly id: string;
  readonly family?: string;
  readonly enabled?: boolean;
  readonly status?: "active" | "beta" | "alpha" | "deprecated";
}): ModelInfo =>
  ({
    providerID: input.providerID,
    id: input.id,
    name: input.id,
    ...(input.family === undefined ? {} : { family: input.family }),
    enabled: input.enabled ?? true,
    status: input.status ?? "active",
    cost: [],
    variants: [],
    capabilities: { tools: true },
  }) as unknown as ModelInfo;

const makeArtifact = (note: string): JudgeSubmissionArtifact => ({
  diffs: [
    {
      path: "src/limiter.ts" as never,
      changed: true,
      before: "const active = entries.filter((ts) => ts >= cutoff);",
      after: `const active = entries.filter((ts) => ts > cutoff); // ${note}`,
    },
  ],
  actorSuitePassed: true,
  trustedOraclePassed: true,
  actorSpecFailsPreFix: true,
  allowedMutationsOnly: true,
  actorSuiteOutput: "5 pass\n0 fail",
  oracleOutput: "4 pass\n0 fail",
});

describe("cross-family judge model resolution", () => {
  const catalogue = [
    makeModel({ providerID: "opencode-go", id: "kimi-k3", family: "kimi" }),
    makeModel({ providerID: "opencode-go", id: "muse-spark-1.3-contributor", family: "muse" }),
    makeModel({ providerID: "opencode-go", id: "mystery-model" }),
    makeModel({ providerID: "anthropic", id: "claude-sonnet", family: "claude" }),
  ];

  const spectreConfig = {
    models: {
      kimi: "opencode-go/kimi-k3",
      muse: "opencode-go/muse-spark-1.3-contributor",
      mystery: "opencode-go/mystery-model",
    },
    priority: ["kimi", "muse"],
    crosscheck: ["kimi", "mystery", "muse"],
  };

  test("resolves crosscheck aliases through models and selects first known different family", () => {
    const resolved = resolveJudgeModel({
      catalogue,
      actorModelRef: "opencode-go/kimi-k3",
      spectreConfig,
    });
    expect(resolved.judgeRef).toBe("opencode-go/muse-spark-1.3-contributor");
    expect(resolved.actorFamily).toBe("kimi");
    expect(resolved.judgeFamily).toBe("muse");
    expect(resolved.sameFamilyOverride).toBe(false);
  });

  test("refuses missing family metadata and refuses same family unless explicitly overridden", () => {
    expect(() =>
      resolveJudgeModel({
        catalogue,
        actorModelRef: "opencode-go/mystery-model",
        judgeModelRef: "opencode-go/muse-spark-1.3-contributor",
      }),
    ).toThrow(/family/i);

    expect(() =>
      resolveJudgeModel({
        catalogue,
        actorModelRef: "opencode-go/kimi-k3",
        judgeModelRef: "opencode-go/mystery-model",
      }),
    ).toThrow(/family/i);

    expect(() =>
      resolveJudgeModel({
        catalogue,
        actorModelRef: "opencode-go/kimi-k3",
        judgeModelRef: "opencode-go/kimi-k3",
      }),
    ).toThrow(/same family/i);

    const overridden = resolveJudgeModel({
      catalogue,
      actorModelRef: "opencode-go/kimi-k3",
      judgeModelRef: "opencode-go/kimi-k3",
      allowSameFamily: true,
    });
    expect(overridden.sameFamilyOverride).toBe(true);
  });
});

describe("allowlisted untrusted judge payload and order-swapped grading", () => {
  test("preserves ordinary code words inside diffs and throws if a forbidden harness token leaks", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const left = makeArtifact("keep present candidate variable name");
    const right = makeArtifact("second variant");

    const prompt = buildJudgePrompt({
      scenario,
      slotA: left,
      slotB: right,
    });

    expect(prompt).toContain('<untrusted_submission slot="A">');
    expect(prompt).toContain('<untrusted_submission slot="B">');
    expect(prompt).toContain("keep present candidate variable name");
    expect(() =>
      assertJudgePayloadClean(prompt, ["/tmp/work-abc123", "opencode-go/kimi-k3"]),
    ).not.toThrow();

    expect(() =>
      assertJudgePayloadClean(`${prompt}\n/tmp/work-abc123`, ["/tmp/work-abc123"]),
    ).toThrow(/leak/i);
  });

  test("reconciles consistent wins, ties, and labels swap disagreements as unresolved", () => {
    expect(reconcileSwappedPasses("A", "B")).toBe("left");
    expect(reconcileSwappedPasses("B", "A")).toBe("right");
    expect(reconcileSwappedPasses("TIE", "TIE")).toBe("tie");
    expect(reconcileSwappedPasses("A", "A")).toBe("unresolved");
    expect(reconcileSwappedPasses("B", "B")).toBe("unresolved");
    expect(reconcileSwappedPasses("A", "TIE")).toBe("unresolved");
    expect(reconcileSwappedPasses("TIE", "B")).toBe("unresolved");
  });

  test("runs forward and swapped passes and marks slot disagreement unresolved", async () => {
    const scenario = await loadScenario(SCENARIO_PATH);
    const left = makeArtifact("clean fix");
    const right = makeArtifact("other fix");

    let callCount = 0;
    const consistentTransport: JudgeTransport = async () => {
      callCount++;
      const winner = callCount === 1 ? "A" : "B";
      return {
        text: JSON.stringify({
          winner,
          scoresA:
            winner === "A"
              ? { boundary_correctness: 5, regression_coverage: 5, minimal_diff: 5 }
              : { boundary_correctness: 3, regression_coverage: 3, minimal_diff: 3 },
          scoresB:
            winner === "A"
              ? { boundary_correctness: 3, regression_coverage: 3, minimal_diff: 3 }
              : { boundary_correctness: 5, regression_coverage: 5, minimal_diff: 5 },
          rationale: "clear winner",
        }),
        tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
        hostRecordedUsd: 0.002,
      };
    };

    const consistent = await judgePairSwapped({
      scenario,
      left,
      right,
      transport: consistentTransport,
      forbiddenTokens: ["opencode-go/kimi-k3"],
    });
    expect(consistent.outcome).toBe("left");
    expect(consistent.leftWeightedScore).toBe(5);
    expect(consistent.rightWeightedScore).toBe(3);
    expect(consistent.hostRecordedUsd).toBeCloseTo(0.004, 6);

    const biasedTransport: JudgeTransport = async () => ({
      text: JSON.stringify({
        winner: "A",
        scoresA: { boundary_correctness: 4, regression_coverage: 4, minimal_diff: 4 },
        scoresB: { boundary_correctness: 3, regression_coverage: 3, minimal_diff: 3 },
        rationale: "always slot A",
      }),
      tokens: { input: 500, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
      hostRecordedUsd: 0,
    });

    const disagreed = await judgePairSwapped({
      scenario,
      left,
      right,
      transport: biasedTransport,
      forbiddenTokens: [],
    });
    expect(disagreed.outcome).toBe("unresolved");
  });

  test("creates a fresh session per pass and always removes it in finally", async () => {
    const events: Array<string> = [];
    const fakeClient = {
      directory: "/tmp/judge",
      session: {
        create: async () => {
          events.push("create");
          return { id: "ses_judge_1" };
        },
        generate: async () => {
          events.push("generate");
          throw new Error("boom");
        },
        remove: async ({ sessionID }: { readonly sessionID: string }) => {
          events.push(`remove:${sessionID}`);
        },
      },
    };

    const transport = createSessionJudgeTransport({
      client: fakeClient as never,
      model: { providerID: "opencode-go", id: "muse-spark-1.3-contributor" },
      timeoutMs: 5000,
    });

    await expect(transport("hello")).rejects.toThrow("boom");
    expect(events).toEqual(["create", "generate", "remove:ses_judge_1"]);
  });
});
