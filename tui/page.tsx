import { usePlugin } from "@opencode/plugin/tui";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { type KeyEvent, type RGBA, TextAttributes } from "@opentui/core";
import { type JSX, useRenderer } from "@opentui/solid";
import { createSignal } from "solid-js";
import { FILE_NAME, KNOWN_ORDER } from "../tools/definitions/routing/index.ts";
import {
  addProfilePrompt,
  applied,
  crosscheckPicker,
  DEFAULT_PROVIDER,
  type Edit,
  effortPicker,
  isJevAvailable,
  isModelUsable,
  isProviderAvailable,
  JEV_MODEL,
  modelPicker,
  pinPicker,
  preview,
  profileInfo,
  providerPicker,
  removeModelPicker,
  removeProfilePicker,
} from "./controls.tsx";
import {
  type Draft,
  formatCost,
  isCustomProfile,
  isProfileEnabled,
  type Model,
  normalizeCost,
  type Profile,
  type Resolution,
} from "./data.ts";
import { bindKeyboard, field, h, type Palette, palette, show } from "./render.ts";

export type TabId = "configured" | "profiles" | "allowlist" | "preview";

export const TABS: ReadonlyArray<TabId> = ["configured", "profiles", "allowlist", "preview"];

export type ProfileRow = {
  readonly profile: Profile;
  readonly resolution: Resolution | undefined;
};

export type EntryRow = {
  readonly alias: string;
  readonly ref: string;
  readonly priority: number;
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
  /** True while the directory's config is being read. */
  readonly loading?: boolean | undefined;
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

const isExpensiveCost = (cost: string | undefined): boolean => {
  if (cost === undefined) return false;
  for (const match of cost.matchAll(/\$(\d+(?:\.\d+)?)/g)) {
    if (Number(match[1]) >= 1) return true;
  }
  return false;
};

export const usableEntryRows = (
  entries: ReadonlyArray<EntryRow>,
  provider: string | undefined,
): ReadonlyArray<EntryRow> =>
  entries.filter((row) => {
    if (provider !== undefined && !row.ref.startsWith(`${provider}/`)) return false;
    if (!isModelUsable(row.model, provider)) return false;
    const hash = row.ref.indexOf("#");
    const variant = hash === -1 ? undefined : row.ref.slice(hash + 1);
    if (variant !== undefined && !row.model.rungs.includes(variant)) return false;
    return true;
  });

const INDENT = 2;

/** The widest a compact select grows before its value truncates. */
const COMPACT_SELECT_MAX_WIDTH = 64;

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
  readonly profileListColumns: {
    readonly gutter: number;
    readonly name: number;
    readonly info: number;
    readonly kind: number;
    readonly status: number;
    readonly summary: number;
    readonly remove: number;
  };
  readonly entryColumns: {
    readonly gutter: number;
    readonly priority: number;
    readonly alias: number;
    readonly family: number;
    readonly rungs: number;
    readonly model: number;
    readonly cost: number;
    readonly move: number;
    readonly remove: number;
  };
};

