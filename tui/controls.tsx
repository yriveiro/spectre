import { usePlugin } from "@opencode/plugin/tui";
import type { Dialog, DialogSelectOption } from "@opencode/plugin/tui/context";
import type { ResolvedTheme } from "@opencode/theme/tui";
import type { JSX } from "@opentui/solid";
import {
  DEFAULT_AGENT,
  isFree,
  type Known,
  ladderOf,
  proposeAlias,
  rungs,
} from "../tools/definitions/routing";
import {
  type Draft,
  type Model,
  type Profile,
  type Resolution,
  resolve as resolveDraft,
} from "./data";
import { field, h } from "./render";

/**
 * The controls: the dialogs that change the draft.
 *
 * A control changes the draft and never writes the file. The page writes the
 * file only when the person asks, and `data.save` does the write.
 *
 * Each dialog carries the facts a person needs to choose: the cost, the rungs
 * and the number of allowed models that reach the effort. The resolver that
 * answers those questions is the one the tool uses, so the page cannot promise
 * a spend the router will not make.
 *
 * The dialogs return an `Edit` and they do not hold a draft. `controls` applies
 * the edit with `applied` and hands the next draft to `onChange`. A caller that
 * wires a dialog to a keybinding does the same two calls.
 */

/** One change a control makes to the draft. */
export type Edit =
  | { readonly kind: "effort"; readonly profile: string; readonly effort: string }
  | { readonly kind: "pin"; readonly profile: string; readonly alias: string | undefined }
  | { readonly kind: "model"; readonly alias: string; readonly ref: string };

/**
 * The draft with one edit applied.
 *
 * A model joins the end of the allowlist, because the order is the preference
 * order and the person put this model last. An effort replaces the value the
 * profile holds.
 */
export const applied = (draft: Draft, edit: Edit): Draft => {
  if (edit.kind === "effort")
    return {
      ...draft,
      profiles: draft.profiles.map((one) =>
        one.name === edit.profile ? { ...one, effort: edit.effort } : one,
      ),
    };
  if (edit.kind === "pin")
    return {
      ...draft,
      profiles: draft.profiles.map((one) =>
        one.name === edit.profile ? { ...one, pinned: edit.alias } : one,
      ),
    };
  return { ...draft, models: [...draft.models, { alias: edit.alias, ref: edit.ref }] };
};

/** The ref of a catalogue row, as the allowlist writes it. */
const refOf = (one: Model): string => `${one.providerID}/${one.id}`;

/**
 * The reduced catalogue row as the barrel's `Known`.
 *
 * `proposeAlias` reads the family, the id and the provider, and `isFree` reads
 * the cost. The two fields the reduction drops carry a stated answer here, and
 * neither call reads them. `tools` carries `true` because the reduced row has
 * no other answer to give.
 */
const knownOf = (one: Model): Known => ({
  providerID: one.providerID,
  id: one.id,
  name: one.name,
  family: one.family,
  rungs: one.rungs,
  costInput: one.costInput,
  costOutput: one.costOutput,
  enabled: one.enabled,
  status: one.deprecated ? "deprecated" : "active",
  tools: true,
});

/** The ladder as a person reads it, in the order the resolver compares by. */
const rungsOf = (one: Model): ReadonlyArray<string> =>
  rungs(ladderOf(one.rungs.map((id) => ({ id }))));

/** The rungs and the cost, as one line. */
const describeModel = (one: Model): string => {
  const ladder = rungsOf(one);
  const effort = ladder.length === 0 ? "No effort rungs" : `Rungs ${ladder.join(", ")}`;
  const cost = isFree(knownOf(one)) ? "free" : `${one.costInput} in, ${one.costOutput} out`;
  // A model that cannot call tools is not spendable on a subagent, and the
  // resolver refuses it. The page says so rather than letting a person put it
  // in the allowlist and wonder why it never runs.
  const tools = one.tools ? "" : " Cannot call tools, so it is not spendable.";
  return `${effort}. Cost ${cost}.${tools}`;
};

/** The profile a reach probe resolves: one effort, no pin and no second opinion. */
const probe = (effort: string): Profile => ({
  name: "probe",
  effort,
  match: undefined,
  why: undefined,
  crosscheck: undefined,
  agent: DEFAULT_AGENT,
  pinned: undefined,
});

/** What one effort means for the allowlist. */
type Reach = {
  /** How many allowed models reach the effort. */
  readonly reached: number;
  /** How many entries the allowlist holds. */
  readonly total: number;
  /** The alias and the ref the router would spend, or undefined. */
  readonly spent: string | undefined;
};

/**
 * The allowlist read one model at a time, at one effort.
 *
 * Each entry resolves on its own through `data.resolve`, which reads the
 * barrel's `candidates` and `resolveProfile`. The count is therefore the
 * router's own answer and not a second rule that can drift from it.
 */
const reachOf = (draft: Draft, models: ReadonlyArray<Model>, effort: string): Reach => {
  let reached = 0;
  let spent: string | undefined;

  for (const entry of draft.models) {
    const [row] = resolveDraft(
      { provider: draft.provider, models: [entry], profiles: [probe(effort)] },
      models,
    );
    if (row?.ref === undefined) continue;
    reached += 1;
    if (spent === undefined) spent = `${entry.alias} ${row.ref}`;
  }

  return { reached, total: draft.models.length, spent };
};

