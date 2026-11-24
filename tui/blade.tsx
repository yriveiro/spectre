import type { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createMemo, createSignal } from "solid-js";
import {
  type Band,
  type Column,
  type ResolvedColumn,
  type Section,
  type Tone,
  fit,
  flatten,
  foldBands,
  resolveColumns,
} from "./blade-layout.ts";
import { clampIndex, h, show } from "./render.ts";

/** The panel slot the host hands a blade, unchanged from every blade today. */
export type BladePanel = {
  readonly name: string;
  readonly sessionID: string;
  readonly width: number;
  readonly focused: boolean;
  readonly close: () => void;
};

/** The sort toggle: one key, one hint, the title the palette shows. */
export type Toggle = {
  readonly id: string;
  readonly title: string;
  readonly bind: string;
  readonly hint: () => string;
  readonly run: () => void;
};

/** One footer line under the table. */
export type SummaryLine = {
  readonly text: string;
  readonly tone?: Tone;
};

/** The nested table a detail section shows for the selected row. */
export type DetailTable<Row, Picked> = {
  readonly rows: (row: Row) => ReadonlyArray<Picked>;
  readonly columns: ReadonlyArray<Column<Picked>>;
  /** The marker before each row's label; the run outcome mark. */
  readonly marker?: (picked: Picked) => { readonly text: string; readonly tone?: Tone };
  /** The band title above the nested table: label plus a hairline fill. */
  readonly bandTitle?: (row: Row) => string;
};

/** The detail section under the summary: a nested table for the selected
 * row, then the bands of the row the nested selection points at — the same
 * selection-driven band the summary holds over the nested table, one level
 * shallower. */
export type Detail<Row, Picked> = {
  readonly table?: DetailTable<Row, Picked>;
  readonly bands: (row: Row, picked: Picked | undefined) => ReadonlyArray<Band>;
  readonly cap: number;
  readonly labelColumn?: number;
  readonly indent?: number;
};

/** One blade, as data. The engine owns the skeleton, the selections, the
 * keymap, the column widths and the folds; the blade owns its rows, its
 * cells and its words. */
export type BladeSpec<Row, Picked = undefined> = {
  readonly context: Plugin.Context;
  readonly panel: BladePanel;
  /** The keymap command namespace; the close command is `${id}.close`. */
  readonly id: string;
  readonly title: string;
  readonly subtitle: () => string | undefined;
  /** A string here hides the table, summary, detail and hints. */
  readonly empty: () => string | undefined;
  readonly sections: () => ReadonlyArray<Section<Row>>;
  readonly columns: ReadonlyArray<Column<Row>>;
  readonly toggle?: Toggle;
  /** A row's expanded line under it, and the `enter` key that folds it. */
  readonly expand?: (row: Row) => string;
  /** Rows key by identity for the expansion set; defaults to position. */
  readonly rowKey?: (row: Row) => string;
  readonly summary: () => ReadonlyArray<SummaryLine>;
  readonly detail?: Detail<Row, Picked>;
};

type Theme = Plugin.Context["theme"];

const toneColor = (theme: Theme, tone: Tone | undefined) =>
  tone === "muted" ? theme.text.muted : tone === "faint" ? theme.text.faint : theme.text.base;

