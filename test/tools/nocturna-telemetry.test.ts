import { describe, expect, test } from "bun:test";
import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Cause, DateTime, Deferred, Effect, Logger, Queue, Schema, Stream } from "effect";
import {
  attachSkillTelemetry,
  NocturnaInput,
  NocturnaOutput,
  nocturnaTool,
} from "../../tools/definitions/nocturna";
import {
  pruneSkillTelemetry,
  readSessionTelemetry,
  telemetryStorageKey,
} from "../../tools/definitions/nocturna/telemetry-store";

const DAY_MS = 24 * 60 * 60 * 1_000;
const NOW = 1_800_000_000_000;

interface MockSessionRow {
  readonly id: string;
  readonly projectID?: string;
  readonly parentID?: string;
  readonly agent?: string;
  readonly directory?: string;
  readonly workspaceID?: string;
  readonly outcome?: "succeeded" | "failed" | "interrupted";
  readonly updatedAt?: number;
  readonly cost?: number;
  readonly messages?: ReadonlyArray<unknown>;
}

type HookFn = (event: unknown) => Effect.Effect<void, unknown>;

interface TelemetryHostOptions {
  readonly directory?: string;
  readonly workspaceID?: string;
  readonly projectID?: string;
  readonly store?: Map<string, Schema.Json>;
  readonly sessions?: Map<string, MockSessionRow>;
  readonly skills?: ReadonlyArray<string>;
  readonly storageDelayMs?: number;
  readonly failStorage?: { readonly get?: Error; readonly set?: Error; readonly remove?: Error };
  readonly failSessionGet?: Error;
  readonly gateBeforeEvent?: {
    readonly predicate: (event: Record<string, unknown>) => boolean;
    readonly gate: Deferred.Deferred<void>;
  };
}

const toSessionInfo = (row: MockSessionRow, fallbackProject: string, fallbackDir: string) => ({
  id: row.id,
  ...(row.parentID === undefined ? {} : { parentID: row.parentID }),
  projectID: row.projectID ?? fallbackProject,
  ...(row.agent === undefined ? {} : { agent: row.agent }),
  model: { providerID: "anthropic", id: "claude-sonnet-4" },
  cost: row.cost ?? 0,
  tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
  ...(row.outcome === undefined ? {} : { outcome: row.outcome }),
  time: {
    created: DateTime.makeUnsafe((row.updatedAt ?? NOW) - 60_000),
    updated: DateTime.makeUnsafe(row.updatedAt ?? NOW),
  },
  location: {
    directory: row.directory ?? fallbackDir,
    ...(row.workspaceID === undefined ? {} : { workspaceID: row.workspaceID }),
  },
});

