import { describe, expect, test } from "bun:test";
import { decide, oneStepUp, PLAY_SAFE } from "../../tools/definitions/routing/policy";
import type { Profile } from "../../tools/definitions/routing/types";

/**
 * The policy.
 *
 * It reads the judge's probability and it does not read the catalogue, the
 * models or the resolver, so every case here is a fact and a number.
 */

const profile = (effort: string | undefined): Profile => ({
  effort,
  match: undefined,
  why: undefined,
  crosscheck: undefined,
  agent: "spectre",
});

const profiles = {
  mechanical: profile("low"),
  search: profile("medium"),
  worker: profile("high"),
  judgment: profile("high"),
  thinking: profile("max"),
};

describe("one step up the canonical ladder", () => {
  test("a step up is a step of thinking, and the top has none", () => {
    expect(oneStepUp("low")).toBe("medium");
    expect(oneStepUp("medium")).toBe("high");
    expect(oneStepUp("high")).toBe("xhigh");
    expect(oneStepUp("xhigh")).toBe("max");
  });

  test("the ceiling stays at the ceiling", () => {
    expect(oneStepUp("max")).toBe("max");
  });

  test("a name the order cannot rank is left alone", () => {
    // A rung nobody can place has no step above it.
    expect(oneStepUp("turbo")).toBe("turbo");
  });

  test("a profile with no effort has no step to take", () => {
    expect(oneStepUp(undefined)).toBeUndefined();
  });
});

describe("the policy", () => {
  test("a confident judge is taken at its word", () => {
    const choice = decide({ profile: "worker", confidence: 0.98, alternatives: [] }, profiles);
    expect(choice?.profile).toBe("worker");
    expect(choice?.escalated).toBe(false);
    expect(choice?.effort).toBeUndefined();
  });

  test("an unsure judge plays safe: the profile is spent one step higher", () => {
    // The judge does not know which profile this is, and not knowing is a
    // reason to spend more rather than less.
    const choice = decide({ profile: "worker", confidence: 0.46, alternatives: [] }, profiles);
    expect(choice?.profile).toBe("worker");
    expect(choice?.escalated).toBe(true);
    expect(choice?.effort).toBe("xhigh");
  });

  test("the threshold is where the corpus says it is", () => {
    // Every hit the judge got on the corpus sat at 0.7 or above, and the one
    // low-confidence mistake sat at 0.46.
    expect(PLAY_SAFE).toBe(0.7);
    const at = decide({ profile: "worker", confidence: 0.7, alternatives: [] }, profiles);
    expect(at?.escalated).toBe(false);
    const under = decide({ profile: "worker", confidence: 0.69, alternatives: [] }, profiles);
    expect(under?.escalated).toBe(true);
  });

  test("a judge with no probability is not a number to threshold on", () => {
    // The lexical arm has a score and not a probability, so the profile is
    // spent at its own effort.
    const choice = decide({ profile: "worker", confidence: undefined, alternatives: [] }, profiles);
    expect(choice?.profile).toBe("worker");
    expect(choice?.escalated).toBe(false);
  });

  test("the judge's other readings travel with the answer", () => {
    const choice = decide(
      {
        profile: "worker",
        confidence: 0.46,
        alternatives: [
          { profile: "worker", probability: 0.46 },
          { profile: "refactor", probability: 0.44 },
        ],
      },
      profiles,
    );
    // The judge's own answer is not one of its alternatives.
    expect(choice?.alternatives).toEqual([{ profile: "refactor", probability: 0.44 }]);
  });

  test("a profile the config does not have is spent as it is", () => {
    const choice = decide({ profile: "ghost", confidence: 0.2, alternatives: [] }, profiles);
    expect(choice?.profile).toBe("ghost");
    expect(choice?.escalated).toBe(false);
    expect(choice?.effort).toBeUndefined();
  });

  test("a config may move the threshold", () => {
    const choice = decide({ profile: "worker", confidence: 0.8, alternatives: [] }, profiles, 0.9);
    expect(choice?.escalated).toBe(true);
    expect(choice?.effort).toBe("xhigh");
  });

  test("a profile at the ceiling has nothing to play safe with", () => {
    const choice = decide({ profile: "thinking", confidence: 0.2, alternatives: [] }, profiles);
    expect(choice?.escalated).toBe(false);
    expect(choice?.effort).toBeUndefined();
  });
});
