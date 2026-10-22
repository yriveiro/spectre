import { usePlugin } from "@opencode/plugin/tui";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { type RGBA, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { KNOWN_ORDER } from "../tools/definitions/routing/index.ts";
import { applied, type Edit, effortPicker, modelPicker, pinPicker, preview } from "./controls.tsx";
import type { Draft, Model, Profile, Resolution } from "./data.ts";
import { field, h, show } from "./render.ts";

/**
 * The page.
 *
 * Three tables: the profiles and what they resolve to, the allowlist, and the
 * catalogue. The catalogue is the largest and the least important, so it goes
 * last. The match line stands under the name, because it is the routing
 * surface, and a person who edits it reads it there.
 *
 * The page is a view. It reads no file and holds no draft. The entrypoint
 * hands the data through the props, and `onEdit` is the one action it takes
 * back: the write of the draft the dialogs have changed. The theme comes from
 * the plugin context, which the host gives every page it renders, so no prop
 * carries colour.
 *
 * The props may carry getters. The helpers in `render.ts` re-read one, so the
 * entrypoint can make this tree follow the draft store while a person edits
 * it. The page needs no knowledge of the store for that.
 */

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
  /**
   * The config file the draft came from. The entrypoint knows it, because it
   * read the file; the page cannot work it out.
   */
  readonly source?: string | undefined;
  /**
   * The draft the dialogs change. The page holds no draft of its own.
   */
  readonly draft: Draft;
  /**
   * A dialog changed the draft. The entrypoint holds it, so the page hands
   * the next one back and the entrypoint keeps it.
   */
  readonly onChange: (next: Draft) => void;
  /**
   * The write of the draft. The dialogs change the draft in the entrypoint;
   * a click passes it here, and the entrypoint writes it. The page carries
   * no writer of its own.
   */
  readonly onSave: () => void;
  /**
   * Dismiss the modal without writing.
   */
  readonly onClose?: () => void;
};

/**
 * The names the known order ranks, as plain strings for the sort below. The
 * catalogue gives every other name no rank, so the page sorts it by identity.
 */
const ORDER: ReadonlyArray<string> = KNOWN_ORDER;

/**
 * The rungs as a person reads them. The known order ranks the names it knows
 * and sorts them by rank. The names it cannot rank keep the order the
 * catalogue gave them, and they come after the ranked ones.
 */
const rungsView = (rungs: ReadonlyArray<string>): string => {
  const ranked = rungs
    .filter((one) => ORDER.includes(one))
    .sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
  const unranked = rungs.filter((one) => !ORDER.includes(one));
  return [...ranked, ...unranked].join(", ");
};

/**
 * The cost as one cell. A model with no cost says so in one word, because the
 * free model is the rung the cross-check prefers.
 */
const costView = (costInput: number, costOutput: number): string =>
  costInput === 0 && costOutput === 0 ? "free" : `$${costInput}/$${costOutput}`;

/** One column width, in cells. A header and its rows read the same number. */
const NAME = 12;
const EFFORT = 9;
const COST = 12;
const INDEX = 3;
const ALIAS = 16;
const PROVIDER = 16;
const FAMILY = 18;
const RUNGS = 20;

/** The indent of the lines that sit under a row. */
const INDENT = 2;

/** One cell of fixed width. The text that is too long for it is cut. */
const cell = (width: number, value: () => string, tone: RGBA): JSX.Element =>
  h("text", { width, fg: tone, truncate: true, wrapMode: "none" }, value);

/** One cell that takes what the row has left, after the fixed cells. */
const flexCell = (value: () => string, tone: RGBA): JSX.Element =>
  h("text", { fg: tone, flexGrow: 1, minWidth: 0, truncate: true, wrapMode: "none" }, value);

/** A cost cell, set against the right edge of its table. */
const costCell = (value: () => string, tone: RGBA): JSX.Element =>
  h("text", { fg: tone, wrapMode: "none" }, () => value().padStart(COST));

/** A line that says why a row failed, in warning, and is cut by the width. */
const problemLine = (theme: ResolvedTheme, problem: string): JSX.Element =>
  h(
    "box",
    { paddingLeft: INDENT, paddingRight: 1 },
    h("text", { fg: theme.text.feedback.warning.base, wrapMode: "word" }, problem),
  );

/**
 * One row of the profile table.
 *
 * The first line carries the requirement and the spend. A profile that names
 * its own ref is marked `pinned`, because the pin wins over the effort. The
 * match line stands under the name. The second opinion and the problem
 * follow, each on its own line and only when the resolver reaches one.
 */
