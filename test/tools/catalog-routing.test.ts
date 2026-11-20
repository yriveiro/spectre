import { describe, expect, test } from "bun:test";
import { CodeMode, Namespace, Tool } from "@opencode/codemode";
import type { Tool as PluginTool } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Schema } from "effect";
import { NAMESPACE_DESCRIPTION } from "../../tools";
import { brain } from "../../tools/definitions/brain";
import { canvases } from "../../tools/definitions/canvas";
import { comments } from "../../tools/definitions/comments";
import { goal } from "../../tools/definitions/goal";
import { historyTool } from "../../tools/definitions/history";
import { nocturnaTool } from "../../tools/definitions/nocturna";
import { pr } from "../../tools/definitions/pr";
import { prose } from "../../tools/definitions/prose";
import { routing } from "../../tools/definitions/routing";
import { ripwire } from "../../tools/definitions/search";
import { skillsTool } from "../../tools/definitions/skills";
import { solidjs } from "../../tools/definitions/solidjs";
import { stack } from "../../tools/definitions/stack";
import { worktrees } from "../../tools/definitions/worktrees";

type SearchResponse = {
  readonly items: ReadonlyArray<{
    readonly path: string;
    readonly description: string;
    readonly signature: string;
  }>;
  readonly remaining: number;
  readonly next: { readonly offset: number } | null;
};

const directory = AbsolutePath.make(process.cwd());
const ctx = {
  location: {
    directory,
    project: { id: "proj_test", directory, canonical: directory },
  },
} as never;

type RegisteredTool = {
  readonly name: string;
  readonly description: string;
  readonly input?: Tool.SchemaType;
  readonly output?: Tool.SchemaType;
  readonly freeform?: unknown;
  readonly options?: PluginTool.Options;
};

const SPECTRE_TOOLS: ReadonlyArray<RegisteredTool> = [
  brain(ctx),
  canvases(ctx),
  comments(directory),
  goal(ctx),
  historyTool(directory),
  nocturnaTool(ctx),
  pr(ctx),
  prose(directory),
  ripwire(ctx),
  routing(ctx),
  skillsTool(),
  solidjs(directory),
  stack(directory),
  worktrees(ctx),
];

const EmptyFields = { path: Schema.optional(Schema.String) };

const distractor = (
  description: string,
  fields: Record<string, Schema.Top & { readonly DecodingServices: never }> = EmptyFields,
) =>
  Tool.make({
    description,
    input: Schema.Struct(fields),
    output: Schema.Struct({ ok: Schema.Boolean }),
    execute: () => Effect.succeed({ ok: true }),
  });

const BROWSE_DISTRACTORS = Namespace.make({
  description: "Drive a connected Chrome browser tab through snapshots, navigation, and actions.",
  tools: {
    upload: distractor(
      "Upload local project files or in-memory buffers to a file input element in a connected browser tab using an accessibility snapshot ref, waiting for change events before returning.",
      { tab: Schema.String, ref: Schema.String, files: Schema.Array(Schema.String) },
    ),
    recording: distractor(
      "Start, pause, stop, or export a browser tab interaction recording session with captured viewport frames, DOM events, and console messages for debugging user flows.",
      { tab: Schema.String, action: Schema.String },
    ),
    navigate: distractor(
      "Open an HTTP or HTTPS URL in a new background browser tab or navigate an existing tab handle, returning the resolved URL, page title, and tab identifier.",
      { url: Schema.String, tab: Schema.optional(Schema.String) },
    ),
    snapshot: distractor(
      "Inspect a connected browser tab and return its current accessibility tree with stable element refs for clicking, filling, typing, hovering, or selecting controls.",
      { tab: Schema.String },
    ),
    screenshot: distractor(
      "Capture a PNG screenshot of the visible browser viewport, full scrollable page, or a specific element ref inside a connected Chrome tab.",
      { tab: Schema.String, ref: Schema.optional(Schema.String) },
    ),
  },
});

