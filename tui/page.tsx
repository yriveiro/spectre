import { usePlugin } from "@opencode/plugin/tui";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { type RGBA, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import { KNOWN_ORDER } from "../tools/definitions/routing/index.ts";
import {
  applied,
  type Edit,
  effortPicker,
  isJevAvailable,
  JEV_MODEL,
  modelPicker,
  pinPicker,
  preview,
} from "./controls.tsx";
import type { Draft, Model, Profile, Resolution } from "./data.ts";
import { field, h, type Palette, palette, show } from "./render.ts";

/**
 * The page.
 *
 * The modal organises routing configuration into three tabs (`Profiles`,
 * `Allowlist`, `Preview`), with a header that shows the config file and a
 * radio toggle for the Jev System One judge.
 */

/** The three tabs of the routing modal. */
export type TabId = "profiles" | "allowlist" | "preview";

export const TABS: ReadonlyArray<TabId> = ["profiles", "allowlist", "preview"];

/** One profile and what it resolves to under the draft the page shows. */
export type ProfileRow = {
  readonly profile: Profile;
  /** The resolution the resolver reached, or nothing while it works. */
  readonly resolution: Resolution | undefined;
};

/** One allowlist entry, in the read order, with the catalogue's facts. */
export type EntryRow = {
  readonly alias: string;
  readonly ref: string;
  /** Nothing when the catalogue holds no model for the ref. */
  readonly model: Model | undefined;
  /** Why the entry cannot be spent, when the entrypoint knows one. */
  readonly problem?: string | undefined;
};

/** The page's inputs. Each one comes from the entrypoint. */
export type PageInput = {
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly models: ReadonlyArray<EntryRow>;
  readonly catalogue: ReadonlyArray<Model>;
  readonly source?: string | undefined;
  readonly draft: Draft;
  readonly tab?: TabId | undefined;
  readonly onTabChange?: ((tab: TabId) => void) | undefined;
  readonly selectedRow?: number | undefined;
  readonly jevAvailable?: boolean | undefined;
  readonly onChange: (next: Draft) => void;
  readonly onSave: () => void;
  readonly onClose?: () => void;
};

const ORDER: ReadonlyArray<string> = KNOWN_ORDER;

/** The rungs sorted by the known order, followed by any unranked names. */
const rungsView = (rungs: ReadonlyArray<string>): string => {
  const ranked = rungs
    .filter((one) => ORDER.includes(one))
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const unranked = rungs.filter((one) => !ORDER.includes(one));
  return [...ranked, ...unranked].join(", ");
};

/** The cost as one cell. */
const costView = (costInput: number, costOutput: number): string =>
  costInput === 0 && costOutput === 0 ? "free" : `$${costInput}/$${costOutput}`;

/** True when a resolved cost line names a rate of $1 or more per million tokens. */
const isExpensiveCost = (cost: string | undefined): boolean => {
  if (cost === undefined) return false;
  for (const match of cost.matchAll(/\$(\d+(?:\.\d+)?)/g)) {
    if (Number(match[1]) >= 1) return true;
  }
  return false;
};

/** Column widths, in cells. */
const GUTTER = 2;
const NAME = 11;
const EFFORT = 12;
const COST = 19;
const INDEX = 3;
const ALIAS = 14;
const FAMILY = 14;
const RUNGS = 18;
const ALLOW_COST = 12;
const INDENT = 2;

const cell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h("text", { width, fg: tone, truncate: true, wrapMode: "none" }, value);

const flexCell = (value: () => string, tone: RGBA): JSX.Element =>
  h("text", { fg: tone, flexGrow: 1, minWidth: 0, truncate: true, wrapMode: "none" }, value);

const costCell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h("text", { width, flexShrink: 0, fg: tone, wrapMode: "none" }, () => value().padStart(width));

const indentedLine = (tone: RGBA, text: string): JSX.Element =>
  h(
    "box",
    { paddingLeft: INDENT, paddingRight: 1 },
    h("text", { fg: tone, wrapMode: "word" }, text),
  );

/** A TUI-styled select dropdown cell with an inset surface and cyan chevron. */
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

/** The Jev System One judge radio/toggle row in the modal header. */
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

/** The horizontal tab bar for switching between Profiles, Allowlist, and Preview. */
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
      paddingLeft: 2,
      paddingRight: 2,
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
    h("text", { fg: input.colors.faint, wrapMode: "none" }, "[/] tabs"),
  );
};

