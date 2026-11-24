import { describe, expect, test } from "bun:test";
import type { SessionMessageInfo, ToolContent } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { routingBlade } from "../../tui/routing/blade.tsx";
import type { Profile } from "../../tui/routing/data.ts";
import { expandBands, judgeView, routingCalls } from "../../tui/routing/history.ts";

const BASE = RGBA.fromInts(220, 224, 232, 255);
const MUTED = RGBA.fromInts(150, 156, 168, 255);
const FAINT = RGBA.fromInts(100, 108, 120, 255);

const theme = {
  text: { base: BASE, muted: MUTED, faint: FAINT },
  border: { base: FAINT },
} as unknown as Plugin.Context["theme"];

const routingPart = (input: Record<string, string>, output: unknown) => ({
  type: "tool" as const,
  id: `call_${Math.random().toString(36).slice(2)}`,
  name: "spectre_routing",
  state: {
    status: "completed" as const,
    input,
    content: [{ type: "text" as const, text: JSON.stringify(output) }] as [
      ToolContent,
      ...ToolContent[],
    ],
  },
  time: { created: 1_700_000_000_000, ran: 1_700_000_001_000, completed: 1_700_000_002_000 },
});

const model = (ref: string) => ({
  ref,
  rung: "high",
  pinned: false,
  steppedUp: false,
  rungs: ["none", "high"],
  cost: { input: 1, output: 2 },
});

