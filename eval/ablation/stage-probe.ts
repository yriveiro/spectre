import { join } from "node:path";
import { Effect } from "effect";
import { assertExactSkillSet, type LeakageHit, type StagedAuditResult } from "./stage";

interface ProbeInput {
  readonly pluginDir: string;
  readonly arm: "present" | "stripped" | "replicate";
  readonly targetSkill: string;
  readonly sourceSkillCount: number;
  readonly expectedIds: ReadonlyArray<string>;
  readonly strippedIds: ReadonlyArray<string>;
}

const TDD_LEAK_PATTERNS: ReadonlyArray<{ readonly name: string; readonly regex: RegExp }> = [
  { name: "tdd-slug", regex: /\btdd\b/i },
  { name: "failing-test-first", regex: /failing[- ]test[- ]first/i },
  { name: "failing-test-before-prod", regex: /failing test before production edit/i },
  { name: "failing-test-cadence", regex: /failing-test cadence/i },
  { name: "write-failing-test-first", regex: /write the failing test first/i },
  { name: "failing-run-before-fix", regex: /failing run lands in git\s+before the fix/i },
];

const collectSchemaDescriptions = (
  node: unknown,
  out: Array<string>,
  seen = new Set<unknown>(),
): void => {
  if (node === null || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  const record = node as Record<string, unknown>;
  if (typeof record.description === "string") out.push(record.description);
  for (const value of Object.values(record)) {
    if (Array.isArray(value)) {
      for (const item of value) collectSchemaDescriptions(item, out, seen);
    } else {
      collectSchemaDescriptions(value, out, seen);
    }
  }
};

const scanSurface = (
  surface: string,
  location: string,
  text: string,
  hits: Array<LeakageHit>,
): void => {
  for (const { name, regex } of TDD_LEAK_PATTERNS) {
    const match = regex.exec(text);
    if (match === null) continue;
    const start = Math.max(0, match.index - 40);
    const end = Math.min(text.length, match.index + match[0].length + 40);
    hits.push({
      surface,
      location,
      pattern: name,
      snippet: text.slice(start, end).replaceAll("\n", " "),
    });
  }
};

const run = async (): Promise<void> => {
  const raw = Bun.argv[2];
  if (raw === undefined) throw new Error("stage-probe requires JSON payload argument");
  const input = JSON.parse(raw) as ProbeInput;

  const defsModule = (await import(join(input.pluginDir, "skills/definitions/index.ts"))) as {
    readonly definitions: ReadonlyArray<{ readonly id: string }>;
    readonly load: (options?: { readonly fresh?: boolean }) => Effect.Effect<
      ReadonlyArray<{
        readonly id: string;
        readonly name: string;
        readonly description: string;
        readonly content: string;
        readonly catalog:
          | { readonly tier: "push"; readonly group: string; readonly trigger: string }
          | { readonly tier: "pull"; readonly category: string; readonly summary: string }
          | { readonly tier: "hub"; readonly summary: string };
      }>
    >;
  };

  const catalogModule = (await import(join(input.pluginDir, "skills/catalog.ts"))) as {
    readonly CATALOG_TOKEN_CAP: number;
    readonly catalogTokens: (text: string) => number;
    readonly renderCatalog: (skills: ReadonlyArray<unknown>) => string;
  };

  const agentModule = (await import(join(input.pluginDir, "agents/definitions/spectre.ts"))) as {
    readonly spectre: { readonly system: string; readonly description: string };
  };

  const skillsToolModule = (await import(join(input.pluginDir, "tools/definitions/skills/index.ts"))) as {
    readonly skillsTool: () => {
      readonly description: string;
      readonly input: { readonly ast: unknown };
      readonly execute: (
        args: Record<string, unknown>,
        ctx: Record<string, unknown>,
      ) => Effect.Effect<{ readonly output?: Record<string, unknown>; readonly content?: unknown }>;
    };
  };

  const loaded = await Effect.runPromise(defsModule.load({ fresh: true }));
  const loadedIds = loaded.map((skill) => skill.id);
  const exactSet = assertExactSkillSet(loadedIds, input.expectedIds, "staged-load");

  const renderedCatalog = catalogModule.renderCatalog(loaded);
  const catalogTokenCount = catalogModule.catalogTokens(renderedCatalog);
  const catalogTokenCap = catalogModule.CATALOG_TOKEN_CAP;

  const tool = skillsToolModule.skillsTool();
  const stubCtx = {
    sessionID: "ses_probe",
    agent: "spectre",
    messageID: "msg_probe",
    id: "call_probe",
    progress: () => Effect.void,
  };

  const inspectResult = await Effect.runPromise(tool.execute({ id: input.targetSkill }, stubCtx));
  const inspectOutput = inspectResult.output ?? {};
  const inspectStatus = typeof inspectOutput.status === "string" ? inspectOutput.status : "missing";
  const inspectSuggestions = Array.isArray(inspectOutput.suggestions)
    ? inspectOutput.suggestions.filter((item): item is string => typeof item === "string")
    : [];

  const searchResult = await Effect.runPromise(
    tool.execute({ query: "tdd failing test before production edit", limit: 10 }, stubCtx),
  );
  const searchOutput = searchResult.output ?? {};
  const searchItems = Array.isArray(searchOutput.items)
    ? (searchOutput.items as ReadonlyArray<{ readonly id?: unknown }>)
    : [];
  const searchContainsTarget = searchItems.some((item) => item.id === input.targetSkill);

  const listResult = await Effect.runPromise(tool.execute({ tier: "all" }, stubCtx));
  const listOutput = listResult.output ?? {};
  const listItems = Array.isArray(listOutput.items)
    ? (listOutput.items as ReadonlyArray<{ readonly id?: unknown }>)
        .map((item) => (typeof item.id === "string" ? item.id : ""))
        .filter((id) => id !== "")
    : [];
  const toolListExactSet = assertExactSkillSet(listItems, input.expectedIds, "skills-tool-list");

  const schemaDescriptions: Array<string> = [];
  collectSchemaDescriptions(tool.input.ast, schemaDescriptions);
  const renderedToolSurface = [tool.description, ...schemaDescriptions].join("\n");

  const leaks: Array<LeakageHit> = [];
  const findings: Array<string> = [...exactSet.findings, ...toolListExactSet.findings];

  if (catalogTokenCount > catalogTokenCap) {
    findings.push(`catalog token count ${catalogTokenCount} exceeds cap ${catalogTokenCap}`);
  }

  let schemaClean = true;
  if (input.arm === "stripped") {
    if (inspectStatus !== "not-found") {
      findings.push(
        `skillsTool inspect("${input.targetSkill}") expected status "not-found", got "${inspectStatus}"`,
      );
    }
    if (inspectSuggestions.includes(input.targetSkill)) {
      findings.push(`skillsTool inspect("${input.targetSkill}") suggested stripped target`);
    }
    if (searchContainsTarget) {
      findings.push(`skillsTool search returned stripped target "${input.targetSkill}"`);
    }

    if (
      renderedToolSurface.includes("playbook-bug-fix") ||
      renderedToolSurface.includes(`all ${input.sourceSkillCount} skill`) ||
      renderedToolSurface.includes(`all ${input.sourceSkillCount} skills`)
    ) {
      schemaClean = false;
      findings.push("skillsTool schema retains unstripped example ids or stale catalog counts");
    }

    scanSurface("agent-prompt", "agents/definitions/spectre.ts", agentModule.spectre.system, leaks);
    scanSurface(
      "agent-description",
      "agents/definitions/spectre.ts",
      agentModule.spectre.description,
      leaks,
    );
    scanSurface("catalog", "skills/catalog.ts", renderedCatalog, leaks);
    scanSurface("tool-schema", "tools/definitions/skills/index.ts", renderedToolSurface, leaks);

    for (const skill of loaded) {
      const catalogLine =
        skill.catalog.tier === "push" ? skill.catalog.trigger : skill.catalog.summary;
      scanSurface("skill-meta", `skills/definitions/${skill.id}/index.ts`, skill.description, leaks);
      scanSurface("skill-catalog", `skills/definitions/${skill.id}/index.ts`, catalogLine, leaks);
      scanSurface("skill-body", `skills/definitions/${skill.id}/SKILL.md`, skill.content, leaks);
    }

    const refGlob = new Bun.Glob("*/references/**/*.md");
    for await (const entry of refGlob.scan({ cwd: join(input.pluginDir, "skills/definitions") })) {
      if (entry.startsWith(`${input.targetSkill}/`)) continue;
      const text = await Bun.file(join(input.pluginDir, "skills/definitions", entry)).text();
      scanSurface("skill-reference", `skills/definitions/${entry}`, text, leaks);
    }

    const commandGlob = new Bun.Glob("*/prompt.md");
    for await (const entry of commandGlob.scan({
      cwd: join(input.pluginDir, "commands/definitions"),
    })) {
      const text = await Bun.file(join(input.pluginDir, "commands/definitions", entry)).text();
      scanSurface("command-prompt", `commands/definitions/${entry}`, text, leaks);
    }

    if (leaks.length > 0) {
      findings.push(
        `detected ${leaks.length} residual cue(s): ${leaks.map((hit) => `${hit.location} [${hit.pattern}]`).join("; ")}`,
      );
    }
  } else {
    if (inspectStatus !== "inspected") {
      findings.push(
        `skillsTool inspect("${input.targetSkill}") expected status "inspected", got "${inspectStatus}"`,
      );
    }
  }

  const result: StagedAuditResult = {
    ok: findings.length === 0,
    exactSet,
    toolListExactSet,
    catalogTokenCount,
    catalogTokenCap,
    inspectStatus,
    searchContainsTarget,
    schemaClean,
    leaks,
    findings,
  };
  console.log(JSON.stringify(result));
};

await run();
