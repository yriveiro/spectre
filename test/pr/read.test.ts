import { describe, expect, test } from "bun:test";
import { branchOk, needsPush, type Facts } from "../../tools/definitions/pr/read";

/** The two reads a push decision rests on: does the remote have an upstream, and by how much. */
const facts = (over: Partial<Extract<Facts, { readonly ok: true }>> = {}) => ({
  ok: true as const,
  branch: "compose-pr",
  base: "main",
  ahead: 0,
  ...over,
});

describe("what the remote holds decides whether a push happens", () => {
  test("no upstream means the remote holds nothing, so push", () => {
    expect(needsPush(facts())).toBe(true);
  });

  test("the remote holding every commit means no push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: 0 }))).toBe(false);
  });

  test("commits the remote lacks mean push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: 2 }))).toBe(true);
  });

  test("a comparison that failed is NaN, which is neither zero nor a count, so push", () => {
    expect(needsPush(facts({ upstream: "origin", ahead: Number.NaN }))).toBe(true);
    expect(Number.isNaN(facts({ upstream: "origin", ahead: Number.NaN }).ahead)).toBe(true);
  });
});

describe("a branch name reaches an argv slot", () => {
  test("an ordinary name is accepted", () => {
    expect(branchOk("compose-pr")).toBe(true);
    expect(branchOk("feature/one-two")).toBe(true);
  });

  test("a leading dash reads as a flag to git and gh, so it is refused", () => {
    expect(branchOk("--repo")).toBe(false);
    expect(branchOk("-x")).toBe(false);
  });

  test("traversal and a traversal run are refused", () => {
    expect(branchOk("..")).toBe(false);
    expect(branchOk("a..b")).toBe(false);
  });

  test("an empty name is refused", () => {
    expect(branchOk("")).toBe(false);
  });
});