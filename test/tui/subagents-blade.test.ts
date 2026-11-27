import { describe, expect, test } from "bun:test";
import type { SessionInfo, SessionMessageInfo } from "@opencode/client";
import type { Plugin } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { join } from "node:path";
import { subagentsBlade } from "../../tui/subagents/blade.tsx";
import { profileRouting } from "../../tui/subagents/routing.ts";
import { profileLabel, sessionUsage, tokenBar } from "../../tui/subagents/usage.ts";
import { tokenUsage as usage } from "./fixture.ts";

const BASE = RGBA.fromInts(220, 224, 232, 255);
const MUTED = RGBA.fromInts(150, 156, 168, 255);
const FAINT = RGBA.fromInts(100, 108, 120, 255);

const theme = {
  text: { base: BASE, muted: MUTED, faint: FAINT },
  border: { base: FAINT },
} as unknown as Plugin.Context["theme"];

let seq = 0;

const user = (text: string): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq },
  type: "user",
  text,
});

const assistant = (
  agent: string,
  id: string,
  tokens: ReturnType<typeof usage>,
  cost: number,
  variant?: string,
): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq, completed: seq },
  type: "assistant",
  agent,
  model: variant === undefined ? { providerID: "opencode-go", id } : { providerID: "opencode-go", id, variant },
  content: [{ type: "text", text: "ok" }],
  tokens,
  cost,
});

const idle = (): SessionMessageInfo => ({
  id: `msg_${seq++}`,
  time: { created: seq },
  type: "idle",
  outcome: "succeeded" as const,
});

/** One run for the main agent and one routed child run, so both bands, the
 * run table and the totals carry real numbers. The child's prompt carries
 * the subagent preamble the usage walk strips. */
const messages: Record<string, ReadonlyArray<SessionMessageInfo>> = {
  ses_root: [
    user(
      "summarize the blade and say which columns collide when the panel is narrow, because no row may overlap",
    ),
    assistant("build", "glm-5.3", usage(1000, 50, 10, 200, 40), 0.02),
    idle(),
  ],
  ses_child: [
    user("You are a subagent spawned by another session. Explore the layout."),
    assistant("explore", "muse-spark-1.3-contributor", usage(800, 40, 0, 100, 20), 0.01),
    idle(),
  ],
};

const sessions = new Map<string, SessionInfo>([
  [
    "ses_root",
    { id: "ses_root", title: "draft session", agent: "build" } as unknown as SessionInfo,
  ],
  [
    "ses_child",
    {
      id: "ses_child",
      parentID: "ses_root",
      title: "explore the layout",
      agent: "explore",
    } as unknown as SessionInfo,
  ],
]);

const profiles = [
  { name: "explore", agent: "explore", ref: "opencode-go/muse-spark-1.3-contributor" },
];

const context = {
  theme,
  data: {
    session: {
      root: () => "ses_root",
      family: () => ["ses_root", "ses_child"],
      get: (id: string) => sessions.get(id),
      status: () => "idle" as const,
      message: { list: (id: string) => messages[id] ?? [] },
    },
  },
  keymap: {
    layer: () => () => undefined,
    shortcuts: (id: string) => (id === "spectre.subagents.close" ? ["esc"] : ["t"]),
  },
} as unknown as Plugin.Context;

const panel = {
  name: "spectre.subagents",
  sessionID: "ses_root",
  width: 96,
  focused: true,
  close: () => undefined,
};

const renderBlade = async (width: number, height: number) => {
  const setup = await testRender(
    () =>
      subagentsBlade({
        context,
        panel: { ...panel, width },
        profiles: () => profiles,
      }),
    { width, height },
  );
  await setup.renderOnce();
  const lines = setup.captureCharFrame().split("\n");
  return { setup, lines };
};

const isRule = (line: string | undefined) => line !== undefined && /^─+$/.test(line.trim());

