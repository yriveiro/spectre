import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import type { Definition } from "./definitions";

export const CATALOG_TOKEN_CAP = 1_500;

export const SKILL_TOOL_DESCRIPTION = [
  "Load a specialized skill's instructions and resources into the current conversation when the task at hand matches its description.",
  "",
  "The skill ID must match an available skill, a skill listed in the Spectre skill catalog, a skill returned by tools.spectre.skills, or a skill explicitly referenced by the user.",
].join("\n");

export const SKILL_ID_DESCRIPTION =
  "The ID of an available skill, a Spectre skill catalog entry, a skill returned by tools.spectre.skills, or a skill explicitly referenced by the user";

export const SUBAGENT_SKILL_TOOL_DESCRIPTION = [
  "Load a specialized skill's instructions and resources into the current conversation when the task at hand matches its description.",
  "",
  "The skill ID must match an available skill, a skill returned by tools.spectre.skills, a skill named in your system instructions, or a skill explicitly referenced by the user.",
].join("\n");

export const SUBAGENT_SKILL_ID_DESCRIPTION =
  "The ID of an available skill, a skill returned by tools.spectre.skills, a skill named in your system instructions, or a skill explicitly referenced by the user";

export interface SkillToolDraft {
  tools: Record<string, { description: string; input: unknown }>;
}

export const catalogTokens = (text: string): number => Math.ceil(text.length / 4);

export const renderCatalog = (skills: ReadonlyArray<Definition>): string => {
  const communication = skills
    .filter(
      (
        skill,
      ): skill is Definition & {
        readonly catalog: {
          readonly tier: "push";
          readonly group: "communication";
          readonly trigger: string;
        };
      } => skill.catalog.tier === "push" && skill.catalog.group === "communication",
    )
    .toSorted((left, right) => left.id.localeCompare(right.id));

  const leaves = skills
    .filter(
      (
        skill,
      ): skill is Definition & {
        readonly catalog: {
          readonly tier: "push";
          readonly group: "leaf";
          readonly trigger: string;
        };
      } => skill.catalog.tier === "push" && skill.catalog.group === "leaf",
    )
    .toSorted((left, right) => left.id.localeCompare(right.id));

  const playbooks = skills.filter(
    (skill) => skill.catalog.tier === "pull" && skill.catalog.category === "playbook",
  ).length;
  const pullOther = skills.filter(
    (skill) => skill.catalog.tier === "pull" && skill.catalog.category !== "playbook",
  ).length;
  const hubs = skills.filter((skill) => skill.catalog.tier === "hub").length;
  const disciplines = [...communication, ...leaves];

  const lines: Array<string> = [
    "## Spectre skill catalog",
    "",
    "Load any matching skill on demand with `skill({ id })` (exact ID as written; skip if none fits).",
    "",
    `Principles & checks (${disciplines.length}):`,
    ...disciplines.map((skill) => `- \`${skill.id}\`: ${skill.catalog.trigger}`),
    "",
    "SDLC gates:",
    "- Bug fix or defect with a local test target → `playbook-bug-fix` + `tdd` (failing test before production edit).",
    "- Non-trivial diff (`>=3` code files or `>=100` LOC) before PR → `interrogate` (different model family) + `code-hygiene`.",
    "- Plugin/host code (`ctx.*`, hooks, tools) → `opencode-platform`.",
    "",
    `Playbooks (${playbooks}) & pull skills (${pullOther} + ${hubs} hubs): call \`tools.spectre.skills({ query })\` or \`tools.spectre.skills({ category })\` in \`execute\` before \`skill({ id })\`:`,
    `- \`playbook\` (${playbooks}): ordered multi-phase task procedures — load \`playbook\` for the selection rule or query \`tools.spectre.skills({ category: "playbook" })\`.`,
    "- `stack`: Effect 4.1 (`effect-best-practices`), Elysia (`elysia-best-practices`), SolidJS (`solidjs-best-practices`), TypeScript (`typescript-best-practices`), OpenCode 2.3 (`opencode-platform`).",
    "- `visual`: interactive HTML pages (`canvas`), diagrams/charts (`diagram`), PR diff walkthroughs (`pr-canvas`).",
    "- `verification`: failing-test-first (`tdd`), impact checks (`blast-radius`), app verification (`create-verification-skill`, `maintain-verification-skill`).",
    "- `design`: architecture (`architect`), multi-model design (`arena`), adversarial review (`interrogate`), parallel fan-out (`swarm`), ad-hoc plans (`figure-it-out`), decision ledger (`show-me-your-work`).",
    "- `writing`: walkthroughs (`how`), git rationale (`why`), guided lessons (`teach`), docs (`technical-writing`), plain restatements (`bro`), personal habits (`automate-me`).",
    "- `hubs`: `spectre-mode`, `playbook`, `ripwire`.",
  ];

  return lines.join("\n");
};

export const shapeSkillTool = (
  draft: SkillToolDraft,
  toolDescription: string = SKILL_TOOL_DESCRIPTION,
  idDescription: string = SKILL_ID_DESCRIPTION,
): void => {
  const skill = draft.tools.skill;
  if (skill === undefined) return;
  skill.description = toolDescription;
  if (typeof skill.input !== "object" || skill.input === null) return;
  const schema = skill.input as { properties?: { id?: { description?: string } } };
  if (schema.properties?.id !== undefined) {
    schema.properties.id.description = idDescription;
  }
};

export const attachSkillToolContract = (ctx: Plugin.Context) =>
  ctx.session
    .hook("context", (event) => {
      if (event.agent === "spectre") shapeSkillTool(event);
      else if (
        event.agent === "nocturna" ||
        event.agent === "operator" ||
        event.agent === "sicko"
      ) {
        shapeSkillTool(event, SUBAGENT_SKILL_TOOL_DESCRIPTION, SUBAGENT_SKILL_ID_DESCRIPTION);
      }
      return Effect.void;
    })
    .pipe(
      Effect.tap(() =>
        Effect.logInfo("Registered skill tool contract", { trigger: "session.context" }),
      ),
      Effect.asVoid,
    );