const judgedPage = {
  status: "resolved",
  profiles: [
    {
      name: "designer",
      match: "a design decision spans several files",
      effort: "high",
      agent: "spectre",
      model: model("acme/falcon-max#high"),
      crosscheck: model("acme/falcon-mini#high"),
    },
    {
      name: "explorer",
      match: "one named file",
      effort: "high",
      agent: "explore",
      model: model("acme/falcon-mini#high"),
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

const agentChosenPage = {
  ...judgedPage,
  judge: { status: "skipped", reason: "The call names a profile, so the choice is already made." },
};

const messages: ReadonlyArray<SessionMessageInfo> = [
  {
    id: "msg_0",
    time: { created: 1 },
    type: "assistant",
    agent: "build",
    model: { providerID: "opencode-go", id: "glm-5.3" },
    content: [
      routingPart({ task: "decide how the settings are laid out" }, judgedPage),
      routingPart({ task: "read one named file", profile: "explorer" }, agentChosenPage),
    ],
  },
];

const panel = {
  name: "spectre.routing.history",
  sessionID: "ses_draft",
  width: 88,
  focused: true,
  close: () => undefined,
};

const profiles: ReadonlyArray<Profile> = [
  {
    name: "designer",
    effort: "high",
    match: "a design decision spans several files",
    why: "w",
    crosscheck: undefined,
    agent: "spectre",
    pinned: undefined,
    enabled: true,
  },
  {
    name: "explorer",
    effort: "high",
    match: "one named file",
    why: "w",
    crosscheck: undefined,
    agent: "spectre",
    pinned: undefined,
    enabled: true,
  },
];

const context = {
  theme,
  data: {
    session: {
      get: () => ({ title: "draft session" }),
      message: { list: () => messages },
    },
  },
  keymap: {
    layer: () => () => undefined,
    shortcuts: () => ["t"],
  },
} as unknown as Plugin.Context;

const view = () => judgeView(profiles, { kind: "jev", model: "acme/judge-1" });

const isRule = (line: string | undefined) => line !== undefined && /^─+$/.test(line.trim());

describe("routing history blade layout", () => {
  test("title, column labels, newest-first rows and totals sit in separated bands", async () => {
    const setup = await testRender(() => routingBlade({ context, panel, judgeView: view }), {
      width: 88,
      height: 32,
    });
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");
    if (process.env.DEBUG_FRAME) {
      console.log(lines.map((l, i) => `${String(i).padStart(2)}|${l}`).join("\n"));
    }

    expect(lines[0]).toContain("Routing history");
    expect(lines[0]).toContain("draft session");
    expect(lines[0]).toContain("×");

    // Newest first: the caller-named row is above the judged row.
    const named = lines.findIndex((one) => one.includes("read one named file"));
    const judged = lines.findIndex((one) => one.includes("decide how the settings"));
    expect(named).toBeGreaterThan(-1);
    expect(named).toBeLessThan(judged);

    expect(lines[named]).toContain("agent");
    expect(lines[named]).toContain("acme/falcon-mini#high");
    expect(lines[judged]).toContain("→ designer (0.42)");
    expect(lines[judged]).toContain("acme/falcon-max#high");

    const totalsAt = lines.findIndex((one) => one.includes("Σ"));
    expect(lines[totalsAt]).toContain("2 calls · 1 judged · 1 agent-chosen");
    expect(lines.some((one) => one.includes("sort oldest first (t)"))).toBe(true);

    // The detail band below the totals reads the selected row, which is
    // selected by default: every value starts at the label column.
    const bandRule = lines.findIndex((line, at) => at > totalsAt && isRule(line));
    expect(bandRule).toBeGreaterThan(totalsAt);
    const bandLines = lines.slice(bandRule + 2, bandRule + 6);
    expect(bandLines[0]).toContain("judge     JEV (acme/judge-1) (reconstructed)");
    expect(bandLines[1]).toContain("skipped   The call names a profile");
    expect(bandLines[2]).toContain("spent     acme/falcon-mini#high");
    expect(bandLines[3]).toContain("profile   explorer (named by the caller)");
    const valueColumn = (bandLines[0] ?? "").indexOf("JEV");
    expect((bandLines[1] ?? "").indexOf("The call")).toBe(valueColumn);
    expect((bandLines[3] ?? "").indexOf("explorer (named")).toBe(valueColumn);

    // The expansion keys are gone: selection alone drives the band.
    expect(lines.some((one) => one.includes("↵ expand"))).toBe(false);
    await setup.dispose();
  });

  test("the detail band's bands show the reconstructed question, the answer, the alternatives and the spent model", () => {
    const calls = routingCalls(messages);
    const judged = calls.find((one) => one.task === "decide how the settings are laid out");
    if (judged === undefined) throw new Error("the fold lost the judged call");
    const bands = expandBands(judged, view());
    const byLabel = new Map(bands.map((one) => [one.label, one.value]));

    expect(byLabel.get("judge")).toBe("JEV (acme/judge-1) (reconstructed)");
    expect(byLabel.get("asked")).toContain("One task statement follows");
    // The reconstruction marker sits on the judge band, so the question itself stays plain.
    expect(byLabel.get("asked")).not.toContain("reconstructed");
    expect(bands.filter((one) => one.label === "").map((one) => one.value)).toContain(
      "designer — a design decision spans several files",
    );
    expect(byLabel.get("answer")).toBe("designer (0.42)");
    expect(byLabel.get("also")).toBe("explorer 0.39");
    expect(byLabel.get("spent")).toBe("acme/falcon-max#high");
    expect(byLabel.get("crosscheck")).toBe("acme/falcon-mini#high");

    const named = calls.find((one) => one.task === "read one named file");
    if (named === undefined) throw new Error("the fold lost the caller-named call");
    const namedBands = expandBands(named, view());
    const namedByLabel = new Map(namedBands.map((one) => [one.label, one.value]));
    expect(namedByLabel.get("judge")).toBe("JEV (acme/judge-1) (reconstructed)");
    expect(namedByLabel.get("skipped")).toBe(
      "The call names a profile, so the choice is already made.",
    );
    // No judge was asked, so no question is reconstructed for it.
    expect(namedBands.some((one) => one.label === "asked")).toBe(false);
    expect(namedBands.at(-1)).toEqual({
      label: "profile",
      value: "explorer (named by the caller)",
    });
  });

  test("a session with no routing calls says so and hides the table bands", async () => {
    const empty = {
      ...context,
      data: {
        session: {
          get: () => ({ title: "draft session" }),
          message: { list: () => [] },
        },
      },
    } as unknown as Plugin.Context;
    const setup = await testRender(() => routingBlade({ context: empty, panel, judgeView: view }), {
      width: 88,
      height: 10,
    });
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("No routing calls yet.");
    expect(frame).not.toContain("Σ");
    await setup.dispose();
  });

  test("the code-mode shape renders rows too", async () => {
    // The default path: the session calls `spectre.routing` inside the host's
    // `execute` tool, so the fold reads the part's metadata and return.
    const codeModeMessages: ReadonlyArray<SessionMessageInfo> = [
      {
        id: "msg_0",
        time: { created: 1 },
        type: "assistant",
        agent: "build",
        model: { providerID: "opencode-go", id: "glm-5.3" },
        content: [
          {
            type: "tool" as const,
            id: "call_execute_1",
            name: "execute",
            state: {
              status: "completed" as const,
              input: {},
              content: [{ type: "text" as const, text: JSON.stringify(judgedPage) }] as [
                ToolContent,
                ...ToolContent[],
              ],
              metadata: {
                toolCalls: [
                  {
                    tool: "spectre.routing",
                    status: "completed",
                    input: { task: "decide how the settings are laid out" },
                  },
                ],
              },
            },
            time: {
              created: 1_700_000_000_000,
              ran: 1_700_000_001_000,
              completed: 1_700_000_002_000,
            },
          },
        ],
      },
    ];
    const codeModeContext = {
      ...context,
      data: {
        session: {
          get: () => ({ title: "draft session" }),
          message: { list: () => codeModeMessages },
        },
      },
    } as unknown as Plugin.Context;
    const setup = await testRender(
      () => routingBlade({ context: codeModeContext, panel, judgeView: view }),
      { width: 88, height: 32 },
    );
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    expect(frame).toContain("decide how the settings are laid out");
    expect(frame).toContain("→ designer (0.42)");
    expect(frame).toContain("Σ 1 calls · 1 judged · 0 agent-chosen");
    // The judged call is the only row, so the band holds its answer too.
    expect(frame).toContain("answer    designer (0.42)");
    await setup.dispose();
  });

  // The fold itself — label column, cap, ellipsis — is asserted as pure
  // data in blade-layout.test.ts, where foldBands lives.

  // A click-then-select assertion cannot live here: bun resolves bare
  // `solid-js` through the `node` condition to the SSR no-op build, so
  // signal-driven re-renders do not subscribe under `bun test`. Measured
  // here: `bun test --conditions solid` did not subscribe either. The click
  // wiring is the same `onMouseUp` → select the other blades use; the
  // detail band reads the selection and row zero is selected by default,
  // so the frames above assert it, and the fold and the band's content are
  // asserted as pure data.
});
