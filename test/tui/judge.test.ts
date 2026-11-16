import { describe, expect, test } from "bun:test";
import { isJevAvailable } from "../../tui/controls.tsx";
import type { Draft } from "../../tui/data.ts";

const draft = (judge: Draft["judge"]): Draft => ({
  directory: "/repo",
  source: undefined,
  problems: [],
  provider: undefined,
  models: [],
  crosscheck: [],
  profiles: [],
  judge,
});

describe("the Jev toggle reads availability from the host's decision models", () => {
  const listed = new Set(["opencode/jev-1.13-free"]);

  test("the default judge is available when the host lists its model", () => {
    expect(isJevAvailable(draft(undefined), listed)).toBe(true);
  });

  test("a bare id from an older file names the same opencode model", () => {
    expect(isJevAvailable(draft({ kind: "jev", model: "jev-1.13-free" }), listed)).toBe(true);
  });

  test("a model the host does not list is not available", () => {
    expect(isJevAvailable(draft({ kind: "jev", model: "acme/jev-9" }), listed)).toBe(false);
    expect(isJevAvailable(draft(undefined), new Set())).toBe(false);
  });
});
