import { usePlugin } from "@opencode/plugin/tui";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { type KeyEvent, type RGBA, TextAttributes } from "@opentui/core";
import { type JSX, useRenderer } from "@opentui/solid";
import { createSignal } from "solid-js";
import { KNOWN_ORDER } from "../tools/definitions/routing/index.ts";
import {
  applied,
  DEFAULT_PROVIDER,
  type Edit,
  effortPicker,
  isJevAvailable,
  isProviderAvailable,
  JEV_MODEL,
  modelPicker,
  pinPicker,
  preview,
  profileInfo,
  providerPicker,
} from "./controls.tsx";
import type { Draft, Model, Profile, Resolution } from "./data.ts";
import { bindKeyboard, field, h, type Palette, palette, show } from "./render.ts";

export type TabId = "profiles" | "allowlist" | "preview";

export const TABS: ReadonlyArray<TabId> = ["profiles", "allowlist", "preview"];

export type ProfileRow = {
  readonly profile: Profile;
  readonly resolution: Resolution | undefined;
};

export type EntryRow = {
  readonly alias: string;
  readonly ref: string;
  readonly model: Model | undefined;
  readonly problem?: string | undefined;
};

export type PageInput = {
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly models: ReadonlyArray<EntryRow>;
  readonly catalogue: ReadonlyArray<Model>;
  readonly source?: string | undefined;
  readonly draft: Draft;
  readonly tab?: TabId | undefined;
  readonly onTabChange?: ((tab: TabId) => void) | undefined;
  readonly selectedRow?: number | undefined;
  readonly onRowChange?: ((row: number) => void) | undefined;
  readonly jevAvailable?: boolean | undefined;
  readonly terminalWidth?: number | undefined;
  readonly terminalHeight?: number | undefined;
  readonly onChange: (next: Draft) => void;
  readonly onProviderChange?: ((next: Draft) => void) | undefined;
  readonly onSave: () => void;
  readonly onClose?: () => void;
};

const ORDER: ReadonlyArray<string> = KNOWN_ORDER;

const rungsView = (rungs: ReadonlyArray<string>): string => {
  const ranked = rungs
    .filter((one) => ORDER.includes(one))
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const unranked = rungs.filter((one) => !ORDER.includes(one));
  return [...ranked, ...unranked].join(", ");
};

const costView = (costInput: number, costOutput: number): string =>
  costInput === 0 && costOutput === 0 ? "free" : `$${costInput}/$${costOutput}`;

const isExpensiveCost = (cost: string | undefined): boolean => {
  if (cost === undefined) return false;
  for (const match of cost.matchAll(/\$(\d+(?:\.\d+)?)/g)) {
    if (Number(match[1]) >= 1) return true;
  }
  return false;
};

const INDENT = 2;

export type LayoutMetrics = {
  readonly modalWidth: number;
  readonly bodyHeight: number;
  readonly profileColumns: {
    readonly gutter: number;
    readonly name: number;
    readonly info: number;
    readonly effort: number;
    readonly model: number;
    readonly cost: number;
  };
  readonly entryColumns: {
    readonly index: number;
    readonly alias: number;
    readonly family: number;
    readonly rungs: number;
    readonly model: number;
    readonly cost: number;
  };
};

