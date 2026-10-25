import { describe, expect, test } from "bun:test";
import { VERIFIED } from "../../skills/definitions/solidjs-best-practices/verified";

const SKILL = "skills/definitions/solidjs-best-practices";

const references = [
  "version-gate.md",
  "solid-v1.md",
  "solid-v2.md",
  "reactivity.md",
  "components-and-composition.md",
  "typescript.md",
  "performance.md",
  "ssr-and-solidstart.md",
  "migration-v1-v2.md",
  "anti-patterns.md",
  "testing-and-review.md",
  "sources-and-maintenance.md",
];

describe("solidjs-best-practices ships the body it promises", () => {
  test("SKILL.md is present and carries the version gate", async () => {
    const body = await Bun.file(`${SKILL}/SKILL.md`).text();
    expect(body).toContain("## The version gate is mandatory");
    expect(body).toContain("## The nine-step workflow");
    expect(body.match(/^\d+\. \*\*/gm)?.length).toBe(9);
    expect(body).toContain("tools.spectre.solidjs");
    expect(body).toContain(VERIFIED.solid.stable);
    expect(body).toContain(VERIFIED.solid.next);
    expect(body).toContain("release candidate");
  });

  test("every reference named in SKILL.md exists and is not empty", async () => {
    const body = await Bun.file(`${SKILL}/SKILL.md`).text();
    for (const reference of references) {
      expect(body).toContain(`references/${reference}`);
      const file = Bun.file(`${SKILL}/references/${reference}`);
      expect(await file.exists()).toBe(true);
      expect((await file.text()).length).toBeGreaterThan(1000);
    }
  });

  test("the anti-pattern catalogue is numbered, sourced and version-tagged", async () => {
    const body = await Bun.file(`${SKILL}/references/anti-patterns.md`).text();
    const ids = [...body.matchAll(/^### AP-(\d+) ·/gm)].map((match) => Number(match[1]));

    expect(ids.length).toBeGreaterThanOrEqual(30);
    expect(new Set(ids).size).toBe(ids.length);
    expect(ids).toEqual(Array.from({ length: ids.length }, (_, index) => index + 1));

    for (const block of body.split(/^### /gm).slice(1)) {
      expect(block).toContain("**Versions:**");
      expect(block).toContain("**Source.**");
    }
  });

  test("every audit rule has a catalogue entry that names it", async () => {
    const source = await Bun.file("tools/definitions/solidjs/audit.ts").text();
    const catalogue = await Bun.file(`${SKILL}/references/anti-patterns.md`).text();
    const rules = new Set([...source.matchAll(/rule:\s*"([a-z0-9-]+)"/g)].map((match) => match[1]));

    expect(rules.size).toBeGreaterThan(10);
    for (const rule of rules) {
      if (rule === undefined) continue;
      expect(catalogue).toContain(rule);
    }
  });

  test("the stamp is a date, the stable line is 1.x and the next line is 2.x", () => {
    expect(VERIFIED.checked).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(VERIFIED.solid.stable.startsWith("1.")).toBe(true);
    expect(VERIFIED.solid.next.startsWith("2.")).toBe(true);
    expect(VERIFIED.start.v2.startsWith("2.")).toBe(true);
    expect(VERIFIED.start.v1.startsWith("1.")).toBe(true);
  });

  test("the maintenance script and both example trees are on disk", async () => {
    expect(await Bun.file(`${SKILL}/scripts/typecheck-examples.ts`).exists()).toBe(true);

    for (const version of ["v1", "v2"]) {
      const files = new Bun.Glob("*.{ts,tsx}").scan({ cwd: `${SKILL}/examples/${version}` });
      const names: string[] = [];
      for await (const file of files) names.push(file);
      expect(names.length).toBeGreaterThan(0);
    }
  });
});
