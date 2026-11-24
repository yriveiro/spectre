import { describe, expect, test } from "bun:test";
import {
  type Band,
  type Column,
  bar,
  fit,
  flatten,
  foldBands,
  resolveColumns,
} from "../../tui/blade-layout.ts";

/** The subagents blade's summary columns, as a descriptor. */
const summary = (rows: ReadonlyArray<{ readonly ref: string }>): ReadonlyArray<
  Column<{ readonly ref: string }>
> => [
  { header: "agent", cell: (row) => row.ref },
  {
    header: "model",
    width: { min: 12, max: 40 },
    hideBelow: 46,
    cell: (row) => row.ref,
  },
  { header: "runs", width: 5, hideBelow: 52, align: "right", cell: () => "1" },
  { header: "tokens", width: 7, align: "right", cell: () => "1.3K" },
  { header: "cost", width: 8, hideBelow: 40, align: "right", cell: () => "$0.020" },
  { header: "", width: 10, hideBelow: 62, tone: "muted", cell: () => "█" },
];

const byHeader = <Row>(resolved: ReadonlyArray<{ header: () => string; width: number }>) =>
  new Map(resolved.map((one) => [one.header(), one.width]));

describe("blade layout", () => {
  test("a wide panel sizes the measured column to the cells and gives the label the rest", () => {
    const rows = [{ ref: "opencode-go/muse-spark-1.3-contributor" }];
    const resolved = byHeader(resolveColumns(summary(rows), rows, 94));
    // The model column takes the longest ref (38 columns) whole; the
    // flexible label keeps what is left after marker, gaps and fixed columns.
    expect(resolved.get("model")).toBe(38);
    expect(resolved.get("agent")).toBe(19);
    expect(resolved.get("runs")).toBe(5);
    expect(resolved.get("cost")).toBe(8);
  });

  test("a narrow panel shrinks the measured column before the label's floor of twelve", () => {
    const rows = [{ ref: "opencode-go/muse-spark-1.3-contributor" }];
    const resolved = byHeader(resolveColumns(summary(rows), rows, 62));
    expect(resolved.get("model")).toBe(13);
    expect(resolved.get("agent")).toBe(12);
  });

  test("columns drop below their width tiers, head and cells together", () => {
    const rows = [{ ref: "opencode-go/glm-5.3" }];
    // Below 46 the model column is gone; below 52 the runs column is gone.
    const mid = byHeader(resolveColumns(summary(rows), rows, 45));
    expect(mid.get("model")).toBe(0);
    expect(mid.get("runs")).toBe(0);
    expect(mid.get("agent")).toBe(26);
    // Below 40 only tokens survive beside the label.
    const tight = byHeader(resolveColumns(summary(rows), rows, 30));
    expect(tight.get("cost")).toBe(0);
    expect(tight.get("agent")).toBe(20);
  });

  test("a blade declares exactly one flexible column", () => {
    const two: ReadonlyArray<Column<{ ref: string }>> = [
      { header: "a", cell: () => "a" },
      { header: "b", cell: () => "b" },
    ];
    expect(() => resolveColumns(two, [], 80)).toThrow("exactly one flexible column");
  });

  test("a measured column that cannot meet its minimum frees its gap", () => {
    const columns = (min: number): ReadonlyArray<Column<{ ref: string }>> => [
      { header: "task", cell: () => "task" },
      { header: "ref", width: { min }, hideBelow: 20, cell: (row) => row.ref },
    ];
    const rows = [{ ref: "x".repeat(40) }];
    // At 40 inner the budget admits 25 of the 40 wanted: the column shrinks
    // to what fits, and the label keeps its floor.
    const shrunk = byHeader(resolveColumns(columns(12), rows, 40));
    expect(shrunk.get("ref")).toBe(25);
    expect(shrunk.get("task")).toBe(12);
    // At 28 the budget is 13, short of a 14 minimum: the column drops and
    // its gap goes back to the label.
    const dropped = byHeader(resolveColumns(columns(14), rows, 28));
    expect(dropped.get("ref")).toBe(0);
    expect(dropped.get("task")).toBe(26);
  });

  test("flatten reads the sections in selection order", () => {
    expect(
      flatten([
        { header: "agent", rows: [1, 2] },
        { header: "profile", rows: [3] },
      ]),
    ).toEqual([1, 2, 3]);
  });

  test("fit clips with an ellipsis and pads a short cell", () => {
    expect(fit("abcdef", 4)).toBe("abc…");
    expect(fit("ab", 4)).toBe("ab  ");
  });

  test("the bar draws no fill for a row with no tokens", () => {
    expect(bar(0, 100, 10)).toBe(" ".repeat(10));
    expect(bar(50, 100, 10)).toBe("█".repeat(5).padEnd(10));
  });

  test("foldBands aligns values at the label column and caps at a constant shape", () => {
    const bands: ReadonlyArray<Band> = [
      { label: "judge", value: "a b" },
      { label: "", value: "c" },
    ];
    expect(foldBands(bands, 22, 5, 10, 2)).toEqual(["  judge     a b", "            c"]);
    // The fold cuts a longer value: the last visible line says so.
    expect(foldBands([{ label: "spent", value: "aa bb cc dd" }], 15, 3, 10, 2)).toEqual([
      "  spent     aa",
      "            bb",
      "            cc…",
    ]);
    // The cap cuts at a band boundary too.
    expect(
      foldBands(
        [
          { label: "answer", value: "designer" },
          { label: "also", value: "explorer" },
        ],
        22,
        1,
        10,
        2,
      ),
    ).toEqual(["  answer    designer…"]);
  });
});