const makeMockStorage = (
  store: Map<string, Schema.Json>,
  options: TelemetryHostOptions,
  counters: { getCalls: number; setCalls: number; removeCalls: number },
) => ({
  get: (key: string) =>
    Effect.suspend(() => {
      counters.getCalls += 1;
      if (options.failStorage?.get !== undefined) return Effect.fail(options.failStorage.get);
      const delay = options.storageDelayMs;
      if (delay === undefined) return Effect.succeed(store.get(key));
      return Effect.promise(async () => {
        await Bun.sleep(delay);
        return store.get(key);
      });
    }),
  set: (key: string, value: Schema.Json) =>
    Effect.suspend(() => {
      counters.setCalls += 1;
      if (options.failStorage?.set !== undefined) return Effect.fail(options.failStorage.set);
      const delay = options.storageDelayMs;
      if (delay === undefined) {
        store.set(key, value);
        return Effect.void;
      }
      return Effect.promise(async () => {
        await Bun.sleep(delay);
        store.set(key, value);
      });
    }),
  remove: (key: string) =>
    Effect.suspend(() => {
      counters.removeCalls += 1;
      if (options.failStorage?.remove !== undefined) return Effect.fail(options.failStorage.remove);
      store.delete(key);
      return Effect.void;
    }),
  scan: ({ prefix, after, limit = 100 }: { prefix: string; after?: string; limit?: number }) =>
    Effect.sync(() => {
      const matching = [...store.entries()]
        .filter(([key]) => key.startsWith(prefix) && (after === undefined || key > after))
        .toSorted(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
      const page = matching.slice(0, limit);
      const next = matching.length > limit ? page.at(-1)?.[0] : undefined;
      return {
        entries: page.map(([key, value]) => ({ key, value })),
        ...(next === undefined ? {} : { next }),
      };
    }),
});

const makeTelemetryHost = (options: TelemetryHostOptions = {}) => {
  const directory = options.directory ?? "/repo/main";
  const projectID = options.projectID ?? "proj_spectre";
  const store = options.store ?? new Map<string, Schema.Json>();
  const sessions = options.sessions ?? new Map<string, MockSessionRow>();
  const hooks = new Map<string, Array<HookFn>>();
  const busQueues: Array<Queue.Queue<Record<string, unknown>, Cause.Done>> = [];
  const counters = { getCalls: 0, setCalls: 0, removeCalls: 0 };

  const registerHook = (kind: string, name: string, cb: HookFn) =>
    Effect.sync(() => {
      const key = `${kind}:${name}`;
      const list = hooks.get(key) ?? [];
      list.push(cb);
      hooks.set(key, list);
      return { dispose: () => Effect.void };
    });

  const ctx = {
    location: {
      directory,
      ...(options.workspaceID === undefined ? {} : { workspaceID: options.workspaceID }),
      project: { id: projectID, directory, canonical: directory },
    },
    storage: makeMockStorage(store, options, counters),
    skill: {
      list: () =>
        Effect.succeed({
          location: { directory },
          data: (options.skills ?? ["tdd", "architect", "canvas", "diagram"]).map((id) => ({
            id,
            name: id,
            path: `/skills/${id}/SKILL.md`,
            content: "",
          })),
        }),
    },
    session: {
      hook: (name: string, cb: HookFn) => registerHook("session", name, cb),
      list: (input?: { readonly project?: string }) => {
        const target = input?.project ?? projectID;
        const data = [...sessions.values()]
          .filter((row) => (row.projectID ?? projectID) === target)
          .toSorted((a, b) => (b.updatedAt ?? NOW) - (a.updatedAt ?? NOW))
          .map((row) => toSessionInfo(row, projectID, directory));
        return Effect.succeed({ data, cursor: {} });
      },
      get: ({ sessionID }: { readonly sessionID: string }) => {
        if (options.failSessionGet !== undefined) return Effect.fail(options.failSessionGet);
        const found = sessions.get(sessionID);
        return found === undefined
          ? Effect.fail(new Error(`missing: ${sessionID}`))
          : Effect.succeed(toSessionInfo(found, projectID, directory));
      },
      context: ({ sessionID }: { readonly sessionID: string }) =>
        Effect.succeed(sessions.get(sessionID)?.messages ?? []),
    },
    tool: {
      hook: (name: string, cb: HookFn) => registerHook("tool", name, cb),
    },
    event: {
      subscribe: (filter?: { readonly types?: ReadonlyArray<string> }) =>
        Stream.unwrap(
          Effect.gen(function* () {
            const q = yield* Queue.unbounded<Record<string, unknown>, Cause.Done>();
            busQueues.push(q);
            const allowed = filter?.types === undefined ? undefined : new Set(filter.types);
            return Stream.fromQueue(q).pipe(
              Stream.filter((evt) => allowed === undefined || allowed.has(String(evt.type))),
              Stream.mapEffect((evt) => {
                const gated = options.gateBeforeEvent;
                return gated?.predicate(evt)
                  ? Deferred.await(gated.gate).pipe(Effect.as(evt))
                  : Effect.succeed(evt);
              }),
            );
          }),
        ),
    },
  } as unknown as Plugin.Context;

  const fireHook = (kind: "session" | "tool", name: string, event: unknown) =>
    Effect.forEach(hooks.get(`${kind}:${name}`) ?? [], (cb) => cb(event), { discard: true });

  const publishEvent = (event: Record<string, unknown>) =>
    Effect.sync(() => {
      for (const q of busQueues) Queue.offerUnsafe(q, event);
    });

  const settle = (ms = 25) => Effect.promise(() => Bun.sleep(ms));

  return {
    ctx,
    store,
    sessions,
    fireSessionHook: (name: string, event: unknown) => fireHook("session", name, event),
    fireToolHook: (name: string, event: unknown) => fireHook("tool", name, event),
    publishEvent,
    settle,
    stats: () => ({ ...counters }),
  };
};

const stepTokens = (input: number, output: number) => ({
  input,
  output,
  reasoning: 0,
  cache: { read: 0, write: 0 },
});

const toolResultMsg = (callID: string, name: string, isError = false) => ({
  role: "tool",
  content: [
    {
      type: "tool-result",
      id: callID,
      name,
      result: isError ? { type: "error", value: "boom" } : { type: "text", value: "skill body" },
    },
  ],
});

const NOCTURNA_CALL_CONTEXT = {
  sessionID: "ses_caller",
  agent: "nocturna",
  messageID: "msg_caller",
  id: "call_1",
  progress: () => Effect.void,
} as unknown as Tool.Context;

describe("nocturna live skill telemetry", () => {
  test("excludes Step k and sibling tool errors, charges Step k+1 after tool-result exposure, and avoids hot-path storage awaits", async () => {
    const sessions = new Map<string, MockSessionRow>([
      [
        "ses_1",
        {
          id: "ses_1",
          agent: "spectre",
          cost: 0.3,
          updatedAt: NOW - 1_000,
          outcome: "succeeded",
          messages: [],
        },
      ],
    ]);
    const host = makeTelemetryHost({ sessions, storageDelayMs: 15 });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          const beforeHookWrites = host.stats().setCalls;
          yield* host.fireSessionHook("context", {
            sessionID: "ses_1",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [{ type: "text", text: "hi" }] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_1",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_tdd",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "TDD instructions" } },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "read",
            codemode: false,
            sessionID: "ses_1",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_sib_err",
            input: { path: "missing.ts" },
            status: "error",
            error: new Error("ENOENT"),
          });
          expect(host.stats().setCalls).toBe(beforeHookWrites);

          yield* host.publishEvent({
            id: "evt_s1",
            type: "session.step.ended",
            created: NOW + 10,
            location: loc,
            data: {
              sessionID: "ses_1",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.05,
              tokens: stepTokens(1_000, 200),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_1",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [{ type: "text", text: "hi" }] },
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_tdd", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "edit",
            codemode: false,
            sessionID: "ses_1",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_edit_err",
            input: { path: "a.ts" },
            status: "error",
            error: new Error("oldString not found"),
          });
          yield* host.publishEvent({
            id: "evt_s2",
            type: "session.step.ended",
            created: NOW + 20,
            location: loc,
            data: {
              sessionID: "ses_1",
              assistantMessageID: "msg_2",
              finish: "stop",
              cost: 0.25,
              tokens: stepTokens(2_000, 500),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 30,
            data: { sessionID: "ses_1" },
          });
          yield* host.settle(80);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const collected = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (collected.output?.status !== "collected") throw new Error("expected collected");

    expect(collected.output.sessions[0]?.telemetryCoverage).toBe("live");
    expect(collected.output.sessions[0]?.skillsLoaded).toEqual(["tdd"]);
    expect(collected.output.topSkills).toEqual([
      {
        skill: "tdd",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 1, "prompt-attachment": 0, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.25,
        attributedTokens: {
          input: 2_000,
          output: 500,
          reasoning: 0,
          cacheRead: 0,
          cacheWrite: 0,
        },
        unmeasuredSteps: 0,
        postLoadErrors: 1,
      },
    ]);
  });

  test("splits staggered co-active skills with exact conservation and avoids double-weighting on same-skill reload", async () => {
    const sessions = new Map<string, MockSessionRow>([
      ["ses_stagger", { id: "ses_stagger", agent: "spectre", cost: 0.34, updatedAt: NOW - 1_000 }],
    ]);
    const host = makeTelemetryHost({ sessions });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireSessionHook("context", {
            sessionID: "ses_stagger",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_stagger",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_a1",
            input: { id: "A" },
            status: "completed",
            result: { output: { content: "A" } },
          });
          yield* host.publishEvent({
            id: "evt_1",
            type: "session.step.ended",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_stagger",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.04,
              tokens: stepTokens(100, 50),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_stagger",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_a1", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_stagger",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_a2",
            input: { id: "A" },
            status: "completed",
            result: { output: { content: "A reload" } },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_stagger",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_b1",
            input: { id: "B" },
            status: "completed",
            result: { output: { content: "B" } },
          });
          yield* host.publishEvent({
            id: "evt_2",
            type: "session.step.ended",
            created: NOW + 2,
            location: loc,
            data: {
              sessionID: "ses_stagger",
              assistantMessageID: "msg_2",
              finish: "tool-calls",
              cost: 0.1,
              tokens: stepTokens(200, 100),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_stagger",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_a1", "skill"),
              { id: "msg_2", role: "assistant", content: [] },
              toolResultMsg("call_a2", "skill"),
              toolResultMsg("call_b1", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "edit",
            codemode: false,
            sessionID: "ses_stagger",
            agent: "spectre",
            messageID: "msg_3",
            id: "call_err",
            input: {},
            status: "error",
            error: new Error("failed"),
          });
          yield* host.publishEvent({
            id: "evt_3",
            type: "session.step.ended",
            created: NOW + 3,
            location: loc,
            data: {
              sessionID: "ses_stagger",
              assistantMessageID: "msg_3",
              finish: "stop",
              cost: 0.2,
              tokens: stepTokens(400, 200),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 4,
            data: { sessionID: "ses_stagger" },
          });
          yield* host.settle(50);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    const rowA = res.output.topSkills.find((row) => row.skill === "A");
    const rowB = res.output.topSkills.find((row) => row.skill === "B");
    expect(rowA?.invocations).toBe(2);
    expect(rowA?.attributedCost).toBe(0.2);
    expect(rowA?.postLoadErrors).toBe(1);
    expect(rowB?.invocations).toBe(1);
    expect(rowB?.attributedCost).toBe(0.1);
    expect(rowB?.postLoadErrors).toBe(1);
    expect((rowA?.attributedCost ?? 0) + (rowB?.attributedCost ?? 0)).toBeCloseTo(0.3, 6);
    expect(res.output.skillCoUse).toEqual([
      { left: "A", right: "B", sessions: 1, sameTurn: 1, jaccard: 1 },
    ]);
  });

  test("preserves exact attribution under ordering race when primary session.context overtakes pending Step.Ended via Deferred", async () => {
    const sessions = new Map<string, MockSessionRow>([
      ["ses_race", { id: "ses_race", agent: "spectre", cost: 0.35, updatedAt: NOW - 1_000 }],
    ]);
    const gate = Deferred.makeUnsafe<void>();
    const host = makeTelemetryHost({
      sessions,
      gateBeforeEvent: {
        predicate: (evt) =>
          evt.type === "session.step.ended" &&
          (evt.data as { assistantMessageID?: string })?.assistantMessageID === "msg_1",
        gate,
      },
    });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireSessionHook("context", {
            sessionID: "ses_race",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_race",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_a",
            input: { id: "A" },
            status: "completed",
            result: { output: { content: "A" } },
          });
          yield* host.publishEvent({
            id: "evt_1",
            type: "session.step.ended",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_race",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.05,
              tokens: stepTokens(100, 10),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_race",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_a", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_race",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_b",
            input: { id: "B" },
            status: "completed",
            result: { output: { content: "B" } },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "edit",
            codemode: false,
            sessionID: "ses_race",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_err_2",
            input: {},
            status: "error",
            error: new Error("step 2 error"),
          });
          yield* host.publishEvent({
            id: "evt_2",
            type: "session.step.ended",
            created: NOW + 2,
            location: loc,
            data: {
              sessionID: "ses_race",
              assistantMessageID: "msg_2",
              finish: "tool-calls",
              cost: 0.1,
              tokens: stepTokens(200, 20),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_race",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_a", "skill"),
              { id: "msg_2", role: "assistant", content: [] },
              toolResultMsg("call_b", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "edit",
            codemode: false,
            sessionID: "ses_race",
            agent: "spectre",
            messageID: "msg_3",
            id: "call_err_3",
            input: {},
            status: "error",
            error: new Error("step 3 error"),
          });
          yield* host.publishEvent({
            id: "evt_3",
            type: "session.step.ended",
            created: NOW + 3,
            location: loc,
            data: {
              sessionID: "ses_race",
              assistantMessageID: "msg_3",
              finish: "stop",
              cost: 0.2,
              tokens: stepTokens(400, 40),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 4,
            data: { sessionID: "ses_race" },
          });

          yield* host.settle(20);
          yield* Deferred.succeed(gate, undefined);
          yield* host.settle(60);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    const rowA = res.output.topSkills.find((row) => row.skill === "A");
    const rowB = res.output.topSkills.find((row) => row.skill === "B");
    expect(rowA?.attributedCost).toBe(0.2);
    expect(rowA?.postLoadErrors).toBe(2);
    expect(rowB?.attributedCost).toBe(0.1);
    expect(rowB?.postLoadErrors).toBe(1);
  });

  test("sources prompt attachments from validated InboxEnqueued, drops cancelled prompts, and waits for context exposure on queued prompts", async () => {
    const sessions = new Map<string, MockSessionRow>([
      ["ses_prompt", { id: "ses_prompt", agent: "spectre", cost: 0.42, updatedAt: NOW - 1_000 }],
    ]);
    const host = makeTelemetryHost({ sessions });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireSessionHook("context", {
            sessionID: "ses_prompt",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });

          yield* host.fireSessionHook("prompt", {
            sessionID: "ses_prompt",
            messageID: "msg_cancelled",
            prompt: { text: "cancel me", skills: [{ id: "tdd" }] },
            delivery: "queue",
          });
          yield* host.publishEvent({
            id: "evt_enq_cancel",
            type: "session.inbox.enqueued",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_prompt",
              inboxID: "msg_cancelled",
              item: {
                type: "user",
                delivery: "queue",
                payload: { text: "cancel me", skills: [{ id: "tdd", name: "tdd" }] },
              },
            },
          });
          yield* host.publishEvent({
            id: "evt_cancel",
            type: "session.inbox.cancelled",
            created: NOW + 2,
            location: loc,
            data: { sessionID: "ses_prompt", inboxID: "msg_cancelled" },
          });

          yield* host.fireSessionHook("prompt", {
            sessionID: "ses_prompt",
            messageID: "msg_u2",
            prompt: { text: "queued", skills: [{ id: "canvas" }] },
            delivery: "queue",
          });
          yield* host.publishEvent({
            id: "evt_enq_u2",
            type: "session.inbox.enqueued",
            created: NOW + 3,
            location: loc,
            data: {
              sessionID: "ses_prompt",
              inboxID: "msg_u2",
              item: {
                type: "user",
                delivery: "queue",
                payload: {
                  text: "queued",
                  skills: [
                    { id: "diagram", name: "diagram", text: "body" },
                    { id: "diagram", name: "diagram" },
                  ],
                },
              },
            },
          });

          yield* host.publishEvent({
            id: "evt_s1",
            type: "session.step.ended",
            created: NOW + 4,
            location: loc,
            data: {
              sessionID: "ses_prompt",
              assistantMessageID: "msg_1",
              finish: "stop",
              cost: 0.3,
              tokens: stepTokens(500, 100),
            },
          });
          yield* host.publishEvent({
            id: "evt_done1",
            type: "session.execution.succeeded",
            created: NOW + 5,
            data: { sessionID: "ses_prompt" },
          });

          yield* host.publishEvent({
            id: "evt_del_u2",
            type: "session.inbox.delivered",
            created: NOW + 6,
            location: loc,
            data: { sessionID: "ses_prompt", inboxID: "msg_u2" },
          });
          yield* host.fireSessionHook("context", {
            sessionID: "ses_prompt",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              { id: "msg_u2", role: "user", content: [] },
            ],
          });
          yield* host.publishEvent({
            id: "evt_s2",
            type: "session.step.ended",
            created: NOW + 7,
            location: loc,
            data: {
              sessionID: "ses_prompt",
              assistantMessageID: "msg_2",
              finish: "stop",
              cost: 0.12,
              tokens: stepTokens(300, 80),
            },
          });
          yield* host.publishEvent({
            id: "evt_done2",
            type: "session.execution.succeeded",
            created: NOW + 8,
            data: { sessionID: "ses_prompt" },
          });
          yield* host.settle(50);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.topSkills).toEqual([
      {
        skill: "diagram",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 0, "prompt-attachment": 1, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.12,
        attributedTokens: { input: 300, output: 80, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 0,
        postLoadErrors: 0,
      },
    ]);
  });

  test("handles locationless session.skill.activated mid-step and locationless execution terminal with multi-location isolation", async () => {
    const sharedStore = new Map<string, Schema.Json>();
    const sessions = new Map<string, MockSessionRow>([
      [
        "ses_locA",
        {
          id: "ses_locA",
          agent: "spectre",
          directory: "/repo/main",
          cost: 0.27,
          updatedAt: NOW - 1_000,
        },
      ],
    ]);
    const hostA = makeTelemetryHost({
      directory: "/repo/main",
      store: sharedStore,
      sessions,
    });
    const hostB = makeTelemetryHost({
      directory: "/repo/wt-1",
      store: sharedStore,
      sessions,
    });
    const publishBoth = (evt: Record<string, unknown>) =>
      Effect.all([hostA.publishEvent(evt), hostB.publishEvent(evt)], { discard: true });

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(hostA.ctx, () => NOW);
          yield* attachSkillTelemetry(hostB.ctx, () => NOW);
          yield* hostA.settle(10);

          yield* hostA.fireSessionHook("context", {
            sessionID: "ses_locA",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* publishBoth({
            id: "evt_act1",
            type: "session.skill.activated",
            created: NOW + 1,
            data: { sessionID: "ses_locA", id: "tdd", name: "TDD", text: "SKILL_BODY_SECRET" },
          });
          yield* publishBoth({
            id: "evt_s1",
            type: "session.step.ended",
            created: NOW + 2,
            location: { directory: "/repo/main" },
            data: {
              sessionID: "ses_locA",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.15,
              tokens: stepTokens(500, 100),
            },
          });

          yield* hostA.fireSessionHook("context", {
            sessionID: "ses_locA",
            agent: "spectre",
            messages: [
              { id: "msg_u1", role: "user", content: [] },
              { id: "msg_1", role: "assistant", content: [] },
              { id: "msg_act1", role: "user", content: [{ type: "text", text: "body" }] },
            ],
          });
          yield* publishBoth({
            id: "evt_s2",
            type: "session.step.ended",
            created: NOW + 3,
            location: { directory: "/repo/main" },
            data: {
              sessionID: "ses_locA",
              assistantMessageID: "msg_2",
              finish: "stop",
              cost: 0.12,
              tokens: stepTokens(300, 50),
            },
          });
          yield* publishBoth({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 4,
            data: { sessionID: "ses_locA" },
          });
          yield* hostA.settle(60);
        }),
      ),
    );

    const tool = nocturnaTool(hostA.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.topSkills).toEqual([
      {
        skill: "tdd",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 0, "prompt-attachment": 0, "api-activation": 1 },
        loadErrors: 0,
        attributedCost: 0.12,
        attributedTokens: { input: 300, output: 50, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 0,
        postLoadErrors: 0,
      },
    ]);
  });

  test("ignores discarded background compaction, closes on committed Compaction.Ended, preserves turn on shutdown, and tracks unmeasuredSteps separately from measured $0", async () => {
    const sessions = new Map<string, MockSessionRow>([
      [
        "ses_comp",
        {
          id: "ses_comp",
          agent: "spectre",
          cost: 0.55,
          updatedAt: NOW - 1_000,
          messages: [
            {
              id: "msg_c1",
              type: "compaction",
              status: "completed",
              reason: "auto",
              summary: "compacted summary",
            },
          ],
        },
      ],
    ]);
    const host = makeTelemetryHost({ sessions });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_comp",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_arch",
            input: { id: "architect" },
            status: "completed",
            result: { output: { content: "arch" } },
          });
          yield* host.publishEvent({
            id: "evt_1",
            type: "session.step.ended",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.05,
              tokens: stepTokens(100, 20),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_arch", "skill"),
            ],
          });
          yield* host.publishEvent({
            id: "evt_2",
            type: "session.step.ended",
            created: NOW + 2,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_2",
              finish: "tool-calls",
              cost: 0,
              tokens: stepTokens(400, 100),
            },
          });

          yield* host.publishEvent({
            id: "evt_bg_fail",
            type: "session.compaction.failed",
            created: NOW + 3,
            location: loc,
            data: {
              sessionID: "ses_comp",
              reason: "auto",
              error: { type: "aborted", message: "discarded" },
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_arch", "skill"),
              { id: "msg_2", role: "assistant", content: [] },
            ],
          });
          yield* host.publishEvent({
            id: "evt_retry",
            type: "session.retry.scheduled",
            created: NOW + 4,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_3",
              attempt: 1,
              at: NOW + 4,
              error: { type: "rate_limit", message: "429" },
            },
          });
          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_arch", "skill"),
              { id: "msg_2", role: "assistant", content: [] },
            ],
          });
          yield* host.publishEvent({
            id: "evt_3_fail",
            type: "session.step.failed",
            created: NOW + 5,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_3",
              error: { type: "provider", message: "timeout" },
            },
          });

          yield* host.publishEvent({
            id: "evt_shutdown",
            type: "session.execution.interrupted",
            created: NOW + 6,
            data: { sessionID: "ses_comp", reason: "shutdown" },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_arch", "skill"),
              { id: "msg_2", role: "assistant", content: [] },
            ],
          });
          yield* host.publishEvent({
            id: "evt_4",
            type: "session.step.ended",
            created: NOW + 7,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_4",
              finish: "tool-calls",
              cost: 0.15,
              tokens: stepTokens(300, 50),
            },
          });

          yield* host.publishEvent({
            id: "evt_compact",
            type: "session.compaction.ended",
            created: NOW + 8,
            location: loc,
            data: {
              sessionID: "ses_comp",
              reason: "auto",
              text: "summary",
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_comp",
            agent: "spectre",
            messages: [{ id: "msg_c1", role: "user", content: [] }],
          });
          yield* host.publishEvent({
            id: "evt_5",
            type: "session.step.ended",
            created: NOW + 9,
            location: loc,
            data: {
              sessionID: "ses_comp",
              assistantMessageID: "msg_5",
              finish: "stop",
              cost: 0.35,
              tokens: stepTokens(900, 100),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 10,
            data: { sessionID: "ses_comp" },
          });
          yield* host.settle(60);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");

    expect(res.output.sessions[0]?.telemetryCoverage).toBe("live");
    expect(res.output.sessions[0]?.telemetryPartial).toBe(true);
    expect(res.output.sessions[0]?.skillsLoaded).toEqual(["architect"]);
    expect(res.output.topSkills).toEqual([
      {
        skill: "architect",
        sessions: 1,
        invocations: 1,
        triggers: { "agent-tool": 1, "prompt-attachment": 0, "api-activation": 0 },
        loadErrors: 0,
        attributedCost: 0.15,
        attributedTokens: { input: 700, output: 150, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        unmeasuredSteps: 1,
        postLoadErrors: 0,
      },
    ]);
  });

  test("deduplicates Code Mode execute/nested errors and shell non-zero exits for postLoadErrors", async () => {
    const sessions = new Map<string, MockSessionRow>([
      ["ses_err", { id: "ses_err", agent: "spectre", cost: 0.1, updatedAt: NOW - 1_000 }],
    ]);
    const host = makeTelemetryHost({ sessions });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireSessionHook("context", {
            sessionID: "ses_err",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_err",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_s",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "tdd" } },
          });
          yield* host.publishEvent({
            id: "evt_1",
            type: "session.step.ended",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_err",
              assistantMessageID: "msg_1",
              finish: "tool-calls",
              cost: 0.02,
              tokens: stepTokens(50, 10),
            },
          });

          yield* host.fireSessionHook("context", {
            sessionID: "ses_err",
            agent: "spectre",
            messages: [
              { id: "msg_1", role: "assistant", content: [] },
              toolResultMsg("call_s", "skill"),
            ],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "spectre_brain",
            codemode: true,
            sessionID: "ses_err",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_nested",
            input: {},
            status: "error",
            error: new Error("nested boom"),
          });
          yield* host.fireToolHook("execute.after", {
            tool: "execute",
            codemode: false,
            sessionID: "ses_err",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_exec1",
            input: {},
            status: "completed",
            result: {
              content: [],
              metadata: {
                error: true,
                toolCalls: [{ tool: "spectre.brain", status: "error" }],
              },
            },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "execute",
            codemode: false,
            sessionID: "ses_err",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_exec2",
            input: {},
            status: "completed",
            result: {
              content: [],
              metadata: { error: true, toolCalls: [] },
            },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "shell",
            codemode: false,
            sessionID: "ses_err",
            agent: "spectre",
            messageID: "msg_2",
            id: "call_sh",
            input: {},
            status: "completed",
            result: { content: [{ type: "text", text: "failed\nExit code: 2" }] },
          });
          yield* host.publishEvent({
            id: "evt_2",
            type: "session.step.ended",
            created: NOW + 2,
            location: loc,
            data: {
              sessionID: "ses_err",
              assistantMessageID: "msg_2",
              finish: "stop",
              cost: 0.08,
              tokens: stepTokens(100, 20),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.failed",
            created: NOW + 3,
            data: { sessionID: "ses_err", error: { type: "provider", message: "err" } },
          });
          yield* host.settle(50);
        }),
      ),
    );

    const tool = nocturnaTool(host.ctx, () => NOW);
    const res = await Effect.runPromise(tool.execute({}, NOCTURNA_CALL_CONTEXT));
    if (res.output?.status !== "collected") throw new Error("expected collected");
    expect(res.output.topSkills[0]?.postLoadErrors).toBe(3);
  });

  test("preserves telemetry under stable key on session.moved, serializes session.deleted against pending writes, and marks reload partial on scope close", async () => {
    const sharedStore = new Map<string, Schema.Json>();
    const host = makeTelemetryHost({ store: sharedStore, storageDelayMs: 10 });
    const loc = { directory: "/repo/main" };

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_move",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_move",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "tdd" } },
          });
          yield* host.publishEvent({
            id: "evt_move",
            type: "session.moved",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_move",
              projectID: "proj_moved",
              location: { directory: "/repo/other" },
            },
          });

          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_del",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_del",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "tdd" } },
          });
          yield* host.publishEvent({
            id: "evt_del",
            type: "session.deleted",
            created: NOW + 2,
            data: { sessionID: "ses_del" },
          });

          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_reload",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_rel",
            input: { id: "architect" },
            status: "completed",
            result: { output: { content: "arch" } },
          });
          yield* host.settle(80);
        }),
      ),
    );

    const moved = await Effect.runPromise(readSessionTelemetry(host.ctx.storage, "ses_move"));
    expect(moved?.projectID).toBe("proj_moved");
    expect(moved?.partial).toBe(true);
    expect(sharedStore.has(telemetryStorageKey("ses_move"))).toBe(true);

    expect(sharedStore.has(telemetryStorageKey("ses_del"))).toBe(false);

    const reloaded = await Effect.runPromise(readSessionTelemetry(host.ctx.storage, "ses_reload"));
    expect(reloaded?.partial).toBe(true);
    expect(reloaded?.loads[0]?.skill).toBe("architect");
  });

  test("enforces privacy in BOTH storage and logs, canonicalizes unknown failed skill IDs to <unknown>, and isolates synchronous hook crashes", async () => {
    const logged: Array<string> = [];
    const testLogger = Logger.make(({ message, cause }) => {
      logged.push(JSON.stringify({ message, cause: Cause.pretty(cause) }));
    });
    const loggerLayer = Logger.layer([testLogger]);

    const sessions = new Map<string, MockSessionRow>([
      ["ses_priv", { id: "ses_priv", agent: "spectre", cost: 0.1, updatedAt: NOW - 1_000 }],
    ]);
    const host = makeTelemetryHost({
      sessions,
      failStorage: undefined,
    });
    const loc = { directory: "/repo/main" };

    const canaries = [
      "CANARY_PROMPT_SECRET",
      "CANARY_FILE_PATH_SECRET",
      "CANARY_SKILL_BODY_SECRET",
      "CANARY_FAILED_SKILL_PROSE_/etc/shadow",
      "CANARY_TOOL_INPUT_SECRET",
      "CANARY_TOOL_ERROR_SECRET",
      "CANARY_SYNC_THROW_SECRET",
      "CANARY_STORAGE_THROW_SECRET",
    ];

    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(host.ctx, () => NOW);
          yield* host.settle(10);

          const poisoned = {};
          Object.defineProperty(poisoned, "sessionID", {
            get() {
              throw new Error("CANARY_SYNC_THROW_SECRET");
            },
          });
          yield* host.fireSessionHook("prompt", poisoned);
          yield* host.fireSessionHook("context", poisoned);
          yield* host.fireToolHook("execute.after", poisoned);

          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_nocturna_self",
            agent: "nocturna",
            messageID: "msg_n1",
            id: "call_n1",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "ignored" } },
          });

          yield* host.fireSessionHook("prompt", {
            sessionID: "ses_priv",
            messageID: "msg_u1",
            prompt: {
              text: "CANARY_PROMPT_SECRET",
              files: [{ uri: "file:///CANARY_FILE_PATH_SECRET" }],
              skills: [],
            },
            delivery: "steer",
          });
          yield* host.fireSessionHook("context", {
            sessionID: "ses_priv",
            agent: "spectre",
            messages: [{ id: "msg_u1", role: "user", content: [] }],
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_priv",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_bad_unknown",
            input: { id: "CANARY_FAILED_SKILL_PROSE_/etc/shadow" },
            status: "error",
            error: new Error("CANARY_TOOL_ERROR_SECRET"),
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_priv",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_bad_known",
            input: { id: "tdd" },
            status: "error",
            error: new Error("CANARY_TOOL_ERROR_SECRET"),
          });
          yield* host.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_priv",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_ok",
            input: { id: "architect" },
            status: "completed",
            result: { output: { content: "CANARY_SKILL_BODY_SECRET" } },
          });
          yield* host.fireToolHook("execute.after", {
            tool: "edit",
            codemode: false,
            sessionID: "ses_priv",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_edit",
            input: { oldString: "CANARY_TOOL_INPUT_SECRET" },
            status: "error",
            error: new Error("CANARY_TOOL_ERROR_SECRET"),
          });
          yield* host.publishEvent({
            id: "evt_1",
            type: "session.step.ended",
            created: NOW + 1,
            location: loc,
            data: {
              sessionID: "ses_priv",
              assistantMessageID: "msg_1",
              finish: "stop",
              cost: 0.1,
              tokens: stepTokens(100, 20),
            },
          });
          yield* host.publishEvent({
            id: "evt_done",
            type: "session.execution.succeeded",
            created: NOW + 2,
            data: { sessionID: "ses_priv" },
          });
          yield* host.settle(50);
        }),
      ).pipe(Effect.provide(loggerLayer)),
    );

    const failingStorageHost = makeTelemetryHost({
      failStorage: { set: new Error("CANARY_STORAGE_THROW_SECRET") },
    });
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(failingStorageHost.ctx, () => NOW);
          yield* failingStorageHost.settle(10);
          yield* failingStorageHost.fireToolHook("execute.after", {
            tool: "skill",
            codemode: false,
            sessionID: "ses_fail_io",
            agent: "spectre",
            messageID: "msg_1",
            id: "call_io",
            input: { id: "tdd" },
            status: "completed",
            result: { output: { content: "ok" } },
          });
          yield* failingStorageHost.settle(40);
        }),
      ).pipe(Effect.provide(loggerLayer)),
    );

    const serializedStorage = JSON.stringify([...host.store.entries()]);
    const serializedLogs = logged.join("\n");
    expect(logged.length).toBeGreaterThan(0);
    expect(serializedLogs).toContain("HOOK_PROMPT_FAILED");
    expect(serializedLogs).toContain("STORAGE_WRITE_FAILED");
    for (const canary of canaries) {
      expect(serializedStorage).not.toContain(canary);
      expect(serializedLogs).not.toContain(canary);
    }

    expect(host.store.has(telemetryStorageKey("ses_nocturna_self"))).toBe(false);

    const stored = await Effect.runPromise(readSessionTelemetry(host.ctx.storage, "ses_priv"));
    expect(stored?.loads.map((l) => [l.skill, l.status])).toEqual([
      ["<unknown>", "error"],
      ["tdd", "error"],
      ["architect", "completed"],
    ]);
  });

  test("prunes expired/corrupt rows, enforces per-project cap, and caps per-session loads", async () => {
    const host = makeTelemetryHost();
    host.store.set(telemetryStorageKey("ses_corrupt"), { bad: true } as unknown as Schema.Json);
    host.store.set(telemetryStorageKey("ses_expired"), {
      version: 1,
      projectID: "proj_spectre",
      sessionID: "ses_expired",
      updatedAt: NOW - 91 * DAY_MS,
      partial: false,
      truncated: false,
      loads: [],
      steps: [],
    });
    for (let i = 0; i < 5; i += 1) {
      host.store.set(telemetryStorageKey(`ses_keep_${i}`), {
        version: 1,
        projectID: "proj_spectre",
        sessionID: `ses_keep_${i}`,
        updatedAt: NOW - (10 - i) * DAY_MS,
        partial: false,
        truncated: false,
        loads: [],
        steps: [],
      });
    }

    await Effect.runPromise(
      pruneSkillTelemetry(host.ctx.storage, "proj_spectre", NOW, { maxSessions: 3, force: true }),
    );
    expect(host.store.has(telemetryStorageKey("ses_corrupt"))).toBe(false);
    expect(host.store.has(telemetryStorageKey("ses_expired"))).toBe(false);
    expect([...host.store.keys()].toSorted()).toEqual([
      telemetryStorageKey("ses_keep_2"),
      telemetryStorageKey("ses_keep_3"),
      telemetryStorageKey("ses_keep_4"),
    ]);

    const capHost = makeTelemetryHost();
    await Effect.runPromise(
      Effect.scoped(
        Effect.gen(function* () {
          yield* attachSkillTelemetry(capHost.ctx, () => NOW);
          yield* capHost.settle(10);
          for (let i = 0; i < 70; i += 1) {
            yield* capHost.fireToolHook("execute.after", {
              tool: "skill",
              codemode: false,
              sessionID: "ses_cap",
              agent: "spectre",
              messageID: `msg_${i}`,
              id: `call_${i}`,
              input: { id: "tdd" },
              status: "completed",
              result: { output: { content: "tdd" } },
            });
          }
          yield* capHost.settle(60);
        }),
      ),
    );
    const capped = await Effect.runPromise(readSessionTelemetry(capHost.ctx.storage, "ses_cap"));
    expect(capped?.loads).toHaveLength(64);
    expect(capped?.truncated).toBe(true);
    expect(capped?.partial).toBe(true);
  });

  test("NocturnaInput and NocturnaOutput emit valid JSON Schema documents", () => {
    expect(() => Schema.toJsonSchemaDocument(NocturnaInput)).not.toThrow();
    expect(() => Schema.toJsonSchemaDocument(NocturnaOutput)).not.toThrow();
  });
});
