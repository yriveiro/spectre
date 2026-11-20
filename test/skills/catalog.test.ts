import { describe, expect, test } from "bun:test";
import { Skill } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { spectre } from "../../agents/definitions/spectre";
import { offences } from "../../eval/bar";
import { blind } from "../../eval/fixture";
import {
  attachSkillToolContract,
  CATALOG_TOKEN_CAP,
  catalogTokens,
  renderCatalog,
  SKILL_ID_DESCRIPTION,
  SKILL_TOOL_DESCRIPTION,
  SUBAGENT_SKILL_ID_DESCRIPTION,
  SUBAGENT_SKILL_TOOL_DESCRIPTION,
  shapeSkillTool,
} from "../../skills/catalog";
import {
  type Definition,
  definitions,
  load,
  notALeaf,
  toSkillInfo,
} from "../../skills/definitions";

interface ContextEvent {
  readonly agent: string;
  tools: Record<string, { description: string; input: unknown }>;
}

const makeFixtureSkill = (id: string, catalog: Definition["catalog"]): Definition => ({
  id: Skill.ID.make(id),
  name: Skill.Name.make(id),
  description: `Description for ${id}`,
  autoinvoke: false,
  catalog,
  path: AbsolutePath.make(`/tmp/${id}/SKILL.md`),
});

describe("renderCatalog", () => {
  test("renders communication first, sorted leaves, and the playbook + pull guide", () => {
    const fixture: ReadonlyArray<Definition> = [
      makeFixtureSkill("principle-b", {
        tier: "push",
        group: "leaf",
        trigger: "second leaf moment",
      }),
      makeFixtureSkill("playbook-z", {
        tier: "pull",
        category: "playbook",
        summary: "zeta task shape",
      }),
      makeFixtureSkill("communication", {
        tier: "push",
        group: "communication",
        trigger: "message shape",
      }),
      makeFixtureSkill("principle-a", {
        tier: "push",
        group: "leaf",
        trigger: "first leaf moment",
      }),
      makeFixtureSkill("playbook-a", {
        tier: "pull",
        category: "playbook",
        summary: "alpha task shape",
      }),
      makeFixtureSkill("opencode-platform", {
        tier: "pull",
        category: "stack",
        summary: "host contract",
      }),
      makeFixtureSkill("spectre-mode", { tier: "hub", summary: "hub rules" }),
    ];

    const rendered = renderCatalog(fixture);
    const lines = rendered.split("\n");

    expect(lines.slice(0, 8)).toEqual([
      "## Spectre skill catalog",
      "",
      "Load any matching skill on demand with `skill({ id })` (exact ID as written; skip if none fits).",
      "",
      "Principles & checks (3):",
      "- `communication`: message shape",
      "- `principle-a`: first leaf moment",
      "- `principle-b`: second leaf moment",
    ]);
    expect(rendered).toContain("Playbooks (2) & pull skills (1 + 1 hubs):");
    expect(rendered).toContain('tools.spectre.skills({ category: "playbook" })');
    expect(rendered).not.toContain("`playbook-a`:");
  });

  test("embeds the rendered catalog directly in the spectre agent system prompt", () => {
    expect(spectre.system).toContain(renderCatalog(definitions));
  });
});