export const layoutMetrics = (input: {
  readonly terminalWidth?: number | undefined;
  readonly terminalHeight?: number | undefined;
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly models: ReadonlyArray<EntryRow>;
}): LayoutMetrics => {
  const termWidth = input.terminalWidth ?? 116;
  const termHeight = input.terminalHeight ?? 40;
  const modalWidth = Math.min(116, Math.max(76, termWidth));
  const bodyHeight = Math.max(16, Math.min(34, termHeight - 14));
  const innerWidth = Math.max(60, modalWidth - 9);

  const pGutter = 2;
  const pInfo = 3;
  const maxProfileName = input.rows.reduce((max, one) => Math.max(max, one.profile.name.length), 7);
  const pName = Math.max(10, Math.min(16, maxProfileName + 1));

  const maxEffort = input.rows.reduce((max, one) => {
    const label = one.profile.pinned !== undefined ? "pinned" : (one.profile.effort ?? "-");
    return Math.max(max, label.length);
  }, 6);
  const pEffort = Math.max(12, Math.min(15, maxEffort + 4));

  const maxProfileCost = input.rows.reduce(
    (max, one) => Math.max(max, (one.resolution?.cost ?? "-").length),
    4,
  );
  const pCost = Math.max(8, Math.min(20, maxProfileCost));
  const pGaps = 5;
  const pModel = Math.max(20, innerWidth - pGutter - pName - pInfo - pEffort - pCost - pGaps);

  const eIndex = 3;
  const maxAlias = input.models.reduce((max, one) => Math.max(max, one.alias.length), 5);
  const eAlias = Math.max(8, Math.min(16, maxAlias + 1));

  const maxFamily = input.models.reduce(
    (max, one) => Math.max(max, (one.model?.family ?? "-").length),
    6,
  );
  const eFamily = Math.max(8, Math.min(14, maxFamily + 1));

  const maxRungs = input.models.reduce((max, one) => {
    const text =
      one.model === undefined || one.model.rungs.length === 0 ? "-" : rungsView(one.model.rungs);
    return Math.max(max, text.length);
  }, 5);
  const eRungs = Math.max(12, Math.min(22, maxRungs + 1));

  const maxEntryCost = input.models.reduce((max, one) => {
    const text =
      one.model === undefined ? "-" : costView(one.model.costInput, one.model.costOutput);
    return Math.max(max, text.length);
  }, 4);
  const eCost = Math.max(6, Math.min(12, maxEntryCost));
  const eGaps = 5;
  const eModel = Math.max(20, innerWidth - eIndex - eAlias - eFamily - eRungs - eCost - eGaps);

  return {
    modalWidth,
    bodyHeight,
    profileColumns: {
      gutter: pGutter,
      name: pName,
      info: pInfo,
      effort: pEffort,
      model: pModel,
      cost: pCost,
    },
    entryColumns: {
      index: eIndex,
      alias: eAlias,
      family: eFamily,
      rungs: eRungs,
      model: eModel,
      cost: eCost,
    },
  };
};

const cell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h("text", { width, flexShrink: 0, fg: tone, truncate: true, wrapMode: "none" }, value);

const modelCell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h(
    "text",
    {
      width,
      flexGrow: 1,
      flexShrink: 1,
      flexBasis: 0,
      minWidth: 0,
      fg: tone,
      truncate: true,
      wrapMode: "none",
    },
    value,
  );

const costCell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h("text", { width, flexShrink: 0, fg: tone, wrapMode: "none" }, () => value().padStart(width));

const indentedLine = (tone: RGBA, text: string): JSX.Element =>
  h(
    "box",
    { paddingLeft: INDENT, paddingRight: 1 },
    h("text", { fg: tone, wrapMode: "word" }, text),
  );

