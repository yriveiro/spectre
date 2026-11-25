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
  test("operator, spectre, spectre-mode, and model-router share the terminal status and escalation tokens", async () => {
    expect(operator.system).toBeDefined();
    expect(spectre.system).toBeDefined();
    const surfaces: ReadonlyArray<readonly [string, string]> = [
      ["agents/definitions/operator.ts", flat(operator.system ?? "")],
      ["agents/definitions/spectre.ts", flat(spectre.system ?? "")],
      [HUB, flat(await Bun.file(HUB).text())],
      [ROUTER, flat(await Bun.file(ROUTER).text())],
    ];

    for (const [name, content] of surfaces) {
      for (const token of CONTRACT_TOKENS) {
        expect(content, `${name} must contain ${token}`).toContain(token);
      }
    }
  });

  test("spectre states main ownership of framing, tradeoffs, integration, and final acceptance", () => {
    const body = flat(spectre.system ?? "");
    expect(body).toContain("framing, tradeoffs, integration, and final acceptance");
    expect(body).toContain("execute directly without delegating further");
    expect(body).toContain("mechanical");
    expect(body).toContain("search");
    expect(body).toContain("worker");
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