const profileRow = (
  theme: ResolvedTheme,
  row: ProfileRow,
  actions: { readonly effort: () => void; readonly pin: () => void },
): JSX.Element => {
  const profile = row.profile;
  return h(
    "box",
    { flexDirection: "column" },
    h(
      "box",
      { flexDirection: "row", columnGap: 1 },
      h(
        "text",
        {
          width: NAME,
          fg: theme.text.base,
          truncate: true,
          wrapMode: "none",
          onMouseUp: actions.effort,
        },
        () => profile.name,
      ),
      h(
        "text",
        {
          width: EFFORT,
          fg: theme.text.base,
          truncate: true,
          wrapMode: "none",
          onMouseUp: actions.pin,
        },
        () => (profile.pinned !== undefined ? "pinned" : (profile.effort ?? "-")),
      ),
      flexCell(() => row.resolution?.ref ?? "-", theme.text.base),
      costCell(() => row.resolution?.cost ?? "-", theme.text.muted),
    ),
    show(
      () => profile.match !== undefined,
      () =>
        h(
          "text",
          { fg: theme.text.muted, wrapMode: "word", paddingLeft: INDENT },
          () => profile.match ?? "",
        ),
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
      () => problemLine(theme, row.resolution?.problem ?? ""),
    ),
  );
};

/**
 * One row of the allowlist table.
 *
 * The number is the position in the read order, and the order decides the
 * spend: the resolver reads the entries from the top and spends the first
 * model that fits. The catalogue's facts stand beside the ref, so one line
 * carries the entry and the model. A problem under the line says why the
 * entry cannot be spent, when the entrypoint knows one.
 */
const entryRow = (theme: ResolvedTheme, row: EntryRow, index: number): JSX.Element => {
  const model = row.model;
  return h(
    "box",
    { flexDirection: "column" },
    h(
      "box",
      { flexDirection: "row", columnGap: 1 },
      cell(INDEX, () => String(index + 1), theme.text.faint),
      cell(ALIAS, () => row.alias, theme.text.base),
      cell(FAMILY, () => model?.family ?? "-", theme.text.muted),
      cell(
        RUNGS,
        () => (model === undefined || model.rungs.length === 0 ? "-" : rungsView(model.rungs)),
        theme.text.muted,
      ),
      flexCell(() => row.ref, theme.text.base),
      costCell(
        () => (model === undefined ? "-" : costView(model.costInput, model.costOutput)),
        theme.text.muted,
      ),
    ),
    show(
      () => row.problem !== undefined,
      () => problemLine(theme, row.problem ?? ""),
    ),
  );
};

/** One row of the catalogue table: a model this session can see. */
const catalogueRow = (theme: ResolvedTheme, model: Model): JSX.Element =>
  h(
    "box",
    { flexDirection: "row", columnGap: 1 },
    cell(PROVIDER, () => model.providerID, theme.text.muted),
    flexCell(() => model.id, theme.text.base),
    cell(FAMILY, () => model.family ?? "-", theme.text.muted),
    cell(RUNGS, () => (model.rungs.length === 0 ? "-" : rungsView(model.rungs)), theme.text.muted),
    costCell(() => costView(model.costInput, model.costOutput), theme.text.muted),
  );

/**
 * One section of the page: its title, its caption, and its table. The caption
 * says what the table shows.
 */
const section = (
  theme: ResolvedTheme,
  title: string,
  caption: string,
  head: ReadonlyArray<JSX.Element>,
  body: JSX.Element,
): JSX.Element =>
  h(
    "box",
    { flexDirection: "column" },
    h("text", { fg: theme.text.base, attributes: TextAttributes.BOLD, paddingTop: 1 }, title),
    h("text", { fg: theme.text.muted, wrapMode: "word" }, caption),
    h("box", { flexDirection: "row", columnGap: 1, paddingTop: 1 }, head),
    body,
  );

/** The faint cells above a table. They read the widths its rows read. */
const headerCells = {
  profiles: (theme: ResolvedTheme): ReadonlyArray<JSX.Element> => [
    cell(NAME, () => "profile", theme.text.faint),
    cell(EFFORT, () => "effort", theme.text.faint),
    flexCell(() => "model", theme.text.faint),
    costCell(() => "cost", theme.text.faint),
  ],
  entries: (theme: ResolvedTheme): ReadonlyArray<JSX.Element> => [
    cell(INDEX, () => "", theme.text.faint),
    cell(ALIAS, () => "alias", theme.text.faint),
    cell(FAMILY, () => "family", theme.text.faint),
    cell(RUNGS, () => "rungs", theme.text.faint),
    flexCell(() => "model", theme.text.faint),
    costCell(() => "cost", theme.text.faint),
  ],
  catalogue: (theme: ResolvedTheme): ReadonlyArray<JSX.Element> => [
    cell(PROVIDER, () => "provider", theme.text.faint),
    flexCell(() => "model", theme.text.faint),
    cell(FAMILY, () => "family", theme.text.faint),
    cell(RUNGS, () => "rungs", theme.text.faint),
    costCell(() => "cost", theme.text.faint),
  ],
};