export const layoutMetrics = (input: {
  readonly terminalWidth?: number | undefined;
  readonly terminalHeight?: number | undefined;
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly profiles?: ReadonlyArray<Profile> | undefined;
  readonly models: ReadonlyArray<EntryRow>;
}): LayoutMetrics => {
  const termWidth = input.terminalWidth ?? 116;
  const termHeight = input.terminalHeight ?? 40;
  const modalWidth = Math.min(116, Math.max(76, termWidth));
  const bodyHeight = Math.max(16, Math.min(34, termHeight - 14));
  const innerWidth = Math.max(60, modalWidth - 9);

  const pGutter = 2;
  const pInfo = 4;
  const maxProfileName = input.rows.reduce((max, one) => Math.max(max, one.profile.name.length), 7);
  const pName = Math.max(10, Math.min(16, maxProfileName + 1));

  const maxEffort = input.rows.reduce((max, one) => {
    const label = one.profile.effort ?? (one.profile.pinned !== undefined ? "Pinned" : "-");
    return Math.max(max, label.length);
  }, 6);
  const pEffort = Math.max(12, Math.min(15, maxEffort + 4));

  const maxProfileCost = input.rows.reduce(
    (max, one) => Math.max(max, (normalizeCost(one.resolution?.cost) ?? "-").length),
    4,
  );
  const pCost = Math.max(8, Math.min(14, maxProfileCost));
  const pGaps = 5;
  const pModel = Math.max(20, innerWidth - pGutter - pName - pInfo - pEffort - pCost - pGaps);

  const listProfiles = input.profiles ?? input.rows.map((one) => one.profile);
  const plGutter = 2;
  const plInfo = 4;
  const maxListName = listProfiles.reduce((max, one) => Math.max(max, one.name.length), 7);
  const plName = Math.max(10, Math.min(16, maxListName + 1));
  const plKind = 8;
  const plStatus = 10;
  const plRemove = 6;
  const plGaps = 6;
  const plSummary = Math.max(
    16,
    innerWidth - plGutter - plName - plInfo - plKind - plStatus - plRemove - plGaps,
  );

  const eGutter = 2;
  const ePriority = 8;
  const eMove = 4;
  const eRemove = 6;
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
      one.model === undefined ? "-" : formatCost(one.model.costInput, one.model.costOutput);
    return Math.max(max, text.length);
  }, 4);
  const eCost = Math.max(6, Math.min(12, maxEntryCost));
  const eGaps = 8;
  const eModel = Math.max(
    18,
    innerWidth - eGutter - ePriority - eAlias - eFamily - eRungs - eCost - eMove - eRemove - eGaps,
  );

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
    profileListColumns: {
      gutter: plGutter,
      name: plName,
      info: plInfo,
      kind: plKind,
      status: plStatus,
      summary: plSummary,
      remove: plRemove,
    },
    entryColumns: {
      gutter: eGutter,
      priority: ePriority,
      alias: eAlias,
      family: eFamily,
      rungs: eRungs,
      model: eModel,
      cost: eCost,
      move: eMove,
      remove: eRemove,
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
  /** Size to the value, keeping the chevron beside it instead of at the column edge. */
  readonly compact?: boolean;
  readonly value: string;
  readonly tone?: RGBA | undefined;
  readonly onOpen: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  const baseTone = input.tone ?? input.colors.text;
  return h(
    "box",
    {
      width: input.width,
      maxWidth: input.compact === true ? COMPACT_SELECT_MAX_WIDTH : undefined,
      flexGrow: input.flexGrow,
      flexShrink: input.flexGrow !== undefined || input.compact === true ? 1 : 0,
      flexBasis: input.flexGrow !== undefined && input.width === undefined ? 0 : undefined,
      minWidth: input.flexGrow !== undefined ? 0 : undefined,
      flexDirection: "row",
      justifyContent: input.compact === true ? "flex-start" : "space-between",
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
        fg: () => (hovered() ? input.colors.cyan : baseTone),
        flexGrow: input.compact === true ? 0 : 1,
        flexShrink: 1,
        flexBasis: input.compact === true ? undefined : 0,
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

const removeBadge = (input: {
  readonly colors: Palette;
  readonly width: number;
  readonly onRemove: () => void;
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
      onMouseUp: input.onRemove,
    },
    h(
      "text",
      {
        fg: () => (hovered() ? input.colors.red : input.colors.muted),
        attributes: TextAttributes.BOLD,
        wrapMode: "none",
      },
      "✕",
    ),
  );
};

const moveBadges = (input: {
  readonly colors: Palette;
  readonly width: number;
  readonly onUp: () => void;
  readonly onDown: () => void;
}): JSX.Element =>
  h(
    "box",
    {
      width: input.width,
      flexShrink: 0,
      flexDirection: "row",
      justifyContent: "center",
      columnGap: 1,
    },
    h("text", { fg: input.colors.muted, wrapMode: "none", onMouseUp: input.onUp }, "↑"),
    h("text", { fg: input.colors.muted, wrapMode: "none", onMouseUp: input.onDown }, "↓"),
  );

const providerBar = (input: {
  readonly colors: Palette;
  readonly provider: string | undefined;
  readonly available: boolean;
  readonly onOpen: () => void;
}): JSX.Element => {
  const label = input.provider ?? `${DEFAULT_PROVIDER} (default)`;
  const selectValue = input.available ? label : `${label} (unavailable)`;
  const selectWidth = Math.max(16, Math.min(36, selectValue.length + 4));

  return h(
    "box",
    {
      flexDirection: "row",
      justifyContent: "space-between",
      width: "100%",
    },
    h("text", { fg: input.colors.blue, truncate: true, wrapMode: "none" }, "Provider:"),
    selectControl({
      colors: input.colors,
      width: selectWidth,
      value: selectValue,
      tone: input.available ? input.colors.text : input.colors.warning,
      onOpen: input.onOpen,
    }),
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
    ? "(○) Disabled (no OPENCODE_KEY)"
    : enabled
      ? "(●) On  ( ) Off"
      : "( ) On  (●) Off";
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
      "Judge: ",
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
  readonly configuredCount: number;
  readonly profileCount: number;
  readonly allowCount: number;
  readonly onSelect: (tab: TabId) => void;
}): JSX.Element => {
  const items: ReadonlyArray<{ readonly id: TabId; readonly label: string }> = [
    { id: "configured", label: `Configured (${input.configuredCount})` },
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
      { flexDirection: "row", gap: 2 },
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
    h("text", { fg: input.colors.faint, wrapMode: "none" }, "[/] Tabs"),
  );
};

const statusToggleBadge = (input: {
  readonly colors: Palette;
  readonly width: number;
  readonly enabled: boolean;
  readonly onToggle: () => void;
}): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  return h(
    "box",
    {
      width: input.width,
      flexShrink: 0,
      flexDirection: "row",
      backgroundColor: () => (hovered() ? input.colors.selectHoverBg : undefined),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
      onMouseUp: input.onToggle,
    },
    h(
      "text",
      {
        fg: () =>
          hovered() ? input.colors.cyan : input.enabled ? input.colors.green : input.colors.muted,
        attributes: input.enabled ? TextAttributes.BOLD : TextAttributes.NONE,
        wrapMode: "none",
      },
      input.enabled ? "[●] On" : "[ ] Off",
    ),
  );
};

const profileListRow = (
  colors: Palette,
  cols: LayoutMetrics["profileListColumns"],
  profile: Profile,
  selected: boolean,
  actions: {
    readonly toggle: () => void;
    readonly info: () => void;
    readonly remove: () => void;
    readonly selectRow: () => void;
  },
): JSX.Element => {
  const [hovered, setHovered] = createSignal(false);
  const enabled = isProfileEnabled(profile);
  const custom = isCustomProfile(profile);
  const nameProps = {
    width: cols.name,
    flexShrink: 0,
    fg: selected ? colors.cyan : enabled ? colors.text : colors.muted,
    attributes: selected ? TextAttributes.BOLD : TextAttributes.NONE,
    truncate: true,
    wrapMode: "none",
    onMouseUp: actions.toggle,
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
      infoBadge({ colors, width: cols.info, onOpen: actions.info }),
      h("text", nameProps, () => profile.name),
      cell(cols.kind, () => (custom ? "custom" : "default"), custom ? colors.teal : colors.muted),
      statusToggleBadge({ colors, width: cols.status, enabled, onToggle: actions.toggle }),
      modelCell(
        cols.summary,
        () => profile.match ?? profile.why ?? "-",
        enabled ? colors.muted : colors.disabled,
      ),
      custom
        ? removeBadge({ colors, width: cols.remove, onRemove: actions.remove })
        : cell(cols.remove, () => "-", colors.faint),
    ),
  );
};

