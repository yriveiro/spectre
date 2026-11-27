import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Cause, DateTime, Effect, Exit, type Schema } from "effect";
import { canvases } from "../../tools/definitions/canvas";
import type { Input as CanvasInput, Output, Review } from "../../tools/definitions/canvas/content";
import { CACHE_ROOT, write } from "../../tools/definitions/canvas/evidence";
import { decodeCanvasState } from "../../tools/definitions/canvas/patch";
import type { Read } from "../../tools/definitions/canvas/read";

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

const fakeReadTool = (
  calls: Array<Recorded>,
): Tool.Info & { readonly id: string } =>
  ({
    id: "opencode_artifact_read",
    name: "artifact_read",
    description: "",
    input: {},
    options: { namespace: "opencode", codemode: true },
    execute: (input: unknown) => {
      const requested = ((input ?? {}) as { id?: string }).id ?? "art_test";
      const last = [...calls].reverse().find((c) => (c.input.id ?? "art_test") === requested);
      return Effect.succeed({
        output: {
          info: info(last?.input.title ?? "Untitled", requested),
          files: last?.input.files ?? {},
        },
      });
    },
  }) as unknown as Tool.Info & { readonly id: string };

const ctxFor = (project: string, tools: ReadonlyArray<Tool.Info & { readonly id: string }>) =>
  ({
    location: { directory: project, project: { id: "p", directory: project, canonical: project } },
    tool: { list: () => Effect.succeed(tools) },
  }) as unknown as Plugin.Context;

const makeNocturnaSession = (id: string, title: string, at: number) => ({
  id,
  projectID: "p",
  agent: "spectre",
  title,
  outcome: "failed",
  cost: 0.25,
  tokens: { input: 1_000, output: 500, reasoning: 100, cache: { read: 50, write: 10 } },
  time: { created: DateTime.makeUnsafe(at - 120_000), updated: DateTime.makeUnsafe(at - 30_000) },
});

const nocturnaMessages = (skill: string, toolName: string) => [
  { id: "msg_user", type: "user", text: "implement the dashboard" },
  { id: "msg_skill", type: "skill", skill, name: skill, text: "" },
  {
    id: "msg_assistant",
    type: "assistant",
    agent: "spectre",
    model: { providerID: "anthropic", id: "claude-sonnet-4" },
    retry: { attempt: 1, error: { type: "rate_limit", message: "429 Too Many Requests" } },
    content: [
      {
        type: "tool",
        id: `call_${toolName}`,
        name: toolName,
        state: {
          status: "completed",
          input: { path: "index.ts" },
          content: [{ type: "text", text: "updated" }],
        },
      },
    ],
  },
];