/** One row of the profile table. */
const profileRow = (
  colors: Palette,
  theme: ResolvedTheme,
  row: ProfileRow,
  selected: boolean,
  actions: { readonly effort: () => void; readonly pin: () => void },
): JSX.Element => {
  const profile = row.profile;
  const [hovered, setHovered] = createSignal(false);
  const costTone = isExpensiveCost(row.resolution?.cost) ? colors.yellow : colors.muted;
  const effort = profile.pinned !== undefined ? "pinned" : (profile.effort ?? "-");
  const ref = row.resolution?.ref ?? "-";
  const nameProps = {
    width: NAME,
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
      backgroundColor: () => (hovered() ? colors.rowHoverBg : undefined),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
    },
    h(
      "box",
      { flexDirection: "row", columnGap: 1 },
      cell(GUTTER, () => (selected ? "▸" : " "), colors.cyan),
      h("text", nameProps, () => profile.name),
      selectControl({ colors, width: EFFORT, value: effort, onOpen: actions.effort }),
      selectControl({ colors, flexGrow: 1, value: ref, onOpen: actions.pin }),
      costCell(COST, () => row.resolution?.cost ?? "-", costTone),
    ),
    show(
      () => profile.match !== undefined,
      () => indentedLine(colors.muted, profile.match ?? ""),
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

/** One row of the allowlist table. */
const entryRow = (colors: Palette, row: EntryRow, index: number): JSX.Element => {
  const model = row.model;
  const [hovered, setHovered] = createSignal(false);
  return h(
    "box",
    {
      flexDirection: "column",
      backgroundColor: () => (hovered() ? colors.rowHoverBg : undefined),
      onMouseOver: () => setHovered(true),
      onMouseOut: () => setHovered(false),
    },
    h(
      "box",
      { flexDirection: "row", columnGap: 1 },
      cell(INDEX, () => String(index + 1), colors.faint),
      cell(ALIAS, () => row.alias, colors.text),
      cell(FAMILY, () => model?.family ?? "-", colors.text),
      cell(
        RUNGS,
        () => (model === undefined || model.rungs.length === 0 ? "-" : rungsView(model.rungs)),
        colors.muted,
      ),
      flexCell(() => row.ref, colors.text),
      costCell(
        ALLOW_COST,
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

/** One section of a tab: its caption, its underlined header row, and its table body. */
const section = (
  colors: Palette,
  caption: string,
  head: ReadonlyArray<JSX.Element>,
  body: JSX.Element,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column" },
    h("text", { fg: colors.muted, wrapMode: "word" }, caption),
    h(
      "box",
      {
        flexDirection: "row",
        columnGap: 1,
        paddingTop: 1,
        border: ["bottom"],
        borderColor: colors.border,
      },
      head,
    ),
    body,
  );

/** The accent-blue column headers above each table. */
const headerCells = {
  profiles: (colors: Palette): ReadonlyArray<JSX.Element> => [
    cell(GUTTER, () => "", colors.blue),
    cell(NAME, () => "profile", colors.blue),
    cell(EFFORT, () => "effort", colors.blue),
    flexCell(() => "model", colors.blue),
    costCell(COST, () => "cost", colors.blue),
  ],
  entries: (colors: Palette): ReadonlyArray<JSX.Element> => [
    cell(INDEX, () => "#", colors.blue),
    cell(ALIAS, () => "alias", colors.blue),
    cell(FAMILY, () => "family", colors.blue),
    cell(RUNGS, () => "rungs", colors.blue),
    flexCell(() => "model", colors.blue),
    costCell(ALLOW_COST, () => "cost", colors.blue),
  ],
};

/** One action button in the footer bar, with a bold key and hover highlight. */
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

/** Renders the syntax-highlighted JSON preview tab body. */
const previewTab = (
  colors: Palette,
  theme: ResolvedTheme,
  draft: Draft,
  catalogue: ReadonlyArray<Model>,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column", gap: 1 },
    h(
      "box",
      {
        flexDirection: "column",
        border: true,
        borderStyle: "rounded",
        borderColor: colors.border,
        backgroundColor: colors.insetBg,
        paddingLeft: 1,
        paddingRight: 1,
      },
      preview({ theme, draft, models: catalogue }),
    ),
    h(
      "text",
      { fg: colors.muted, wrapMode: "word" },
      "the page writes nothing by itself. A click writes the draft to the config file.",
    ),
  );

/** Renders the active tab body inside the modal's scrollable area. */
const activeTabBody = (input: {
  readonly tab: TabId;
  readonly colors: Palette;
  readonly theme: ResolvedTheme;
  readonly rows: ReadonlyArray<ProfileRow>;
  readonly models: ReadonlyArray<EntryRow>;
  readonly catalogue: ReadonlyArray<Model>;
  readonly draft: Draft;
  readonly selectedRow: number;
  readonly actions: (profile: Profile) => { readonly effort: () => void; readonly pin: () => void };
}): JSX.Element => {
  const { colors, theme } = input;
  if (input.tab === "allowlist") {
    const entries = h(
      "box",
      { flexDirection: "column" },
      () => input.models.map((row, index) => entryRow(colors, row, index)),
      show(
        () => input.models.length === 0,
        () => indentedLine(colors.muted, "no entries yet"),
      ),
    );
    return section(
      colors,
      "the resolver reads the entries from the top and spends the first model that fits",
      headerCells.entries(colors),
      entries,
    );
  }
  if (input.tab === "preview") {
    return previewTab(colors, theme, input.draft, input.catalogue);
  }
  const profiles = h(
    "box",
    { flexDirection: "column" },
    () =>
      input.rows.map((row, index) =>
        profileRow(colors, theme, row, index === input.selectedRow, input.actions(row.profile)),
      ),
    show(
      () => input.rows.length === 0,
      () => indentedLine(colors.muted, "no profiles yet"),
    ),
  );
  return section(
    colors,
    "the requirement each profile names, and the model the resolver would spend on it",
    headerCells.profiles(colors),
    profiles,
  );
};

export const page = (input: PageInput): JSX.Element => {
  const context = usePlugin();
  const theme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const colors = palette(context.theme, theme);
  const dialog = context.ui.dialog;
  const activeTab: TabId = input.tab ?? "profiles";
  const selectedRow = input.selectedRow ?? 0;
  const jevAvailable = input.jevAvailable ?? isJevAvailable(input.draft);
  const jevEnabled =
    jevAvailable && input.draft.judge !== undefined && input.draft.judge.kind !== "lexical";
  const jevModel = input.draft.judge?.model ?? JEV_MODEL;

  const close = () => {
    if (input.onClose) input.onClose();
    else dialog.clear();
  };

  const run = (open: () => Promise<Edit | undefined>): void => {
    void open().then(
      (edit) => {
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

  const actions = (profile: Profile) => ({
    effort: () =>
      run(() => effortPicker({ dialog, draft: input.draft, models: input.catalogue, profile })),
    pin: () => run(() => pinPicker({ dialog, draft: input.draft, profile })),
  });

  const body = h(
    "scrollbox",
    {
      height: 18,
      flexGrow: 1,
      minHeight: 0,
      paddingLeft: 2,
      paddingRight: 2,
      paddingTop: 1,
      contentOptions: { flexDirection: "column", gap: 1 },
      focused: () => true,
    },
    activeTabBody({
      tab: activeTab,
      colors,
      theme,
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
        flexShrink: 0,
        paddingLeft: 2,
        paddingRight: 2,
        border: ["bottom"],
        borderColor: colors.border,
      },
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between" },
        h("text", { fg: colors.text, attributes: TextAttributes.BOLD }, "Routing"),
        h("text", { fg: colors.teal, onMouseUp: close }, "esc"),
      ),
      show(
        () => input.source !== undefined || (input.rows.length === 0 && input.models.length === 0),
        () => field(theme, "config", () => input.source ?? "none yet"),
      ),
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
        flexShrink: 0,
        backgroundColor: colors.insetBg,
        border: ["top"],
        borderColor: colors.border,
        paddingLeft: 2,
        paddingRight: 2,
      },
      h(
        "box",
        { flexDirection: "row", gap: 3 },
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
          onPress: () =>
            run(() => modelPicker({ dialog, draft: input.draft, models: input.catalogue })),
        }),
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