/** The line a table shows when it holds no rows. */
const noneYet = (theme: ResolvedTheme, says: string): JSX.Element =>
  h("box", { paddingLeft: INDENT, paddingRight: 1 }, h("text", { fg: theme.text.muted }, says));

export const page = (input: PageInput): JSX.Element => {
  const context = usePlugin();
  const theme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const dialog = context.ui.dialog;
  const close = () => {
    if (input.onClose) input.onClose();
    else dialog.clear();
  };

  /**
   * A dialog, and what happens when it answers.
   *
   * The answer is a change to the draft, and the draft belongs to the
   * entrypoint. The page hands the next one back and the entrypoint keeps it.
   * A dialog that stops says so in a toast, because a person who pressed a
   * row and saw nothing would press it again.
   */
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

  /** The two actions a profile row opens: its effort, and its pin. */
  const actions = (profile: Profile) => ({
    effort: () =>
      run(() => effortPicker({ dialog, draft: input.draft, models: input.catalogue, profile })),
    pin: () => run(() => pinPicker({ dialog, draft: input.draft, profile })),
  });

  const profiles = h(
    "box",
    { flexDirection: "column" },
    () => input.rows.map((row) => profileRow(theme, row, actions(row.profile))),
    show(
      () => input.rows.length === 0,
      () => noneYet(theme, "no profiles yet"),
    ),
  );

  const entries = h(
    "box",
    { flexDirection: "column" },
    () => input.models.map((row, index) => entryRow(theme, row, index)),
    show(
      () => input.models.length === 0,
      () => noneYet(theme, "no entries yet"),
    ),
    h(
      "text",
      {
        fg: theme.text.muted,
        paddingLeft: INDENT,
        onMouseUp: () =>
          run(() => modelPicker({ dialog, draft: input.draft, models: input.catalogue })),
      },
      "add a model to the allowlist",
    ),
  );

  const catalogue = h(
    "box",
    { flexDirection: "column" },
    () => input.catalogue.map((model) => catalogueRow(theme, model)),
    show(
      () => input.catalogue.length === 0,
      () => noneYet(theme, "no models"),
    ),
  );

  // The scrollbox takes the space the heading and the write line leave. The
  // page focuses it, so the up and down keys scroll it, and the mouse wheel
  // scrolls it with or without focus.
  const tables = h(
    "scrollbox",
    {
      height: 16,
      flexGrow: 1,
      minHeight: 0,
      contentOptions: { flexDirection: "column" },
      focused: () => true,
    },
    section(
      theme,
      "Profiles",
      "the requirement each profile names, and the model the resolver would spend on it",
      headerCells.profiles(theme),
      profiles,
    ),
    section(
      theme,
      "Allowlist",
      "the resolver reads the entries from the top and spends the first model that fits",
      headerCells.entries(theme),
      entries,
    ),
    section(
      theme,
      "Catalogue",
      "every model this session can see, with its ladder and its cost",
      headerCells.catalogue(theme),
      catalogue,
    ),
  );

  return h(
    "box",
    {
      flexDirection: "column",
      flexGrow: 1,
      minWidth: 0,
      minHeight: 0,
      paddingLeft: 2,
      paddingRight: 2,
      paddingBottom: 1,
      gap: 1,
    },
    h(
      "box",
      { flexDirection: "column", flexShrink: 0 },
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between" },
        h("text", { fg: theme.text.base, attributes: TextAttributes.BOLD }, "Routing"),
        h("text", { fg: theme.text.muted, onMouseUp: close }, "esc"),
      ),
      show(
        () => input.source !== undefined || (input.rows.length === 0 && input.models.length === 0),
        () => field(theme, "config", () => input.source ?? "none yet"),
      ),
    ),
    tables,
    h(
      "box",
      {
        flexDirection: "column",
        flexShrink: 0,
        paddingLeft: 1,
        paddingRight: 1,
        backgroundColor: theme.background?.raised.base,
      },
      preview({ theme, draft: input.draft, models: input.catalogue }),
    ),
    h(
      "box",
      { flexDirection: "column", flexShrink: 0 },
      h(
        "text",
        { fg: theme.text.muted, wrapMode: "word" },
        "the page writes nothing by itself. A click writes the draft to the config file.",
      ),
      h(
        "box",
        { flexDirection: "row", gap: 2, paddingTop: 1 },
        h(
          "text",
          { fg: theme.text.base, onMouseUp: () => input.onSave() },
          "enter ",
          h("span", { style: { fg: theme.text.muted } }, "write it"),
        ),
        h(
          "text",
          {
            fg: theme.text.base,
            onMouseUp: () =>
              run(() => modelPicker({ dialog, draft: input.draft, models: input.catalogue })),
          },
          "+ ",
          h("span", { style: { fg: theme.text.muted } }, "add model"),
        ),
        h(
          "text",
          { fg: theme.text.base, onMouseUp: close },
          "esc ",
          h("span", { style: { fg: theme.text.muted } }, "close"),
        ),
      ),
    ),
  );
};