const selectControl = (input: {
  readonly colors: Palette;
  readonly width?: number;
  readonly flexGrow?: number;
  readonly value: string;
  readonly onOpen: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  return h(
    "box",
    {
      width: input.width,
      flexGrow: input.flexGrow,
      flexShrink: input.flexGrow !== undefined ? 1 : 0,
      flexBasis: input.flexGrow !== undefined && input.width === undefined ? 0 : undefined,
      minWidth: input.flexGrow !== undefined ? 0 : undefined,
      flexDirection: "row",
      justifyContent: "space-between",
      paddingLeft: 1,
      paddingRight: 1,
      backgroundColor: () => (hovered() ? input.colors.selectHoverBg : input.colors.insetBg),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: input.onOpen,
    },
    h(
      "text",
      {
        fg: () => (hovered() ? input.colors.cyan : input.colors.text),
        flexGrow: 1,
        flexShrink: 1,
        flexBasis: 0,
        minWidth: 0,
        truncate: true,
        wrapMode: "none",
      },
      input.value,
    ),
    h(
      "text",
      {
        fg: input.colors.cyan,
        flexShrink: 0,
        wrapMode: "none",
      },
      " ▾",
    ),
  );
};

const infoBadge = (input: {
  readonly colors: Palette;
  readonly width: number;
  readonly onOpen: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  return h(
    "box",
    {
      width: input.width,
      flexShrink: 0,
      flexDirection: "row",
      justifyContent: "center",
      backgroundColor: () => (hovered() ? input.colors.selectHoverBg : undefined),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: input.onOpen,
    },
    h(
      "text",
      {
        fg: () => (hovered() ? input.colors.cyan : input.colors.teal),
        attributes: TextAttributes.BOLD,
        wrapMode: "none",
      },
      "ⓘ",
    ),
  );
};

const providerBar = (input: {
  readonly colors: Palette;
  readonly provider: string | undefined;
  readonly available: boolean;
  readonly onOpen: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  const label = input.provider ?? `${DEFAULT_PROVIDER} (default)`;
  const statusText = input.available ? "change ▾" : "unavailable — select provider ▾";
  const statusTone = input.available
    ? () => (hovered() ? input.colors.cyan : input.colors.muted)
    : () => input.colors.warning;

  return h(
    "box",
    {
      flexDirection: "row",
      justifyContent: "space-between",
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: input.onOpen,
    },
    h(
      "text",
      { fg: input.colors.blue, truncate: true, wrapMode: "none" },
      "provider: ",
      h(
        "span",
        { style: { fg: input.available ? input.colors.text : input.colors.warning } },
        label,
      ),
    ),
    h(
      "text",
      {
        fg: statusTone,
        flexShrink: 0,
        wrapMode: "none",
      },
      statusText,
    ),
  );
};

const jevToggleBar = (input: {
  readonly colors: Palette;
  readonly modelName: string;
  readonly enabled: boolean;
  readonly available: boolean;
  readonly onToggle: () => void;
}): JSX.Element => {
  const { colors, available, enabled } = input;
  const radioText = !available
    ? "(○) disabled (no OPENCODE_KEY)"
    : enabled
      ? "(●) on  ( ) off"
      : "( ) on  (●) off";
  const radioColor = !available ? colors.disabled : enabled ? colors.green : colors.muted;

  return h(
    "box",
    {
      flexDirection: "row",
      justifyContent: "space-between",
      onMouseUp: input.onToggle,
    },
    h(
      "text",
      { fg: colors.blue, truncate: true, wrapMode: "none" },
      "judge: ",
      h("span", { style: { fg: available ? colors.text : colors.disabled } }, input.modelName),
    ),
    h(
      "text",
      {
        fg: radioColor,
        attributes: available && enabled ? TextAttributes.BOLD : TextAttributes.NONE,
        flexShrink: 0,
        wrapMode: "none",
      },
      radioText,
    ),
  );
};

const tabBar = (input: {
  readonly colors: Palette;
  readonly active: TabId;
  readonly profileCount: number;
  readonly allowCount: number;
  readonly onSelect: (tab: TabId) => void;
}): JSX.Element => {
  const items: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
    { id: "profiles", label: `Profiles (${input.profileCount})` },
    { id: "allowlist", label: `Allowlist (${input.allowCount})` },
    { id: "preview", label: "Preview" },
  ];

  return h(
    "box",
    {
      flexDirection: "row",
      justifyContent: "space-between",
      flexShrink: 0,
      backgroundColor: input.colors.insetBg,
      border: ["bottom"],
      borderColor: input.colors.border,
      paddingLeft: 3,
      paddingRight: 3,
      paddingTop: 1,
      paddingBottom: 1,
    },
    h(
      "box",
      { flexDirection: "row", gap: 3 },
      ...items.map((item) => {
        const selected = item.id === input.active;
        return h(
          "box",
          {
            paddingLeft: 1,
            paddingRight: 1,
            backgroundColor: selected ? input.colors.modalBg : undefined,
            onMouseUp: () => input.onSelect(item.id),
          },
          h(
            "text",
            {
              fg: selected ? input.colors.cyan : input.colors.muted,
              attributes: selected ? TextAttributes.BOLD : TextAttributes.NONE,
              wrapMode: "none",
            },
            selected ? `▸ ${item.label}` : `  ${item.label}`,
          ),
        );
      }),
    ),
    h("text", { fg: input.colors.faint, wrapMode: "none" }, "[/] tabs"),
  );
};

const profileRow = (
  colors: Palette,
  theme: ResolvedTheme,
  cols: LayoutMetrics["profileColumns"],
  row: ProfileRow,
  selected: boolean,
  actions: {
    readonly effort: () => void;
    readonly pin: () => void;
    readonly info: () => void;
    readonly selectRow: () => void;
  },
): JSX.Element => {
  const profile = row.profile;
  const [hovered, setHovered] = createSignal(false);
  const costTone = isExpensiveCost(row.resolution?.cost) ? colors.yellow : colors.muted;
  const effort = profile.pinned !== undefined ? "pinned" : (profile.effort ?? "-");
  const ref = row.resolution?.ref ?? "-";
  const nameProps = {
    width: cols.name,
    flexShrink: 0,
    fg: selected ? colors.cyan : colors.text,
    attributes: selected ? TextAttributes.BOLD : TextAttributes.NONE,
    truncate: true,
    wrapMode: "none",
    onMouseUp: actions.effort,
  };
  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
      backgroundColor: () => (hovered() ? colors.rowHoverBg : undefined),
      onMouseOver: () => {
        setHovered(true);
        actions.selectRow();
      },
      onMouseOut: () => setHovered(false),
    },
    h(
      "box",
      { flexDirection: "row", columnGap: 1, width: "100%" },
      cell(cols.gutter, () => (selected ? "▸" : " "), colors.cyan),
      h("text", nameProps, () => profile.name),
      infoBadge({ colors, width: cols.info, onOpen: actions.info }),
      selectControl({ colors, width: cols.effort, value: effort, onOpen: actions.effort }),
      selectControl({
        colors,
        width: cols.model,
        flexGrow: 1,
        value: ref,
        onOpen: actions.pin,
      }),
      costCell(cols.cost, () => row.resolution?.cost ?? "-", costTone),
    ),
    show(
      () => row.resolution !== undefined && row.resolution.crosscheck !== undefined,
      () =>
        h(
          "box",
          { paddingLeft: INDENT, paddingRight: 1 },
          field(theme, "crosscheck", () => row.resolution?.crosscheck ?? ""),
        ),
    ),
    show(
      () => row.resolution !== undefined && row.resolution.problem !== undefined,
      () => indentedLine(colors.warning, row.resolution?.problem ?? ""),
    ),
  );
};

