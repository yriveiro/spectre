import { wrapLines } from "./render.ts";

/**
 * The blade geometry, as pure data. The three session blades declare their
 * columns and bands; this module turns those declarations into widths,
 * folds and flattened row order. It holds no Solid, no theme and no host
 * type, so `bun test` proves every rule here without a renderer — the part
 * of a blade where the layout bugs live (columns colliding at narrow
 * panel widths) is exactly the part that becomes testable.
 *
 * One rule owns the width: every column is resolved against the panel's
 * inner width, so no row can overflow into its neighbour and no panel
 * width is wasted on a fixed guess. A column that does not fit is
 * dropped, never squeezed into an overlap.
 */

/** The text tones a blade cell can carry. */
export type Tone = "base" | "muted" | "faint";

/**
 * One table column. Exactly one column in a blade omits `width`: the
 * flexible label column, which takes whatever width the other columns
 * leave and never less than twelve columns.
 */
export type Column<Row> = {
  /** The head text, aligned like the column's cells. */
  readonly header: string;
  readonly cell: (row: Row) => string;
  /** Absent = the flexible column. A number = fixed. A range = measured from the cells. */
  readonly width?: number | { readonly min: number; readonly max?: number };
  readonly align?: "left" | "right";
  /** The inner width below which the column is dropped, head and cells together. */
  readonly hideBelow?: number;
  readonly tone?: Tone | ((row: Row) => Tone);
};

/** One band of rows under one head. `header` names the flexible column in this section. */
export type Section<Row> = {
  readonly header?: string;
  readonly rows: ReadonlyArray<Row>;
};

/** One label-value line of a detail band. */
export type Band = {
  readonly label: string;
  readonly value: string;
};

/** A column with its width resolved: zero means dropped from this draw. */
export type ResolvedColumn<Row> = {
  readonly header: string;
  readonly cell: (row: Row) => string;
  readonly width: number;
  readonly flex: boolean;
  readonly align: "left" | "right";
  readonly tone: (row: Row) => Tone | undefined;
};

const toneOf = <Row>(tone: Column<Row>["tone"]): ((row: Row) => Tone | undefined) => {
  if (tone === undefined) return () => undefined;
  if (typeof tone === "function") return tone;
  return () => tone;
};

/** The rows of every section, in selection order. */
export const flatten = <Row>(sections: ReadonlyArray<Section<Row>>): ReadonlyArray<Row> =>
  sections.flatMap((one) => one.rows);

/**
 * The columns a blade draws at one inner width. Fixed columns drop below
 * their `hideBelow`; a measured column takes the widest of its head and
 * cells, clamped to its range, and never squeezes the flexible column
 * below twelve columns. A column the budget shrinks below its widest
 * cell stays, and the cells clip to the shrunk width, so no row can
 * overflow into its neighbour.
 */
export const resolveColumns = <Row>(
  columns: ReadonlyArray<Column<Row>>,
  rows: ReadonlyArray<Row>,
  inner: number,
): ReadonlyArray<ResolvedColumn<Row>> => {
  const flexible = columns.filter((one) => one.width === undefined);
  if (flexible.length !== 1)
    throw new Error(`a blade declares exactly one flexible column, got ${flexible.length}`);

  const widths = columns.map((one) => {
    if (one.width === undefined) return -1;
    if (typeof one.width === "number")
      return one.hideBelow !== undefined && inner < one.hideBelow ? 0 : one.width;
    return 0;
  });

  // The gaps between the visible cells of one row: marker, flexible label,
  // and every column this width admits. A measured column that the budget
  // below drops frees its gap back.
  let gaps = widths.filter((one) => one > 0).length + 1;
  for (const one of columns) {
    if (typeof one.width === "object" && (one.hideBelow ?? 0) <= inner) gaps += 1;
  }
  // What is left for the measured columns once the fixed ones, the gaps and
  // the flexible column's floor of twelve are paid for.
  let rangeLeft = inner - 1 - widths.reduce((sum, one) => sum + Math.max(0, one), 0) - gaps - 12;
  for (let at = 0; at < columns.length; at += 1) {
    const one = columns[at];
    if (one === undefined) continue;
    const range = typeof one.width === "object" ? one.width : undefined;
    if (range === undefined || (one.hideBelow ?? 0) > inner) continue;
    const measured = Math.max(
      one.header.length,
      rows.reduce((max, row) => Math.max(max, one.cell(row).length), 0),
    );
    const wanted = Math.max(range.min, Math.min(measured, range.max ?? Number.POSITIVE_INFINITY));
    const taken = Math.min(wanted, rangeLeft);
    if (taken < range.min) {
      gaps -= 1;
      continue;
    }
    widths[at] = taken;
    rangeLeft -= taken;
  }

  const spent = widths.reduce((sum, one) => sum + Math.max(0, one), 0);
  const flexWidth = Math.max(12, inner - 1 - gaps - spent);
  return columns.map((one, at) => ({
    header: one.header,
    cell: one.cell,
    width: one.width === undefined ? flexWidth : (widths[at] ?? 0),
    flex: one.width === undefined,
    align: one.align === "left" ? "left" : "right",
    tone: toneOf(one.tone),
  }));
};

