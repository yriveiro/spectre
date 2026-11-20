import { describe, expect, test } from "bun:test";
import { type Plugin, Tool } from "@opencode/plugin/effect";
import { DateTime, Effect, type Schema } from "effect";
import { nocturnaTool } from "../../tools/definitions/nocturna";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000;

interface MockSession {
  readonly id: string;
  readonly projectID?: string;
  readonly parentID?: string;
  readonly agent?: string;
  readonly title?: string;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly updatedAt: number;
  readonly cost?: number;
  readonly tokens?: {
    readonly input?: number;
    readonly output?: number;
    readonly reasoning?: number;
  };
  readonly contextError?: string;
  readonly messages?: ReadonlyArray<unknown>;
}

const toSessionInfo = (row: MockSession) => ({
  id: row.id,
  ...(row.parentID === undefined ? {} : { parentID: row.parentID }),
  projectID: row.projectID ?? "proj_spectre",
  ...(row.agent === undefined ? {} : { agent: row.agent }),
  model: { providerID: "anthropic", id: "claude-sonnet-4" },
  cost: row.cost ?? 0.05,
  tokens: {
    input: row.tokens?.input ?? 1_000,
    output: row.tokens?.output ?? 500,
    reasoning: row.tokens?.reasoning ?? 0,
    cache: { read: 0, write: 0 },
  },
  ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
  time: {
    created: DateTime.makeUnsafe(row.updatedAt - 60_000),
    updated: DateTime.makeUnsafe(row.updatedAt),
  },
  ...(row.title === undefined ? {} : { title: row.title }),
  location: { directory: "/repo" },
});

const makeHost = (
  initial: ReadonlyArray<MockSession>,
  options: { readonly failList?: boolean; readonly storageDelayMs?: number } = {},
) => {
  const store = new Map<string, Schema.Json>();
  const rows = new Map<string, MockSession>(initial.map((one) => [one.id, one]));

  const ctx = {
    location: {
      directory: "/repo",
      project: { id: "proj_spectre", directory: "/repo", canonical: "/repo" },
    },
    storage: {
      get: (key: string) =>
        options.storageDelayMs === undefined
          ? Effect.succeed(store.get(key))
          : Effect.promise(async () => {
              await Bun.sleep(options.storageDelayMs!);
              return store.get(key);
            }),
      set: (key: string, value: Schema.Json) =>
        Effect.sync(() => {
          store.set(key, value);
        }),
      remove: (key: string) =>
        Effect.sync(() => {
          store.delete(key);
        }),
      scan: () => Effect.succeed({ entries: [], cursor: undefined }),
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
          .toSorted((left, right) => right.updatedAt - left.updatedAt || right.id.localeCompare(left.id));
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
          { id: "msg_2", type: "skill", skill: "playbook-feature", name: "playbook-feature", text: "" },
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
    expect(out.topSkills).toEqual([{ skill: "playbook-feature", sessions: 1 }]);
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
      Effect.runPromise(
        tool.execute({ action: "mark", sessions: ["ses_two"] }, callContext()),
      ),
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
});
