import { describe, expect, test } from "bun:test";
import { runSelfTest } from "../selftest";

describe("deterministic zero-LLM --self-test", () => {
  test("exercises real staging, oracle verification, wire decoding, and catches all 5 injected faults", async () => {
    const result = await runSelfTest({ trials: 2 });
    expect(result.passed).toBe(true);
    expect(result.summary.validity.allPassed).toBe(true);
    expect(result.summary.verdict).toBe("inconclusive");
    expect(result.summary.verdictReasons).toContain("small_sample");

    const checkIds = result.faultChecks.map((item) => item.id);
    expect(checkIds).toEqual([
      "extra_registered_id_caught",
      "surviving_tdd_cue_caught",
      "false_red_witness_caught",
      "order_disagreement_caught",
      "incomplete_timed_out_trial_caught",
    ]);
    for (const check of result.faultChecks) {
      expect(check.caught).toBe(true);
    }

    expect(result.markdown).toContain("Skill Ablation & Causal Trajectory Report");
    expect(result.markdown).toContain("Host-Recorded USD");
    expect(result.markdown).toContain("Self-Test Fault-Injection Checks");
  }, 60_000);
});
