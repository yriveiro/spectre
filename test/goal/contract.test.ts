import { describe, expect, test } from "bun:test";
import {
  compose,
  type Feature,
  MAX_OBJECTIVE,
  parseContract,
  type RawContract,
  refusal,
} from "../../tools/definitions/goal/contract";

const place: Feature = {
  kind: "feature",
  directory: "/work/spectre-worktrees/retry",
  branch: "retry",
};

const raw = {
  objective: "Make the retry queue pass its tests",
  predicate: "bun test returns zero failures",
  check: "bun test",
};

const parsed = (override: Partial<RawContract> = {}) => {
  const result = parseContract({ ...raw, ...override });
  if (!result.ok) throw new Error(result.problems.join("\n"));
  return result.value;
};

describe("the goal contract", () => {
  test("a complete contract parses", () => {
    const result = parseContract(raw);
    expect(result.ok).toBe(true);
  });

  test("an empty objective, predicate or check is refused", () => {
    for (const field of ["objective", "predicate", "check"] as const) {
      const result = parseContract({ ...raw, [field]: " " });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems.join("\n")).toContain(`${field} is empty`);
    }
  });

  test("a multi-line field is refused", () => {
    const result = parseContract({ ...raw, check: "bun test\nbun run typecheck" });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join("\n")).toContain("must be one line");
  });

  test("a character the host escapes is refused in every field", () => {
    for (const field of ["objective", "predicate", "check", "evidence"] as const) {
      const value =
        field === "evidence" ? "a && b" : field === "check" ? "bun test && bun run lint" : "a & b";
      const result = parseContract({ ...raw, [field]: value });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.problems.join("\n")).toContain('contains "&"');
    }
  });

  test("the composed objective carries the measured place, the predicate, the check and the ledger", () => {
    const result = compose(parsed(), place);
    expect(result.ok).toBe(true);
    if (!result.ok) return;

    expect(result.value).toContain("Make the retry queue pass its tests");
    expect(result.value).toContain(place.directory);
    expect(result.value).toContain("branch retry");
    expect(result.value).toContain("bun test returns zero failures");
    expect(result.value).toContain("Check: bun test");
    expect(result.value).toContain("/work/spectre-worktrees/retry/.spectre/run.md");
    expect(result.value).toContain("playbook-autonomous-run");
    expect(result.value).toContain("tools.spectre.routing");
    expect(result.value).toContain("does not count");
  });

  test("a babysit contract names the babysit playbook", () => {
    const result = compose(parsed({ playbook: "playbook-babysit" }), place);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value).toContain("Follow the playbook-babysit skill.");
  });

  test("a composition over the host's cap is refused with the cap named", () => {
    const long = parsed();
    const result = compose(
      {
        ...long,
        objective:
          `Make the retry queue pass its tests ${"x".repeat(MAX_OBJECTIVE)}` as typeof long.objective,
      },
      place,
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.problems.join("\n")).toContain(String(MAX_OBJECTIVE));
  });

  test("every unsafe place refuses with the fix", () => {
    expect(refusal({ kind: "main-worktree", directory: "/w" })).toContain("main worktree");
    expect(refusal({ kind: "main-worktree", directory: "/w" })).toContain("/wt");
    expect(refusal({ kind: "main-branch", directory: "/w", branch: "main" })).toContain("trunk");
    expect(refusal({ kind: "detached", directory: "/w" })).toContain("detached");
    expect(refusal({ kind: "not-a-repository", directory: "/w", why: "not here" })).toContain(
      "not here",
    );
  });
});