/** The footer of one effort option. */
const footerOf = (one: Reach): string => {
  if (one.total === 0) return "The allowlist is empty, so no model reaches this effort.";
  if (one.reached === 0)
    return `No allowed model reaches this effort. The allowlist holds ${one.total}.`;
  const count = `${one.reached} of ${one.total} allowed models reach this effort.`;
  return one.spent === undefined ? count : `${count} The router spends ${one.spent}.`;
};

/**
 * The effort names the catalogue declares, in the order the resolver compares
 * by, with the floor in front of them.
 *
 * A name no model declares is not on the list, because the router cannot spend
 * it. The value the profile holds stays on the list even so, so the person sees
 * the value the router refuses.
 *
 * `none` is always on the list, because the router can spend it on every
 * model: a model with rungs is spent at its lowest one, and a model with no
 * thinking control is spent at its own default. It is the floor, not a name
 * only the models that declare it can hold.
 */
const effortNames = (
  models: ReadonlyArray<Model>,
  current: string | undefined,
): ReadonlyArray<string> => {
  const declared = models.flatMap((one) => one.rungs);
  const names = rungs(ladderOf(declared.map((id) => ({ id }))));
  const floor = "none";
  const held = [floor, ...names.filter((one) => one !== floor)];
  if (current === undefined || held.includes(current)) return held;
  return [...held, current];
};

/** A query matched against the title, the description and the category. */
const matches = (
  query: string,
  options: readonly DialogSelectOption<string>[],
): readonly DialogSelectOption<string>[] => {
  const needle = query.trim().toLowerCase();
  if (needle === "") return options;
  return options.filter((one) =>
    `${one.title} ${one.description ?? ""} ${one.category ?? ""}`.toLowerCase().includes(needle),
  );
};

/** The effort picker: one profile's requirement, and what each choice costs. */
export const effortPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
  readonly profile: Profile;
}): Promise<Edit | undefined> => {
  const pin =
    input.profile.pinned === undefined ? undefined : ` (pinned to ${input.profile.pinned})`;
  const options: Array<DialogSelectOption<string>> = effortNames(
    input.models,
    input.profile.effort,
  ).map((name) => ({
    title: name,
    value: name,
    description: `profiles.${input.profile.name}.effort${pin ?? ""}`,
    footer: footerOf(reachOf(input.draft, input.models, name)),
  }));

  const chosen = await input.dialog.select({
    title: `The effort for "${input.profile.name}"`,
    placeholder: "Search the effort names",
    options,
    current: input.profile.effort,
  });

  if (chosen === undefined || chosen === input.profile.effort) return undefined;
  return { kind: "effort", profile: input.profile.name, effort: chosen };
};

/**
 * The pin picker: the model a profile spends on, whatever the effort says.
 *
 * A pin names an entry in the allowlist, so the options are the allowlist's
 * entries and not the catalogue's models: a model the user did not allow is
 * not spendable here, and the picker says so by not offering it. The first
 * option clears the pin, so a profile that had one can have it back.
 */
export const pinPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly profile: Profile;
}): Promise<Edit | undefined> => {
  const options: Array<DialogSelectOption<string>> = [
    {
      title: "No pin",
      value: "",
      description: `profiles.${input.profile.name}.model`,
      footer: "The profile asks for an effort, and the router picks the model.",
    },
    ...input.draft.models.map((one) => ({
      title: one.alias,
      value: one.alias,
      description: one.ref,
      footer: "The profile spends this model whatever the effort says.",
    })),
  ];

  const chosen = await input.dialog.select({
    title: `The model "${input.profile.name}" spends`,
    placeholder: "Search the allowlist",
    options,
    current: input.profile.pinned ?? "",
  });

  if (chosen === undefined) return undefined;
  if ((chosen === "") === (input.profile.pinned === undefined)) return undefined;
  return { kind: "pin", profile: input.profile.name, alias: chosen === "" ? undefined : chosen };
};

/** Why the alias is not valid, or undefined when it is. */
const aliasProblem = (name: string, taken: ReadonlyArray<string>): string | undefined => {
  if (name === "") return "Type an alias. Use lowercase letters, digits and hyphens only.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    return "Use lowercase letters, digits and hyphens only. A slash or a hash would make the alias look like a ref.";
  if (taken.includes(name)) return `The allowlist already holds "${name}". Choose another alias.`;
  return undefined;
};

/**
 * The alias of a model that joins the allowlist.
 *
 * The charset is lowercase letters, digits and hyphens, so a name can never
 * carry a slash or a hash and can never look like a ref. A refused name asks
 * again, and a cancel answers undefined.
 */
