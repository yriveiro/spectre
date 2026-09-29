import { describe, expect, test } from "bun:test";
import { verify } from "../catalogue";

const ours = ["a", "b", "c"];

describe("verify", () => {
  test("a full match passes silently", () => {
    expect(verify(["a", "b", "c"], ours)).toEqual([]);
    expect(verify(["c", "b", "a"], ours)).toEqual([]);
  });

  test("no report at all is a refusal, not a pass", () => {
    expect(verify(undefined, ours)[0]).toContain("Refusing to score");
    expect(verify([], ours)[0]).toContain("Refusing to score");
  });

  test("a strict subset names the stale copy and the line to delete", () => {
    const problems = verify(["a", "b"], ours);
    expect(problems.join(" ")).toContain("missing c");
    expect(problems.join(" ")).toContain("github:yriveiro/spectre");
  });

  test("a subset names which source was trusted", () => {
    expect(verify(["a"], ours, "route").join(" ")).toContain("the route");
    expect(verify(["a"], ours, "log").join(" ")).toContain("the log");
  });

  test("the global catalogue is diagnosed as the plugin not having loaded", () => {
    const problems = verify(["opencode", "report", "ripwire"], ours, "route");
    const text = problems.join(" ");
    expect(text).toContain("has not loaded in this project yet");
    expect(text).toContain("opencode");
  });

  test("one missing id among many is named, not summarised away", () => {
    // An unknown extra id sends this down the "global catalogue" branch, which
    // names the id in the "never offered" list rather than the stale-copy list.
    expect(verify(["a", "b", "zzz"], ours).join(" ")).toContain("never offered: c");
  });

  test("a strict subset and a polluted set are told apart", () => {
    expect(verify(["a", "b"], ours).join(" ")).toContain("github:yriveiro/spectre");
    expect(verify(["a", "b", "zzz"], ours).join(" ")).not.toContain("github:yriveiro/spectre");
  });
});
