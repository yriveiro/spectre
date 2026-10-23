import { Plugin } from "@opencode/plugin/tui";
import { type KeyEvent, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal, onCleanup, onMount } from "solid-js";
import {
  catalogue,
  type Draft,
  type Model,
  type Resolution,
  read,
  resolve,
  save,
  source as sourceOf,
} from "./data.ts";
import { page, TABS, type TabId } from "./page.tsx";
import { h, show } from "./render.ts";

/**
 * The terminal page that configures the routing.
 *
 * The plugin's own entrypoint is the server side, and it registers the tool
 * the session calls. This entrypoint is the terminal side, and it registers the
 * page a person opens when they want to change what the session spends.
 */

/** The draft, with the arrays the page changes. */
type Editable<Value> =
  Value extends ReadonlyArray<infer Item>
    ? Array<Editable<Item>>
    : Value extends object
      ? { -readonly [Key in keyof Value]: Editable<Value[Key]> }
      : Value;

type MutableDraft = Editable<Draft>;

/** The empty draft a repository with no config starts from. */
const EMPTY: Draft = { provider: undefined, models: [], profiles: [] };

/** The route name. The command opens this page by name. */
const PAGE = "Routing";

/** The storage keys. One holds the draft, one the directory, and one the sidebar collapse state. */
const DRAFT = "draft";
const SOURCE = "source";
const VIEW = "view";

/** The message of a value that reached the error channel. */
const message = (problem: unknown): string =>
  problem instanceof Error ? problem.message : String(problem);

/** A deep copy, so the page, the store and the writer never share an object. */
const copy = (draft: Draft): MutableDraft => ({
  provider: draft.provider,
  judge: draft.judge === undefined ? undefined : { ...draft.judge },
  // Storage returns whatever JSON it holds. A missing list is an empty one,
  // so one bad file cannot stop the plugin from loading.
  models: (Array.isArray(draft.models) ? draft.models : []).map((one) => ({
    alias: one.alias,
    ref: one.ref,
  })),
  profiles: (Array.isArray(draft.profiles) ? draft.profiles : []).map((one) => ({
    name: one.name,
    effort: one.effort,
    match: one.match,
    why: one.why,
    crosscheck:
      one.crosscheck === undefined
        ? undefined
        : { effort: one.crosscheck.effort, prefer: one.crosscheck.prefer },
    agent: one.agent,
    pinned: one.pinned,
  })),
});

/** Copies a draft's mutable fields into a target draft object. */
const assignDraft = (target: MutableDraft, source: MutableDraft): void => {
  target.provider = source.provider;
  target.judge = source.judge;
  target.models = source.models;
  target.profiles = source.profiles;
};

/** Cycles to the next or previous tab in the modal tab strip. */
const stepTab = (current: TabId, delta: number): TabId => {
  const at = TABS.indexOf(current);
  const next = ((at === -1 ? 0 : at) + delta + TABS.length) % TABS.length;
  return TABS[next] ?? "profiles";
};

/** Moves the selected profile row index with wraparound. */
const stepRow = (current: number, total: number, delta: number): number =>
  total <= 0 ? 0 : (current + delta + total) % total;

const TAB_DELTAS: Readonly<Record<string, number>> = { tab: 1, "]": 1, "[": -1 };
const ROW_DELTAS: Readonly<Record<string, number>> = { down: 1, j: 1, up: -1, k: -1 };