export const aliasPrompt = async (input: {
  readonly dialog: Dialog;
  readonly ref: string;
  readonly proposed: string;
  readonly taken: ReadonlyArray<string>;
}): Promise<string | undefined> => {
  let value = input.proposed;

  for (;;) {
    const answer = await input.dialog.prompt({
      title: `The alias for ${input.ref}`,
      description:
        "Use lowercase letters, digits and hyphens only. The first character is a letter or a digit.",
      placeholder: input.proposed,
      value,
    });
    if (answer === undefined) return undefined;

    const problem = aliasProblem(answer, input.taken);
    if (problem === undefined) return answer;

    value = answer;
    await input.dialog.alert({ title: "The alias is not valid", message: problem });
  }
};

/**
 * The model picker: every model this session can see, grouped by provider.
 *
 * A model the router refuses is on the list and cannot be chosen, so the person
 * reads why. A model already in the allowlist is marked, so the same ref cannot
 * join twice. A chosen model asks for its alias before it joins.
 */
export const modelPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): Promise<Edit | undefined> => {
  const taken = input.draft.models.map((one) => one.alias);
  const options: Array<DialogSelectOption<string>> = input.models.map((one) => {
    const ref = refOf(one);
    const held = input.draft.models.some(
      (entry) => entry.ref === ref || entry.ref.startsWith(`${ref}#`),
    );
    const state = !one.enabled
      ? "disabled in the catalogue"
      : one.deprecated
        ? "deprecated in the catalogue"
        : held
          ? "already in the allowlist"
          : undefined;

    return {
      title: ref,
      value: ref,
      description: one.family === undefined ? "no family" : one.family,
      footer: state === undefined ? describeModel(one) : `${state}. ${describeModel(one)}`,
      category: one.providerID,
      disabled: state !== undefined,
    };
  });

  const ref = await input.dialog.select({
    title: "Add a model to the allowlist",
    placeholder: "Search the models this session can see",
    options,
    search: matches,
  });
  if (ref === undefined) return undefined;

  const model = input.models.find((one) => refOf(one) === ref);
  if (model === undefined) return undefined;

  const alias = await aliasPrompt({
    dialog: input.dialog,
    ref,
    proposed: proposeAlias(knownOf(model), taken),
    taken,
  });
  if (alias === undefined) return undefined;

  return { kind: "model", alias, ref };
};

/** One profile of the draft, and what it resolves to. */
const previewLine = (theme: ResolvedTheme, one: Resolution): JSX.Element => {
  if (one.problem !== undefined)
    return h("text", { fg: theme.text.feedback.warning.base }, `${one.profile}: ${one.problem}`);

  const parts = [one.profile, one.ref ?? "no model"];
  if (one.rung !== undefined) parts.push(one.rung);
  if (one.cost !== undefined) parts.push(one.cost);
  if (one.crosscheck !== undefined) parts.push(`second opinion ${one.crosscheck}`);
  return h("text", { fg: theme.text.base }, parts.join("  "));
};

/**
 * The preview of an unsaved edit.
 *
 * It reads the draft and the catalogue, and never the file. `data.resolve`
 * reads the barrel's resolver, so the preview and the router agree.
 */
export const preview = (input: {
  readonly theme: ResolvedTheme;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): JSX.Element => {
  const rows = resolveDraft(input.draft, input.models);
  const lines =
    rows.length === 0
      ? [h("text", { fg: input.theme.text.faint }, "The draft holds no profile.")]
      : rows.map((one) => previewLine(input.theme, one));

  return h(
    "box",
    { flexDirection: "column" },
    h("text", { fg: input.theme.text.faint }, "The draft is not saved. It resolves to:"),
    ...lines,
  );
};

/**
 * The controls, as the rows a person presses.
 *
 * One row per profile opens the effort picker for that profile. One row opens
 * the model picker. The preview goes under them, so a changed draft shows its
 * own result before the person saves it.
 *
 * `onChange` receives the next draft. This file never writes the config, and
 * the caller must not write it here either. The write is a separate action,
 * and a person asks for it.
 */
export const controls = (input: {
  readonly onChange: (next: Draft) => void;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): JSX.Element => {
  const context = usePlugin();
  const theme = context.theme;
  const dialog = context.ui.dialog;

  const run = (open: () => Promise<Edit | undefined>): void => {
    void open().then(
      (edit) => {
        if (edit !== undefined) input.onChange(applied(input.draft, edit));
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

  const rows = input.draft.profiles.map((one) =>
    h(
      "box",
      {
        flexDirection: "row",
        onMouseDown: () =>
          run(() =>
            effortPicker({ dialog, draft: input.draft, models: input.models, profile: one }),
          ),
      },
      field(theme, `profiles.${one.name}.effort`, () =>
        one.pinned === undefined ? (one.effort ?? "not set") : `pinned to ${one.pinned}`,
      ),
    ),
  );

  return h(
    "box",
    { flexDirection: "column" },
    h("text", { fg: theme.text.muted }, "Change the draft"),
    ...rows,
    h(
      "box",
      {
        flexDirection: "row",
        onMouseDown: () =>
          run(() => modelPicker({ dialog, draft: input.draft, models: input.models })),
      },
      field(theme, "Add a model", () => "open the catalogue"),
    ),
    preview({ theme, draft: input.draft, models: input.models }),
  );
};
