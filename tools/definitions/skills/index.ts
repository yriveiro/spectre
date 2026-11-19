import { Tool } from "@opencode/plugin/effect";
import { Effect, Schema } from "effect";
import { load, type LoadedSkill } from "../../../skills/definitions";
import {
  bodyTokensOf,
  extractHeadings,
  matchesSkillFilter,
  previewBody,
  rankSkills,
  siblingReferences,
  suggestIds,
  summaryOf,
} from "./rank";

const Tier = Schema.Literals(["push", "hub", "pull"]);
const ListTier = Schema.Literals(["push", "hub", "pull", "all"]);
const PushGroupSchema = Schema.Literals(["leaf", "communication"]);
const PullCategorySchema = Schema.Literals([
  "playbook",
  "stack",
  "visual",
  "design",
  "verification",
  "writing",
]);

export const InspectInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["inspect"])).annotate({
    description:
      "Inspect one skill's full description, headings, opening lines, and reference files before calling skill({ id }).",
  }),
  id: Schema.String.annotate({
    description:
      "Exact skill id, such as `playbook-bug-fix`, `opencode-platform`, or `pr-canvas`.",
  }),
  previewLines: Schema.optional(Schema.Int).annotate({
    description: "Opening lines of SKILL.md to preview (0..80). Default 24.",
  }),
});

export const SearchInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["search"])).annotate({
    description: "Rank skills against `query`. Default when `query` is provided.",
  }),
  query: Schema.String.annotate({
    description: "Task, stack, artifact, or symptom in plain words.",
  }),
  tier: Schema.optional(Tier).annotate({
    description:
      "Restrict search to `push` (33), `hub` (3), or `pull` (49). Searches all 85 skills when omitted.",
  }),
  group: Schema.optional(PushGroupSchema).annotate({
    description: "Restrict search to one push group (`leaf`, `communication`).",
  }),
  category: Schema.optional(PullCategorySchema).annotate({
    description:
      "Restrict search to one pull category (`playbook`, `stack`, `visual`, `design`, `verification`, `writing`).",
  }),
  limit: Schema.optional(Schema.Int).annotate({
    description: "Maximum ranked matches to return (1..25). Default 5.",
  }),
});

export const ListInput = Schema.Struct({
  action: Schema.optional(Schema.Literals(["list"])).annotate({
    description:
      "List compact catalog entries without full descriptions. Default when neither `id` nor `query` is provided.",
  }),
  tier: Schema.optional(ListTier).annotate({
    description:
      "Which tier to list. Defaults to `pull` (the 25 playbooks and 24 domain/workflow skills not pushed inline).",
  }),
  group: Schema.optional(PushGroupSchema).annotate({
    description: "Optional filter for push skills (`leaf`, `communication`).",
  }),
  category: Schema.optional(PullCategorySchema).annotate({
    description:
      "Optional filter for pull skills (`playbook`, `stack`, `visual`, `design`, `verification`, `writing`).",
  }),
});

export const SkillsInput = Schema.Union([InspectInput, SearchInput, ListInput]);

const MatchedRow = Schema.Struct({
  id: Schema.String,
  tier: Tier,
  group: Schema.optional(PushGroupSchema),
  category: Schema.optional(PullCategorySchema),
  score: Schema.Number,
  summary: Schema.String,
  description: Schema.String,
  bodyTokens: Schema.Int,
});

const ListedRow = Schema.Struct({
  id: Schema.String,
  tier: Tier,
  group: Schema.optional(PushGroupSchema),
  category: Schema.optional(PullCategorySchema),
  summary: Schema.String,
  bodyTokens: Schema.Int,
});

export const MatchedOutput = Schema.Struct({
  status: Schema.Literals(["matched"]),
  query: Schema.String,
  total: Schema.Int,
  items: Schema.Array(MatchedRow),
});

export const ListedOutput = Schema.Struct({
  status: Schema.Literals(["listed"]),
  tier: ListTier,
  count: Schema.Int,
  items: Schema.Array(ListedRow),
});

export const InspectedOutput = Schema.Struct({
  status: Schema.Literals(["inspected"]),
  id: Schema.String,
  tier: Tier,
  group: Schema.optional(PushGroupSchema),
  category: Schema.optional(PullCategorySchema),
  autoinvoke: Schema.Boolean,
  summary: Schema.String,
  description: Schema.String,
  headings: Schema.Array(Schema.String),
  preview: Schema.String,
  references: Schema.Array(Schema.String),
  bodyTokens: Schema.Int,
  loadWith: Schema.String,
});

