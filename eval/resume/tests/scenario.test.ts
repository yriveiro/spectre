import { describe, expect, test } from "bun:test";
import { loadScenario, parseScenario, type WorkspacePath } from "../scenario";

const fixture = {
  id: "correction",
  description: "a fixture",
  setup: {},
  turns: [{ prompt: "do the thing" }],
  mock: [{ role: "parent", when: "do the thing", text: "ok" }],
  expect: { subagentCalls: 0, continuesFirstChild: false, childSessions: 0, files: {} },
};

describe("the fixture boundary", () => {
  test("the committed fixtures parse", async () => {
    const correction = await loadScenario(`${import.meta.dir}/../scenarios/correction.json`);
    expect(correction.id).toBe("correction");
    expect(correction.expect.files["notes.txt" as WorkspacePath]).toBe(
      "alpha\nBETA-42\ngamma\nORCHID-42",
    );
  });

  test("a scenario id is a lowercase slug", () => {
    expect(() => parseScenario({ ...fixture, id: "../escape" }, "fixture")).toThrow(
      "fixture.id: expected a lowercase slug",
    );
  });

  test("a setup key cannot climb out", () => {
    expect(() => parseScenario({ ...fixture, setup: { "../escape": "x" } }, "fixture")).toThrow(
      "expected a path inside the workspace",
    );
  });

  test("an expected file cannot be absolute", () => {
    expect(() =>
      parseScenario(
        { ...fixture, expect: { ...fixture.expect, files: { "/etc/passwd": "" } } },
        "fixture",
      ),
    ).toThrow("expected a path relative to the workspace");
  });

  test("an expected file cannot climb out", () => {
    expect(() =>
      parseScenario(
        { ...fixture, expect: { ...fixture.expect, files: { "a/../../b": "" } } },
        "fixture",
      ),
    ).toThrow("expected a path inside the workspace");
  });
});