describe("subagents blade layout", () => {
  test("a wide panel spends its width on every column and keeps numbers under their headers", async () => {
    const { setup, lines } = await renderBlade(96, 31);

    expect(lines[0]).toContain("Session breakdown");
    expect(lines[0]).toContain("draft session");
    expect(lines[0]).toContain("×");
    expect(isRule(lines[1])).toBe(true);

    const agentHead = lines.findIndex((line) => line.includes("runs") && line.includes("tokens"));
    expect(agentHead).toBeGreaterThanOrEqual(0);

    // The model column is wide enough to carry the whole ref, so the row
    // names what it spent instead of clipping it away.
    const mainRow = lines.findIndex((line) => line.trimStart().startsWith("▌ build"));
    expect(mainRow).toBeGreaterThan(agentHead);
    expect(lines[mainRow]).toContain("opencode-go/glm-5.3");
    expect(lines[mainRow]).toContain("█");

    // The numbers end exactly where their headers end, in both bands.
    const tokensEnd = (lines[agentHead] ?? "").indexOf("tokens") + "tokens".length;
    const costEnd = (lines[agentHead] ?? "").lastIndexOf("cost") + "cost".length;
    expect((lines[mainRow] ?? "").indexOf("1.3K") + "1.3K".length).toBe(tokensEnd);
    expect((lines[mainRow] ?? "").indexOf("$0.020") + "$0.020".length).toBe(costEnd);

    const profileRow = lines.findIndex((line) => line.trimStart().startsWith("→ explore"));
    expect(profileRow).toBeGreaterThan(mainRow);
    // The model column is sized to the longest ref the rows carry, so at
    // this width even the 38-character ref shows whole.
    expect(lines[profileRow]).toContain("opencode-go/muse-spark-1.3-contributor");
    expect((lines[profileRow] ?? "").indexOf("960") + "960".length).toBe(tokensEnd);

    // The totals sum the bands, and the run table names the selected row.
    const totals = lines.findIndex((line) => line.includes("Σ 2 runs"));
    expect(totals).toBeGreaterThan(profileRow);
    expect(lines[totals]).toContain("2.3K tokens");
    const band = lines.findIndex((line) => line.includes("▼ build · 1 run"));
    expect(band).toBeGreaterThan(totals);
    expect(lines[band + 1]).toContain("cache(R/W)");
    expect(lines[band + 1]).toContain("rsn");
    const runRow = lines.findIndex((line) => line.includes("summarize the blade"));
    expect(runRow).toBeGreaterThan(band);
    expect(lines[runRow]).toContain("200/40");

    // The third band: the selected run's prompt, under its own hairline,
    // folded to the width and starting with the words the row label clips.
    const bandRule = lines.findIndex((line, at) => at > runRow && isRule(line));
    expect(bandRule).toBe(runRow + 2);
    expect(lines[bandRule + 2]).toContain(
      "summarize the blade and say which columns collide when the",
    );
    expect(lines[bandRule + 3]).toContain("may overlap");

    await setup.dispose();
  });

  test("a narrow panel drops columns instead of overlapping them", async () => {
    const { setup, lines } = await renderBlade(44, 32);

    const agentHead = lines.findIndex((line) => line.includes("tokens") && line.includes("agent"));
    expect(agentHead).toBeGreaterThanOrEqual(0);
    // The width admits tokens and cost only: model, runs and the bar are
    // dropped in the same draw, head and rows together.
    expect(lines[agentHead]).not.toContain("model");
    expect(lines[agentHead]).not.toContain("runs");

    const mainRow = lines.findIndex((line) => line.trimStart().startsWith("▌ build"));
    expect(mainRow).toBeGreaterThan(agentHead);
    // The cost cell is the row's last content, flush against the padding:
    // nothing is pushed past it into a neighbour.
    expect((lines[mainRow] ?? "").trimEnd().endsWith("$0.020")).toBe(true);
    expect(lines[mainRow]).not.toContain("opencode-go");
    expect(lines[mainRow]).not.toContain("█");

    const costEnd = (lines[agentHead] ?? "").lastIndexOf("cost") + "cost".length;
    expect((lines[mainRow] ?? "").trimEnd().length).toBe(costEnd);

    // The run table keeps in, out and cost, and drops cache and reasoning.
    const band = lines.findIndex((line) => line.includes("▼ build · 1 run"));
    expect(band).toBeGreaterThan(mainRow);
    expect(lines[band + 1]).toContain("in");
    expect(lines[band + 1]).not.toContain("cache(R/W)");
    expect(lines[band + 1]).not.toContain("rsn");
    expect(lines[band + 1]).toContain("cost");

    // The third band folds the prompt to the narrower width: three lines
    // where the wide panel needed two, and no line past the padding.
    const runRow = lines.findIndex((line) => line.includes("summar"));
    const bandRule = lines.findIndex((line, at) => at > runRow && isRule(line));
    expect(lines[bandRule + 2]).toContain("summarize the blade and say which");
    expect(lines[bandRule + 3]).toContain("columns collide when the panel is");
    expect(lines[bandRule + 4]).toContain("narrow, because no row may overlap");

    await setup.dispose();
  });

  test("a mid-width panel clips the measured column and keeps every other in place", async () => {
    const { setup, lines } = await renderBlade(64, 30);

    // At this width the model column shrinks below the longest ref on
    // purpose: the cell clips with an ellipsis instead of pushing the row
    // into its neighbour, and the label keeps its floor.
    const profileRow = lines.findIndex((line) => line.trimStart().startsWith("→ explore"));
    expect(profileRow).toBeGreaterThanOrEqual(0);
    const row = lines[profileRow] ?? "";
    expect(row).toContain("opencode-go/…");
    expect(row).not.toContain("muse-spark");
    expect(row).toContain("960");
    expect(row.trimEnd().endsWith("██████▓")).toBe(true);
    // Nothing is pushed past the panel's inner width.
    expect(row.trimEnd().length).toBeLessThanOrEqual(63);

    // The numbers still end exactly where their headers end.
    const agentHead = lines.findIndex((one) => one.includes("tokens") && one.includes("agent"));
    const tokensEnd = (lines[agentHead] ?? "").indexOf("tokens") + "tokens".length;
    expect((lines[profileRow] ?? "").indexOf("960") + "960".length).toBe(tokensEnd);

    await setup.dispose();
  });

  // A click-then-select assertion cannot live in the default run: bun
  // resolves bare `solid-js` to the server build, so signal re-renders do
  // not repaint. Under `--conditions=browser` effects subscribe and a
  // probe repaints, but that condition is not this suite's, so the frames
  // above assert the initial state and the fold and the bands as pure
  // data.
  test("a run carries the whole prompt its row label clips, for the prompt band", () => {
    const report = sessionUsage({
      rootID: "ses_root",
      family: () => ["ses_root", "ses_child"],
      get: (id) => sessions.get(id),
      status: () => "idle" as const,
      messages: (id) => messages[id] ?? [],
      profiles,
    });
    const main = report.rows.find((row) => row.kind === "main");
    const run = main?.runs[0]?.run;
    expect(run).toBeDefined();
    // The label is the clipped first line; the section reads the whole body.
    expect(run?.prompt.length).toBeLessThanOrEqual(60);
    expect(run?.promptText.startsWith(run?.prompt ?? "")).toBe(true);
    expect(run?.promptText).toContain("no row may overlap");

    // The child's prompt drops the subagent preamble the host prefixes.
    const child = report.rows.find((row) => row.name === "explore")?.runs[0]?.run;
    expect(child?.promptText).toBe("Explore the layout.");
  });

  test("profileRouting emits crosscheck profiles and sessionUsage attributes them with a glyph", async () => {
    const dir = join(Bun.env.TMPDIR ?? "/tmp", `spectre-subagents-crosscheck-${crypto.randomUUID()}`);
    await Bun.write(
      join(dir, "spectre.json"),
      JSON.stringify({
        models: {
          fast: "opencode-go/muse-spark-1.3-contributor",
          review: "opencode-go/glm-5.3",
        },
        priority: ["fast", "review"],
        crosscheck: ["review", "fast"],
        profiles: {
          deep: {
            effort: "high",
            model: "fast",
            crosscheck: { effort: "high", model: "review" },
            match: "Deep work.",
            why: "Test.",
          },
        },
      }),
    );
    const models = [
      {
        providerID: "opencode-go",
        id: "muse-spark-1.3-contributor",
        modelID: "muse-spark-1.3-contributor",
        name: "Muse",
        family: "muse",
        variants: [{ id: "high" }],
        cost: [{ input: 1, output: 2, cache: { read: 0, write: 0 } }],
        enabled: true,
        status: "active",
        capabilities: { tools: true, input: [], output: [] },
        time: { released: 0 },
        limit: { context: 200_000, output: 32_000 },
      },
      {
        providerID: "opencode-go",
        id: "glm-5.3",
        modelID: "glm-5.3",
        name: "GLM",
        family: "glm",
        variants: [{ id: "high" }],
        cost: [{ input: 2, output: 4, cache: { read: 0, write: 0 } }],
        enabled: true,
        status: "active",
        capabilities: { tools: true, input: [], output: [] },
        time: { released: 0 },
        limit: { context: 200_000, output: 32_000 },
      },
    ];
    const prevConfigDir = Bun.env.OPENCODE_CONFIG_DIR;
    Bun.env.OPENCODE_CONFIG_DIR = dir;
    let resolved;
    try {
      resolved = await profileRouting(dir, models);
    } finally {
      if (prevConfigDir === undefined) delete Bun.env.OPENCODE_CONFIG_DIR;
      else Bun.env.OPENCODE_CONFIG_DIR = prevConfigDir;
    }
    expect(resolved.map((one) => ({ name: one.name, ref: one.ref, crosscheck: one.crosscheck ?? false }))).toEqual([
      { name: "deep", ref: "opencode-go/muse-spark-1.3-contributor#high", crosscheck: false },
      { name: "deep", ref: "opencode-go/glm-5.3#high", crosscheck: true },
    ]);

    const crossSessions = new Map<string, SessionInfo>([
      ["ses_root", { id: "ses_root", title: "root", agent: "spectre" } as unknown as SessionInfo],
      ["ses_primary", { id: "ses_primary", parentID: "ses_root", title: "primary", agent: "spectre" } as unknown as SessionInfo],
      ["ses_cross", { id: "ses_cross", parentID: "ses_root", title: "cross", agent: "spectre" } as unknown as SessionInfo],
    ]);
    const crossMessages: Record<string, ReadonlyArray<SessionMessageInfo>> = {
      ses_root: [user("go"), assistant("spectre", "glm-5.3", usage(100, 10, 0, 0, 0), 0.01), idle()],
      ses_primary: [
        user("You are a subagent spawned by another session. Primary."),
        assistant("spectre", "muse-spark-1.3-contributor", usage(200, 20, 0, 0, 0), 0.02, "high"),
        idle(),
      ],
      ses_cross: [
        user("You are a subagent spawned by another session. Review."),
        assistant("spectre", "glm-5.3", usage(300, 30, 0, 0, 0), 0.03, "high"),
        idle(),
      ],
    };

    const report = sessionUsage({
      rootID: "ses_root",
      family: () => ["ses_root", "ses_primary", "ses_cross"],
      get: (id) => crossSessions.get(id),
      status: () => "idle" as const,
      messages: (id) => crossMessages[id] ?? [],
      profiles: resolved,
    });

    const unrouted = report.rows.filter((row) => row.unrouted);
    expect(unrouted).toEqual([]);

    const primaryRow = report.rows.find((row) => row.kind === "profile" && !row.crosscheck);
    const crossRow = report.rows.find((row) => row.kind === "profile" && row.crosscheck);
    expect(primaryRow?.name).toBe("deep");
    expect(crossRow?.name).toBe("deep");
    expect(profileLabel(primaryRow!)).toBe("→ deep");
    expect(profileLabel(crossRow!)).toBe("⇄ deep");

    const mainRow = report.rows.find((row) => row.kind === "main");
    expect(profileLabel(mainRow!)).toBe("spectre");

    expect(tokenBar({ input: 500, output: 200, reasoning: 100, cacheRead: 200, cacheWrite: 0 }, 1000, 10)).toBe(
      "█████▓▓░░▪",
    );
    expect(tokenBar({ input: 7, output: 26, reasoning: 0, cacheRead: 17, cacheWrite: 0 }, 50, 10)).toBe(
      "██▓▓▓░░░░░",
    );
  });
});
