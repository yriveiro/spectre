import { describe, expect, test } from "bun:test";
import { operator } from "../../agents/definitions/operator";
import { spectre } from "../../agents/definitions/spectre";

const HUB = "skills/definitions/spectre-mode/SKILL.md";
const ROUTER = "skills/definitions/model-router/SKILL.md";

const flat = (text: string): string => text.replace(/\s+/g, " ");

const CONTRACT_TOKENS = [
  "STATUS: DONE",
  "STATUS: ESCALATE",
  "AMBIGUITY",
  "SCOPE",
  "FAILURE_CAP",
] as const;

describe("delegation and escalation contract", () => {
  test("operator and model-router share the terminal status and escalation wire tokens", async () => {
    expect(operator.system).toBeDefined();
    const surfaces: ReadonlyArray<readonly [string, string]> = [
      ["agents/definitions/operator.ts", flat(operator.system ?? "")],
      [ROUTER, flat(await Bun.file(ROUTER).text())],
    ];

    for (const [name, content] of surfaces) {
      for (const token of CONTRACT_TOKENS) {
        expect(content, `${name} must contain ${token}`).toContain(token);
      }
    }
  });

  test("spectre stays thin and does not leak router profiles or worker wire tokens", () => {
    const body = flat(spectre.system ?? "");
    expect(body).toContain("spectre-mode");
    expect(body).toContain("model-router");
    for (const leaked of [
      "STATUS: DONE",
      "STATUS: ESCALATE",
      "AMBIGUITY",
      "FAILURE_CAP",
      "mechanical",
      "spectre.json",
    ]) {
      expect(body, `agents/definitions/spectre.ts must not leak ${leaked}`).not.toContain(leaked);
    }
  });

  test("spectre-mode owns decomposition, main-session ownership, and low-complexity delegation without wire leakage", async () => {
    const body = flat(await Bun.file(HUB).text());
    expect(body).toContain("framing, tradeoffs, integration, and final acceptance");
    expect(body).toContain("decompose the request into small, verifiable units");
    expect(body).toContain("low-complexity, bounded units");
    expect(body).toContain("execute your assigned unit directly without delegating further");
    expect(body).not.toContain("STATUS: ESCALATE");
    expect(body).not.toContain("FAILURE_CAP");
  });

  test("operator states the stop triggers, first-hit environment blocker, and delivery fields", () => {
    const body = flat(operator.system ?? "");
    expect(body).toContain("Stop & escalate");
    expect(body).toContain("2 failed fix attempts");
    expect(body).toContain("environment or permission blocker outside scope on the first hit");
    expect(body).toContain("TOUCHED:");
    expect(body).toContain("VERIFIED:");
    expect(body).toContain("OUTCOME:");
    expect(body).toContain("REASON:");
    expect(body).toContain("BLOCKER:");
    expect(body).toContain("OPTIONS_OR_ATTEMPTS:");
    expect(body).toContain("RECOMMENDED_NEXT: orchestrator_decision | higher_profile");
  });

  test("model-router defines bounded operator delegation and escalation handling", async () => {
    const body = await Bun.file(ROUTER).text();
    expect(body).toContain("## Delegate bounded slices to operator");
    expect(body).toContain("## Handling an operator escalation");
  });
});