/**
 * What the crosscheck control says. The resolved model is the answer a session
 * spends. A configured crosscheck that found none names the requirement it
 * asked for, so "no model" is not mistaken for "off".
 */
const crosscheckValue = (row: ProfileRow): string => {
  const configured = row.profile.crosscheck;
  if (configured === undefined) return "None";
  const resolved = row.resolution?.crosscheck;
  if (resolved !== undefined) return resolved;
  const want = configured.effort ?? "profile effort";
  return `No model (${want})`;
};

const profileRow = (
  colors: Palette,
  cols: LayoutMetrics["profileColumns"],
  row: ProfileRow,
  selected: boolean,
  actions: {
    readonly effort: () => void;
    readonly pin: () => void;
    readonly crosscheck: () => void;
    readonly info: () => void;
    readonly selectRow: () => void;
  },
): JSX.Element => {
  const profile = row.profile;
  const [hovered, setHovered] = createSignal(false);
  const costText = normalizeCost(row.resolution?.cost) ?? "-";
  const costTone = isExpensiveCost(costText) ? colors.yellow : colors.muted;
  const effort = profile.effort ?? (profile.pinned !== undefined ? "Pinned" : "-");
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
      infoBadge({ colors, width: cols.info, onOpen: actions.info }),
      h("text", nameProps, () => profile.name),
      selectControl({
        colors,
        width: cols.model,
        flexGrow: 1,
        value: ref,
        onOpen: actions.pin,
      }),
      selectControl({ colors, width: cols.effort, value: effort, onOpen: actions.effort }),
      costCell(cols.cost, () => costText, costTone),
    ),
    h(
      "box",
      {
        flexDirection: "row",
        alignItems: "center",
        width: "100%",
        columnGap: 1,
        paddingRight: 1,
      },
      h(
        "box",
        {
          // The label is right-aligned so the select starts at the Model
          // column whatever width the Profile column takes.
          width: cols.gutter + cols.info + cols.name + 2,
          flexShrink: 0,
          flexDirection: "row",
          justifyContent: "flex-end",
        },
        h("text", { fg: colors.blue, wrapMode: "none" }, "↳ crosscheck:"),
      ),
      selectControl({
        colors,
        compact: true,
        value: crosscheckValue(row),
        onOpen: actions.crosscheck,
      }),
      h("box", { flexGrow: 1 }),
    ),
    show(
      () => row.resolution?.crosscheckProblem !== undefined,
      () => indentedLine(colors.warning, row.resolution?.crosscheckProblem ?? ""),
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
  selected: boolean,
  actions: {
    readonly up: () => void;
    readonly down: () => void;
    readonly remove: () => void;
    readonly selectRow: () => void;
  },
): JSX.Element => {
  const model = row.model;
  const [hovered, setHovered] = createSignal(false);
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
      cell(cols.priority, () => String(row.priority), colors.faint),
      cell(cols.alias, () => row.alias, selected ? colors.cyan : colors.text),
      cell(cols.family, () => model?.family ?? "-", colors.text),
      cell(
        cols.rungs,
        () => (model === undefined || model.rungs.length === 0 ? "-" : rungsView(model.rungs)),
        colors.muted,
      ),
      modelCell(cols.model, () => row.ref, colors.text),
      costCell(
        cols.cost,
        () => (model === undefined ? "-" : formatCost(model.costInput, model.costOutput)),
        colors.muted,
      ),
      moveBadges({ colors, width: cols.move, onUp: actions.up, onDown: actions.down }),
      removeBadge({ colors, width: cols.remove, onRemove: actions.remove }),
    ),
  );
};

