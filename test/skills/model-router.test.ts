import { describe, expect, test } from "bun:test";

const SKILL = "skills/definitions/model-router";

const references = ["answer-shape.md", "subagent-call.md", "routing-flow.md", "worked-example.md"];

describe("model-router ships the body it promises", () => {
  test("the body names the four steps and the routing tool", async () => {
    const body = await Bun.file(`${SKILL}/SKILL.md`).text();
    expect(body.match(/^\d+\. \*\*(?:Evaluate|Ask|Choose|Spawn)\.\*\*/gm)?.length).toBe(4);
    expect(body).toContain("tools.spectre.routing");
    expect(body).not.toContain("routing_model_preference");
  });

  test("every reference named in the body exists and carries detail", async () => {
    const body = await Bun.file(`${SKILL}/SKILL.md`).text();
    for (const reference of references) {
      expect(body).toContain(`references/${reference}`);
      const file = Bun.file(`${SKILL}/references/${reference}`);
      expect(await file.exists()).toBe(true);
      expect((await file.text()).length).toBeGreaterThan(1000);
    }
  });

  test("the references folder has no page the body does not name", () => {
    const shipped = [...new Bun.Glob("*.md").scanSync(`${SKILL}/references`)].toSorted();
    expect(shipped).toEqual(references.toSorted());
  });

  test("the answer-shape page covers every status and both orders", async () => {
    const body = await Bun.file(`${SKILL}/references/answer-shape.md`).text();
    for (const status of ["resolved", "setup", "declined", "problems"])
      expect(body).toContain(status);
    expect(body).toContain("priority");
    expect(body).toContain("crosscheck");
  });

  test("the body states the correction rule and the flow page draws it", async () => {
    const body = await Bun.file(`${SKILL}/SKILL.md`).text();
    expect(body).toContain("## A correction is a follow-up, not a new child");
    expect(body).toContain("You are the judge");
    expect(body).toContain("reviewer's `sessionID`");
    const flow = await Bun.file(`${SKILL}/references/routing-flow.md`).text();
    expect(flow).toContain("flowchart TD");
    expect(flow).toContain("Spawn the crosscheck");
    expect(flow).toContain("The judge accepts a challenge?");
    expect(flow).toContain("Does the challenge carry evidence?");
  });
});
