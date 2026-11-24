import { describe, expect, test } from "bun:test";
import type { JsonValue, SessionMessageInfo, ToolContent } from "@opencode/client";
import type { Profile } from "../../tui/routing/data.ts";
import {
  type JudgeView,
  judgeView,
  ROUTING_TOOL,
  routingCalls,
  routingTotals,
} from "../../tui/routing/history.ts";

/**
 * The direct routing call shape: a completed `spectre_routing` part whose
 * single text part is the JSON of the tool's declared output, the persistence
 * shape `normalizeContent` writes (`packages/core/src/tool/runtime.ts` at
 * v2.3.0) when the host lists the tool itself. The default code-mode shape is
 * `executePart` below.
 */
const routingPart = (input: Record<string, JsonValue>, output: unknown) => ({
  type: "tool" as const,
  id: `call_${Math.random().toString(36).slice(2)}`,
  name: ROUTING_TOOL,
  state: {
    status: "completed" as const,
    input,
    content: [{ type: "text" as const, text: JSON.stringify(output) }] as [
      ToolContent,
      ...ToolContent[],
    ],
  },
  time: { created: 1, ran: 2, completed: 3 },
});

const failedRoutingPart = (input: Record<string, JsonValue>) => ({
  type: "tool" as const,
  id: `call_${Math.random().toString(36).slice(2)}`,
  name: ROUTING_TOOL,
  state: {
    status: "error" as const,
    input,
    error: { type: "ToolError", message: "the call stopped" },
  },
  time: { created: 1, ran: 2, completed: 3 },
});

const runningRoutingPart = (input: Record<string, JsonValue>) => ({
  type: "tool" as const,
  id: `call_${Math.random().toString(36).slice(2)}`,
  name: ROUTING_TOOL,
  state: { status: "running" as const, input, metadata: {} },
  time: { created: 1 },
});

let seq = 0;

type RoutingTestPart =
  | ReturnType<typeof routingPart>
  | ReturnType<typeof failedRoutingPart>
  | ReturnType<typeof runningRoutingPart>
  | ReturnType<typeof otherTool>
  | ReturnType<typeof executePart>;

const assistant = (parts: ReadonlyArray<RoutingTestPart>): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq },
  type: "assistant",
  agent: "build",
  model: { providerID: "opencode-go", id: "glm-5.3" },
  content: [...parts],
});

const otherTool = (name: string) => ({
  type: "tool" as const,
  id: `call_${name}`,
  name,
  state: {
    status: "completed" as const,
    input: {},
    content: [{ type: "text" as const, text: "ok" }] as [ToolContent, ...ToolContent[]],
  },
  time: { created: 1 },
});

/**
 * The default code-mode shape: a completed `execute` part whose metadata
 * carries the inner calls and whose text content is the program's return,
 * which is the routing page when the program passed the call's answer
 * through (`packages/core/src/codemode/tool.ts` at v2.3.0).
 */
const executePart = (calls: ReadonlyArray<Record<string, JsonValue>>, output: unknown) => ({
  type: "tool" as const,
  id: `call_execute_${Math.random().toString(36).slice(2)}`,
  name: "execute",
  state: {
    status: "completed" as const,
    input: {},
    content: [{ type: "text" as const, text: JSON.stringify(output) }] as [
      ToolContent,
      ...ToolContent[],
    ],
    metadata: { toolCalls: [...calls] },
  },
  time: { created: 1, ran: 2, completed: 3 },
});

const model = (ref: string) => ({
  ref,
  rung: "high",
  pinned: false,
  steppedUp: false,
  rungs: ["none", "high"],
  cost: { input: 1, output: 2 },
});

const resolvedPage = {
  status: "resolved",
  profiles: [
    {
      name: "explorer",
      match: "one named file",
      effort: "high",
      agent: "explore",
      model: model("acme/falcon-mini#high"),
    },
    {
      name: "designer",
      match: "a design decision spans several files",
      effort: "high",
      agent: "spectre",
      model: model("acme/falcon-max#high"),
      crosscheck: model("acme/falcon-mini#high"),
    },
  ],
  models: [],
  crosscheck: [],
  sources: [],
  asked: [],
  judge: {
    status: "used",
    profile: "designer",
    confidence: 0.42,
    alternatives: [{ profile: "explorer", probability: 0.39 }],
  },
};