const UV_DISTRACTORS = Namespace.make({
  description: "Manage Python environments, dependencies, builds, and package audits with uv.",
  tools: {
    build: distractor(
      "Build Python source distributions and binary wheels for the current project or selected workspace member into the dist output directory with isolated build environments.",
      { package: Schema.optional(Schema.String) },
    ),
    check: distractor(
      "Verify pyproject.toml metadata, Python lockfile consistency, dependency version constraints, and virtual environment synchronization without modifying installed packages.",
      { locked: Schema.optional(Schema.Boolean) },
    ),
    publish: distractor(
      "Upload built Python wheel and source distribution archives from dist to PyPI or a configured private package index using token credentials.",
      { index_url: Schema.optional(Schema.String) },
    ),
    audit: distractor(
      "Scan installed Python packages and uv.lock dependencies for known CVE security vulnerabilities, yanked releases, and adverse package advisories.",
      { ignore: Schema.optional(Schema.Array(Schema.String)) },
    ),
    add: distractor(
      "Add one or more Python package dependencies with optional version specifiers or extras to pyproject.toml, re-locking and syncing the project environment.",
      { package_name: Schema.String, version: Schema.optional(Schema.String) },
    ),
    sync: distractor(
      "Synchronize the active Python virtual environment with exact package versions locked in uv.lock, installing missing wheels and pruning extraneous packages.",
      { frozen: Schema.optional(Schema.Boolean) },
    ),
  },
});

const BIOME_DISTRACTORS = Namespace.make({
  description: "Run Biome formatting, linting, and code-quality checks on TypeScript and web files.",
  tools: {
    biome_lint: distractor(
      "Run Biome static lint rules across TypeScript, JavaScript, JSX, CSS, and JSON files to report code diagnostics and fixable issues without writing files.",
      { paths: Schema.optional(Schema.Array(Schema.String)), changed_only: Schema.optional(Schema.Boolean) },
    ),
    biome_check: distractor(
      "Run Biome formatting, linting, and import-sorting assist checks across repository files or changed paths with compact token-efficient diagnostic output.",
      { paths: Schema.optional(Schema.Array(Schema.String)), changed_only: Schema.optional(Schema.Boolean) },
    ),
    biome_format: distractor(
      "Verify Biome code formatting on TypeScript, JSX, and JSON files against configured indentation and line-width rules without modifying files on disk.",
      { paths: Schema.optional(Schema.Array(Schema.String)) },
    ),
  },
});

const OPENCODE_DISTRACTORS = Namespace.make({
  description: "Tools for managing OpenCode sessions, worktrees, models, and artifacts.",
  tools: {
    models: distractor(
      "Search and list provider models configured in OpenCode, returning provider IDs, model IDs, context window sizes, token costs, and supported reasoning variants.",
      { query: Schema.optional(Schema.String), provider: Schema.optional(Schema.String) },
    ),
    worktree_create: distractor(
      "Create a named git worktree through the OpenCode host worktree service and return its absolute filesystem directory without moving the active session.",
      { name: Schema.String },
    ),
    worktree_remove: distractor(
      "Remove a git worktree directory registered with the OpenCode host, optionally discarding modified and untracked files when forced removal is confirmed.",
      { directory: Schema.String, force: Schema.optional(Schema.Boolean) },
    ),
    worktree_list: distractor(
      "List every git worktree directory and configured worktree strategy currently registered for the active OpenCode repository.",
      {},
    ),
    artifact_create: distractor(
      "Create a raw OpenCode artifact from a map of relative file paths and UTF-8 contents, returning the stored artifact identifier and viewer path.",
      { title: Schema.String },
    ),
    session_move: distractor(
      "Move an OpenCode session or the current session to another filesystem working directory at the next message delivery boundary.",
      { directory: Schema.String, sessionID: Schema.optional(Schema.String) },
    ),
  },
});

