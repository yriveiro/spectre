import { describe, expect, test } from "bun:test";
import { definitions } from "../../../skills/definitions";
import {
  BLINDING_FORBIDDEN_WORDS,
  findBlindingLeaks,
  listScenarios,
  loadScenario,
  parseScenario,
} from "../scenario";

const SCENARIO_PATH = `${import.meta.dir}/../scenarios/tdd-bugfix.json`;

describe("ablation scenario schema and blinding", () => {
  test("ships the single tdd-bugfix scenario with valid targetSkill and zero blinding leaks", async () => {
    const scenarios = await listScenarios();
    expect(scenarios.map((item) => item.id)).toEqual(["tdd-bugfix"]);

    const scenario = await loadScenario(SCENARIO_PATH);
    expect(scenario.targetSkill).toBe("tdd");
    expect(definitions.some((def) => def.id === scenario.targetSkill)).toBe(true);
    expect(scenario.productionFiles).toEqual(["src/limiter.ts" as never]);
    expect(scenario.testFiles).toEqual(["spec/limiter.spec.ts" as never]);
    expect(scenario.oracle.path in scenario.setup).toBe(false);

    expect(findBlindingLeaks(scenario.sessionTitle, scenario.targetSkill)).toEqual([]);
    for (const file of Object.keys(scenario.setup)) {
      expect(findBlindingLeaks(file, scenario.targetSkill)).toEqual([]);
    }
    for (const turn of scenario.turns) {
      expect(findBlindingLeaks(turn.prompt, scenario.targetSkill)).toEqual([]);
    }
    expect(findBlindingLeaks(scenario.rubric.taskSummary, scenario.targetSkill)).toEqual([]);

    const weightSum = scenario.rubric.criteria.reduce((sum, item) => sum + item.weight, 0);
    expect(Math.abs(weightSum - 1)).toBeLessThan(1e-6);
  });

  test("rejects every playbook-eval forbidden blinding word and literal targetSkill in prompts or setup paths", async () => {
    const valid = (await Bun.file(SCENARIO_PATH).json()) as Record<string, unknown>;

    for (const word of [...BLINDING_FORBIDDEN_WORDS, "tdd"]) {
      const badPrompt = {
        ...valid,
        turns: [{ prompt: `Fix src/limiter.ts for this ${word} check.` }],
      };
      expect(() => parseScenario(badPrompt, "bad-prompt.json")).toThrow(/blinding/i);
    }

    const badSetupPath = {
      ...valid,
      setup: {
        ...(valid.setup as Record<string, string>),
        "test/limiter.test.ts": "export {};\n",
      },
    };
    expect(() => parseScenario(badSetupPath, "bad-setup.json")).toThrow(/blinding/i);

    const badTitle = { ...valid, sessionTitle: "ablation-trial" };
    expect(() => parseScenario(badTitle, "bad-title.json")).toThrow(/blinding/i);
  });

  test("rejects unknown targetSkill, path traversal, oracle collision, bad regex, and invalid weights", async () => {
    const valid = (await Bun.file(SCENARIO_PATH).json()) as Record<string, unknown>;

    expect(() =>
      parseScenario({ ...valid, targetSkill: "nonexistent-skill" }, "unknown.json"),
    ).toThrow(/unknown targetSkill/i);

    expect(() =>
      parseScenario(
        {
          ...valid,
          setup: { "../escape.ts": "x" },
        },
        "escape.json",
      ),
    ).toThrow(/workspace/i);

    expect(() =>
      parseScenario(
        {
          ...valid,
          oracle: {
            ...(valid.oracle as Record<string, unknown>),
            path: "spec/limiter.spec.ts",
          },
        },
        "oracle-collision.json",
      ),
    ).toThrow(/oracle/i);

    expect(() =>
      parseScenario({ ...valid, testCommandRegex: "[unclosed" }, "bad-regex.json"),
    ).toThrow(/regex/i);

    expect(() =>
      parseScenario(
        {
          ...valid,
          rubric: {
            taskSummary: "Neutral summary",
            criteria: [{ id: "a", description: "desc", weight: 0 }],
          },
        },
        "zero-weight.json",
      ),
    ).toThrow(/weight/i);
  });
});