const ctxForNocturna = (
  project: string,
  tools: ReadonlyArray<Tool.Info & { readonly id: string }>,
  options: {
    readonly denyRead?: boolean;
    readonly omitPermission?: boolean;
    readonly defectPermission?: boolean;
    readonly declinePapercuts?: boolean;
    readonly correctedFeedback?: string;
    readonly wrappedDecline?: boolean;
    readonly failSessionList?: boolean;
    readonly defectSessionGet?: boolean;
    readonly defectStorageGet?: boolean;
    readonly now?: number;
  } = {},
) => {
  let now = options.now ?? Date.UTC(2026, 10, 27, 12, 0, 0);
  const clock = () => now;
  const caller = {
    id: "ses_test",
    projectID: "p",
    agent: "spectre",
    cost: 0,
    tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
    time: { created: DateTime.makeUnsafe(now - 60_000), updated: DateTime.makeUnsafe(now) },
  };
  const sessions = [makeNocturnaSession("ses_feature", "Feature run", now)];
  const messagesBySession = new Map([
    ["ses_feature", nocturnaMessages("playbook-feature", "edit")],
  ]);
  const store = new Map<string, Schema.Json>();
  const permissionCalls: Array<{
    readonly action: string;
    readonly resources: ReadonlyArray<string>;
  }> = [];
  let listCalls = 0;

  const ctx = {
    location: { directory: project, project: { id: "p", directory: project, canonical: project } },
    tool: { list: () => Effect.succeed(tools) },
    ...(options.omitPermission
      ? {}
      : {
          permission: {
            assert: (input: {
              readonly action: string;
              readonly resources: ReadonlyArray<string>;
            }) => {
              permissionCalls.push({ action: input.action, resources: input.resources });
              if (options.defectPermission && input.action === "read") {
                return Effect.die(new Error("User rejected permission"));
              }
              if (options.declinePapercuts && input.action === "papercuts") {
                return Effect.die({ _tag: "Permission.DeclinedError" });
              }
              if (options.wrappedDecline && input.action === "read") {
                return Effect.fail(
                  new Tool.Error({
                    message: "Declined",
                    error: { _tag: "Permission.DeclinedError" },
                  }),
                );
              }
              if (options.correctedFeedback !== undefined && input.action === "read") {
                return Effect.fail(
                  new Tool.Error({
                    message: options.correctedFeedback,
                    error: {
                      _tag: "Permission.CorrectedError",
                      feedback: options.correctedFeedback,
                    },
                  }),
                );
              }
              if (options.denyRead && input.action === "read") {
                return Effect.fail(new Tool.Error({ message: "Read permission denied." }));
              }
              return Effect.void;
            },
          },
        }),
    storage: {
      get: (key: string) => {
        if (options.defectStorageGet) {
          return Effect.die(new Error("/private/secret/storage crashed"));
        }
        return Effect.succeed(store.get(key));
      },
      set: (key: string, value: Schema.Json) =>
        Effect.sync(() => {
          store.set(key, value);
        }),
      remove: (key: string) =>
        Effect.sync(() => {
          store.delete(key);
        }),
      scan: () => Effect.succeed({ entries: [] }),
    },
    session: {
      list: () => {
        listCalls += 1;
        if (options.failSessionList) {
          return Effect.fail(new Error("/private/secret/sessions.db failed"));
        }
        return Effect.succeed({ data: [...sessions], cursor: {} });
      },
      get: ({ sessionID }: { readonly sessionID: string }) => {
        if (options.defectSessionGet) {
          return Effect.die(new Error("session.get defect"));
        }
        return Effect.succeed(
          sessionID === caller.id
            ? caller
            : (sessions.find((s) => s.id === sessionID) ?? sessions[0]),
        );
      },
      context: ({ sessionID }: { readonly sessionID: string }) =>
        Effect.succeed(messagesBySession.get(sessionID) ?? []),
    },
  } as unknown as Plugin.Context;

  return {
    ctx,
    clock,
    permissionCalls,
    get listCalls() {
      return listCalls;
    },
    addSession: (id: string, title: string, skill: string, toolName: string) => {
      now += 60_000;
      sessions.unshift(makeNocturnaSession(id, title, now));
      messagesBySession.set(id, nocturnaMessages(skill, toolName));
    },
  };
};

const toolContext = {
  sessionID: "ses_test",
  agent: "spectre",
  messageID: "msg_test",
  id: "call_test",
  progress: () => Effect.void,
} as unknown as Tool.Context;