const entryRow = (
  colors: Palette,
  cols: LayoutMetrics["entryColumns"],
  row: EntryRow,
  index: number,
): JSX.Element => {
  const model = row.model;
  const [hovered, setHovered] = createSignal(false);
  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
      backgroundColor: () => (hovered() ? colors.rowHoverBg : undefined),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
    },
    h(
      "box",
      { flexDirection: "row", columnGap: 1, width: "100%" },
      cell(cols.index, () => String(index + 1), colors.faint),
      cell(cols.alias, () => row.alias, colors.text),
      cell(cols.family, () => model?.family ?? "-", colors.text),
      cell(
        cols.rungs,
        () => (model === undefined || model.rungs.length === 0 ? "-" : rungsView(model.rungs)),
        colors.muted,
      ),
      modelCell(cols.model, () => row.ref, colors.text),
      costCell(
        cols.cost,
        () => (model === undefined ? "-" : costView(model.costInput, model.costOutput)),
        colors.muted,
      ),
    ),
    show(
      () => row.problem !== undefined,
      () => indentedLine(colors.warning, row.problem ?? ""),
    ),
  );
};

const section = (
  colors: Palette,
  caption: string,
  head: ReadonlyArray<JSX.Element>,
  body: JSX.Element,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column", width: "100%", gap: 1 },
    h("text", { fg: colors.muted, wrapMode: "word" }, caption),
    h(
      "box",
      {
        flexDirection: "row",
        columnGap: 1,
        width: "100%",
        paddingTop: 1,
        paddingBottom: 1,
        border: ["bottom"],
        borderColor: colors.border,
      },
      head,
    ),
    body,
  );

const headerCells = {
  profiles: (
    colors: Palette,
    cols: LayoutMetrics["profileColumns"],
  ): ReadonlyArray<JSX.Element> => [
    cell(cols.gutter, () => "", colors.blue),
    cell(cols.name, () => "profile", colors.blue),
    cell(cols.info, () => "i", colors.blue),
    cell(cols.effort, () => "effort", colors.blue),
    modelCell(cols.model, () => "model", colors.blue),
    costCell(cols.cost, () => "cost", colors.blue),
  ],
  entries: (colors: Palette, cols: LayoutMetrics["entryColumns"]): ReadonlyArray<JSX.Element> => [
    cell(cols.index, () => "#", colors.blue),
    cell(cols.alias, () => "alias", colors.blue),
    cell(cols.family, () => "family", colors.blue),
    cell(cols.rungs, () => "rungs", colors.blue),
    modelCell(cols.model, () => "model", colors.blue),
    costCell(cols.cost, () => "cost", colors.blue),
  ],
};