const ATLASSIAN_DISTRACTORS = Namespace.make({
  description: "Manage Jira issues, Confluence pages, comments, and Teamwork Graph entities.",
  tools: {
    createConfluencePage: distractor(
      "Create a new Confluence documentation page inside a target space using Markdown or Atlassian Document Format JSON body content and optional parent page ID.",
      { cloudId: Schema.String, spaceId: Schema.String, title: Schema.String, body: Schema.String },
    ),
    createConfluenceInlineComment: distractor(
      "Create an inline review comment anchored to highlighted text selection properties on a published Confluence page in Atlassian Cloud.",
      { cloudId: Schema.String, pageId: Schema.String, body: Schema.String },
    ),
    addCommentToJiraIssue: distractor(
      "Add a new comment or update an existing comment on a Jira issue key using Markdown or Atlassian Document Format with optional role visibility.",
      { cloudId: Schema.String, issueIdOrKey: Schema.String, commentBody: Schema.String },
    ),
    createJiraIssue: distractor(
      "Create a Jira work item in an Atlassian Cloud project with issue type, summary, description, assignee, priority, and custom field values.",
      { cloudId: Schema.String, projectKey: Schema.String, summary: Schema.String },
    ),
    getTeamworkGraphContext: distractor(
      "Retrieve Teamwork Graph relationships and connected context across Atlassian projects, goals, teams, people, Confluence pages, and Jira work items.",
      { entityAri: Schema.String },
    ),
  },
});

const PLAYWRIGHT_DISTRACTORS = Namespace.make({
  description: "Automate headless browser testing, DOM snapshots, and network inspection with Playwright.",
  tools: {
    browser_network_request: distractor(
      "List HTTP and XHR network requests, response status codes, headers, and timing captured by Playwright since page load or navigation.",
      { urlFilter: Schema.optional(Schema.String) },
    ),
    browser_snapshot: distractor(
      "Capture a structured ARIA accessibility snapshot of the active Playwright browser page with element refs for automated interaction.",
      {},
    ),
    browser_evaluate: distractor(
      "Execute a JavaScript function or expression inside the active Playwright browser frame and return its JSON-serializable return value.",
      { expression: Schema.String },
    ),
  },
});

const DISTRACTORS = {
  browse: BROWSE_DISTRACTORS,
  uv: UV_DISTRACTORS,
  biome: BIOME_DISTRACTORS,
  opencode: OPENCODE_DISTRACTORS,
  atlassian: ATLASSIAN_DISTRACTORS,
  playwright: PLAYWRIGHT_DISTRACTORS,
};

const toCodeModeTool = (registration: RegisteredTool) =>
  Tool.make({
    description: registration.description,
    input: registration.input ?? {},
    freeform: registration.freeform !== undefined,
    output: registration.output ?? Schema.NullOr(Schema.String),
    execute: () => Effect.succeed(null),
  });

const runtime = CodeMode.make({
  tools: {
    spectre: Namespace.make({
      description: NAMESPACE_DESCRIPTION,
      tools: Object.fromEntries(SPECTRE_TOOLS.map((tool) => [tool.name, toCodeModeTool(tool)])),
    }),
    ...DISTRACTORS,
  },
});

const runSearch = async (query: string, limit = 5): Promise<SearchResponse> => {
  const result = await Effect.runPromise(
    runtime.execute("return search({ query, limit })", { query, limit }),
  );
  if (!result.ok) throw new Error(`CodeMode search failed: ${result.error.message}`);
  return result.value as SearchResponse;
};

const wordCount = (text: string): number => text.trim().split(/\s+/).filter(Boolean).length;

