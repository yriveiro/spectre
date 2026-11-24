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

describe("routing history blade layout", () => {
  test("title, column labels, newest-first rows and totals sit in separated bands", async () => {
    const setup = await testRender(() => routingBlade({ context, panel, judgeView: view }), {
      width: 88,
      height: 20,
    });
    await setup.renderOnce();
    const lines = setup.captureCharFrame().split("\n");

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

    const totals = lines.find((one) => one.includes("Σ"));
    expect(totals).toContain("2 calls · 1 judged · 1 agent-chosen");
    expect(lines.some((one) => one.includes("sort oldest first (t)"))).toBe(true);
    await setup.dispose();
  });

  test("the expanded bands show the reconstructed question, the answer, the alternatives and the spent model", () => {
    const calls = routingCalls(messages);
    const judged = calls.find((one) => one.task === "decide how the settings are laid out");
    if (judged === undefined) throw new Error("the fold lost the judged call");
    const bands = expandBands(judged, view());
    const byLabel = new Map(bands.map((one) => [one.label, one.value]));

    expect(byLabel.get("judge")).toBe("JEV (acme/judge-1)");
    expect(byLabel.get("asked")).toContain("One task statement follows");
    expect(byLabel.get("asked")).toContain("(reconstructed)");
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
    expect(namedByLabel.get("judge")).toBe("JEV (acme/judge-1)");
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

  // A click-then-expand assertion cannot live here: bun resolves bare
  // `solid-js` through the `node` condition to the SSR no-op build, so
  // signal-driven re-renders do not subscribe under `bun test`. Measured here:
  // `bun test --conditions solid` did not subscribe either, so the expanded
  // bands are asserted as pure data (`expandBands` above) instead, and the
  // click wiring is the same `onMouseUp` → `toggleExpanded` the tools blade
  // uses.
});