const section = (
  colors: Palette,
  caption: string | undefined,
  head: ReadonlyArray<JSX.Element>,
  body: JSX.Element,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column", width: "100%", gap: 1 },
    caption !== undefined ? h("text", { fg: colors.muted, wrapMode: "word" }, caption) : null,
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
    cell(cols.info, () => "Info", colors.blue),
    cell(cols.name, () => "Profile", colors.blue),
    modelCell(cols.model, () => "Model", colors.blue),
    cell(cols.effort, () => "Effort", colors.blue),
    costCell(cols.cost, () => "Cost", colors.blue),
  ],
  profileList: (
    colors: Palette,
    cols: LayoutMetrics["profileListColumns"],
  ): ReadonlyArray<JSX.Element> => [
    cell(cols.gutter, () => "", colors.blue),
    cell(cols.info, () => "Info", colors.blue),
    cell(cols.name, () => "Profile", colors.blue),
    cell(cols.kind, () => "Kind", colors.blue),
    cell(cols.status, () => "Status", colors.blue),
    modelCell(cols.summary, () => "When to use", colors.blue),
    cell(cols.remove, () => "Remove", colors.blue),
  ],
  entries: (colors: Palette, cols: LayoutMetrics["entryColumns"]): ReadonlyArray<JSX.Element> => [
    cell(cols.gutter, () => "", colors.blue),
    cell(cols.priority, () => "Priority", colors.blue),
    cell(cols.alias, () => "Alias", colors.blue),
    cell(cols.family, () => "Family", colors.blue),
    cell(cols.rungs, () => "Rungs", colors.blue),
    modelCell(cols.model, () => "Model", colors.blue),
    costCell(cols.cost, () => "Cost", colors.blue),
    cell(cols.move, () => "", colors.blue),
    cell(cols.remove, () => "Remove", colors.blue),
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
      wrapMode: "none",
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
      "The page writes nothing by itself. Press Enter to write spectre.json.",
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
  readonly selectedProfileListRow: () => number;
  readonly selectedEntryRow: () => number;
  readonly actions: (
    row: ProfileRow,
    index: number,
  ) => {
    readonly effort: () => void;
    readonly pin: () => void;
    readonly crosscheck: () => void;
    readonly info: () => void;
    readonly selectRow: () => void;
  };
  readonly profileListActions: (
    profile: Profile,
    index: number,
  ) => {
    readonly toggle: () => void;
    readonly info: () => void;
    readonly remove: () => void;
    readonly selectRow: () => void;
  };
  readonly entryActions: (
    row: EntryRow,
    index: number,
  ) => {
    readonly up: () => void;
    readonly down: () => void;
    readonly remove: () => void;
    readonly selectRow: () => void;
  };
}): JSX.Element => {
  const { colors, theme, metrics } = input;
  if (input.tab === "profiles") {
    const list = h(
      "box",
      { flexDirection: "column", width: "100%", gap: 1 },
      () =>
        input.draft.profiles.map((profile, index) =>
          profileListRow(
            colors,
            metrics.profileListColumns,
            profile,
            index === input.selectedProfileListRow(),
            input.profileListActions(profile, index),
          ),
        ),
      show(
        () => input.draft.profiles.length === 0,
        () => indentedLine(colors.muted, "No profiles yet"),
      ),
    );
    return section(
      colors,
      "Enable or disable default profiles, or add and remove custom profiles.",
      headerCells.profileList(colors, metrics.profileListColumns),
      list,
    );
  }
  if (input.tab === "allowlist") {
    const entries = h(
      "box",
      { flexDirection: "column", width: "100%", gap: 1 },
      () =>
        input.models.map((row, index) =>
          entryRow(
            colors,
            metrics.entryColumns,
            row,
            index === input.selectedEntryRow(),
            input.entryActions(row, index),
          ),
        ),
      show(
        () => input.models.length === 0,
        () => indentedLine(colors.muted, "No entries yet"),
      ),
    );
    return section(
      colors,
      "Priority is the explicit order. The resolver spends the first model that fits, from the top. K/J or the arrows move the selected entry.",
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
          metrics.profileColumns,
          row,
          index === input.selectedRow(),
          input.actions(row, index),
        ),
      ),
    show(
      () => input.rows.length === 0,
      () => indentedLine(colors.muted, "No profiles yet"),
    ),
  );
  return section(colors, undefined, headerCells.profiles(colors, metrics.profileColumns), profiles);
};

