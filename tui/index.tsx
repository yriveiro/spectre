import { Plugin } from "@opencode/plugin/tui";
import { TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import { FILE_NAME } from "../tools/definitions/routing/index.ts";
import { applied, isProviderAvailable, providerPicker, usableDraft } from "./controls.tsx";
import {
  catalogue,
  configuredProfiles,
  type Draft,
  defaultProfiles,
  directoryOf,
  effortDots,
  normalizeCost,
  type Resolution,
  read,
  resolve,
  save,
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

const PAGE = "Routing";

const VIEW = "view";

const message = (problem: unknown): string =>
  problem instanceof Error ? problem.message : String(problem);

/** The state of a directory with no config yet, or one that is still loading. */
const empty = (directory: string): Draft => ({
  directory,
  source: undefined,
  problems: [],
  provider: undefined,
  models: [],
  profiles: defaultProfiles(true),
});

const copy = (draft: Draft): MutableDraft => ({
  directory: draft.directory,
  source: draft.source,
  problems: [...draft.problems],
  provider: draft.provider,
  judge: draft.judge === undefined ? undefined : { ...draft.judge },
  models: (Array.isArray(draft.models) ? draft.models : []).map((one) => ({
    alias: one.alias,
    ref: one.ref,
  })),
  profiles: (Array.isArray(draft.profiles) && draft.profiles.length > 0
    ? draft.profiles
    : defaultProfiles(true)
  ).map((one) => ({
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
    enabled: one.enabled,
  })),
});

const assignDraft = (target: MutableDraft, source: MutableDraft): void => {
  target.directory = source.directory;
  target.source = source.source;
  target.problems = [...source.problems];
  target.provider = source.provider;
  target.judge = source.judge;
  target.models = source.models;
  target.profiles = source.profiles;
};

const absent = (name: string): Resolution => ({
  profile: name,
  alias: undefined,
  ref: undefined,
  rung: undefined,
  cost: undefined,
  crosscheck: undefined,
  crosscheckProblem: undefined,
  problem: "The resolver returned no row",
});

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
  const aliasText = failed ? "Error" : (row.alias ?? row.ref ?? "-");
  const dots = failed ? "" : effortDots(row.rung);

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
      aliasText,
    ),
    h(
      "text",
      {
        fg: statusColor,
        wrapMode: "none",
        flexShrink: 0,
      },
      dots,
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
  // A profile that did not resolve has no model to show. Reporting the model
  // the child inherited would name the parent's choice as this profile's.
  if (row?.problem !== undefined) return "Error";
  const ref = sessionRef ?? row?.ref;
  if (ref === undefined) return undefined;

  const name = input.profiles[index]?.name ?? input.session.agent ?? "subagent";
  const matched = row?.ref === ref;
  const aliasText = matched ? (row?.alias ?? ref) : ref;
  const dots = matched ? effortDots(row?.rung) : effortDots(input.session.model?.variant);
  const normalizedCost = normalizeCost(row?.cost);
  const cost = normalizedCost !== undefined && matched ? `, ${normalizedCost}` : "";
  return `${name} ${aliasText} ${dots}${cost}`;
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
        h("text", { fg: input.theme.text.faint }, "Routing"),
        h("text", { fg: input.theme.text.base }, () => input.line() ?? ""),
      ),
  );

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
    const defaultDirectory = context.data.location.default().directory;
    const initial = context.location?.directory ?? defaultDirectory;

    const [view, setView] = context.storage.store(VIEW, {
      initial: { open: true },
    });
    const [open, setOpen] = createSignal(view.open ?? true);

    // Drafts read in this generation, keyed by directory. A TUI that renders
    // two sessions in two worktrees must not re-read a file on every render,
    // and must never answer with the other directory's models.
    const cache = new Map<string, Draft>();
    let current: string | undefined;
    let draft: MutableDraft = copy(empty(initial));
    let loading: string | undefined;
    let inflight: Promise<void> | undefined;
    let modalOpen = false;

    const [revision, setRevision] = createSignal(0);

    /** Make one directory's draft the active one, keeping the edits of the last. */
    const adopt = (next: Draft, notify = true): void => {
      if (current !== undefined && current === draft.directory) cache.set(current, copy(draft));
      draft = copy(next);
      current = next.directory;
      if (notify) setRevision((value) => value + 1);
    };

    /** The session the modal was opened over, when the route is one. */
    const routeSession = (): string | undefined => {
      const route = context.ui.router.current();
      return route.type === "session" ? route.sessionID : undefined;
    };

    /** The session's directory, or the TUI's own default location when no session is open. */
    const directoryFor = (sessionID?: string): string =>
      directoryOf({
        sessionID,
        session: (id) => context.data.session.get(id),
        route: context.ui.router.current(),
        location: context.location,
        fallback: defaultDirectory,
      });

    /** Read one directory into the cache, once. A second caller joins the read. */
    const ensure = async (target: string): Promise<void> => {
      if (current === target) return;
      const cached = cache.get(target);
      if (cached !== undefined) {
        adopt(cached);
        return;
      }
      if (loading === target && inflight !== undefined) return inflight;
      loading = target;
      inflight = read(target)
        .then((found) => {
          // Cache it even when a later read has taken over: the directory was
          // read, and the next render for it must not read it again.
          cache.set(target, found);
          if (loading !== target) return;
          loading = undefined;
          adopt(found);
          if (modalOpen) showModal();
        })
        .catch((problem: unknown) => {
          // The previous directory's models are not this directory's answer.
          const blank = empty(target);
          cache.set(target, blank);
          if (loading !== target) return;
          loading = undefined;
          adopt(blank);
          context.ui.toast.show({
            title: "Routing",
            message: `The config could not be read: ${message(problem)}`,
            variant: "error",
          });
        });
      return inflight;
    };

    /**
     * The draft for this session's directory. A directory the page has not read
     * is loaded now, and the render after the load shows it. Until then this
     * returns an empty draft, never another directory's models.
     */
    const hold = (sessionID?: string): Draft => {
      const target = directoryFor(sessionID);
      if (current === target) return draft;
      const cached = cache.get(target);
      if (cached !== undefined) {
        adopt(cached, false);
        return draft;
      }
      void ensure(target);
      return empty(target);
    };

    let activeTab: TabId = "configured";
    let selectedRow = 0;

    const listed = (sessionID?: string) => {
      const location =
        (sessionID === undefined ? undefined : context.data.session.get(sessionID)?.location) ??
        context.location;
      return context.data.location.model.list(location) ?? [];
    };

    const persist = async (): Promise<void> => {
      const models = catalogue(listed());
      const next = copy(usableDraft(draft, models));
      assignDraft(draft, next);
      setRevision((value) => value + 1);
      try {
        await save(next);
        // The writer decoded the whole file before it wrote, and the canonical
        // name is the one the reader takes next. The read problems described
        // the file that is now gone.
        draft.source = `${next.directory}/${FILE_NAME}`;
        draft.problems = [];
        cache.set(next.directory, copy(draft));
        setRevision((value) => value + 1);
        context.ui.toast.show({
          title: "Routing",
          message: "The config was written",
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
      const target = directoryFor(routeSession());
      const models = catalogue(listed(routeSession()));
      const clean = usableDraft(hold(routeSession()), models);
      const active = configuredProfiles(clean);
      const found = resolve(clean, models);

      const rows = active.map((profile, atIndex) => ({
        profile,
        resolution: found[atIndex] ?? absent(profile.name),
      }));

      const allow = clean.models.map((one) => {
        const model = models.find((two) => {
          const head = `${two.providerID}/${two.id}`;
          return one.ref === head || one.ref.startsWith(`${head}#`);
        });
        return { alias: one.alias, ref: one.ref, model };
      });

      return page({
        rows,
        models: allow,
        catalogue: models,
        draft: clean,
        tab: activeTab,
        selectedRow,
        loading: loading === target,
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
        source: clean.source,
      });
    };

    let modalGeneration = 0;

    const showModal = (): void => {
      modalOpen = true;
      // Replacing a shown dialog calls the previous close callback. The
      // generation keeps the new dialog from being marked closed by it.
      const generation = ++modalGeneration;
      context.ui.dialog.show(
        () => renderModal(),
        () => {
          if (generation === modalGeneration) modalOpen = false;
        },
      );
      context.ui.dialog.set({ size: "xlarge", centered: true });
    };

    const openModal = async (): Promise<void> => {
      // The session may have moved since the draft was read. Read the new
      // directory before the modal decides whether a provider is available, so
      // the page never offers a choice over the directory the session left.
      await ensure(directoryFor(routeSession()));
      const models = catalogue(listed(routeSession()));
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
      // A directory still being read has no answer yet. Hiding the section for
      // that frame is honest; seven error rows would not be.
      const target = directoryFor(sessionID);
      if (current !== target && !cache.has(target)) {
        void ensure(target);
        return [];
      }
      const models = catalogue(listed(sessionID));
      const clean = usableDraft(hold(sessionID), models);
      const active = configuredProfiles(clean);
      if (active.length === 0) return [];
      const found = resolve(clean, models);
      return active.map((profile, atIndex) => found[atIndex] ?? absent(profile.name));
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
              profiles: configuredProfiles(hold(input.sessionID)),
              resolutions: resolvedRows(input.sessionID),
            }),
        }),
    });
  },
});