/** Clip with an ellipsis at the width, never widen. */
const clip = (text: string, width: number): string =>
  text.length > width ? `${text.slice(0, Math.max(0, width - 1))}…` : text;

/** Left-aligned fixed column: clip with an ellipsis, never widen. */
export const fit = (text: string, width: number): string => clip(text, width).padEnd(width);

/** Right-aligned fixed column: clip with an ellipsis, never widen. A cell
 * wider than its resolved column must not push the row into its
 * neighbour — the budget shrinks a measured column below its widest cell
 * on purpose, and the cell honours the shrink. */
export const clipRight = (text: string, width: number): string => clip(text, width).padStart(width);

/** The share bar: one cell is the resolution the eye can rank with anyway. */
export const bar = (tokens: number, peak: number, cells: number): string => {
  // A row with no tokens draws no fill: a one-cell artifact on a seeded
  // zero-usage row reads as spend that does not exist.
  if (peak <= 0 || tokens <= 0) return " ".repeat(cells);
  const filled = Math.max(1, Math.round((tokens / peak) * cells));
  return "█".repeat(Math.min(cells, filled)).padEnd(cells);
};

export type TokenBuckets = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
};

const TOKEN_GLYPHS: ReadonlyArray<readonly [keyof TokenBuckets, string]> = [
  ["input", "█"],
  ["cacheRead", "▓"],
  ["cacheWrite", "▒"],
  ["output", "░"],
  ["reasoning", "▪"],
];

/**
 * Stacked proportional bar across token types, scaled against `peak` into
 * `cells` columns using largest-remainder apportionment.
 */
export const tokenBar = (tokens: TokenBuckets, peak: number, cells: number): string => {
  const total =
    tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite;
  if (peak <= 0 || total <= 0 || cells <= 0) return " ".repeat(Math.max(0, cells));
  const filled = Math.min(cells, Math.max(1, Math.round((total / peak) * cells)));
  const parts = TOKEN_GLYPHS.flatMap(([key, glyph], order) => {
    const count = tokens[key];
    if (count <= 0) return [];
    const numerator = count * filled;
    const width = Math.floor(numerator / total);
    return [{ order, glyph, width, rem: numerator % total }];
  });
  let remaining = filled - parts.reduce((sum, part) => sum + part.width, 0);
  const byRem = [...parts].sort((a, b) => b.rem - a.rem || a.order - b.order);
  for (const part of byRem) {
    if (remaining <= 0) break;
    part.width += 1;
    remaining -= 1;
  }
  return parts
    .map((part) => part.glyph.repeat(part.width))
    .join("")
    .padEnd(cells);
};

/**
 * The bands a detail section shows, folded to `width` columns, at most
 * `cap` lines, every value starting `indent` columns in and `labelColumn`
 * columns wide, the last visible line ending in an ellipsis when the fold
 * cut anything. A constant shape whatever the bands hold, so the rows
 * above yield the space and nothing else moves.
 */
export const foldBands = (
  bands: ReadonlyArray<Band>,
  width: number,
  cap: number,
  labelColumn: number,
  indent: number,
): ReadonlyArray<string> => {
  const pad = " ".repeat(indent);
  const flat = bands.flatMap((one) => {
    const label = one.label.padEnd(labelColumn);
    const folded = wrapLines(one.value, Math.max(1, width - indent - labelColumn), cap);
    return [
      `${pad}${label}${folded[0] ?? ""}`,
      ...folded.slice(1).map((line) => `${pad}${" ".repeat(labelColumn)}${line}`),
    ];
  });
  if (flat.length <= cap) return flat;
  const cut = flat.slice(0, cap);
  const last = cut[cap - 1] ?? "";
  return [...cut.slice(0, -1), `${last.slice(0, Math.max(0, width - 1))}…`];
};
