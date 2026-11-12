import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
import type { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { canvases } from "../../tools/definitions/canvas";
import type { Input as CanvasInput, Output, Review } from "../../tools/definitions/canvas/content";
import { CACHE_ROOT, write } from "../../tools/definitions/canvas/evidence";
import type { Read } from "../../tools/definitions/canvas/read";

/**
 * The dispatcher end to end: `publish`/`update` through a fake artifact tool,
 * the report and diagram composers, the page arm with the real d3 bundle, and
 * the PR arm through a real evidence cache. The fake tool is the host seam; the
 * composers and the cache are the production code.
 */

const PROJECT = join(Bun.env.TMPDIR ?? "/tmp", `canvas-tool-${process.pid}`);

const digest = (project: string): string => Bun.hash(project).toString(16).slice(0, 8);

type RecordedInput = {
  readonly title?: string;
  readonly id?: string;
  readonly entry?: string;
  readonly provider?: string;
  readonly files?: Readonly<Record<string, string>>;
};

type Recorded = {
  readonly tool: "artifact_create" | "artifact_update";
  readonly input: RecordedInput;
};

const info = (title: string, id: string) => ({
  id,
  provider: "local",
  title,
  entry: "index.html",
  url: `/api/experimental/artifacts/${id}/view/`,
  time: { created: 1, updated: 1 },
});

const fakeTool = (
  name: "artifact_create" | "artifact_update",
  calls: Array<Recorded>,
): Tool.Info & { readonly id: string } =>
  ({
    id: `opencode_${name}`,
    name,
    description: "",
    input: {},
    options: { namespace: "opencode", codemode: true },
    execute: (input: unknown) => {
      const recorded = (input ?? {}) as RecordedInput;
      calls.push({ tool: name, input: recorded });
      return Effect.succeed({
        output: info(recorded.title ?? "Untitled", recorded.id ?? "art_test"),
      });
    },
  }) as unknown as Tool.Info & { readonly id: string };

const ctxFor = (project: string, tools: ReadonlyArray<Tool.Info & { readonly id: string }>) =>
  ({
    location: { directory: project, project: { id: "p", directory: project, canonical: project } },
    tool: { list: () => Effect.succeed(tools) },
  }) as unknown as Plugin.Context;

const toolContext = {
  sessionID: "ses_test",
  agent: "spectre",
  messageID: "msg_test",
  id: "call_test",
  progress: () => Effect.void,
} as unknown as Tool.Context;

const run = async (ctx: Plugin.Context, input: CanvasInput): Promise<Output> => {
  const result = await Effect.runPromise(canvases(ctx).execute(input, toolContext));
  if (result.output === undefined) throw new Error("canvas returned no output");
  return result.output;
};

const published = (output: Output) => {
  if (output.status !== "published")
    throw new Error(`expected published, got ${JSON.stringify(output)}`);
  return output;
};

const makeRead = (): Extract<Read, { status: "read" }> => ({
  status: "read",
  subject: {
    kind: "pull-request",
    number: 7,
    repository: "owner/repo",
    url: "https://github.com/owner/repo/pull/7",
    title: "Add the constant",
    author: "author",
    state: "open",
    headSha: "0123456789abcdef0123456789abcdef01234567",
    baseRef: "main",
    headRef: "feature",
    additions: 1,
    deletions: 0,
    changedFiles: 1,
    isDraft: false,
    body: "",
  },
  files: [
    {
      status: "read",
      index: 1,
      path: "src/a.ts",
      rows: [{ kind: "added", new: 1, text: "const x = 1" }],
      additions: 1,
      deletions: 0,
    },
  ],
  cross: {
    kind: "matched",
    parsed: { files: 1, additions: 1, deletions: 0 },
    reported: { files: 1, additions: 1, deletions: 0 },
  },
  problems: [],
});

beforeEach(async () => {
  await rm(PROJECT, { recursive: true, force: true });
  await Bun.write(join(PROJECT, ".keep"), "");
  await rm(join(CACHE_ROOT, digest(PROJECT)), { recursive: true, force: true });
});

afterAll(async () => {
  await rm(PROJECT, { recursive: true, force: true });
  await rm(join(CACHE_ROOT, digest(PROJECT)), { recursive: true, force: true });
});

describe("publish and update through the host artifact tools", () => {
  test("a report becomes an artifact with a static Mermaid SVG", async () => {
    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
    ]);

    const output = published(
      await run(ctx, {
        action: "publish",
        content: {
          kind: "report",
          title: "Checkout report",
          markdown: "## Findings\n\nText.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n",
        },
      }),
    );

    expect(output.id).toBe("art_test");
    expect(output.url).toContain("/view/");
    expect(output.bytes).toBeGreaterThan(0);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("artifact_create");
    expect(calls[0]?.input.entry).toBe("index.html");
    expect(calls[0]?.input.provider).toBe("local");
    const html = calls[0]?.input.files?.["index.html"];
    expect(html).toContain("<svg");
    expect(html).toContain("Checkout report");
    expect(html).not.toContain("<script");
  });

  test("update keeps the id and sends no provider", async () => {
    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
    ]);

    const output = published(
      await run(ctx, {
        action: "update",
        id: "art_test",
        content: {
          kind: "diagram",
          title: "Deploy flow",
          takeaway: "Every deploy pauses at staging.",
          mermaid: "flowchart LR\n  A --> B",
        },
      }),
    );

    expect(output.id).toBe("art_test");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("artifact_update");
    expect(calls[0]?.input.id).toBe("art_test");
    expect(calls[0]?.input.provider).toBeUndefined();
    expect(calls[0]?.input.files?.["index.html"]).toContain("<svg");
  });

  test("a page that references vendor/d3.min.js gets the installed bundle", async () => {
    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [fakeTool("artifact_create", calls)]);

    published(
      await run(ctx, {
        action: "publish",
        content: {
          kind: "page",
          title: "Chart",
          html: '<!doctype html><html><head><title>Chart</title><script src="vendor/d3.min.js"></script></head><body><div id="chart"></div></body></html>',
        },
      }),
    );

    const d3 = calls[0]?.input.files?.["vendor/d3.min.js"];
    expect(d3).toBeDefined();
    expect(d3?.length).toBeGreaterThan(200_000);
    expect(calls[0]?.input.files?.["index.html"]).toContain("vendor/d3.min.js");
  });

  test("the flag-off path refuses and names experimental.artifacts", async () => {
    const output = await run(ctxFor(PROJECT, []), {
      action: "publish",
      content: { kind: "report", title: "No artifacts", markdown: "Text." },
    });

    expect(output.status).toBe("refused");
    if (output.status !== "refused") throw new Error("expected refused");
    expect(output.problem).toContain("experimental.artifacts");
    expect(output.problem).toContain("OPENCODE_FLAGS=artifacts");
  });
});

describe("the PR arm reads the evidence cache and publishes the page", () => {
  test("a typed review becomes a page with the diff and the metadata", async () => {
    const evidence = await write(PROJECT, makeRead());
    const review: Review = {
      summary: "Adds one constant.",
      groups: [{ heading: "Core", paths: ["src/a.ts"] }],
      points: [
        {
          kind: "change",
          text: "Adds the constant.",
          at: { path: "src/a.ts", side: "head", line: 1 },
        },
      ],
    };

    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [fakeTool("artifact_create", calls)]);
    const output = published(
      await run(ctx, { action: "publish", content: { kind: "pr", token: evidence.token, review } }),
    );

    expect(output.title).toContain("PR #7");
    const html = calls[0]?.input.files?.["index.html"];
    expect(html).toContain("PR #7");
    expect(html).toContain("src/a.ts");
    expect(html).toContain("const x = 1");
    expect(html).toContain("Adds the constant.");
  });
});