/** Handles one keypress while the routing modal is open. */
const dispatchModalKey = (
  event: KeyEvent,
  actions: {
    readonly saveAndClose: () => void;
    readonly close: () => void;
    readonly moveTab: (delta: number) => void;
    readonly moveRow: (delta: number) => void;
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
  const tabDelta = TAB_DELTAS[key] ?? (event.sequence ? TAB_DELTAS[event.sequence] : undefined);
  if (tabDelta !== undefined) {
    event.preventDefault();
    actions.moveTab(tabDelta);
    return;
  }
  const rowDelta = ROW_DELTAS[key];
  if (rowDelta !== undefined) actions.moveRow(rowDelta);
};

/** The row of a profile the resolver did not answer for. */
const absent = (name: string): Resolution => ({
  profile: name,
  ref: undefined,
  rung: undefined,
  cost: undefined,
  crosscheck: undefined,
  problem: "the resolver returned no row",
});

/** Why an allowlist entry cannot be spent, or undefined when it can. */
const refused = (model: Model | undefined): string | undefined => {
  if (model === undefined) return "this session cannot see the model";
  if (!model.enabled) return "the model is disabled";
  if (model.deprecated) return "the model is deprecated";
  return undefined;
};

/** Strips the provider prefix from a `providerID/modelID#variant` ref for the sidebar column. */
const shortRef = (ref: string): string => {
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
};

/** The collapsed summary beside the sidebar heading: `(3 active, 1 error)`. */
const summaryOf = (rows: ReadonlyArray<Resolution>, open: boolean): string => {
  if (open) return "";
  const active = rows.filter((one) => one.problem === undefined && one.ref !== undefined).length;
  const bad = rows.filter((one) => one.problem !== undefined).length;
  const errors = bad > 0 ? `, ${bad} error${bad > 1 ? "s" : ""}` : "";
  return ` (${active} active${errors})`;
};

/** One profile row inside the collapsible sidebar section. */
const sidebarRow = (
  theme: Plugin.Context["theme"],
  row: Resolution,
  onOpen: () => void,
): JSX.Element => {
  const failed = row.problem !== undefined;
  const errorColor = theme.text.feedback.error?.base ?? theme.text.feedback.warning.base;
  const dotColor = failed ? errorColor : (theme.text.feedback.success?.base ?? theme.text.base);
  const statusColor = failed ? errorColor : theme.text.muted;
  const right = failed ? "Error" : row.ref === undefined ? "-" : shortRef(row.ref);

  return h(
    "box",
    {
      flexDirection: "row",
      gap: 1,
      minWidth: 0,
      onMouseUp: onOpen,
    },
    h("text", { flexShrink: 0, fg: dotColor }, "•"),
    h(
      "text",
      {
        fg: theme.text.base,
        attributes: TextAttributes.BOLD,
        wrapMode: "none",
        truncate: true,
        flexGrow: 1,
        flexShrink: 1,
        minWidth: 0,
      },
      row.profile,
    ),
    h(
      "text",
      {
        fg: statusColor,
        wrapMode: "none",
        flexShrink: 0,
      },
      right,
    ),
  );
};

/** The collapsible Routing section in the session sidebar, modeled on OpenCode's MCP section. */
export const sidebarSection = (input: {
  readonly theme: Plugin.Context["theme"];
  readonly open: () => boolean;
  readonly onToggle: () => void;
  readonly onOpenModal: () => void;
  readonly rows: () => ReadonlyArray<Resolution>;
}): JSX.Element =>
  show(
    () => input.rows().length > 0,
    () =>
      h(
        "box",
        { flexDirection: "column" },
        h(
          "box",
          {
            flexDirection: "row",
            gap: 1,
            onMouseDown: input.onToggle,
          },
          h("text", { fg: input.theme.text.base }, () => (input.open() ? "▼" : "▶")),
          h(
            "box",
            { flexDirection: "row" },
            h("text", { fg: input.theme.text.base, attributes: TextAttributes.BOLD }, "Routing"),
            h("text", { fg: input.theme.text.muted }, () => summaryOf(input.rows(), input.open())),
          ),
        ),
        h(
          "box",
          { flexDirection: "column" },
          show(
            () => input.open(),
            () =>
              h("box", { flexDirection: "column" }, () =>
                input.rows().map((row) => sidebarRow(input.theme, row, input.onOpenModal)),
              ),
          ),
        ),
      ),
  );

/** Formats a session's model selection as `providerID/modelID` or `providerID/modelID#variant`. */
const sessionModelRef = (
  model:
    | { readonly providerID: string; readonly id: string; readonly variant?: string }
    | undefined,
): string | undefined => {
  if (model === undefined) return undefined;
  return model.variant === undefined
    ? `${model.providerID}/${model.id}`
    : `${model.providerID}/${model.id}#${model.variant}`;
};

/** Picks the profile index that matches the subagent's model or agent. */
const subagentProfileIndex = (
  profiles: ReadonlyArray<{ readonly name: string; readonly agent: string }>,
  resolutions: ReadonlyArray<Resolution>,
  sessionRef: string | undefined,
  agent: string | undefined,
): number => {
  if (sessionRef !== undefined) {
    const exact = resolutions.findIndex(
      (one, at) => one.ref === sessionRef && profiles[at]?.agent === agent,
    );
    if (exact !== -1) return exact;
    const byRef = resolutions.findIndex((one) => one.ref === sessionRef);
    if (byRef !== -1) return byRef;
  }
  const byAgent = profiles.findIndex((one) => one.agent === agent);
  return byAgent === -1 ? 0 : byAgent;
};

/** What the docked footer shows for a subagent session, or undefined on a main session. */
export const subagentLine = (input: {
  readonly session:
    | {
        readonly parentID?: string | null;
        readonly agent?: string;
        readonly model?: {
          readonly providerID: string;
          readonly id: string;
          readonly variant?: string;
        };
      }
    | undefined;
  readonly profiles: ReadonlyArray<{ readonly name: string; readonly agent: string }>;
  readonly resolutions: ReadonlyArray<Resolution>;
}): string | undefined => {
  if (!input.session?.parentID) return undefined;
  const sessionRef = sessionModelRef(input.session.model);
  const index = subagentProfileIndex(
    input.profiles,
    input.resolutions,
    sessionRef,
    input.session.agent,
  );
  const row = input.resolutions[index];
  const ref = sessionRef ?? row?.ref;
  if (ref === undefined) return undefined;

  const name = input.profiles[index]?.name ?? input.session.agent ?? "subagent";
  const cost = row?.cost !== undefined && row.ref === ref ? `, ${row.cost}` : "";
  return `${name} uses ${ref}${cost}`;
};

/** The docked footer bar above the composer, shown only on subagent sessions. */
export const subagentFooter = (input: {
  readonly theme: Plugin.Context["theme"];
  readonly line: () => string | undefined;
}): JSX.Element =>
  show(
    () => input.line() !== undefined,
    () =>
      h(
        "box",
        { flexDirection: "row", gap: 1, paddingLeft: 3, paddingRight: 3 },
        h("text", { fg: input.theme.text.faint }, "routing"),
        h("text", { fg: input.theme.text.base }, () => input.line() ?? ""),
      ),
  );

/**
 * The command that opens the page.
 *
 * The layer is global because the palette is itself a mode. A command in the
 * base mode is not reachable while the palette dialog is open, and a command
 * nobody can reach is a command the palette does not list. This page opens
 * from the palette, from the slash command, and from nowhere else, so it has
 * to be reachable in every mode. Measured in a terminal: without this line the
 * palette answered "No results found".
 *
 * It is a value rather than a closure over the setup, so a test can read it
 * without a host.
 */
export const opener = (open: () => void) => ({
  mode: "global" as const,
  commands: [
    {
      id: "spectre.routing.open",
      title: "Routing",
      description: "Open the page that configures model routing",
      group: "Spectre",
      palette: true as const,
      slash: { name: "routing" } as const,
      run: open,
    },
  ],
});

export default Plugin.define({
  id: "spectre.routing",
  setup: async (context) => {
    const directory = context.location?.directory ?? Bun.env.PWD ?? ".";

    // The draft survives a reload, so an edit is not lost when the terminal
    // restarts. The source key says which directory the draft belongs to,
    // because the terminal keeps one copy for every project.
    const [stored, setStored] = context.storage.store<MutableDraft>(DRAFT, {
      initial: { provider: undefined, models: [], profiles: [] },
    });
    const [source, setSource] = context.storage.store(SOURCE, {
      initial: { directory, seeded: false },
    });

    const [view, setView] = context.storage.store(VIEW, {
      initial: { open: true },
    });
    const [open, setOpen] = createSignal(view.open ?? true);

    // The name of the file the draft came from. The reader knows it and the
    // page does not, and the page names it in its heading.
    const at = await sourceOf(directory).catch(() => undefined);

    if (at !== undefined || !source.seeded || source.directory !== directory) {
      const found = await read(directory).catch((problem: unknown) => {
        context.ui.toast.show({
          title: "Routing",
          message: `the config could not be read: ${message(problem)}`,
          variant: "error",
        });
        return EMPTY;
      });
      const next = copy(found);
      await setStored((held) => assignDraft(held, next));
      await setSource((held) => {
        held.directory = directory;
        held.seeded = true;
      });
    }

    // The page changes this object in place. The entrypoint is the only place
    // that writes the file, so the page cannot save without asking.
    const draft: MutableDraft = copy(stored);
    let activeTab: TabId = "profiles";
    let selectedRow = 0;

    // The sidebar redraws when an edit lands, so its rows are never stale.
    const [revision, setRevision] = createSignal(0);

    /** The catalogue this session can see, read when a render needs it. */
    const listed = (sessionID?: string) => {
      const location =
        (sessionID === undefined ? undefined : context.data.session.get(sessionID)?.location) ??
        context.location;
      return context.data.location.model.list(location) ?? [];
    };

    /** The config as the page saves it. */
    const persist = async (): Promise<void> => {
      const next = copy(draft);
      try {
        await setStored((held) => assignDraft(held, next));
      } catch {
        // The file is the copy that matters. A storage write that fails does
        // not stop the save below.
      }
      setRevision((value) => value + 1);
      try {
        await save(directory, next);
        context.ui.toast.show({
          title: "Routing",
          message: "the config was written",
          variant: "success",
        });
      } catch (problem) {
        context.ui.toast.show({
          title: "Routing",
          message: message(problem),
          variant: "error",
        });
      }
    };

    /** The page calls this when the person asks to save. */
    const onSave = (): void => {
      void persist();
    };

    /**
     * A dialog changed the draft.
     *
     * The draft is the entrypoint's object, and the page hands the next one
     * back, so the change lands in the one the store and the writer read. The
     * revision moves so the composer line redraws with the change.
     */
    const onChange = (next: Draft): void => {
      assignDraft(draft, copy(next));
      setRevision((value) => value + 1);
    };

    const renderModal = () => {
      const models = catalogue(listed());
      const found = resolve(draft, models);

      const rows = draft.profiles.map((profile, atIndex) => ({
        profile,
        resolution: found[atIndex] ?? absent(profile.name),
      }));

      const allow = draft.models.map((one) => {
        const model = models.find((two) => {
          const head = `${two.providerID}/${two.id}`;
          return one.ref === head || one.ref.startsWith(`${head}#`);
        });
        return { alias: one.alias, ref: one.ref, model, problem: refused(model) };
      });

      return page({
        rows,
        models: allow,
        catalogue: models,
        draft,
        tab: activeTab,
        selectedRow,
        onTabChange: (next) => {
          activeTab = next;
          openModal();
        },
        onChange: (next) => {
          onChange(next);
          openModal();
        },
        onSave: () => {
          onSave();
          context.ui.dialog.clear();
        },
        onClose: () => context.ui.dialog.clear(),
        source: at,
      });
    };

    const openModal = (): void => {
      context.ui.dialog.show(() => {
        if (context.renderer?.keyInput) {
          const onKeyPress = (event: KeyEvent) =>
            dispatchModalKey(event, {
              saveAndClose: () => {
                onSave();
                context.ui.dialog.clear();
              },
              close: () => context.ui.dialog.clear(),
              moveTab: (delta) => {
                activeTab = stepTab(activeTab, delta);
                openModal();
              },
              moveRow: (delta) => {
                if (activeTab !== "profiles") return;
                selectedRow = stepRow(selectedRow, draft.profiles.length, delta);
                openModal();
              },
            });
          onMount(() => {
            context.renderer.keyInput.on("keypress", onKeyPress);
          });
          onCleanup(() => {
            context.renderer.keyInput.off("keypress", onKeyPress);
          });
        }
        return renderModal();
      });
      context.ui.dialog.set({ size: "large", centered: true });
    };

    context.ui.router.register({
      name: PAGE,
      render: renderModal,
    });

    context.keymap.layer(() => opener(openModal));

    /** The resolved profile rows for the session sidebar, recomputed when the draft changes. */
    const resolvedRows = (sessionID: string): ReadonlyArray<Resolution> => {
      revision();
      if (draft.profiles.length === 0) return [];
      const found = resolve(draft, catalogue(listed(sessionID)));
      return draft.profiles.map((profile, atIndex) => found[atIndex] ?? absent(profile.name));
    };

    context.ui.slot({
      append: "sidebar.content",
      render: (input) =>
        sidebarSection({
          theme: context.theme,
          open,
          onToggle: () => {
            const next = !open();
            setOpen(next);
            void setView((held) => {
              held.open = next;
            }).catch(() => undefined);
          },
          onOpenModal: () => openModal(),
          rows: () => resolvedRows(input.sessionID),
        }),
    });

    context.ui.slot({
      append: "session.composer.top",
      render: (input) =>
        subagentFooter({
          theme: context.theme,
          line: () =>
            subagentLine({
              session: context.data.session.get(input.sessionID),
              profiles: draft.profiles,
              resolutions: resolvedRows(input.sessionID),
            }),
        }),
    });
  },
});