const profiles = (names: ReadonlyArray<string>): ReadonlyArray<Profile> =>
  names.map((name) => ({
    name,
    effort: "high",
    match: resolvedPage.profiles.find((one) => one.name === name)?.match,
    why: "w",
    crosscheck: undefined,
    agent: "spectre",
    pinned: undefined,
    enabled: true,
  }));

describe("routing history fold", () => {
  test("a judged call carries the judge's answer and the profile row it spent", () => {
    const calls = routingCalls([
      assistant([routingPart({ task: "decide how the settings are laid out" }, resolvedPage)]),
    ]);
    expect(calls).toHaveLength(1);
    const one = calls[0];
    expect(one?.status).toBe("resolved");
    expect(one?.task).toBe("decide how the settings are laid out");
    expect(one?.judge).toEqual({
      status: "used",
      profile: "designer",
      confidence: 0.42,
      escalated: undefined,
      effort: undefined,
      alternatives: [{ profile: "explorer", probability: 0.39 }],
    });
    expect(one?.spent).toEqual({
      ref: "acme/falcon-max#high",
      rung: "high",
      pinned: false,
      steppedUp: false,
      crosscheck: "acme/falcon-mini#high",
    });
  });

  test("a caller-named profile spends that row, and the judge is not asked", () => {
    const page = {
      ...resolvedPage,
      judge: {
        status: "skipped",
        reason: "The call names a profile, so the choice is already made.",
      },
    };
    const calls = routingCalls([
      assistant([routingPart({ task: "read one file", profile: "explorer" }, page)]),
    ]);
    const one = calls[0];
    expect(one?.namedProfile).toBe("explorer");
    expect(one?.judge?.status).toBe("skipped");
    expect(one?.spent?.ref).toBe("acme/falcon-mini#high");
    expect(one?.spent?.crosscheck).toBeUndefined();
  });

  test("only this plugin's routing parts are calls", () => {
    const calls = routingCalls([
      assistant([otherTool("spectre_brain_assert"), routingPart({ task: "t" }, resolvedPage)]),
      assistant([otherTool("read")]),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.task).toBe("t");
  });

  test("an execute part's inner routing call folds like a direct one", () => {
    const calls = routingCalls([
      assistant([
        executePart(
          [
            {
              tool: "spectre.routing",
              status: "completed",
              input: { task: "decide how the settings are laid out" },
            },
          ],
          resolvedPage,
        ),
      ]),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("resolved");
    expect(calls[0]?.task).toBe("decide how the settings are laid out");
    expect(calls[0]?.judge?.status).toBe("used");
    expect(calls[0]?.spent?.ref).toBe("acme/falcon-max#high");
    expect(calls[0]?.spent?.crosscheck).toBe("acme/falcon-mini#high");
  });

  test("an execute part with several routing calls keeps only the program's return", () => {
    const calls = routingCalls([
      assistant([
        executePart(
          [
            { tool: "spectre.routing", status: "completed", input: { task: "first" } },
            { tool: "spectre.routing", status: "completed", input: { task: "second" } },
          ],
          resolvedPage,
        ),
      ]),
    ]);
    expect(calls.map((one) => one.task)).toEqual(["first", "second"]);
    expect(calls[0]?.status).toBe("unknown");
    expect(calls[0]?.detail).toContain("only the program's return");
    expect(calls[1]?.status).toBe("resolved");
    expect(calls[1]?.task).toBe("second");
  });

  test("an inner call that failed or never settled is a row with that status", () => {
    const calls = routingCalls([
      assistant([
        executePart(
          [
            { tool: "spectre.routing", status: "error", input: { task: "boom" } },
            { tool: "spectre.routing", status: "running", input: { task: "later" } },
          ],
          { answer: "the program returned something unrelated" },
        ),
      ]),
    ]);
    expect(calls.map((one) => one.status)).toEqual(["error", "running"]);
    expect(calls[0]?.detail).toBe("the call failed inside the program");
  });

  test("an execute part that returned something else says so, and one with no routing calls is no row", () => {
    const calls = routingCalls([
      assistant([
        executePart([{ tool: "spectre.routing", status: "completed", input: { task: "one" } }], {
          not: "a routing page",
        }),
        executePart([{ tool: "spectre_brain_assert", status: "completed", input: {} }], {
          ok: true,
        }),
      ]),
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]?.status).toBe("unknown");
    expect(calls[0]?.detail).toContain("did not return this call's answer");
  });

  test("a revert boundary cuts the calls from it on, and an unknown one cuts nothing", () => {
    const first = assistant([routingPart({ task: "one" }, resolvedPage)]);
    const boundary = assistant([routingPart({ task: "two" }, resolvedPage)]);
    const after = assistant([routingPart({ task: "three" }, resolvedPage)]);
    expect(routingCalls([first, boundary, after], boundary.id).map((one) => one.task)).toEqual([
      "one",
    ]);
    expect(routingCalls([first, after], "msg_absent")).toHaveLength(2);
  });

  test("answers that are not decisions keep their status word and detail", () => {
    const problems = { status: "problems", problems: "profiles.effort: unknown rung" };
    const setup = { status: "setup" };
    const declined = { status: "declined" };
    const calls = routingCalls([
      assistant([routingPart({ task: "t" }, problems)]),
      assistant([routingPart({ setup: "accepted" }, setup)]),
      assistant([routingPart({ setup: "declined" }, declined)]),
    ]);
    expect(calls.map((one) => one.status)).toEqual(["problems", "setup", "declined"]);
    expect(calls[0]?.detail).toBe("profiles.effort: unknown rung");
  });

  test("an answer that is not JSON or not a known page is unknown, and says why", () => {
    const unparseable = routingPart({ task: "t" }, undefined);
    unparseable.state.content = [{ type: "text", text: "not json" }];
    const unrecognized = routingPart({ task: "t" }, { status: "shrug" });
    const calls = routingCalls([assistant([unparseable, unrecognized])]);
    expect(calls.map((one) => one.status)).toEqual(["unknown", "unknown"]);
    expect(calls[0]?.detail).toContain("not JSON");
    expect(calls[1]?.detail).toContain("shrug");
  });

  test("a failed call carries the error message, and a running call is still a row", () => {
    const calls = routingCalls([
      assistant([failedRoutingPart({ task: "t" })]),
      assistant([runningRoutingPart({ task: "t2" })]),
    ]);
    expect(calls[0]).toMatchObject({ status: "error", detail: "the call stopped" });
    expect(calls[1]).toMatchObject({ status: "running" });
  });

  test("the totals count judged calls and agent-chosen calls apart", () => {
    const skipped = {
      ...resolvedPage,
      judge: {
        status: "skipped",
        reason: "The config names no judge, so the profile choice is yours.",
      },
    };
    const calls = routingCalls([
      assistant([routingPart({ task: "one" }, resolvedPage)]),
      assistant([routingPart({ task: "two" }, skipped)]),
      assistant([routingPart({ task: "three" }, { status: "setup" })]),
    ]);
    expect(routingTotals(calls)).toEqual({ calls: 3, judged: 1, agentChosen: 1 });
  });
});

describe("judge view reconstruction", () => {
  test("a jev config names the model, the instructions, and the way out", () => {
    const view = judgeView(profiles(["explorer", "designer"]), { kind: "jev" });
    expect(view.kind).toBe("jev");
    expect(view.model).toBe("opencode/jev-1.13-free");
    expect(view.instructions).toBeDefined();
    expect(view.choices.map((one) => one.profile)).toEqual(["explorer", "designer", "none"]);
    expect(view.choices.at(-1)?.description).toContain("not work of any kind");
  });

  test("a named judge model keeps its provider prefix", () => {
    const view = judgeView(profiles(["explorer"]), { kind: "jev", model: "acme/judge-1" });
    expect(view.model).toBe("acme/judge-1");
  });

  test("a lexical config has no instructions and no way out", () => {
    const view = judgeView(profiles(["explorer"]), { kind: "lexical" });
    expect(view).toEqual({
      kind: "lexical",
      model: "Lexical (BM25)",
      instructions: undefined,
      choices: [{ profile: "explorer", description: "one named file" }],
    } satisfies JudgeView);
  });

  test("no judge config says the session chooses, and a blank surface asks nothing", () => {
    expect(judgeView(profiles(["explorer"]), undefined).model).toBe("Session LLM");
    const bare = judgeView(
      [
        {
          name: "blank",
          effort: "high",
          match: undefined,
          why: "w",
          crosscheck: undefined,
          agent: "spectre",
          pinned: undefined,
        },
      ],
      { kind: "jev" },
    );
    expect(bare.choices).toEqual([]);
  });
});