const TAB_DELTAS: Readonly<Record<string, number>> = { tab: 1, "]": 1, "[": -1 };
const ROW_DELTAS: Readonly<Record<string, number>> = { down: 1, j: 1, up: -1, k: -1 };

const stepTab = (current: TabId, delta: number): TabId => {
  const at = TABS.indexOf(current);
  const next = ((at === -1 ? 0 : at) + delta + TABS.length) % TABS.length;
  return TABS[next] ?? "configured";
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
    readonly moveModel?: (delta: -1 | 1) => void;
    readonly addModel?: () => void;
    readonly removeModel?: () => void;
    readonly toggleProfile?: () => void;
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
  if (key === "space" || event.sequence === " ") {
    event.preventDefault();
    actions.toggleProfile?.();
    return;
  }
  if (key === "+" || key === "kpplus" || event.sequence === "+" || (key === "=" && event.shift)) {
    event.preventDefault();
    actions.addModel?.();
    return;
  }
  if (
    key === "-" ||
    key === "kpminus" ||
    event.sequence === "-" ||
    key === "delete" ||
    key === "backspace" ||
    ((key === "x" || event.sequence === "x") && !event.ctrl && !event.meta && !event.super)
  ) {
    event.preventDefault();
    actions.removeModel?.();
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
  if (key === "K" || (key === "k" && event.shift)) {
    event.preventDefault();
    actions.moveModel?.(-1);
    return;
  }
  if (key === "J" || (key === "j" && event.shift)) {
    event.preventDefault();
    actions.moveModel?.(1);
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
  const activeTab: TabId = input.tab ?? "configured";
  const configuredRows = input.rows.filter((one) => isProfileEnabled(one.profile));
  const customProfiles = input.draft.profiles.filter(isCustomProfile);
  const [selectedRow, setSelectedRow] = createSignal(input.selectedRow ?? 0);
  const [selectedProfileListRow, setSelectedProfileListRow] = createSignal(0);
  const [selectedEntryRow, setSelectedEntryRow] = createSignal(0);
  const jevAvailable = input.jevAvailable ?? isJevAvailable(input.draft);
  const jevEnabled =
    jevAvailable && input.draft.judge !== undefined && input.draft.judge.kind !== "lexical";
  const jevModel = input.draft.judge?.model ?? JEV_MODEL;
  const providerAvailable = isProviderAvailable(input.draft.provider, input.catalogue);
  const usableModels = usableEntryRows(input.models, input.draft.provider);

  const metrics = layoutMetrics({
    terminalWidth: input.terminalWidth ?? context.renderer?.width ?? liveRenderer?.width,
    terminalHeight: input.terminalHeight ?? context.renderer?.height ?? liveRenderer?.height,
    rows: configuredRows,
    profiles: input.draft.profiles,
    models: usableModels,
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

  const openAddProfile = (): void => {
    run(() => addProfilePrompt({ dialog, draft: input.draft, models: input.catalogue }));
  };

  const removeEntryByAlias = (alias: string): void => {
    input.onChange(applied(input.draft, { kind: "remove-model", alias }));
  };

  const removeCustomProfileByName = (name: string): void => {
    input.onChange(applied(input.draft, { kind: "remove-profile", profile: name }));
  };

  const toggleProfileByName = (name: string): void => {
    input.onChange(applied(input.draft, { kind: "toggle-profile", profile: name }));
  };

  const triggerRemoveModel = (): void => {
    if (activeTab === "allowlist") {
      const row = usableModels[selectedEntryRow()] ?? usableModels[0];
      if (row !== undefined) {
        removeEntryByAlias(row.alias);
      }
      return;
    }
    run(() => removeModelPicker({ dialog, draft: input.draft, models: input.catalogue }));
  };

  const triggerRemoveProfile = (): void => {
    const selected = input.draft.profiles[selectedProfileListRow()];
    if (selected !== undefined && isCustomProfile(selected)) {
      removeCustomProfileByName(selected.name);
      return;
    }
    run(() => removeProfilePicker({ dialog, draft: input.draft }));
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

  const openProfileListInfo = (profile: Profile | undefined): void => {
    if (profile === undefined) return;
    const matched = configuredRows.find((one) => one.profile.name === profile.name);
    openProfileInfo({ profile, resolution: matched?.resolution });
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
        if (activeTab === "configured") {
          const next = stepRow(selectedRow(), configuredRows.length, delta);
          setSelectedRow(next);
          input.onRowChange?.(next);
          return;
        }
        if (activeTab === "profiles") {
          const next = stepRow(selectedProfileListRow(), input.draft.profiles.length, delta);
          setSelectedProfileListRow(next);
          return;
        }
        if (activeTab === "allowlist") {
          const next = stepRow(selectedEntryRow(), usableModels.length, delta);
          setSelectedEntryRow(next);
        }
      },
      moveModel: (delta) => {
        if (activeTab !== "allowlist") return;
        const row = usableModels[selectedEntryRow()];
        if (row !== undefined)
          input.onChange(applied(input.draft, { kind: "move-model", alias: row.alias, delta }));
      },
      addModel: activeTab === "profiles" ? openAddProfile : openAddModel,
      removeModel: activeTab === "profiles" ? triggerRemoveProfile : triggerRemoveModel,
      toggleProfile: () => {
        if (activeTab !== "profiles") return;
        const target = input.draft.profiles[selectedProfileListRow()];
        if (target !== undefined) toggleProfileByName(target.name);
      },
      openInfo: () => {
        if (activeTab === "configured") {
          openProfileInfo(configuredRows[selectedRow()]);
          return;
        }
        if (activeTab === "profiles") {
          openProfileListInfo(input.draft.profiles[selectedProfileListRow()]);
        }
      },
    }),
  );

  const actions = (row: ProfileRow, index: number) => ({
    effort: () =>
      run(() =>
        effortPicker({ dialog, draft: input.draft, models: input.catalogue, profile: row.profile }),
      ),
    pin: () =>
      run(() =>
        pinPicker({ dialog, draft: input.draft, models: input.catalogue, profile: row.profile }),
      ),
    crosscheck: () =>
      run(() =>
        crosscheckPicker({
          dialog,
          draft: input.draft,
          models: input.catalogue,
          profile: row.profile,
        }),
      ),
    info: () => openProfileInfo(row),
    selectRow: () => {
      setSelectedRow(index);
      input.onRowChange?.(index);
    },
  });

  const profileListActions = (profile: Profile, index: number) => ({
    toggle: () => toggleProfileByName(profile.name),
    info: () => openProfileListInfo(profile),
    remove: () => removeCustomProfileByName(profile.name),
    selectRow: () => {
      setSelectedProfileListRow(index);
    },
  });

  const entryActions = (row: EntryRow, index: number) => ({
    up: () =>
      input.onChange(applied(input.draft, { kind: "move-model", alias: row.alias, delta: -1 })),
    down: () =>
      input.onChange(applied(input.draft, { kind: "move-model", alias: row.alias, delta: 1 })),
    remove: () => removeEntryByAlias(row.alias),
    selectRow: () => {
      setSelectedEntryRow(index);
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
      rows: configuredRows,
      models: usableModels,
      catalogue: input.catalogue,
      draft: input.draft,
      selectedRow,
      selectedProfileListRow,
      selectedEntryRow,
      actions,
      profileListActions,
      entryActions,
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
        h("text", { fg: colors.teal, onMouseUp: close }, "Esc"),
      ),
      field(theme, "Config", () => input.source ?? "None yet"),
      show(
        () => input.loading === true,
        () => indentedLine(colors.muted, `Reading ${input.draft.directory}…`),
      ),
      show(
        () => input.loading !== true && input.source === undefined,
        () =>
          indentedLine(
            colors.warning,
            `No ${FILE_NAME} in ${input.draft.directory}. The page writes one when you save.`,
          ),
      ),
      show(
        () => input.draft.problems.length > 0,
        () =>
          h("box", { flexDirection: "column" }, () =>
            input.draft.problems.map((one) => indentedLine(colors.red, one)),
          ),
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
      configuredCount: configuredRows.length,
      profileCount: input.draft.profiles.length,
      allowCount: usableModels.length,
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
        { flexDirection: "row", gap: 3 },
        footerButton({
          key: "Enter",
          label: "Write it",
          hoverKeyColor: colors.green,
          textColor: colors.text,
          mutedColor: colors.muted,
          onPress: () => input.onSave(),
        }),
        show(
          () => activeTab === "profiles" && input.draft.profiles.length > 0,
          () =>
            footerButton({
              key: "Space",
              label: "Toggle",
              hoverKeyColor: colors.green,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: () => {
                const target = input.draft.profiles[selectedProfileListRow()];
                if (target !== undefined) toggleProfileByName(target.name);
              },
            }),
        ),
        show(
          () => activeTab === "profiles",
          () =>
            footerButton({
              key: "+",
              label: "Add profile",
              hoverKeyColor: colors.cyan,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: openAddProfile,
            }),
        ),
        show(
          () => activeTab !== "profiles",
          () =>
            footerButton({
              key: "+",
              label: "Add model",
              hoverKeyColor: colors.cyan,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: openAddModel,
            }),
        ),
        show(
          () => activeTab === "profiles" && customProfiles.length > 0,
          () =>
            footerButton({
              key: "-",
              label: "Remove profile",
              hoverKeyColor: colors.red,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: triggerRemoveProfile,
            }),
        ),
        show(
          () => activeTab !== "profiles" && usableModels.length > 0,
          () =>
            footerButton({
              key: "-",
              label: "Remove model",
              hoverKeyColor: colors.red,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: triggerRemoveModel,
            }),
        ),
        show(
          () => activeTab === "configured" && configuredRows.length > 0,
          () =>
            footerButton({
              key: "i",
              label: "Profile info",
              hoverKeyColor: colors.teal,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: () => openProfileInfo(configuredRows[selectedRow()]),
            }),
        ),
        show(
          () => activeTab === "profiles" && input.draft.profiles.length > 0,
          () =>
            footerButton({
              key: "i",
              label: "Profile info",
              hoverKeyColor: colors.teal,
              textColor: colors.text,
              mutedColor: colors.muted,
              onPress: () => openProfileListInfo(input.draft.profiles[selectedProfileListRow()]),
            }),
        ),
      ),
      footerButton({
        key: "Esc",
        label: "Close",
        hoverKeyColor: colors.red,
        textColor: colors.text,
        mutedColor: colors.muted,
        onPress: close,
      }),
    ),
  );
};