const TASK_QUERIES: ReadonlyArray<readonly [query: string, expectedPath: string]> = [
  ["project memory decisions gotchas", "tools.spectre.brain"],
  ["record lesson constraint", "tools.spectre.brain"],
  ["publish html page mermaid diagram", "tools.spectre.canvas"],
  ["visual pull request review artifact", "tools.spectre.canvas"],
  ["inventory code comments lint suppressions", "tools.spectre.comments"],
  ["find ts-ignore eslint-disable comments", "tools.spectre.comments"],
  ["arm autonomous goal loop ledger", "tools.spectre.goal"],
  ["goal loop status rounds predicate", "tools.spectre.goal"],
  ["file git commit history blame", "tools.spectre.history"],
  ["git pickaxe commit introduced line", "tools.spectre.history"],
  ["compose and open pull request", "tools.spectre.pr"],
  ["open github pr conventional commit", "tools.spectre.pr"],
  ["asd-ste100 markdown prose grammar", "tools.spectre.prose"],
  ["prose passive voice semicolons dictionary", "tools.spectre.prose"],
  ["pre-commit quality-delta and affected tests check", "tools.spectre.ripwire"],
  ["sessions that skipped ripwire verbs", "tools.spectre.ripwire"],
  ["subagent model routing effort profile", "tools.spectre.routing"],
  ["task judge model allowlist crosscheck", "tools.spectre.routing"],
  ["detect solid 1 or solid 2", "tools.spectre.solidjs"],
  ["audit solidjs jsx reactivity", "tools.spectre.solidjs"],
  ["stacked pull requests merge order", "tools.spectre.stack"],
  ["pr stack blocker merge conflicts", "tools.spectre.stack"],
  ["open branch worktree move session", "tools.spectre.worktrees"],
  ["cleanup git worktrees hold-wip safe", "tools.spectre.worktrees"],
  ["search list inspect spectre skill catalog", "tools.spectre.skills"],
  ["preview skill headings pull workflows", "tools.spectre.skills"],
  ["audit past opencode sessions rolling window", "tools.spectre.nocturna"],
  ["nocturna session watermark storage", "tools.spectre.nocturna"],
];

describe("Code Mode catalog routing surface", () => {
  test("mounts a 42-tool catalog (14 spectre tools + 28 MCP distractors)", () => {
    expect(SPECTRE_TOOLS).toHaveLength(14);
    expect(runtime.catalog).toHaveLength(42);
  });

  test("zero tools.spectre.* tools set pinned: true", () => {
    const pinned = SPECTRE_TOOLS.filter((tool) => tool.options?.pinned === true).map(
      (tool) => tool.name,
    );
    expect(pinned).toEqual([]);
  });

  test("every tools.spectre.* description fits line 1 <= 120 chars and 30..95 words", () => {
    for (const tool of SPECTRE_TOOLS) {
      const firstLine = tool.description.split("\n", 1)[0] ?? "";
      const words = wordCount(tool.description);
      expect({ tool: tool.name, firstLineFits: firstLine.length <= 120 }).toEqual({
        tool: tool.name,
        firstLineFits: true,
      });
      expect(words).toBeGreaterThanOrEqual(30);
      expect(words).toBeLessThanOrEqual(95);
    }
  });

  test("NAMESPACE_DESCRIPTION names every Spectre Code Mode tool and spectre_search", () => {
    for (const tool of SPECTRE_TOOLS) {
      expect(NAMESPACE_DESCRIPTION).toContain(tool.name);
    }
    expect(NAMESPACE_DESCRIPTION).toContain("spectre_search");
  });

  test("exact-path search({ query: 'tools.spectre.<name>' }) returns [exact] for all 14 tools", async () => {
    for (const tool of SPECTRE_TOOLS) {
      const path = `tools.spectre.${tool.name}`;
      const res = await runSearch(path);
      expect(res.items.map((item) => item.path)).toEqual([path]);
      expect(res.remaining).toBe(0);
    }
  });

  for (const [query, expectedPath] of TASK_QUERIES) {
    test(`ranks ${expectedPath} #1 for "${query}"`, async () => {
      const res = await runSearch(query, 5);
      expect(res.items[0]?.path).toBe(expectedPath);
    });
  }
});