const footerButton = (input: {
  readonly key: string;
  readonly label: string;
  readonly hoverKeyColor: RGBA;
  readonly textColor: RGBA;
  readonly mutedColor: RGBA;
  readonly onPress: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  return h(
    "text",
    {
      fg: () => (hovered() ? input.hoverKeyColor : input.textColor),
      attributes: TextAttributes.BOLD,
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: input.onPress,
    },
    `${input.key} `,
    h(
      "span",
      {
        style: () => ({
          fg: hovered() ? input.textColor : input.mutedColor,
        }),
      },
      input.label,
    ),
  );
};

const previewTab = (
  colors: Palette,
  theme: ResolvedTheme,
  draft: Draft,
  catalogue: ReadonlyArray<Model>,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column", gap: 1, width: "100%" },
    h(
      "box",
      {
        flexDirection: "column",
        width: "100%",
        border: true,
        borderStyle: "rounded",
        borderColor: colors.border,
        backgroundColor: colors.insetBg,
        paddingLeft: 2,
        paddingRight: 2,
        paddingTop: 1,
        paddingBottom: 1,
      },
      preview({ theme, draft, models: catalogue }),
    ),
    h(
      "text",
      { fg: colors.muted, wrapMode: "word" },
      "the page writes nothing by itself. A click writes the draft to the config file.",
    ),
  );

const activeTabBody = (input: {
  readonly tab: TabId;
  readonly colors: Palette;
  readonly theme: ResolvedTheme;
  readonly metrics: LayoutMetrics;
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly models: ReadonlyArray<EntryRow>;
  readonly catalogue: ReadonlyArray<Model>;
  readonly draft: Draft;
  readonly selectedRow: () => number;
  readonly actions: (
    row: ProfileRow,
    index: number,
  ) => {
    readonly effort: () => void;
    readonly pin: () => void;
    readonly info: () => void;
    readonly selectRow: () => void;
  };
}): JSX.Element => {
  const { colors, theme, metrics } = input;
  if (input.tab === "allowlist") {
    const entries = h(
      "box",
      { flexDirection: "column", width: "100%", gap: 1 },
      () => input.models.map((row, index) => entryRow(colors, metrics.entryColumns, row, index)),
      show(
        () => input.models.length === 0,
        () => indentedLine(colors.muted, "no entries yet"),
      ),
    );
    return section(
      colors,
      "the resolver reads the entries from the top and spends the first model that fits",
      headerCells.entries(colors, metrics.entryColumns),
      entries,
    );
  }
  if (input.tab === "preview") {
    return previewTab(colors, theme, input.draft, input.catalogue);
  }
  const profiles = h(
    "box",
    { flexDirection: "column", width: "100%", gap: 1 },
    () =>
      input.rows.map((row, index) =>
        profileRow(
          colors,
          theme,
          metrics.profileColumns,
          row,
          index === input.selectedRow(),
          input.actions(row, index),
        ),
      ),
    show(
      () => input.rows.length === 0,
      () => indentedLine(colors.muted, "no profiles yet"),
    ),
  );
  return section(
    colors,
    "the requirement each profile names, and the model the resolver would spend on it (press i or click ⓘ for profile details)",
    headerCells.profiles(colors, metrics.profileColumns),
    profiles,
  );
};

const TAB_DELTAS: Readonly<Record<string, number>> = { tab: 1, "]": 1, "[": -1 };
const ROW_DELTAS: Readonly<Record<string, number>> = { down: 1, j: 1, up: -1, k: -1 };

const stepTab = (current: TabId, delta: number): TabId => {
  const at = TABS.indexOf(current);
  const next = ((at === -1 ? 0 : at) + delta + TABS.length) % TABS.length;
  return TABS[next] ?? "profiles";
};

const stepRow = (current: number, total: number, delta: number): number =>
  total <= 0 ? 0 : (current + delta + total) % total;

export const dispatchModalKey = (
  event: KeyEvent,
  actions: {
    readonly saveAndClose: () => void;
    readonly close: () => void;
    readonly moveTab: (delta: number) => void;
    readonly moveRow: (delta: number) => void;
    readonly addModel?: () => void;
    readonly openInfo?: () => void;
  },
): void => {
  const key = event.name || event.sequence || "";
  if (key === "return" || key === "enter") {
    event.preventDefault();
    actions.saveAndClose();
    return;
  }
  if (key === "escape") {
    event.preventDefault();
    actions.close();
    return;
  }
  if (key === "+" || key === "kpplus" || event.sequence === "+" || (key === "=" && event.shift)) {
    event.preventDefault();
    actions.addModel?.();
    return;
  }
  if ((key === "i" || event.sequence === "i") && !event.ctrl && !event.meta && !event.super) {
    event.preventDefault();
    actions.openInfo?.();
    return;
  }
  const tabDelta = TAB_DELTAS[key] ?? (event.sequence ? TAB_DELTAS[event.sequence] : undefined);
  if (tabDelta !== undefined) {
    event.preventDefault();
    actions.moveTab(tabDelta);
    return;
  }
  const rowDelta = ROW_DELTAS[key];
  if (rowDelta !== undefined) actions.moveRow(rowDelta);
};

export const page = (input: PageInput): JSX.Element => {
  const context = usePlugin();
  let liveRenderer: typeof context.renderer | undefined = context.renderer;
  try {
    const fromSolid = useRenderer();
    if (fromSolid) liveRenderer = fromSolid;
  } catch {
    liveRenderer = context.renderer;
  }
  const theme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const colors = palette(context.theme, theme);
  const dialog = context.ui.dialog;
  const activeTab: TabId = input.tab ?? "profiles";
  const [selectedRow, setSelectedRow] = createSignal(input.selectedRow ?? 0);
  const jevAvailable = input.jevAvailable ?? isJevAvailable(input.draft);
  const jevEnabled =
    jevAvailable && input.draft.judge !== undefined && input.draft.judge.kind !== "lexical";
  const jevModel = input.draft.judge?.model ?? JEV_MODEL;
  const providerAvailable = isProviderAvailable(input.draft.provider, input.catalogue);

  const metrics = layoutMetrics({
    terminalWidth: input.terminalWidth ?? context.renderer?.width ?? liveRenderer?.width,
    terminalHeight: input.terminalHeight ?? context.renderer?.height ?? liveRenderer?.height,
    rows: input.rows,
    models: input.models,
  });

  const close = () => {
    if (input.onClose) input.onClose();
    else dialog.clear();
  };

  const run = (open: () => Promise<Edit | undefined>): void => {
    void open().then(
      (edit) => {
        if (edit?.kind === "provider") {
          const next = applied(input.draft, edit);
          if (input.onProviderChange) input.onProviderChange(next);
          else {
            input.onChange(next);
            input.onSave();
          }
          return;
        }
        input.onChange(edit !== undefined ? applied(input.draft, edit) : input.draft);
      },
      (problem: unknown) => {
        context.ui.toast.show({
          title: "The control stopped",
          message: problem instanceof Error ? problem.message : String(problem),
          variant: "error",
        });
      },
    );
  };

  const openAddModel = (): void => {
    run(() => modelPicker({ dialog, draft: input.draft, models: input.catalogue }));
  };

  const openProfileInfo = (row: ProfileRow | undefined): void => {
    if (row === undefined) return;
    run(() =>
      profileInfo({
        dialog,
        profile: row.profile,
        resolution: row.resolution,
        draft: input.draft,
        models: input.catalogue,
      }),
    );
  };

  const openProviderPicker = (): void => {
    run(() => providerPicker({ dialog, draft: input.draft, models: input.catalogue }));
  };

  bindKeyboard(context.renderer, (event: KeyEvent) =>
    dispatchModalKey(event, {
      saveAndClose: () => {
        input.onSave();
        close();
      },
      close,
      moveTab: (delta) => {
        input.onTabChange?.(stepTab(activeTab, delta));
      },
      moveRow: (delta) => {
        if (activeTab !== "profiles") return;
        const next = stepRow(selectedRow(), input.rows.length, delta);
        setSelectedRow(next);
        input.onRowChange?.(next);
      },
      addModel: openAddModel,
      openInfo: () => {
        if (activeTab !== "profiles") return;
        openProfileInfo(input.rows[selectedRow()]);
      },
    }),
  );

  const actions = (row: ProfileRow, index: number) => ({
    effort: () =>
      run(() =>
        effortPicker({ dialog, draft: input.draft, models: input.catalogue, profile: row.profile }),
      ),
    pin: () => run(() => pinPicker({ dialog, draft: input.draft, profile: row.profile })),
    info: () => openProfileInfo(row),
    selectRow: () => {
      setSelectedRow(index);
      input.onRowChange?.(index);
    },
  });

  const body = h(
    "scrollbox",
    {
      width: "100%",
      height: metrics.bodyHeight,
      flexGrow: 1,
      minHeight: 0,
      paddingLeft: 3,
      paddingRight: 3,
      paddingTop: 1,
      paddingBottom: 1,
      contentOptions: { flexDirection: "column", gap: 1, width: "100%" },
      focused: () => true,
    },
    activeTabBody({
      tab: activeTab,
      colors,
      theme,
      metrics,
      rows: input.rows,
      models: input.models,
      catalogue: input.catalogue,
      draft: input.draft,
      selectedRow,
      actions,
    }),
  );

  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
      flexGrow: 1,
      minWidth: 0,
      minHeight: 0,
      border: true,
      borderStyle: "rounded",
      borderColor: colors.borderOuter,
      backgroundColor: colors.modalBg,
    },
    h(
      "box",
      {
        flexDirection: "column",
        width: "100%",
        flexShrink: 0,
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
        border: ["bottom"],
        borderColor: colors.border,
      },
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between", width: "100%" },
        h("text", { fg: colors.text, attributes: TextAttributes.BOLD }, "Routing"),
        h("text", { fg: colors.teal, onMouseUp: close }, "esc"),
      ),
      show(
        () => input.source !== undefined || (input.rows.length === 0 && input.models.length === 0),
        () => field(theme, "config", () => input.source ?? "none yet"),
      ),
      providerBar({
        colors,
        provider: input.draft.provider,
        available: providerAvailable,
        onOpen: openProviderPicker,
      }),
      jevToggleBar({
        colors,
        modelName: jevModel,
        enabled: jevEnabled,
        available: jevAvailable,
        onToggle: () => {
          if (!jevAvailable) {
            context.ui.toast.show({
              title: "Routing",
              message: "Set OPENCODE_API_KEY to enable the Jev judge",
              variant: "warning",
            });
            return;
          }
          input.onChange(applied(input.draft, { kind: "judge", enabled: !jevEnabled }));
        },
      }),
    ),
    tabBar({
      colors,
      active: activeTab,
      profileCount: input.rows.length,
      allowCount: input.models.length,
      onSelect: (next) => input.onTabChange?.(next),
    }),
    body,
    h(
      "box",
      {
        flexDirection: "row",
        justifyContent: "space-between",
        width: "100%",
        flexShrink: 0,
        backgroundColor: colors.insetBg,
        border: ["top"],
        borderColor: colors.border,
        paddingLeft: 3,
        paddingRight: 3,
      },
      h(
        "box",
        { flexDirection: "row", gap: 4 },
        footerButton({
          key: "enter",
          label: "write it",
          hoverKeyColor: colors.green,
          textColor: colors.text,
          mutedColor: colors.muted,
          onPress: () => input.onSave(),
        }),
        footerButton({
          key: "+",
          label: "add model",
          hoverKeyColor: colors.cyan,
          textColor: colors.text,
          mutedColor: colors.muted,
          onPress: openAddModel,
        }),
        show(
          () => activeTab === "profiles" && input.rows.length > 0,
          () =>
            footerButton({
              key: "i",
              label: "profile info",
              hoverKeyColor: colors.teal,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: () => openProfileInfo(input.rows[selectedRow()]),
            }),
        ),
      ),
      footerButton({
        key: "esc",
        label: "close",
        hoverKeyColor: colors.red,
        textColor: colors.text,
        mutedColor: colors.muted,
        onPress: close,
      }),
    ),
  );
};
