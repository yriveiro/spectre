import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { ledger as brainLedger } from "../../tools/definitions/brain/ledger";
import { board } from "../../tools/definitions/canvas/board";
import { nocturnaBoard } from "../../tools/definitions/canvas/nocturna";

const PROJECT = join(Bun.env.TMPDIR ?? "/tmp", `canvas-board-${process.pid}`);

beforeEach(async () => {
  await rm(PROJECT, { recursive: true, force: true });
  await Bun.write(
    join(PROJECT, "src/sample.ts"),
    "export const computeScore = (x: number): number => x * 2;\nexport const BASE = 10;\n",
  );
  await Bun.write(join(PROJECT, ".spectre/run.md"), "## Round 1\n\nAll tests green.\n");
});

afterAll(async () => {
  await rm(PROJECT, { recursive: true, force: true });
});

describe("board composer", () => {
  test("composes KPI cards, SVG charts, sortable tables, Pele diagrams, highlighted code, and brain/goal evidence", async () => {
    await Effect.runPromise(
      brainLedger(AbsolutePath.make(PROJECT)).mint({
        kind: "decision",
        claim: "Use local host computation for canvas charts.",
        subject: ["tools/definitions/canvas/board.ts"],
      }),
    );

    const result = await board(PROJECT, {
      kind: "board",
      title: "Canvas Architecture Workspace",
      summary: "Structured board rendered on the local host.",
      sections: [
        {
          id: "metrics",
          kind: "kpi",
          heading: "Token Cost",
          items: [
            { label: "Saved Output Tokens", value: "88%", delta: "-3.4k tokens", tone: "good" },
            { label: "Hydration Cost", value: "0 ms", tone: "neutral" },
          ],
        },
        {
          id: "chart-bars",
          kind: "chart",
          heading: "Tokens by Mode",
          chart: "bar",
          unit: "tok",
          note: "Measured per publish call",
          data: [
            { label: "Raw Page", value: 3800 },
            { label: "Board", value: 420 },
          ],
        },
        {
          id: "chart-horiz",
          kind: "chart",
          heading: "Horizontal Comparison",
          chart: "horizontal-bar",
          data: [
            { label: "Local SVG", value: 12 },
            { label: "Model D3", value: 95 },
          ],
        },
        {
          id: "chart-line",
          kind: "chart",
          heading: "Latency Trend",
          chart: "line",
          unit: "ms",
          data: [
            { label: "T1", value: 120 },
            { label: "T2", value: 80 },
            { label: "T3", value: 45 },
          ],
        },
        {
          id: "matrix",
          kind: "table",
          heading: "Feature Matrix",
          columns: ["Surface", "Status"],
          rows: [
            ["Highlight", "Ready"],
            ["Pele Zoom", "Ready"],
          ],
        },
        {
          id: "flow",
          kind: "diagram",
          heading: "Execution Flow",
          mermaid: "flowchart LR\n  Host --> Artifact",
          caption: "Zero LLM layout tokens",
        },
        {
          id: "snippet",
          kind: "code",
          heading: "Verified Implementation",
          code: "export const computeScore = (x: number): number => x * 2;",
          at: { path: "src/sample.ts", line: 1, symbol: "computeScore" },
        },
        {
          id: "adr",
          kind: "callout",
          heading: "ADR-1: Host Rendering",
          tone: "decision",
          markdown: "Render charts and tables in **Bun**.",
          at: { path: "src/sample.ts", line: 2, symbol: "BASE" },
        },
        {
          id: "brain-view",
          kind: "evidence",
          heading: "Project Brain Claims",
          source: "brain",
        },
        {
          id: "goal-view",
          kind: "evidence",
          heading: "Goal Ledger",
          source: "goal",
        },
      ],
    });

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.problem);
    const html = result.files["index.html"] ?? "";
    expect(html).toContain("Canvas Architecture Workspace");
    expect(html).toContain("88%");
    expect(html).toContain('<figure class="chart-figure"><svg');
    expect(html).toContain("data-table");
    expect(html).toContain("data-pele-diagram");
    expect(html).toContain('<span class="hl-k">export</span> <span class="hl-k">const</span> computeScore');
    expect(html).toContain("src/sample.ts:1 · computeScore");
    expect(html).toContain("Use local host computation for canvas charts.");
    expect(html).toContain("All tests green.");
  });

  test("refuses a citation to a non-existent file, out-of-range line, or missing symbol", async () => {
    const missingFile = await board(PROJECT, {
      kind: "board",
      title: "Bad Citation",
      sections: [
        {
          kind: "code",
          heading: "Missing",
          code: "const x = 1;",
          at: { path: "src/missing.ts", line: 1 },
        },
      ],
    });
    expect(missingFile.ok).toBe(false);
    if (missingFile.ok) throw new Error("expected refusal");
    expect(missingFile.problem).toContain("does not exist");

    const badLine = await board(PROJECT, {
      kind: "board",
      title: "Bad Line",
      sections: [
        {
          kind: "code",
          heading: "Out of range",
          code: "const x = 1;",
          at: { path: "src/sample.ts", line: 99 },
        },
      ],
    });
    expect(badLine.ok).toBe(false);
    if (badLine.ok) throw new Error("expected refusal");
    expect(badLine.problem).toContain("outside the file's");

    const badSymbol = await board(PROJECT, {
      kind: "board",
      title: "Bad Symbol",
      sections: [
        {
          kind: "callout",
          heading: "Missing sym",
          markdown: "Note",
          at: { path: "src/sample.ts", line: 1, symbol: "nonExistentSymbol" },
        },
      ],
    });
    expect(badSymbol.ok).toBe(false);
    if (badSymbol.ok) throw new Error("expected refusal");
    expect(badSymbol.problem).toContain("nonExistentSymbol");
  });

  test("composes a table with CSS-like session title text and single-escaped papercut target", async () => {
    const content = nocturnaBoard({
      status: "collected",
      project: "p",
      windowDays: 7,
      cutoffAt: 0,
      scannedInWindow: 1,
      skippedAnalyzed: 0,
      remainingUnanalyzed: 0,
      trackedInStorage: 0,
      truncated: false,
      unreadable: [],
      totals: {
        cost: 0,
        tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
        toolCalls: 0,
        toolErrors: 0,
        retries: 0,
        compactions: 0,
      },
      topTools: [],
      topSkills: [],
      skillCoUse: [],
      skillCoverage: { live: 0, transcript: 0, hybrid: 0, none: 1, partial: 0 },
      sessions: [
        {
          id: "ses_css",
          title: "Fix inline style=background:url(icon.svg)",
          agent: "spectre",
          outcome: "succeeded",
          createdAt: 1,
          updatedAt: 2,
          cost: 0,
          tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
          userTurns: 1,
          assistantSteps: 1,
          retries: 0,
          compactions: 0,
          compacted: false,
          subagentsSpawned: 0,
          shellFailed: 0,
          skillsLoaded: [],
          telemetryCoverage: "none",
          telemetryPartial: false,
          tools: [],
          anomalyScore: 0,
        },
      ],
      papercuts: {
        status: "ok",
        openGroups: 1,
        newReportsInWindow: 1,
        scanTruncated: false,
        topGroups: [
          {
            groupId: "pc_1",
            targetKind: "tool",
            target: "tool &lt;alpha&gt; &amp; beta",
            projects: 1,
            occurrences: 2,
            reopened: false,
          },
        ],
      },
    });

    const result = await board(PROJECT, content);
    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.problem);
    const html = result.files["index.html"] ?? "";
    expect(html).toContain("<td>Fix inline style=background:url(icon.svg)</td>");
    expect(html).toContain("<td>tool &lt;alpha&gt; &amp; beta</td>");
    expect(html).not.toContain("&amp;lt;");
    expect(html).not.toContain("&amp;amp;");
  });
});