/** One head cell, aligned the way its data rows align. */
const headCell = (theme: Theme, one: ResolvedColumn<never>): JSX.Element =>
  h(
    "text",
    { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
    one.align === "left" ? fit(one.header(), one.width) : one.header().padStart(one.width),
  );

/** One row's cells after the marker. The flexible label is bold and
 * base-coloured on the chosen row and muted otherwise; a column with its
 * own tone keeps it chosen or not. */
function rowCells<Row>(
  theme: Theme,
  resolved: ReadonlyArray<ResolvedColumn<Row>>,
  row: Row,
  chosen: () => boolean,
): ReadonlyArray<JSX.Element> {
  return resolved
    .filter((one) => one.width > 0)
    .map((one) => {
      const labelTone = one.flex && one.tone(row) === undefined ? "muted" : one.tone(row);
      return one.flex
        ? h(
            "text",
            {
              fg: chosen() ? theme.text.base : toneColor(theme, labelTone),
              attributes: chosen() ? TextAttributes.BOLD : undefined,
              wrapMode: "none",
              truncate: true,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
            },
            one.cell(row),
          )
        : h(
            "text",
            { fg: chosen() ? theme.text.base : toneColor(theme, one.tone(row)), wrapMode: "none", flexShrink: 0 },
            one.align === "left" ? fit(one.cell(row), one.width) : one.cell(row).padStart(one.width),
          );
    });
}

/** One selectable row: the marker, then its cells, then its expanded line
 * when it is the expanded row. */
function selectRow<Row>(
  theme: Theme,
  resolved: ReadonlyArray<ResolvedColumn<Row>>,
  row: Row,
  chosen: () => boolean,
  onPick: () => void,
  expanded?: () => string | undefined,
): JSX.Element {
  return h(
    "box",
    { flexDirection: "row", gap: 1, width: "100%", minWidth: 0, flexShrink: 0, onMouseUp: onPick },
    h("text", { fg: theme.text.base, flexShrink: 0 }, () => (chosen() ? "▌" : " ")),
    ...rowCells(theme, resolved, row, chosen),
    ...(expanded === undefined
      ? []
      : [
          show(
            () => expanded() !== undefined,
            () =>
              h(
                "box",
                { flexDirection: "row", width: "100%", minWidth: 0, flexShrink: 0 },
                // Two leading spaces: the marker column plus the row's gap,
                // so the expanded line nests under the label.
                h("text", { fg: theme.text.base, flexShrink: 0 }, "  "),
                h(
                  "text",
                  { fg: theme.text.faint, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0 },
                  expanded() ?? "",
                ),
              ),
          ),
        ]),
  );
}

/**
 * The one blade component. A blade author declares columns, sections, a
 * toggle and a summary; the engine owns the skeleton the session panels
 * share — title band, section heads, the clamped selections, the keymap
 * layer, the detail bands and the hints — so a change to the skeleton is
 * one edit, not one per blade.
 *
 * The keymap layer is created inside the component, so the panel's keys
 * stop existing the moment the host closes it, and `enabled` keeps them
 * from firing while the panel is up but the prompt owns the keyboard.
 */
export const blade = <Row, Picked>(spec: BladeSpec<Row, Picked>): JSX.Element => {
  const theme = spec.context.theme;
  const inner = Math.max(0, spec.panel.width - 2);

  // One row list in selection order; every read downstream goes through
  // this memo, so a message landing mid-render cannot fork the totals.
  const rows = createMemo(() => flatten(spec.sections()));
  const emptyText = (): string | undefined => (rows().length > 0 ? undefined : spec.empty());

  const [selected, setSelected] = createSignal(0);
  /** The clamped selection index: a revert can shorten the list under the
   * cursor, and the marker, the bold row and the detail must all agree. */
  const at = (): number => clampIndex(selected(), rows().length);
  const move = (delta: number): void => {
    if (rows().length === 0) return;
    setSelected((held) => clampIndex(held + delta, rows().length));
  };

  const table = spec.detail?.table;
  const toggle = spec.toggle;
  const expandOf = spec.expand;
  const pickedRow = (): Row | undefined => rows()[at()];
  const picked = createMemo(() => {
    const row = pickedRow();
    return row === undefined || table === undefined ? [] : table.rows(row);
  });
  const [pickedAtRaw, setPickedAt] = createSignal(0);
  const pickedAt = (): number => clampIndex(pickedAtRaw(), picked().length);
  const current = (): Picked | undefined => picked()[pickedAt()];

  // The expansion set survives sort flips keyed by the row's own identity,
  // not its position; the counter is the redraw trigger.
  const expandedKeys = new Set<string>();
  const [expandedCount, setExpandedCount] = createSignal(0);
  const toggleExpand = (): void => {
    const row = pickedRow();
    if (row === undefined || spec.expand === undefined) return;
    const key = spec.rowKey === undefined ? String(at()) : spec.rowKey(row);
    if (expandedKeys.has(key)) expandedKeys.delete(key);
    else expandedKeys.add(key);
    setExpandedCount((held) => held + 1);
  };

  spec.context.keymap.layer(() => ({
    enabled: () => spec.panel.focused,
    commands: [
      { id: `${spec.id}.close`, title: `Close ${spec.title}`, bind: "escape", run: () => spec.panel.close() },
      ...(toggle === undefined
        ? []
        : [
            {
              id: toggle.id,
              title: toggle.title,
              bind: toggle.bind,
              run: () => toggle.run(),
            },
          ]),
      ...(spec.expand === undefined
        ? []
        : [{ id: `${spec.id}.expand`, title: "Expand selected row", bind: "enter", run: toggleExpand }]),
      { bind: "up", run: () => move(-1) },
      { bind: "down", run: () => move(1) },
    ],
  }));

  const resolved = createMemo(() => resolveColumns(spec.columns, rows(), inner));
  const pickedResolved = createMemo(() =>
    table === undefined ? [] : resolveColumns(table.columns, picked(), inner),
  );

  const shortcut = (id: string, fallback: string): string =>
    spec.context.keymap.shortcuts(id)[0] ?? fallback;

  /** A full-width hairline: the panel's inner width, which is what the rows
   * occupy. It never shrinks, so a short panel loses rows, not rules. */
  const rule = (): JSX.Element =>
    h("text", { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none", flexShrink: 0 }, "─".repeat(inner));

  /** One empty row, never a shareable one: shrinking air would move the
   * bands it separates. */
  const air = (): JSX.Element => h("box", { height: 1, flexShrink: 0 });

  /** The head over one section's rows: the section's own label in the
   * flexible column, every other head aligned like its cells. */
  const sectionHead = (label: string): JSX.Element =>
    h(
      "box",
      { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
      h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " "),
      h(
        "text",
        { fg: theme.text.faint, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0 },
        label,
      ),
      ...resolved()
        .filter((one) => one.width > 0 && !one.flex)
        .map((one) => headCell(theme, one)),
    );

  return h(
    "box",
    { flexDirection: "column", width: "100%", height: "100%", paddingLeft: 1, paddingRight: 1 },
    h(
      "box",
      { flexDirection: "row", justifyContent: "space-between", width: "100%", flexShrink: 0 },
      h(
        "box",
        { flexDirection: "row", gap: 1, minWidth: 0, flexShrink: 1 },
        h(
          "text",
          {
            fg: theme.text.base,
            attributes: TextAttributes.BOLD,
            wrapMode: "none",
            truncate: true,
            flexShrink: 1,
            minWidth: 0,
          },
          spec.title,
        ),
        h(
          "text",
          { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 },
          () => spec.subtitle() ?? "",
        ),
      ),
      h(
        "box",
        { flexShrink: 0, onMouseUp: () => spec.panel.close() },
        h("text", { fg: theme.text.muted, wrapMode: "none" }, "×"),
      ),
    ),
    rule(),
    air(),
    show(
      () => emptyText() === undefined,
      () =>
        h(
          "box",
          { flexDirection: "column", width: "100%", minWidth: 0 },
          // The sections, in selection order with their flattened offsets;
          // the function child keeps the rows reading the selection as it
          // moves between sections.
          () => {
            let offset = 0;
            return spec.sections().map((section) => {
              const base = offset;
              offset += section.rows.length;
              return h(
                "box",
                { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                ...(base > 0 ? [air()] : []),
                sectionHead(section.header ?? flexHeaderOf(resolved())),
                rule(),
                air(),
                h(
                  "box",
                  { flexDirection: "column", width: "100%", minWidth: 0, flexShrink: 0 },
                  () =>
                    section.rows.map((row, position) =>
                      selectRow<Row>(
                        theme,
                        resolved(),
                        row,
                        () => at() === base + position,
                        () => {
                          setSelected(base + position);
                          setPickedAt(0);
                        },
                        spec.expand === undefined
                          ? undefined
                          : () => {
                              void expandedCount();
                              const key = spec.rowKey === undefined ? String(base + position) : spec.rowKey(row);
                              return expandedKeys.has(key) ? spec.expand?.(row) : undefined;
                            },
                      ),
                    ),
                ),
              );
            });
          },
          air(),
          rule(),
          () =>
            spec.summary().map((one) =>
              h(
                "text",
                { fg: toneColor(theme, one.tone), wrapMode: "none", truncate: true, flexShrink: 0 },
                one.text,
              ),
            ),
          // The detail region: the one flexible box in the panel. It clips
          // its own overflow, so a nested table longer than fits loses its
          // tail and nothing else moves; the bands under it never yield. A
          // row with no nested rows and no bands hides it whole.
          show(
            () => {
              const detail = spec.detail;
              const row = pickedRow();
              if (detail === undefined || row === undefined) return false;
              return picked().length > 0 || detail.bands(row, current()).length > 0;
            },
            () =>
              h(
                "box",
                {
                  flexDirection: "column",
                  width: "100%",
                  flexGrow: 1,
                  flexShrink: 1,
                  minHeight: 0,
                  overflow: "hidden",
                },
                ...(table === undefined
                  ? []
                  : [
                      () => {
                        const row = pickedRow();
                        if (row === undefined || table.bandTitle === undefined) return null;
                        const label = table.bandTitle(row);
                        return h(
                          "box",
                          { flexDirection: "row", width: "100%", flexShrink: 0 },
                          h(
                            "text",
                            { fg: theme.text.muted, wrapMode: "none", truncate: true, flexShrink: 1, minWidth: 0 },
                            label,
                          ),
                          h(
                            "text",
                            { fg: theme.border?.base ?? theme.text.faint, wrapMode: "none", flexShrink: 0 },
                            ` ${"─".repeat(Math.max(0, inner - label.length - 1))}`,
                          ),
                        );
                      },
                      () =>
                        h(
                          "box",
                          { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
                          h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, " "),
                          h(
                            "text",
                            { fg: theme.text.faint, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0 },
                            flexHeaderOf(pickedResolved()),
                          ),
                          ...pickedResolved()
                            .filter((one) => one.width > 0 && !one.flex)
                            .map((one) => headCell(theme, one)),
                        ),
                      h(
                        "box",
                        {
                          flexDirection: "column",
                          width: "100%",
                          flexGrow: 1,
                          flexShrink: 1,
                          minHeight: 0,
                          overflow: "hidden",
                        },
                        () =>
                          picked().map((one, position) => {
                            const marker = table.marker?.(one);
                            return h(
                              "box",
                              {
                                flexDirection: "row",
                                gap: 1,
                                width: "100%",
                                minWidth: 0,
                                flexShrink: 0,
                                onMouseUp: () => setPickedAt(position),
                              },
                              h(
                                "text",
                                {
                                  fg:
                                    pickedAt() === position
                                      ? theme.text.base
                                      : toneColor(theme, marker?.tone),
                                  flexShrink: 0,
                                },
                                marker?.text ?? " ",
                              ),
                              ...rowCells(theme, pickedResolved(), one, () => pickedAt() === position),
                            );
                          }),
                      ),
                    ]),
                air(),
                rule(),
                air(),
                () => {
                  const detail = spec.detail;
                  const row = pickedRow();
                  if (detail === undefined || row === undefined) return null;
                  return foldBands(
                    detail.bands(row, current()),
                    inner,
                    detail.cap,
                    detail.labelColumn ?? 10,
                    detail.indent ?? 2,
                  ).map((line) =>
                    h("text", { fg: theme.text.muted, wrapMode: "none", flexShrink: 0 }, line),
                  );
                },
              ),
          ),
        ),
    ),
    show(
      () => emptyText() !== undefined,
      () => h("text", { fg: theme.text.muted, wrapMode: "none" }, emptyText() ?? ""),
    ),
    air(),
    show(
      () => emptyText() === undefined,
      () =>
        h(
          "box",
          { flexDirection: "row", gap: 1, width: "100%", flexShrink: 0 },
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", truncate: true, flexGrow: 1, flexShrink: 1, minWidth: 0 },
            () =>
              spec.toggle === undefined ? "" : `${spec.toggle.hint()} (${shortcut(spec.toggle.id, spec.toggle.bind)})`,
          ),
          h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "· ↑↓ select"),
          ...(spec.expand === undefined
            ? []
            : [h("text", { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 }, "· ↵ expand")]),
          h(
            "text",
            { fg: theme.text.faint, wrapMode: "none", flexShrink: 0 },
            `· esc close (${shortcut(`${spec.id}.close`, "escape")})`,
          ),
        ),
    ),
  );
};

/** The nested table's flexible head when its column names one. */
const flexHeaderOf = (resolved: ReadonlyArray<ResolvedColumn<never>>): string =>
  (resolved.find((one) => one.flex)?.header() ?? "").trim();
