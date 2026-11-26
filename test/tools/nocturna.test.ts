import { describe, expect, test } from "bun:test";
import { type Plugin, Tool } from "@opencode/plugin/effect";
import { DateTime, Effect, Schema } from "effect";
import { renderCatalog } from "../../skills/catalog";
import { definitions } from "../../skills/definitions";
import { NAMESPACE_DESCRIPTION } from "../../tools";
import { NocturnaOutput, nocturnaTool } from "../../tools/definitions/nocturna";
import { telemetryStorageKey } from "../../tools/definitions/nocturna/telemetry-store";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000;

interface MockSession {
  readonly id: string;
  readonly projectID?: string;
  readonly parentID?: string;
  readonly fork?: {
    readonly sessionID: string;
    readonly boundary: { readonly type: "message"; readonly id: string };
  };
  readonly agent?: string;
  readonly title?: string;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly createdAt?: number;
  readonly updatedAt: number;
  readonly cost?: number;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
    readonly cacheRead?: number;
  };
  readonly contextError?: string;
  readonly messages?: ReadonlyArray<unknown>;
  readonly permissions?: ReadonlyArray<{
    readonly action: string;
    readonly resource: string;
    readonly effect: "allow" | "deny" | "ask";
  }>;
}

const toSessionInfo = (row: MockSession) => ({
  id: row.id,
  ...(row.parentID === undefined ? {} : { parentID: row.parentID }),
  ...(row.fork === undefined ? {} : { fork: row.fork }),
  projectID: row.projectID ?? "proj_spectre",
  ...(row.agent === undefined ? {} : { agent: row.agent }),
  model: { providerID: "anthropic", id: "claude-sonnet-4" },
  cost: row.cost ?? 0.05,
  tokens: {
    input: row.tokens?.input ?? 1_000,
    output: row.tokens?.output ?? 500,
    reasoning: row.tokens?.reasoning ?? 0,
    cache: { read: row.tokens?.cacheRead ?? 0, write: 0 },
  },
  ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
  time: {
    created: DateTime.makeUnsafe(row.createdAt ?? row.updatedAt - 60_000),
    updated: DateTime.makeUnsafe(row.updatedAt),
  },
  ...(row.title === undefined ? {} : { title: row.title }),
  ...(row.permissions === undefined ? {} : { permissions: row.permissions }),
  location: { directory: "/repo" },
});

const scanMockStore = (
  store: Map<string, Schema.Json>,
  scanOptions: { readonly prefix: string; readonly after?: string; readonly limit?: number },
  failScan?: boolean,
) => {
  if (failScan) return Effect.die(new Error("storage scan unavailable"));
  const rawLimit = scanOptions.limit ?? 100;
  const limit = Number.isNaN(rawLimit) ? 100 : Math.min(Math.max(Math.floor(rawLimit), 1), 1000);
  const matching = [...store.entries()]
    .filter(([key]) => key.startsWith(scanOptions.prefix))
    .filter(([key]) => scanOptions.after === undefined || key > scanOptions.after)
    .toSorted(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0));
  const entries = matching.slice(0, limit).map(([key, value]) => ({ key, value }));
  if (matching.length <= limit) return Effect.succeed({ entries });
  const last = entries.at(-1);
  return Effect.succeed({ entries, ...(last === undefined ? {} : { next: last.key }) });
};

interface MockHostOptions {
  readonly failList?: boolean;
  readonly failScan?: boolean;
  readonly storageDelayMs?: number;
  readonly permissionAssert?: (input: {
    readonly sessionID: string;
    readonly agent?: string;
    readonly action: string;
    readonly resources: ReadonlyArray<string>;
  }) => Effect.Effect<void, Tool.Error>;
  readonly agentPermissions?: Readonly<
    Record<
      string,
      ReadonlyArray<{
        readonly action: string;
        readonly resource: string;
        readonly effect: "allow" | "deny" | "ask";
      }>
    >
  >;
}

const makeOptionalAccessDomains = (options: MockHostOptions) => ({
  ...(options.permissionAssert === undefined
    ? {}
    : { permission: { assert: options.permissionAssert } }),
  ...(options.agentPermissions === undefined
    ? {}
    : {
        agent: {
          get: ({ agentID }: { readonly agentID: string }) => {
            const permissions = options.agentPermissions?.[agentID];
            return permissions === undefined
              ? Effect.fail(new Error(`Agent not found: ${agentID}`))
              : Effect.succeed({
                  location: {
                    directory: "/repo",
                    project: { id: "proj_spectre", directory: "/repo", canonical: "/repo" },
                  },
                  data: { id: agentID, name: agentID, permissions },
                });
          },
        },
      }),
});