export const NotFoundOutput = Schema.Struct({
  status: Schema.Literals(["not-found"]),
  id: Schema.String,
  suggestions: Schema.Array(Schema.String),
});

export const SkillsOutput = Schema.Union([
  MatchedOutput,
  ListedOutput,
  InspectedOutput,
  NotFoundOutput,
]);

export const DESCRIPTION = `Search, list, and inspect registered Spectre skills across push principles, playbooks, hubs, and pull workflows.
Ranks all 85 skill definitions by BM25 over ids, triggers, summaries, and full descriptions so you can pick the exact id before calling the native skill tool. Filter by tier or pull category (playbook, stack, visual, design, verification, writing), or inspect one id to preview headings, opening lines, and reference files without loading the full SKILL.md body.`;

const taxonomyFields = (skill: LoadedSkill) => {
  if (skill.catalog.tier === "push") return { tier: "push" as const, group: skill.catalog.group };
  if (skill.catalog.tier === "pull") return { tier: "pull" as const, category: skill.catalog.category };
  return { tier: "hub" as const };
};

const inspectSkill = (all: ReadonlyArray<LoadedSkill>, input: typeof InspectInput.Type) =>
  Effect.gen(function* () {
    const found = all.find((skill) => skill.id === input.id);
    if (found === undefined) {
      const missing: typeof NotFoundOutput.Type = {
        status: "not-found",
        id: input.id,
        suggestions: [...suggestIds(all, input.id)],
      };
      return { output: missing, content: JSON.stringify(missing) };
    }
    const references = yield* Effect.promise(() => siblingReferences(found));
    const inspected: typeof InspectedOutput.Type = {
      status: "inspected",
      id: found.id,
      ...taxonomyFields(found),
      autoinvoke: Boolean(found.autoinvoke),
      summary: summaryOf(found),
      description: found.description,
      headings: [...extractHeadings(found.content)],
      preview: previewBody(found.content, input.previewLines ?? 24),
      references: [...references],
      bodyTokens: bodyTokensOf(found),
      loadWith: `skill({ id: ${JSON.stringify(found.id)} })`,
    };
    return { output: inspected, content: JSON.stringify(inspected) };
  });

const searchSkills = (all: ReadonlyArray<LoadedSkill>, input: typeof SearchInput.Type) => {
  const ranked = rankSkills(all, {
    query: input.query,
    tier: input.tier,
    group: input.group,
    category: input.category,
    limit: input.limit ?? 5,
  });
  const output: typeof MatchedOutput.Type = {
    status: "matched",
    query: input.query,
    total: ranked.total,
    items: ranked.hits.map(({ skill, score }) => ({
      id: skill.id,
      ...taxonomyFields(skill),
      score,
      summary: summaryOf(skill),
      description: skill.description,
      bodyTokens: bodyTokensOf(skill),
    })),
  };
  return { output, content: JSON.stringify(output) };
};

const listSkills = (all: ReadonlyArray<LoadedSkill>, input: typeof ListInput.Type) => {
  const requestedTier = input.tier ?? (input.group !== undefined ? "push" : "pull");
  const items = all
    .filter((skill) =>
      matchesSkillFilter(skill, {
        tier: requestedTier,
        group: input.group,
        category: input.category,
      }),
    )
    .toSorted((left, right) => left.id.localeCompare(right.id))
    .map((skill) => ({
      id: skill.id,
      ...taxonomyFields(skill),
      summary: summaryOf(skill),
      bodyTokens: bodyTokensOf(skill),
    }));

  const output: typeof ListedOutput.Type = {
    status: "listed",
    tier: requestedTier,
    count: items.length,
    items,
  };
  return { output, content: JSON.stringify(output) };
};

export const skillsTool = (): Tool.Info<typeof SkillsInput, typeof SkillsOutput> => ({
  name: "skills",
  description: DESCRIPTION,
  input: SkillsInput,
  output: SkillsOutput,
  options: { namespace: "spectre", codemode: true, permission: "read" },
  execute: (input) =>
    Effect.gen(function* () {
      const all = yield* load();
      if ("id" in input) return yield* inspectSkill(all, input);
      if ("query" in input) return searchSkills(all, input);
      return listSkills(all, input);
    }),
});
