import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import { applied, isProviderAvailable, providerPicker } from "./controls.tsx";
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
import { page, type TabId } from "./page.tsx";
import { h, show } from "./render.ts";

type Editable<Value> =
  Value extends ReadonlyArray<infer Item>
    ? Array<Editable<Item>>
    : Value extends object
      ? { -readonly [Key in keyof Value]: Editable<Value[Key]> }
      : Value;

type MutableDraft = Editable<Draft>;

const EMPTY: Draft = { provider: undefined, models: [], profiles: [] };

const PAGE = "Routing";

const DRAFT = "draft";
const SOURCE = "source";
const VIEW = "view";

const message = (problem: unknown): string =>
  problem instanceof Error ? problem.message : String(problem);

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

const assignDraft = (target: MutableDraft, source: MutableDraft): void => {
  target.provider = source.provider;
  target.judge = source.judge;
  target.models = source.models;
  target.profiles = source.profiles;
};

const absent = (name: string): Resolution => ({
  profile: name,
  ref: undefined,
  rung: undefined,
  cost: undefined,
  crosscheck: undefined,
  problem: "the resolver returned no row",
});

const refused = (model: Model | undefined): string | undefined => {
  if (model === undefined) return "this session cannot see the model";
  if (!model.enabled) return "the model is disabled";
  if (model.deprecated) return "the model is deprecated";
  return undefined;
};

const shortRef = (ref: string): string => {
  const slash = ref.indexOf("/");
  return slash === -1 ? ref : ref.slice(slash + 1);
};

const summaryOf = (rows: ReadonlyArray<Resolution>, open: boolean): string => {
  if (open) return "";
  const active = rows.filter((one) => one.problem === undefined && one.ref !== undefined).length;
  const bad = rows.filter((one) => one.problem !== undefined).length;
  const errors = bad > 0 ? `, ${bad} error${bad > 1 ? "s" : ""}` : "";
  return ` (${active} active${errors})`;
};

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
 * The layer is global because the palette is itself a mode. A command in the
 * base mode is not reachable while the palette dialog is open, and a command
 * nobody can reach is a command the palette does not list.
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

    const draft: MutableDraft = copy(stored);
    let activeTab: TabId = "profiles";
    let selectedRow = 0;

    const [revision, setRevision] = createSignal(0);

    const listed = (sessionID?: string) => {
      const location =
        (sessionID === undefined ? undefined : context.data.session.get(sessionID)?.location) ??
        context.location;
      return context.data.location.model.list(location) ?? [];
    };

    const persist = async (): Promise<void> => {
      const next = copy(draft);
      await setStored((held) => assignDraft(held, next)).catch(() => undefined);
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

    const onSave = (): void => {
      void persist();
    };

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
        onRowChange: (next) => {
          selectedRow = next;
        },
        onTabChange: (next) => {
          activeTab = next;
          showModal();
        },
        onChange: (next) => {
          onChange(next);
          showModal();
        },
        onProviderChange: (next) => {
          onChange(next);
          onSave();
          showModal();
        },
        onSave: () => {
          onSave();
          context.ui.dialog.clear();
        },
        onClose: () => context.ui.dialog.clear(),
        source: at,
      });
    };

    const showModal = (): void => {
      context.ui.dialog.show(() => renderModal());
      context.ui.dialog.set({ size: "xlarge", centered: true });
    };

    const openModal = (): void => {
      const models = catalogue(listed());
      if (!isProviderAvailable(draft.provider, models)) {
        void providerPicker({
          dialog: context.ui.dialog,
          draft,
          models,
        }).then((edit) => {
          if (edit !== undefined) {
            onChange(applied(draft, edit));
            onSave();
          }
          showModal();
        });
        return;
      }
      showModal();
    };

    context.ui.router.register({
      name: PAGE,
      render: renderModal,
    });

    context.keymap.layer(() => opener(openModal));

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