const makeHost = (initial: ReadonlyArray<MockSession>, options: MockHostOptions = {}) => {
  const store = new Map<string, Schema.Json>();
  const rows = new Map<string, MockSession>(initial.map((one) => [one.id, one]));

  const ctx = {
    location: {
      directory: "/repo",
      project: { id: "proj_spectre", directory: "/repo", canonical: "/repo" },
    },
    ...makeOptionalAccessDomains(options),
    storage: {
      get: (key: string) => {
        const delay = options.storageDelayMs;
        return delay === undefined
          ? Effect.succeed(store.get(key))
          : Effect.promise(async () => {
              await Bun.sleep(delay);
              return store.get(key);
            });
      },
      set: (key: string, value: Schema.Json) =>
        Effect.sync(() => {
          store.set(key, value);
        }),
      remove: (key: string) =>
        Effect.sync(() => {
          store.delete(key);
        }),
      scan: (scanOptions: {
        readonly prefix: string;
        readonly after?: string;
        readonly limit?: number;
      }) => scanMockStore(store, scanOptions, options.failScan),
    },
    session: {
      list: (input?: {
        readonly project?: string;
        readonly limit?: number;
        readonly cursor?: string;
      }) => {
        if (options.failList) return Effect.fail(new Error("server unavailable"));
        const project = input?.project ?? "proj_spectre";
        const sorted = [...rows.values()]
          .filter((row) => (row.projectID ?? "proj_spectre") === project)
          .toSorted(
            (left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id),
          );
        const offset = input?.cursor === undefined ? 0 : Number(input.cursor);
        const pageSize = input?.limit ?? 100;
        const slice = sorted.slice(offset, offset + pageSize).map(toSessionInfo);
        const nextOffset = offset + slice.length;
        return Effect.succeed({
          data: slice,
          cursor: nextOffset < sorted.length ? { next: String(nextOffset) } : {},
        });
      },
      get: ({ sessionID }: { readonly sessionID: string }) => {
        const found = rows.get(sessionID);
        return found === undefined
          ? Effect.fail(new Error(`missing: ${sessionID}`))
          : Effect.succeed(toSessionInfo(found));
      },
      context: ({ sessionID }: { readonly sessionID: string }) => {
        const found = rows.get(sessionID);
        if (found?.contextError !== undefined) return Effect.fail(new Error(found.contextError));
        return Effect.succeed(found?.messages ?? []);
      },
    },
  } as unknown as Plugin.Context;

  const upsert = (next: MockSession) => {
    rows.set(next.id, next);
  };

  return { ctx, store, upsert };
};

const callContext = (sessionID = "ses_caller"): Tool.Context =>
  ({
    sessionID,
    agent: "nocturna",
    messageID: "msg_caller",
    id: "call_1",
    progress: () => Effect.void,
  }) as unknown as Tool.Context;