const run = async (
  ctx: Plugin.Context,
  input: CanvasInput,
  clock?: () => number,
): Promise<Output> => {
  const result = await Effect.runPromise(canvases(ctx, clock).execute(input, toolContext));
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
    expect(html).toContain("diagram-fullscreen");
    expect(html).toContain('data-pele-action="fullscreen"');
    expect(html).toContain("<script>");
    expect(html).not.toContain("<script src=");
  });

  test("publishes current Nocturna telemetry as a board artifact", async () => {
    const calls: Array<Recorded> = [];
    const { ctx, clock, permissionCalls } = ctxForNocturna(PROJECT, [
      fakeTool("artifact_create", calls),
    ]);

    const output = published(
      await run(
        ctx,
        {
          action: "publish",
          content: { kind: "nocturna", days: 7, limit: 25 },
        },
        clock,
      ),
    );

    expect(output.title).toBe("Nocturna telemetry — 7 days");
    expect(calls).toHaveLength(1);
    expect(calls[0]?.tool).toBe("artifact_create");
    expect(permissionCalls).toContainEqual({ action: "read", resources: ["*"] });
    const html = calls[0]?.input.files?.["index.html"] ?? "";
    expect(html).toContain("Nocturna telemetry — 7 days");
    expect(html).toContain("playbook-feature");
    expect(html).toContain("edit");
    expect(html).toContain("ses_feature");

    const decoded = decodeCanvasState(calls[0]?.input.files ?? {});
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.problem);
    expect(decoded.content.kind).toBe("board");
    if (decoded.content.kind !== "board") throw new Error("expected board");
    const serialized = JSON.stringify(decoded.content);
    expect(serialized).toContain("playbook-feature");
    expect(serialized).toContain("edit");
    expect(serialized).toContain("ses_feature");
  });

  test("recollects Nocturna on update and patches saved board state without recollecting", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
      fakeReadTool(calls),
    ]);

    const created = published(
      await run(
        fixture.ctx,
        { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
        fixture.clock,
      ),
    );
    expect(fixture.listCalls).toBe(1);

    fixture.addSession("ses_followup", "Followup run", "tdd", "read");
    const updated = published(
      await run(
        fixture.ctx,
        { action: "update", id: created.id, content: { kind: "nocturna", days: 7, limit: 25 } },
        fixture.clock,
      ),
    );
    expect(updated.id).toBe(created.id);
    expect(fixture.listCalls).toBe(2);
    expect(calls[1]?.tool).toBe("artifact_update");
    const updatedHtml = calls[1]?.input.files?.["index.html"] ?? "";
    expect(updatedHtml).toContain("ses_followup");
    expect(updatedHtml).toContain("tdd");

    const patched = published(
      await run(
        fixture.ctx,
        {
          action: "patch",
          id: created.id,
          ops: [
            { op: "set-title", title: "Annotated Nocturna Board" },
            { op: "set-summary", summary: "Reviewed telemetry snapshot." },
          ],
        },
        fixture.clock,
      ),
    );
    expect(patched.title).toBe("Annotated Nocturna Board");
    expect(fixture.listCalls).toBe(2);
    const patchedDecoded = decodeCanvasState(calls[2]?.input.files ?? {});
    expect(patchedDecoded.ok).toBe(true);
    if (!patchedDecoded.ok) throw new Error(patchedDecoded.problem);
    expect(patchedDecoded.content.kind).toBe("board");
    if (patchedDecoded.content.kind !== "board") throw new Error("expected board");
    expect(patchedDecoded.content.title).toBe("Annotated Nocturna Board");
    expect(patchedDecoded.content.summary).toBe("Reviewed telemetry snapshot.");
    expect(JSON.stringify(patchedDecoded.content)).toContain("ses_followup");
    expect(JSON.stringify(patchedDecoded.content)).toContain("playbook-feature");
  });

  test("refuses Nocturna publish when read permission is denied", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], { denyRead: true });

    const output = await run(
      fixture.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      fixture.clock,
    );

    expect(output).toEqual({
      status: "refused",
      problem: "Nocturna telemetry requires read permission.",
    });
    expect(calls).toHaveLength(0);
    expect(fixture.listCalls).toBe(0);
  });

  test("refuses Nocturna publish when permission.assert is unavailable", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      omitPermission: true,
    });

    const output = await run(
      fixture.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      fixture.clock,
    );

    expect(output).toEqual({
      status: "refused",
      problem: "Nocturna telemetry requires read permission.",
    });
    expect(calls).toHaveLength(0);
    expect(fixture.listCalls).toBe(0);
  });

  test("preserves host plain-rejection defect from permission.assert", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      defectPermission: true,
    });

    const exit = await Effect.runPromiseExit(
      canvases(fixture.ctx, fixture.clock).execute(
        { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
        toolContext,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
    expect(calls).toHaveLength(0);
    expect(fixture.listCalls).toBe(0);
  });

  test("returns a stable refusal without raw error details when session.list fails", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      failSessionList: true,
    });

    const output = await run(
      fixture.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      fixture.clock,
    );

    expect(output).toEqual({
      status: "refused",
      problem: "Nocturna telemetry could not be collected.",
    });
    expect(calls).toHaveLength(0);
    expect(fixture.listCalls).toBe(1);
  });

  test("returns a stable refusal without raw error details when storage.get defects", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      defectStorageGet: true,
    });

    const output = await run(
      fixture.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      fixture.clock,
    );

    expect(output).toEqual({
      status: "refused",
      problem: "Nocturna telemetry could not be collected.",
    });
    expect(calls).toHaveLength(0);
  });

  test("preserves Permission.CorrectedError feedback and does not swallow wrapped DeclinedError", async () => {
    const calls: Array<Recorded> = [];
    const corrected = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      correctedFeedback: "Limit the dashboard to 1 day.",
    });

    const correctedOutput = await run(
      corrected.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      corrected.clock,
    );
    expect(correctedOutput).toEqual({
      status: "refused",
      problem: "Limit the dashboard to 1 day.",
    });
    expect(calls).toHaveLength(0);
    expect(corrected.listCalls).toBe(0);

    const declined = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      wrappedDecline: true,
    });
    const declinedExit = await Effect.runPromiseExit(
      canvases(declined.ctx, declined.clock).execute(
        { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
        toolContext,
      ),
    );
    expect(Exit.isFailure(declinedExit)).toBe(true);
    expect(calls).toHaveLength(0);
    expect(declined.listCalls).toBe(0);
  });

  test("propagates a plain papercut permission decline defect instead of returning a Canvas result", async () => {
    const calls: Array<Recorded> = [];
    const fixture = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)], {
      declinePapercuts: true,
    });

    const exit = await Effect.runPromiseExit(
      canvases(fixture.ctx, fixture.clock).execute(
        { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
        toolContext,
      ),
    );

    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      expect(Cause.hasDies(exit.cause)).toBe(true);
    }
    expect(calls).toHaveLength(0);
  });

  test("preflights artifact_create and artifact_update before prompting or collecting Nocturna", async () => {
    const calls: Array<Recorded> = [];
    const noCreate = ctxForNocturna(PROJECT, [fakeTool("artifact_update", calls)]);
    const publishOutput = await run(
      noCreate.ctx,
      { action: "publish", content: { kind: "nocturna", days: 7, limit: 25 } },
      noCreate.clock,
    );
    expect(publishOutput.status).toBe("refused");
    if (publishOutput.status !== "refused") throw new Error("expected refused");
    expect(publishOutput.problem).toContain("experimental.artifacts");
    expect(publishOutput.problem).toContain("OPENCODE_FLAGS=artifacts");
    expect(noCreate.permissionCalls).toHaveLength(0);
    expect(noCreate.listCalls).toBe(0);

    const noUpdate = ctxForNocturna(PROJECT, [fakeTool("artifact_create", calls)]);
    const updateOutput = await run(
      noUpdate.ctx,
      { action: "update", id: "art_test", content: { kind: "nocturna", days: 7, limit: 25 } },
      noUpdate.clock,
    );
    expect(updateOutput.status).toBe("refused");
    if (updateOutput.status !== "refused") throw new Error("expected refused");
    expect(updateOutput.problem).toContain("experimental.artifacts");
    expect(noUpdate.permissionCalls).toHaveLength(0);
    expect(noUpdate.listCalls).toBe(0);
  });

  test("patches a board without calling ctx.session.get even when session.get defects", async () => {
    const calls: Array<Recorded> = [];
    const tools = [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
      fakeReadTool(calls),
    ];
    const fixture = ctxForNocturna(PROJECT, tools, { defectSessionGet: true });

    const created = published(
      await run(
        fixture.ctx,
        {
          action: "publish",
          content: {
            kind: "board",
            title: "Board Snapshot",
            sections: [
              {
                id: "kpi",
                kind: "kpi",
                heading: "Overview",
                items: [{ label: "Count", value: "1" }],
              },
            ],
          },
        },
        fixture.clock,
      ),
    );

    const patched = published(
      await run(
        fixture.ctx,
        {
          action: "patch",
          id: created.id,
          ops: [{ op: "set-title", title: "Patched Board Snapshot" }],
        },
        fixture.clock,
      ),
    );

    expect(patched.title).toBe("Patched Board Snapshot");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tool).toBe("artifact_update");
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

  test("patch reads .spectre-canvas.json from artifact_read and updates one section in place", async () => {
    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
      fakeReadTool(calls),
    ]);

    published(
      await run(ctx, {
        action: "publish",
        content: {
          kind: "report",
          title: "Initial Report",
          markdown: "## Findings\n\nOld text.\n\n## Limits\n\nNone.\n",
        },
      }),
    );

    const updated = published(
      await run(ctx, {
        action: "patch",
        id: "art_test",
        ops: [
          { op: "set-title", title: "Patched Report" },
          { op: "replace-section", heading: "Findings", markdown: "Updated finding with `const x = 1`." },
        ],
      }),
    );

    expect(updated.title).toBe("Patched Report");
    expect(calls).toHaveLength(2);
    expect(calls[1]?.tool).toBe("artifact_update");
    const html = calls[1]?.input.files?.["index.html"] ?? "";
    expect(html).toContain("Patched Report");
    expect(html).toContain("Updated finding");
    expect(html).not.toContain("Old text.");
    expect(html).toContain("None.");
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
    expect(html).toContain('<span class="hl-k">const</span> x = <span class="hl-n">1</span>');
    expect(html).toContain("Adds the constant.");
  });

  test("publishes and updates the dedicated brain canvas with d3 attached", async () => {
    const calls: Array<Recorded> = [];
    const ctx = ctxFor(PROJECT, [
      fakeTool("artifact_create", calls),
      fakeTool("artifact_update", calls),
    ]);
    await Bun.write(
      join(PROJECT, ".spectre", "brain", "neurons", "0199b600-0000-7000-8000-000000000001.md"),
      [
        "---",
        "id: 0199b600-0000-7000-8000-000000000001",
        "schema_version: 1",
        "kind: decision",
        'claim: "Brain canvas uses one fixed layout."',
        "subject: []",
        "at: 2026-11-20T00:00:00.000Z",
        "---",
        "",
        "- Connectome view",
        "- Prompt Cortex view",
        "",
      ].join("\n"),
    );

    const created = published(
      await run(ctx, { action: "publish", content: { kind: "brain" } }),
    );
    expect(created.title).toContain("Brain");
    expect(Object.keys(calls[0]?.input.files ?? {}).toSorted()).toEqual([
      "index.html",
      "vendor/d3.min.js",
    ]);
    expect(calls[0]?.input.files?.["index.html"]).toContain("Brain canvas uses one fixed layout.");
    expect(calls[0]?.input.files?.["index.html"]).toContain("Connectome view");

    const updated = published(
      await run(ctx, {
        action: "update",
        id: created.id,
        content: { kind: "brain", focus: "0199b600" },
      }),
    );
    expect(updated.id).toBe(created.id);
    expect(calls[1]?.tool).toBe("artifact_update");
  });
});
