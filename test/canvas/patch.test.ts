import { describe, expect, test } from "bun:test";
import {
  applyPatchOps,
  CANVAS_STATE_FILE,
  decodeCanvasState,
  encodeCanvasState,
} from "../../tools/definitions/canvas/patch";

describe("decodeCanvasState and encodeCanvasState", () => {
  test("round-trips a report content payload through .spectre-canvas.json", () => {
    const original = {
      kind: "report" as const,
      title: "Latency Audit",
      markdown: "## Summary\n\nFast.\n\n## Details\n\nNumbers.\n",
    };
    const encoded = encodeCanvasState(original);
    const decoded = decodeCanvasState({ [CANVAS_STATE_FILE]: encoded });
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) throw new Error(decoded.problem);
    expect(decoded.content).toEqual(original);
  });

  test("refuses when .spectre-canvas.json is missing or invalid", () => {
    const missing = decodeCanvasState({ "index.html": "<html></html>" });
    expect(missing.ok).toBe(false);
    const badJson = decodeCanvasState({ [CANVAS_STATE_FILE]: "{broken" });
    expect(badJson.ok).toBe(false);
  });

  test("refuses an unresolved nocturna request in .spectre-canvas.json", () => {
    const decoded = decodeCanvasState({
      [CANVAS_STATE_FILE]: JSON.stringify({ kind: "nocturna", days: 7, limit: 25 }),
    });
    expect(decoded.ok).toBe(false);
  });
});

describe("applyPatchOps", () => {
  test("patches a report's section by heading and appends markdown", () => {
    const initial = {
      kind: "report" as const,
      title: "Initial Title",
      markdown: "## Summary\n\nOld summary.\n\n## Limits\n\nOld limit.\n",
    };
    const patched = applyPatchOps(initial, [
      { op: "set-title", title: "Updated Title" },
      { op: "replace-section", heading: "Summary", markdown: "New **highlighted** summary." },
      { op: "append-markdown", markdown: "## Next Steps\n\nShip it." },
    ]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) throw new Error(patched.problem);
    if (patched.content.kind !== "report") throw new Error("expected report");
    expect(patched.content.title).toBe("Updated Title");
    expect(patched.content.markdown).toContain("New **highlighted** summary.");
    expect(patched.content.markdown).not.toContain("Old summary.");
    expect(patched.content.markdown).toContain("## Limits\n\nOld limit.");
    expect(patched.content.markdown).toContain("## Next Steps\n\nShip it.");
  });

  test("patches a PR canvas with upsert-point, remove-point, upsert-group, and set-summary", () => {
    const initial = {
      kind: "pr" as const,
      token: "pr-7-abcdef0-123456",
      review: {
        summary: "Initial PR summary",
        groups: [{ heading: "Core", paths: ["src/a.ts"] }],
        points: [
          {
            kind: "change" as const,
            text: "First point",
            at: { path: "src/a.ts", side: "head" as const, line: 1 },
          },
        ],
      },
    };
    const patched = applyPatchOps(initial, [
      { op: "set-summary", summary: "Refined PR summary" },
      {
        op: "upsert-point",
        point: {
          kind: "question",
          text: "Second point",
          at: { path: "src/a.ts", side: "head", line: 1 },
        },
      },
      { op: "remove-point", index: 1 },
      { op: "upsert-group", group: { heading: "Tests", paths: ["test/a.test.ts"] } },
    ]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) throw new Error(patched.problem);
    if (patched.content.kind !== "pr") throw new Error("expected pr");
    expect(patched.content.review.summary).toBe("Refined PR summary");
    expect(patched.content.review.points).toHaveLength(1);
    expect(patched.content.review.points[0]?.text).toBe("Second point");
    expect(patched.content.review.groups).toHaveLength(2);
  });

  test("patches a board canvas by upserting and removing sections", () => {
    const initial = {
      kind: "board" as const,
      title: "Engineering Board",
      sections: [
        {
          id: "s1",
          kind: "kpi" as const,
          heading: "KPIs",
          items: [{ label: "Speed", value: "10ms" }],
        },
        {
          id: "s2",
          kind: "table" as const,
          heading: "Matrix",
          columns: ["A"],
          rows: [["1"]],
        },
      ],
    };
    const patched = applyPatchOps(initial, [
      {
        op: "upsert-board-section",
        section: {
          id: "s1",
          kind: "kpi",
          heading: "KPIs",
          items: [{ label: "Speed", value: "4ms", tone: "good" }],
        },
      },
      { op: "remove-board-section", target: "s2" },
    ]);
    expect(patched.ok).toBe(true);
    if (!patched.ok) throw new Error(patched.problem);
    if (patched.content.kind !== "board") throw new Error("expected board");
    expect(patched.content.sections).toHaveLength(1);
    const first = patched.content.sections[0];
    if (first?.kind !== "kpi") throw new Error("expected kpi");
    expect(first.items[0]?.value).toBe("4ms");
  });
});