describe("tools.spectre.nocturna", () => {
  test("collect defaults to 7d, paginates cursors, marks compacted sessions, and isolates unreadable transcripts", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_recent_root",
        agent: "spectre",
        title: "Root feature run",
        updatedAt: NOW - 2 * DAY_MS,
        messages: [
          {
            id: "msg_compact",
            type: "compaction",
            status: "completed",
            reason: "auto",
            summary: "Earlier exploration compacted.",
          },
          { id: "msg_1", type: "user", text: "build feature" },
          {
            id: "msg_2",
            type: "skill",
            skill: "playbook-feature",
            name: "playbook-feature",
            text: "",
          },
          {
            id: "msg_3",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            content: [
              {
                type: "tool",
                id: "call_sub",
                name: "subagent",
                state: {
                  status: "completed",
                  input: { agent: "operator" },
                  content: [{ type: "text", text: "done" }],
                },
              },
            ],
          },
        ],
      },
      {
        id: "ses_recent_child",
        parentID: "ses_recent_root",
        agent: "operator",
        outcome: "failed",
        updatedAt: NOW - DAY_MS,
        messages: [
          {
            id: "msg_4",
            type: "assistant",
            agent: "operator",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            retry: { attempt: 1, error: { type: "rate_limit", message: "429 Too Many Requests" } },
            content: [
              {
                type: "tool",
                id: "call_err",
                name: "edit",
                state: {
                  status: "error",
                  input: { path: "index.ts" },
                  error: { type: "tool.execution", message: "oldString not found" },
                },
              },
            ],
          },
        ],
      },
      {
        id: "ses_corrupt",
        agent: "spectre",
        updatedAt: NOW - 3 * DAY_MS,
        contextError: "MessageDecodeError",
      },
      {
        id: "ses_too_old",
        agent: "spectre",
        updatedAt: NOW - 9 * DAY_MS,
      },
      {
        id: "ses_caller",
        agent: "spectre",
        updatedAt: NOW - 1_000,
      },
      {
        id: "ses_prev_audit",
        agent: "nocturna",
        updatedAt: NOW - DAY_MS,
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(
      tool.execute({ days: Number.NaN }, callContext("ses_caller")),
    );
    const out = res.output;
    expect(out?.status).toBe("collected");
    if (out?.status !== "collected") throw new Error("expected collected");

    expect(out.windowDays).toBe(7);
    expect(out.scannedInWindow).toBe(3);
    expect(out.skippedAnalyzed).toBe(0);
    expect(out.truncated).toBe(false);
    expect(out.unreadable).toEqual(["ses_corrupt"]);
    expect(out.sessions.map((one) => one.id)).toEqual(["ses_recent_child", "ses_recent_root"]);
    expect(out.sessions[1]?.compacted).toBe(true);
    expect(out.totals.toolErrors).toBe(1);
    expect(out.totals.retries).toBe(1);
    expect(out.topSkills).toEqual([
      {
        skill: "playbook-feature",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 0, "prompt-attachment": 0, "api-activation": 1 },
        loadErrors: 0,
        attributedCost: 0,
        attributedTokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 1,
        postLoadErrors: 0,
      },
    ]);
    expect(out.sessions[1]?.telemetryCoverage).toBe("transcript");
    expect(out.sessions[1]?.telemetryPartial).toBe(true);
    expect(out.sessions[0]?.telemetryCoverage).toBe("none");
    expect(out.sessions[0]?.telemetryPartial).toBeUndefined();
  });

  test("collect fails with Tool.Error when ctx.session.list fails instead of reporting a clean window", async () => {
    const { ctx } = makeHost([], { failList: true });
    const tool = nocturnaTool(ctx, () => NOW);
    await expect(Effect.runPromise(tool.execute({}, callContext()))).rejects.toBeInstanceOf(
      Tool.Error,
    );
  });

  test("collect pages past >100 already-marked sessions to reach older unanalyzed sessions in window", async () => {
    const markedRecent: Array<MockSession> = Array.from({ length: 120 }, (_, index) => ({
      id: `ses_marked_${String(index).padStart(3, "0")}`,
      agent: "spectre",
      updatedAt: NOW - (index + 1) * 60_000,
    }));
    const unanalyzedOlder: MockSession = {
      id: "ses_older_unanalyzed",
      agent: "spectre",
      updatedAt: NOW - 4 * DAY_MS,
    };

    const { ctx } = makeHost([...markedRecent, unanalyzedOlder]);
    const tool = nocturnaTool(ctx, () => NOW);

    await Effect.runPromise(
      tool.execute({ action: "mark", sessions: markedRecent.map((one) => one.id) }, callContext()),
    );

    const collected = await Effect.runPromise(tool.execute({}, callContext()));
    if (collected.output?.status !== "collected") throw new Error("expected collected");
    expect(collected.output.skippedAnalyzed).toBe(120);
    expect(collected.output.sessions.map((one) => one.id)).toEqual(["ses_older_unanalyzed"]);
  });

  test("mark serializes concurrent writes, skips unchanged sessions, and re-enters resumed sessions", async () => {
    const { ctx, upsert } = makeHost(
      [
        { id: "ses_one", agent: "spectre", updatedAt: NOW - 2 * DAY_MS },
        { id: "ses_two", agent: "spectre", updatedAt: NOW - DAY_MS },
        { id: "ses_foreign", projectID: "proj_other", agent: "spectre", updatedAt: NOW - DAY_MS },
      ],
      { storageDelayMs: 10 },
    );

    const tool = nocturnaTool(ctx, () => NOW);

    const [m1, m2] = await Promise.all([
      Effect.runPromise(
        tool.execute(
          { action: "mark", sessions: ["ses_one", "bad_id", "ses_foreign"] },
          callContext(),
        ),
      ),
      Effect.runPromise(tool.execute({ action: "mark", sessions: ["ses_two"] }, callContext())),
    ]);

    if (m1.output?.status !== "marked" || m2.output?.status !== "marked") {
      throw new Error("expected marked");
    }
    expect(m1.output.missing).toEqual(["bad_id", "ses_foreign"]);

    const skipped = await Effect.runPromise(tool.execute({}, callContext()));
    if (skipped.output?.status !== "collected") throw new Error("expected collected");
    expect(skipped.output.sessions).toEqual([]);
    expect(skipped.output.skippedAnalyzed).toBe(2);
    expect(skipped.output.trackedInStorage).toBe(2);

    upsert({
      id: "ses_one",
      agent: "spectre",
      updatedAt: NOW - 1_000,
    });

    const resumed = await Effect.runPromise(tool.execute({}, callContext()));
    if (resumed.output?.status !== "collected") throw new Error("expected collected");
    expect(resumed.output.sessions.map((one) => one.id)).toEqual(["ses_one"]);
    expect(resumed.output.skippedAnalyzed).toBe(1);
  });

  test("inspect rejects malformed and cross-project IDs into missing and isolates unreadable transcripts", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_trace",
        agent: "spectre",
        title: "Trace target",
        updatedAt: NOW - DAY_MS,
        messages: [
          {
            id: "msg_c1",
            type: "compaction",
            status: "completed",
            reason: "manual",
            summary: "Compacted prior steps",
          },
          { id: "msg_u1", type: "user", text: "fix the broken schema" },
          {
            id: "msg_a1",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            content: [
              { type: "text", text: "Checking schema definition." },
              {
                type: "tool",
                id: "call_t1",
                name: "spectre_search",
                state: {
                  status: "completed",
                  input: { pattern: "NocturnaInput" },
                  content: [{ type: "text", text: "matched tools/definitions/nocturna/index.ts" }],
                },
              },
            ],
          },
          { id: "msg_idle", type: "idle", outcome: "succeeded" },
        ],
      },
      {
        id: "ses_broken",
        agent: "spectre",
        updatedAt: NOW - DAY_MS,
        contextError: "corrupt row",
      },
      {
        id: "ses_other",
        projectID: "proj_other",
        agent: "spectre",
        updatedAt: NOW - DAY_MS,
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(
      tool.execute(
        { action: "inspect", sessions: ["ses_trace", "not_a_ses_id", "ses_other", "ses_broken"] },
        callContext(),
      ),
    );
    expect(res.output?.status).toBe("inspected");
    if (res.output?.status !== "inspected") throw new Error("expected inspected");

    expect(res.output.missing).toEqual(["not_a_ses_id", "ses_other"]);
    expect(res.output.unreadable).toEqual(["ses_broken"]);
    expect(res.output.sessions).toHaveLength(1);
    expect(res.output.sessions[0]?.events.map((event) => event.kind)).toEqual([
      "compaction",
      "user",
      "assistant",
      "idle",
    ]);
    expect(res.output.sessions[0]?.events[0]?.summary).toContain("Compacted prior steps");
  });

  test("collect records completed skill tool calls, nested Code Mode toolCalls and metadata.error, excludes callerParentID, and pre-ranks pending sessions before limit slicing", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_caller_parent",
        agent: "spectre",
        updatedAt: NOW - 500,
      },
      {
        id: "ses_caller",
        parentID: "ses_caller_parent",
        agent: "spectre",
        updatedAt: NOW - 200,
      },
      {
        id: "ses_small_newest",
        agent: "operator",
        updatedAt: NOW - 1_000,
        cost: 0.01,
        tokens: { input: 100, output: 50, reasoning: 0 },
      },
      {
        id: "ses_failed_older",
        agent: "spectre",
        outcome: "failed",
        updatedAt: NOW - 2 * DAY_MS,
        cost: 0.2,
        tokens: { input: 4_000, output: 1_000, reasoning: 0 },
        messages: [
          {
            id: "msg_a",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            content: [
              {
                type: "tool",
                id: "call_skill",
                name: "skill",
                state: {
                  status: "completed",
                  input: { id: "effect-best-practices" },
                  content: [{ type: "text", text: "loaded" }],
                },
              },
              {
                type: "tool",
                id: "call_exec",
                name: "execute",
                state: {
                  status: "completed",
                  input: { code: "return 1;" },
                  content: [{ type: "text", text: "ok" }],
                  metadata: {
                    error: true,
                    toolCalls: [
                      { tool: "spectre.brain", status: "completed" },
                      { tool: "spectre.comments", status: "error" },
                    ],
                  },
                },
              },
            ],
          },
        ],
      },
      {
        id: "ses_heavy_tokens",
        agent: "spectre",
        updatedAt: NOW - DAY_MS,
        cost: 0.5,
        tokens: { input: 80_000, output: 20_000, reasoning: 0 },
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({ limit: 2 }, callContext("ses_caller")));
    expect(res.output?.status).toBe("collected");
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.scannedInWindow).toBe(3);
    expect(res.output.remainingUnanalyzed).toBe(1);
    expect(res.output.sessions.map((one) => one.id)).toEqual([
      "ses_failed_older",
      "ses_heavy_tokens",
    ]);

    const failedDigest = res.output.sessions[0];
    expect(failedDigest?.skillsLoaded).toEqual(["effect-best-practices"]);
    expect(failedDigest?.tools).toEqual([
      { name: "execute", calls: 1, errors: 1 },
      { name: "spectre.comments", calls: 1, errors: 1 },
      { name: "skill", calls: 1, errors: 0 },
      { name: "spectre.brain", calls: 1, errors: 0 },
    ]);
  });

  test("collect counts assistant shell non-zero exits and errors, excludes subagent resumes, and weights cost/steps/cacheRead", async () => {
    const stepMessages = Array.from({ length: 400 }, (_, idx) => ({
      id: `msg_step_${idx}`,
      type: "assistant",
      agent: "spectre",
      model: { providerID: "anthropic", id: "claude-sonnet-4" },
      content: [],
    }));

    const { ctx } = makeHost([
      {
        id: "ses_expensive_outlier",
        agent: "spectre",
        updatedAt: NOW - DAY_MS,
        cost: 70,
        tokens: { input: 100_000, output: 10_000, reasoning: 0, cacheRead: 10_000_000 },
        messages: stepMessages,
      },
      {
        id: "ses_shell_and_subagent",
        agent: "spectre",
        updatedAt: NOW - 2 * DAY_MS,
        messages: [
          {
            id: "msg_tools",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            content: [
              {
                type: "tool",
                id: "call_shell_ok",
                name: "shell",
                state: {
                  status: "completed",
                  input: { command: "echo ok" },
                  content: [{ type: "text", text: "ok\nExit code: 0" }],
                },
              },
              {
                type: "tool",
                id: "call_shell_nonzero",
                name: "shell",
                state: {
                  status: "completed",
                  input: { command: "false" },
                  content: [{ type: "text", text: "boom\nExit code: 2" }],
                },
              },
              {
                type: "tool",
                id: "call_shell_err",
                name: "shell",
                state: {
                  status: "error",
                  input: { command: "bad" },
                  error: { type: "tool.execution", message: "timed out" },
                },
              },
              {
                type: "tool",
                id: "call_sub_spawn",
                name: "subagent",
                state: {
                  status: "completed",
                  input: { agent: "operator", prompt: "do task" },
                  content: [{ type: "text", text: "spawned" }],
                },
              },
              {
                type: "tool",
                id: "call_sub_resume",
                name: "subagent",
                state: {
                  status: "completed",
                  input: { agent: "operator", sessionID: "ses_child_1", prompt: "follow up" },
                  content: [{ type: "text", text: "resumed" }],
                },
              },
            ],
          },
        ],
      },
      {
        id: "ses_small_failed",
        agent: "operator",
        outcome: "failed",
        updatedAt: NOW - 3 * DAY_MS,
        cost: 0.1,
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, callContext()));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.sessions[0]?.id).toBe("ses_expensive_outlier");
    expect(res.output.sessions[0]?.anomalyScore).toBeGreaterThan(100);

    const shellAndSub = res.output.sessions.find((one) => one.id === "ses_shell_and_subagent");
    expect(shellAndSub?.shellFailed).toBe(2);
    expect(shellAndSub?.subagentsSpawned).toBe(1);
  });

  test("collect paginates ranked pending sessions with offset", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_p1",
        agent: "spectre",
        outcome: "failed",
        updatedAt: NOW - DAY_MS,
        cost: 1,
        tokens: { input: 50_000, output: 10_000, reasoning: 0 },
      },
      {
        id: "ses_p2",
        agent: "spectre",
        updatedAt: NOW - 2 * DAY_MS,
        cost: 0.5,
        tokens: { input: 40_000, output: 5_000, reasoning: 0 },
      },
      {
        id: "ses_p3",
        agent: "spectre",
        updatedAt: NOW - 3 * DAY_MS,
        cost: 0.1,
        tokens: { input: 10_000, output: 1_000, reasoning: 0 },
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const page1 = await Effect.runPromise(tool.execute({ limit: 1, offset: 0 }, callContext()));
    const page2 = await Effect.runPromise(tool.execute({ limit: 1, offset: 1 }, callContext()));
    const page3 = await Effect.runPromise(tool.execute({ limit: 2, offset: 2 }, callContext()));

    if (
      page1.output?.status !== "collected" ||
      page2.output?.status !== "collected" ||
      page3.output?.status !== "collected"
    ) {
      throw new Error("expected collected");
    }

    expect(page1.output.sessions.map((one) => one.id)).toEqual(["ses_p1"]);
    expect(page1.output.remainingUnanalyzed).toBe(2);

    expect(page2.output.sessions.map((one) => one.id)).toEqual(["ses_p2"]);
    expect(page2.output.remainingUnanalyzed).toBe(1);

    expect(page3.output.sessions.map((one) => one.id)).toEqual(["ses_p3"]);
    expect(page3.output.remainingUnanalyzed).toBe(0);
  });

  test("collect surfaces open cross-project papercuts with empty local sessions and keeps mark isolated", async () => {
    const { ctx, store } = makeHost([]);
    store.set("papercut:v1:o:01950000-0000-7000-8000-000000000001", {
      v: 1,
      id: "01950000-0000-7000-8000-000000000001",
      groupId: "pc_112233445566",
      targetKind: "tool",
      target: "tools.spectre.worktrees",
      canonicalTarget: "tool:worktrees",
      tried: "start",
      expected: "opens",
      actual: "rejected",
      suggestedFix: "Do not leak suggestedFix into collect",
      projectId: "proj_external",
      repo: "payments-api",
      sessionID: "ses_foreign_secret",
      opencodeVersion: "2.4.2",
      at: NOW - DAY_MS,
    });

    const tool = nocturnaTool(ctx, () => NOW);
    const collected = await Effect.runPromise(tool.execute({}, callContext()));
    if (collected.output?.status !== "collected") throw new Error("expected collected");

    expect(collected.output.sessions).toEqual([]);
    expect(collected.output.papercuts).toEqual({
      status: "ok",
      openGroups: 1,
      newReportsInWindow: 1,
      scanTruncated: false,
      topGroups: [
        {
          groupId: "pc_112233445566",
          targetKind: "tool",
          target: "tools.spectre.worktrees",
          projects: 1,
          occurrences: 1,
          reopened: false,
        },
      ],
    });
    expect(JSON.stringify(collected.output.papercuts)).not.toContain("ses_foreign_secret");
    expect(JSON.stringify(collected.output.papercuts)).not.toContain("Do not leak");

    await Effect.runPromise(tool.execute({ action: "mark", sessions: [] }, callContext()));
    const afterMark = await Effect.runPromise(tool.execute({}, callContext()));
    if (afterMark.output?.status !== "collected") throw new Error("expected collected");
    expect(afterMark.output.papercuts.openGroups).toBe(1);
  });

  test("collect isolates papercut storage defects into status=unavailable without failing local results", async () => {
    const { ctx } = makeHost([{ id: "ses_local_ok", agent: "spectre", updatedAt: NOW - DAY_MS }], {
      failScan: true,
    });

    const tool = nocturnaTool(ctx, () => NOW);
    const collected = await Effect.runPromise(tool.execute({}, callContext()));
    if (collected.output?.status !== "collected") throw new Error("expected collected");

    expect(collected.output.sessions.map((one) => one.id)).toEqual(["ses_local_ok"]);
    expect(collected.output.papercuts).toEqual({
      status: "unavailable",
      openGroups: 0,
      newReportsInWindow: 0,
      scanTruncated: false,
      topGroups: [],
    });
  });

  test("collect respects papercuts permission denial and ask rules without prompting or failing local sessions", async () => {
    const papercutRow = {
      v: 1,
      id: "01950000-0000-7000-8000-000000000099",
      groupId: "pc_aabbccddeeff",
      targetKind: "tool",
      target: "tools.spectre.worktrees",
      canonicalTarget: "tool:worktrees",
      tried: "start",
      expected: "opens",
      actual: "rejected",
      projectId: "proj_external",
      repo: "secret-repo",
      opencodeVersion: "2.4.2",
      at: NOW - DAY_MS,
    } as const;

    const assertCalls: Array<{ readonly action: string; readonly sessionID: string }> = [];
    const deniedHost = makeHost(
      [{ id: "ses_local_visible", agent: "spectre", updatedAt: NOW - DAY_MS }],
      {
        permissionAssert: (input) => {
          assertCalls.push({ action: input.action, sessionID: input.sessionID });
          return Effect.fail(new Tool.Error({ message: "Permission denied: papercuts" }));
        },
      },
    );
    deniedHost.store.set("papercut:v1:o:01950000-0000-7000-8000-000000000099", papercutRow);

    const deniedRes = await Effect.runPromise(
      nocturnaTool(deniedHost.ctx, () => NOW).execute({}, callContext("ses_caller")),
    );
    if (deniedRes.output?.status !== "collected") throw new Error("expected collected");
    expect(deniedRes.output.sessions.map((one) => one.id)).toEqual(["ses_local_visible"]);
    expect(deniedRes.output.papercuts).toEqual({
      status: "unavailable",
      openGroups: 0,
      newReportsInWindow: 0,
      scanTruncated: false,
      topGroups: [],
    });
    expect(assertCalls).toEqual([{ action: "papercuts", sessionID: "ses_caller" }]);

    let promptAttempted = false;
    const askHost = makeHost(
      [
        { id: "ses_local_ask", agent: "spectre", updatedAt: NOW - DAY_MS },
        {
          id: "ses_caller",
          agent: "nocturna",
          updatedAt: NOW - 1_000,
          permissions: [{ action: "papercuts", resource: "*", effect: "ask" }],
        },
      ],
      {
        agentPermissions: {
          nocturna: [{ action: "*", resource: "*", effect: "allow" }],
        },
        permissionAssert: () => {
          promptAttempted = true;
          return Effect.void;
        },
      },
    );
    askHost.store.set("papercut:v1:o:01950000-0000-7000-8000-000000000099", papercutRow);

    const askRes = await Effect.runPromise(
      nocturnaTool(askHost.ctx, () => NOW).execute({}, callContext("ses_caller")),
    );
    if (askRes.output?.status !== "collected") throw new Error("expected collected");
    expect(askRes.output.sessions.map((one) => one.id)).toEqual(["ses_local_ask"]);
    expect(askRes.output.papercuts).toEqual({
      status: "unavailable",
      openGroups: 0,
      newReportsInWindow: 0,
      scanTruncated: false,
      topGroups: [],
    });
    expect(promptAttempted).toBe(false);

    const allowedHost = makeHost(
      [
        { id: "ses_local_allow", agent: "spectre", updatedAt: NOW - DAY_MS },
        { id: "ses_caller", agent: "nocturna", updatedAt: NOW - 1_000 },
      ],
      {
        agentPermissions: {
          nocturna: [{ action: "*", resource: "*", effect: "allow" }],
        },
        permissionAssert: () => Effect.void,
      },
    );
    allowedHost.store.set("papercut:v1:o:01950000-0000-7000-8000-000000000099", papercutRow);

    const allowedRes = await Effect.runPromise(
      nocturnaTool(allowedHost.ctx, () => NOW).execute({}, callContext("ses_caller")),
    );
    if (allowedRes.output?.status !== "collected") throw new Error("expected collected");
    expect(allowedRes.output.sessions.map((one) => one.id)).toEqual(["ses_local_allow"]);
    expect(allowedRes.output.papercuts.status).toBe("ok");
    expect(allowedRes.output.papercuts.openGroups).toBe(1);
  });

  test("extracts User.skills prompt attachments, excludes Step k and sibling errors, keeps steered prompts in one turn, and tracks completed vs failed compaction", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_tx_skills",
        agent: "spectre",
        updatedAt: NOW - DAY_MS,
        cost: 0.4,
        messages: [
          {
            id: "msg_cf",
            type: "compaction",
            status: "failed",
            reason: "auto",
            error: { type: "aborted", message: "cancelled" },
          },
          {
            id: "msg_u1",
            type: "user",
            text: "fix bug",
            skills: [{ id: "playbook-bug-fix", name: "playbook-bug-fix", text: "body" }],
          },
          {
            id: "msg_a1",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            cost: 0.1,
            tokens: { input: 200, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [
              {
                type: "tool",
                id: "call_tdd",
                name: "skill",
                state: {
                  status: "completed",
                  input: { id: "tdd" },
                  content: [{ type: "text", text: "tdd body" }],
                },
              },
              {
                type: "tool",
                id: "call_sib",
                name: "read",
                state: {
                  status: "error",
                  input: { path: "missing" },
                  error: { type: "tool.execution", message: "nope" },
                },
              },
            ],
          },
          {
            id: "msg_u2_steer",
            type: "user",
            text: "also verify",
          },
          {
            id: "msg_a2",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            cost: 0.2,
            tokens: { input: 400, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [
              {
                type: "tool",
                id: "call_e",
                name: "edit",
                state: {
                  status: "error",
                  input: {},
                  error: { type: "tool.execution", message: "mismatch" },
                },
              },
            ],
          },
          { id: "msg_idle", type: "idle", outcome: "succeeded" },
          {
            id: "msg_a3_after_idle",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            cost: 0.1,
            tokens: { input: 100, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
          },
        ],
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, callContext()));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.sessions[0]?.telemetryCoverage).toBe("transcript");
    expect(res.output.sessions[0]?.telemetryPartial).toBeUndefined();
    expect(res.output.sessions[0]?.skillsLoaded).toEqual(["playbook-bug-fix", "tdd"]);
    expect(res.output.topSkills).toEqual([
      {
        skill: "playbook-bug-fix",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 0, "prompt-attachment": 1, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.2,
        attributedTokens: { input: 400, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 0,
        postLoadErrors: 2,
      },
      {
        skill: "tdd",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 1, "prompt-attachment": 0, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.1,
        attributedTokens: { input: 200, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 0,
        postLoadErrors: 1,
      },
    ]);
    expect(res.output.skillCoUse).toEqual([
      { left: "playbook-bug-fix", right: "tdd", sessions: 1, sameTurn: 1, jaccard: 1 },
    ]);
  });

  test("applies fork replay cutoff so pre-fork parent skills and step costs are not double-counted", async () => {
    const forkAt = NOW - 10_000;
    const { ctx } = makeHost([
      {
        id: "ses_forked",
        agent: "spectre",
        fork: { sessionID: "ses_parent", boundary: { type: "message", id: "msg_p1" } },
        createdAt: forkAt,
        updatedAt: NOW - 1_000,
        cost: 0.15,
        messages: [
          {
            id: "msg_pre_u",
            type: "user",
            text: "old",
            time: { created: DateTime.makeUnsafe(forkAt - 5_000) },
            skills: [{ id: "architect", name: "architect", text: "old" }],
          },
          {
            id: "msg_pre_a",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            time: { created: DateTime.makeUnsafe(forkAt - 4_000) },
            cost: 0.5,
            tokens: { input: 5_000, output: 500, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
          },
          {
            id: "msg_post_u",
            type: "user",
            text: "new",
            time: { created: DateTime.makeUnsafe(forkAt + 1_000) },
            skills: [{ id: "tdd", name: "tdd", text: "new" }],
          },
          {
            id: "msg_post_a",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            time: { created: DateTime.makeUnsafe(forkAt + 2_000) },
            cost: 0.15,
            tokens: { input: 300, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
          },
        ],
      },
    ]);

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, callContext()));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.sessions[0]?.skillsLoaded).toEqual(["tdd"]);
    expect(res.output.topSkills).toEqual([
      {
        skill: "tdd",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 0, "prompt-attachment": 1, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.15,
        attributedTokens: { input: 300, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 0,
        postLoadErrors: 0,
      },
    ]);
  });

  test("deduplicates overlapping live and transcript steps by assistantMessageID with zero double-charge", async () => {
    const { ctx, store } = makeHost([
      {
        id: "ses_hybrid",
        agent: "spectre",
        updatedAt: NOW - 1_000,
        cost: 0.45,
        messages: [
          {
            id: "msg_u1",
            type: "user",
            text: "go",
            skills: [
              { id: "A", name: "A", text: "A" },
              { id: "B", name: "B", text: "B" },
            ],
          },
          {
            id: "msg_2",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            cost: 0.2,
            tokens: { input: 400, output: 100, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
          },
          {
            id: "msg_3",
            type: "assistant",
            agent: "spectre",
            model: { providerID: "anthropic", id: "claude-sonnet-4" },
            cost: 0.1,
            tokens: { input: 200, output: 50, reasoning: 0, cache: { read: 0, write: 0 } },
            content: [],
          },
        ],
      },
    ]);

    store.set(telemetryStorageKey("ses_hybrid"), {
      version: 1,
      projectID: "proj_spectre",
      sessionID: "ses_hybrid",
      updatedAt: NOW - 1_000,
      partial: false,
      truncated: false,
      loads: [
        {
          id: "prompt:msg_u1:A",
          turnID: "live:0",
          skill: "A",
          trigger: "prompt-attachment",
          status: "completed",
          at: NOW - 5_000,
        },
      ],
      steps: [
        {
          assistantMessageID: "msg_pre_1",
          turnID: "live:0",
          skills: ["A"],
          cost: 0.15,
          tokens: { input: 300, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          postLoadErrors: 0,
        },
        {
          assistantMessageID: "msg_2",
          turnID: "live:0",
          skills: ["A"],
          cost: 0.2,
          tokens: { input: 400, output: 100, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          postLoadErrors: 0,
        },
      ],
    });

    const tool = nocturnaTool(ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, callContext()));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.sessions[0]?.telemetryCoverage).toBe("hybrid");
    expect(res.output.skillCoverage).toEqual({
      live: 0,
      transcript: 0,
      hybrid: 1,
      none: 0,
      partial: 0,
    });
    const rowA = res.output.topSkills.find((row) => row.skill === "A");
    const rowB = res.output.topSkills.find((row) => row.skill === "B");
    expect(rowA?.attributedCost).toBe(0.3);
    expect(rowB?.attributedCost).toBe(0.15);
    expect((rowA?.attributedCost ?? 0) + (rowB?.attributedCost ?? 0)).toBeCloseTo(0.45, 6);
  });

  test("preserves unchanged descriptions, byte-identical push catalog, and valid NocturnaOutput schema decode across all actions", async () => {
    const { ctx } = makeHost([
      {
        id: "ses_schema",
        agent: "spectre",
        updatedAt: NOW - 1_000,
        messages: [{ id: "msg_u", type: "user", text: "hi" }],
      },
    ]);
    const tool = nocturnaTool(ctx, () => NOW);
    expect(tool.description).toBe(
      `Collect, inspect, and watermark past OpenCode sessions for Nocturna audits over a rolling lookback window.
Uses ctx.session to digest root and subagent token spend, tool errors, retries, compactions, and loaded skills over the last 7 days by default, and tracks analyzed session updatedAt watermarks in ctx.storage so unchanged sessions are skipped until resumed.`,
    );
    expect(NAMESPACE_DESCRIPTION).toContain(
      "nocturna (rolling session audit digests, storage watermarks)",
    );
    expect(renderCatalog(definitions)).toContain("## Spectre skill catalog");

    const decode = Schema.decodeUnknownOption(NocturnaOutput);
    const collected = await Effect.runPromise(tool.execute({}, callContext()));
    const inspected = await Effect.runPromise(
      tool.execute({ action: "inspect", sessions: ["ses_schema"] }, callContext()),
    );
    const marked = await Effect.runPromise(
      tool.execute({ action: "mark", sessions: ["ses_schema"] }, callContext()),
    );

    expect(decode(collected.output)._tag).toBe("Some");
    expect(decode(inspected.output)._tag).toBe("Some");
    expect(decode(marked.output)._tag).toBe("Some");
  });
});