describe("registered catalog invariants", () => {
  test("partitions all 85 skills into 33 push (32 leaf + 1 communication), 3 hub, and 49 pull (25 playbook + 24 domain)", async () => {
    const skills = await Effect.runPromise(load());
    const leaves = skills.filter(
      (s) => s.catalog.tier === "push" && s.catalog.group === "leaf",
    ).length;
    const comm = skills.filter(
      (s) => s.catalog.tier === "push" && s.catalog.group === "communication",
    ).length;
    const hubs = skills.filter((s) => s.catalog.tier === "hub").length;
    const playbooks = skills.filter(
      (s) => s.catalog.tier === "pull" && s.catalog.category === "playbook",
    ).length;
    const domainPull = skills.filter(
      (s) => s.catalog.tier === "pull" && s.catalog.category !== "playbook",
    ).length;

    expect({
      total: skills.length,
      leaves,
      comm,
      hubs,
      playbooks,
      domainPull,
      notALeaf: notALeaf.size,
    }).toEqual({
      total: 85,
      leaves: 32,
      comm: 1,
      hubs: 3,
      playbooks: 25,
      domainPull: 24,
      notALeaf: 53,
    });
  });

  test("keeps every trigger and summary single-line <= 120 chars and rendered catalog well under 1,500 tokens", async () => {
    const skills = await Effect.runPromise(load());
    const badLines = skills
      .map((skill) => {
        const line = skill.catalog.tier === "push" ? skill.catalog.trigger : skill.catalog.summary;
        return { id: skill.id, length: line.length, multiline: line.includes("\n") };
      })
      .filter((row) => row.length === 0 || row.length > 120 || row.multiline);

    expect(badLines).toEqual([]);

    const rendered = renderCatalog(skills);
    const tokens = catalogTokens(rendered);
    expect(tokens).toBeGreaterThan(500);
    expect(tokens).toBeLessThanOrEqual(CATALOG_TOKEN_CAP);
  });

  test("shares no four-word run between catalog lines and the blind eval slice", async () => {
    const skills = await Effect.runPromise(load());
    const surface = new Map<string, string>(
      skills.map((skill) => [
        skill.id as string,
        skill.catalog.tier === "push" ? skill.catalog.trigger : skill.catalog.summary,
      ]),
    );

    const leaked = offences(blind, surface).map(
      (offence) => `${offence.prompt} -> ${offence.id} (${offence.shared} words)`,
    );
    expect(leaked).toEqual([]);
  });

  test("toSkillInfo strips catalog metadata before OpenCode registration", async () => {
    const [first] = await Effect.runPromise(load());
    if (first === undefined) throw new Error("expected at least one skill");
    const info = toSkillInfo(first);

    expect("catalog" in info).toBe(false);
    expect(Object.keys(info).toSorted()).toEqual(
      ["autoinvoke", "content", "description", "id", "name", "path"].toSorted(),
    );
  });
});

describe("skill tool contract", () => {
  const makeDraft = () => ({
    tools: {
      skill: {
        description: "Original OpenCode skill description",
        input: {
          type: "object",
          properties: {
            id: {
              type: "string",
              description: "Original id description",
            },
          },
        },
      },
    },
  });

  test("shapeSkillTool updates both skill description and input.properties.id.description in place", () => {
    const draft = makeDraft();
    shapeSkillTool(draft);

    expect(draft.tools.skill.description).toBe(SKILL_TOOL_DESCRIPTION);
    expect(
      (draft.tools.skill.input as { properties: { id: { description: string } } }).properties.id
        .description,
    ).toBe(SKILL_ID_DESCRIPTION);
  });

  test("attachSkillToolContract rewrites skill tool for spectre and subagents, leaving mnemonic and build untouched", async () => {
    let hookName: string | undefined;
    let handler: ((event: ContextEvent) => Effect.Effect<void>) | undefined;
    const ctx = {
      session: {
        hook: (name: string, cb: (event: ContextEvent) => Effect.Effect<void>) => {
          hookName = name;
          handler = cb;
          return Effect.void;
        },
      },
    };

    await Effect.runPromise(Effect.scoped(attachSkillToolContract(ctx as never)));
    expect(hookName).toBe("context");
    if (handler === undefined) throw new Error("expected context hook");

    const idDescriptionOf = (event: ContextEvent) => {
      const skill = event.tools.skill;
      if (skill === undefined) throw new Error("expected skill tool");
      return (skill.input as { properties: { id: { description: string } } }).properties.id
        .description;
    };

    for (const agent of ["build", "mnemonic"]) {
      const event: ContextEvent = { agent, ...makeDraft() };
      await Effect.runPromise(handler(event));
      expect(event.tools.skill?.description).toBe("Original OpenCode skill description");
      expect(idDescriptionOf(event)).toBe("Original id description");
    }

    for (const agent of ["nocturna", "operator", "sicko"]) {
      const event: ContextEvent = { agent, ...makeDraft() };
      await Effect.runPromise(handler(event));
      expect(event.tools.skill?.description).toBe(SUBAGENT_SKILL_TOOL_DESCRIPTION);
      expect(idDescriptionOf(event)).toBe(SUBAGENT_SKILL_ID_DESCRIPTION);
    }

    const spectreEvent: ContextEvent = { agent: "spectre", ...makeDraft() };
    await Effect.runPromise(handler(spectreEvent));
    expect(spectreEvent.tools.skill?.description).toBe(SKILL_TOOL_DESCRIPTION);
    expect(idDescriptionOf(spectreEvent)).toBe(SKILL_ID_DESCRIPTION);
  });
});
