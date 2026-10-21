import { Plugin } from "@opencode/plugin/tui";
import { createSignal } from "solid-js";
import {
  catalogue,
  type Draft,
  type Model,
  type Resolution,
  read,
  resolve,
  save,
  source as sourceOf,
} from "./data";
import { page } from "./page";
import { h } from "./render";

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

/** The storage keys. One holds the draft, the other the directory it came from. */
const DRAFT = "draft";
const SOURCE = "source";

/** The message of a value that reached the error channel. */
const message = (problem: unknown): string =>
  problem instanceof Error ? problem.message : String(problem);

/** A deep copy, so the page, the store and the writer never share an object. */
const copy = (draft: Draft): MutableDraft => ({
  provider: draft.provider,
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

/** One line of the composer: the profile, the spend, or the problem. */
type Line = { readonly body: string; readonly problem: boolean };

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

    // The name of the file the draft came from. The reader knows it and the
    // page does not, and the page names it in its heading.
    const at = await sourceOf(directory).catch(() => undefined);

    if (!source.seeded || source.directory !== directory) {
      const found = await read(directory).catch((problem: unknown) => {
        context.ui.toast.show({
          title: "Routing",
          message: `the config could not be read: ${message(problem)}`,
          variant: "error",
        });
        return EMPTY;
      });
      const next = copy(found);
      await setStored((held) => {
        held.provider = next.provider;
        held.models = next.models;
        held.profiles = next.profiles;
      });
      await setSource((held) => {
        held.directory = directory;
        held.seeded = true;
      });
    }

    // The page changes this object in place. The entrypoint is the only place
    // that writes the file, so the page cannot save without asking.
    const draft: MutableDraft = copy(stored);

    // The composer redraws when an edit lands, so its line is never stale.
    const [revision, setRevision] = createSignal(0);

    /** The catalogue this session can see, read when a render needs it. */
    const listed = () => context.data.location.model.list(context.location) ?? [];

    /** The config as the page saves it. */
    const persist = async (): Promise<void> => {
      const next = copy(draft);
      try {
        await setStored((held) => {
          held.provider = next.provider;
          held.models = next.models;
          held.profiles = next.profiles;
        });
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
      const held = copy(next);
      draft.provider = held.provider;
      draft.models = held.models;
      draft.profiles = held.profiles;
      setRevision((value) => value + 1);
    };

    context.ui.router.register({
      name: PAGE,
      render: () => {
        const models = catalogue(listed());
        const found = resolve(draft, models);

        // The profile table joins the profile the page edits to the row the
        // resolver answered, so an edit and its consequence sit on one line.
        const rows = draft.profiles.map((profile, at) => ({
          profile,
          resolution: found[at] ?? absent(profile.name),
        }));

        // The allowlist table joins an alias to the catalogue row its ref
        // names. The page shows the family, the rungs and the cost from there.
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
          onChange,
          onSave,
          source: at,
        });
      },
    });

    context.keymap.layer(() => ({
      commands: [
        {
          id: "spectre.routing.open",
          title: "Routing",
          description: "Open the page that configures model routing",
          group: "Spectre",
          palette: true,
          slash: { name: "routing" },
          run: () => {
            context.ui.router.navigate({ type: "plugin", name: PAGE });
          },
        },
      ],
    }));

    /** The profile this session would use: the first one under its agent. */
    const chosen = (sessionID: string) => {
      const agent = context.data.session.get(sessionID)?.agent;
      const at = draft.profiles.findIndex((one) => one.agent === agent);
      return draft.profiles[at === -1 ? 0 : at];
    };

    /** The composer line, computed from the draft and the live catalogue. */
    const line = (sessionID: string): Line => {
      revision();
      if (draft.profiles.length === 0) return { body: "no profile is configured", problem: false };
      const profile = chosen(sessionID);
      if (profile === undefined) return { body: "no profile is configured", problem: false };
      const found = resolve(draft, catalogue(listed()));
      const at = draft.profiles.indexOf(profile);
      const row = found[at] ?? absent(profile.name);
      if (row.problem !== undefined)
        return { body: `${profile.name}: ${row.problem}`, problem: true };
      const rung = row.rung === undefined ? "" : ` (${row.rung})`;
      const cost = row.cost === undefined ? "" : `, ${row.cost}`;
      return { body: `${profile.name} uses ${row.ref}${rung}${cost}`, problem: false };
    };

    context.ui.slot({
      append: "session.composer.top",
      render: (input) =>
        h(
          "box",
          { flexDirection: "row", paddingLeft: 1 },
          h("text", { fg: () => context.theme.text.faint, content: () => "routing " }),
          h("text", {
            fg: () =>
              line(input.sessionID).problem
                ? context.theme.text.feedback.warning.base
                : context.theme.text.base,
            content: () => line(input.sessionID).body,
          }),
        ),
    });
  },
});
