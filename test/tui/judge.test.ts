import { describe, expect, test } from "bun:test";
import { isJevAvailable } from "../../tui/routing/controls.tsx";
import { type Draft, selectionMethodOf } from "../../tui/routing/data.ts";

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

describe("selectionMethodOf reports the active profile selection method", () => {
  test("returns Session with the session model when JEV is off or unavailable", () => {
    expect(
      selectionMethodOf({
        draft: draft(undefined),
        jevAvailable: true,
        sessionModel: "github-copilot/gemini-4-carbon",
      }),
    ).toEqual({
      kind: "session",
      badge: "Session",
      model: "github-copilot/gemini-4-carbon",
    });

    expect(
      selectionMethodOf({
        draft: draft({ kind: "jev", model: "opencode/jev-1.13-free" }),
        jevAvailable: false,
        sessionModel: "github-copilot/gemini-4-carbon",
      }),
    ).toEqual({
      kind: "session",
      badge: "Session",
      model: "github-copilot/gemini-4-carbon",
    });
  });

  test("returns JEV when JEV is enabled and available", () => {
    expect(
      selectionMethodOf({
        draft: draft({ kind: "jev" }),
        jevAvailable: true,
        sessionModel: "github-copilot/gemini-4-carbon",
      }),
    ).toEqual({
      kind: "jev",
      badge: "JEV",
      model: "opencode/jev-1.13-free",
    });

    expect(
      selectionMethodOf({
        draft: draft({ kind: "jev", model: "acme/jev-custom" }),
        jevAvailable: true,
      }),
    ).toEqual({
      kind: "jev",
      badge: "JEV",
      model: "acme/jev-custom",
    });
  });

  test("returns Lexical when judge kind is lexical regardless of JEV availability", () => {
    expect(
      selectionMethodOf({
        draft: draft({ kind: "lexical" }),
        jevAvailable: false,
        sessionModel: "github-copilot/gemini-4-carbon",
      }),
    ).toEqual({
      kind: "lexical",
      badge: "Lexical",
    });

    expect(
      selectionMethodOf({
        draft: draft({ kind: "lexical" }),
        jevAvailable: true,
        sessionModel: "github-copilot/gemini-4-carbon",
      }),
    ).toEqual({
      kind: "lexical",
      badge: "Lexical",
    });
  });
});
