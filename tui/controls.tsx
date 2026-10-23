import { usePlugin } from "@opencode/plugin/tui";
import type { Dialog, DialogSelectOption } from "@opencode/plugin/tui/context";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { type KeyEvent, TextAttributes } from "@opentui/core";
import type { JSX } from "@opentui/solid";
import { createSignal } from "solid-js";
import {
  DEFAULT_TIMEOUT_MS,
  isFree,
  KNOWN_ORDER,
  type Known,
  ladderOf,
  proposeAlias,
  rungs,
  SYSTEMONE_ENDPOINT,
  SYSTEMONE_KEY_ENV,
} from "../tools/definitions/routing/index.ts";
import {
  type Draft,
  formatConfig,
  formatCost,
  type Model,
  normalizeCost,
  type Profile,
  type Resolution,
  resolve as resolveDraft,
} from "./data.ts";
import { bindKeyboard, field, h, palette, show } from "./render.ts";

export const JEV_MODEL = "jev-1.13-free";
export const DEFAULT_PROVIDER = "opencode-go";

export const isJevAvailable = (draft: Draft): boolean => {
  const keyName = draft.judge?.key ?? SYSTEMONE_KEY_ENV;
  return Boolean(Bun.env[keyName] || Bun.env.OPENCODE_API_KEY || Bun.env.OPENCODE_KEY);
};

export type Edit =
  | { readonly kind: "effort"; readonly profile: string; readonly effort: string }
  | { readonly kind: "pin"; readonly profile: string; readonly alias: string | undefined }
  | { readonly kind: "model"; readonly alias: string; readonly ref: string }
  | { readonly kind: "remove-model"; readonly alias: string }
  | { readonly kind: "judge"; readonly enabled: boolean }
  | { readonly kind: "provider"; readonly provider: string };

export const applied = (draft: Draft, edit: Edit): Draft => {
  if (edit.kind === "effort")
    return {
      ...draft,
      profiles: draft.profiles.map((one) =>
        one.name === edit.profile ? { ...one, effort: edit.effort, pinned: undefined } : one,
      ),
    };
  if (edit.kind === "pin")
    return {
      ...draft,
      profiles: draft.profiles.map((one) =>
        one.name === edit.profile ? { ...one, pinned: edit.alias } : one,
      ),
    };
  if (edit.kind === "judge")
    return {
      ...draft,
      judge: edit.enabled
        ? {
            kind: "jev",
            model: draft.judge?.model ?? JEV_MODEL,
            endpoint: draft.judge?.endpoint ?? SYSTEMONE_ENDPOINT,
            key: draft.judge?.key ?? SYSTEMONE_KEY_ENV,
            timeout: draft.judge?.timeout ?? DEFAULT_TIMEOUT_MS,
            threshold: draft.judge?.threshold,
          }
        : undefined,
    };
  if (edit.kind === "provider") {
    const models = draft.models.filter((one) => one.ref.startsWith(`${edit.provider}/`));
    const held = new Set(models.map((one) => one.alias));
    return {
      ...draft,
      provider: edit.provider,
      models,
      profiles: draft.profiles.map((one) =>
        one.pinned !== undefined && !held.has(one.pinned) ? { ...one, pinned: undefined } : one,
      ),
    };
  }
  if (edit.kind === "remove-model") {
    return {
      ...draft,
      models: draft.models.filter((one) => one.alias !== edit.alias),
      profiles: draft.profiles.map((one) =>
        one.pinned === edit.alias ? { ...one, pinned: undefined } : one,
      ),
    };
  }
  return { ...draft, models: [...draft.models, { alias: edit.alias, ref: edit.ref }] };
};

const refOf = (one: Model): string => `${one.providerID}/${one.id}`;

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

const rungsOf = (one: Model): ReadonlyArray<string> =>
  rungs(ladderOf(one.rungs.map((id) => ({ id }))));

const costLabelOf = (one: Model): string => formatCost(one.costInput, one.costOutput);

const describeModel = (one: Model): string => {
  const ladder = rungsOf(one);
  const effort = ladder.length === 0 ? "No effort rungs" : `Rungs: ${ladder.join(", ")}`;
  const tools = one.tools ? "" : " · No tools";
  return `${effort}${tools}`;
};

export const availableProviders = (models: ReadonlyArray<Model>): ReadonlyArray<string> => {
  const spendable = new Set<string>();
  const anyEnabled = new Set<string>();
  for (const one of models) {
    if (!one.enabled || one.deprecated) continue;
    anyEnabled.add(one.providerID);
    if (one.tools) spendable.add(one.providerID);
  }
  return spendable.size > 0 ? [...spendable] : [...anyEnabled];
};

export const isProviderAvailable = (
  provider: string | undefined,
  models: ReadonlyArray<Model>,
): boolean => {
  const providers = availableProviders(models);
  if (providers.length === 0) return true;
  if (provider === undefined) return false;
  return providers.includes(provider);
};

export const isModelUsable = (
  model: Model | undefined,
  provider?: string | undefined,
): model is Model => {
  if (model === undefined) return false;
  if (!model.enabled || model.deprecated || !model.tools) return false;
  if (provider !== undefined && model.providerID !== provider) return false;
  return true;
};

export const compatibleModelsFor = (
  models: ReadonlyArray<Model>,
  provider: string | undefined,
): ReadonlyArray<Model> => {
  const targetProvider = provider ?? DEFAULT_PROVIDER;
  const available = availableProviders(models);
  const filterByProvider = provider !== undefined || available.includes(targetProvider);
  return models.filter((one) => isModelUsable(one, filterByProvider ? targetProvider : undefined));
};

const findCatalogModel = (models: ReadonlyArray<Model>, ref: string): Model | undefined =>
  models.find((one) => {
    const head = refOf(one);
    return ref === head || ref.startsWith(`${head}#`);
  });

export const usableDraft = (draft: Draft, catalogue: ReadonlyArray<Model>): Draft => {
  const models = draft.models.filter((entry) => {
    if (draft.provider !== undefined && !entry.ref.startsWith(`${draft.provider}/`)) {
      return false;
    }
    if (catalogue.length === 0) return true;
    const found = findCatalogModel(catalogue, entry.ref);
    if (!isModelUsable(found, draft.provider)) return false;
    const hash = entry.ref.indexOf("#");
    const variant = hash === -1 ? undefined : entry.ref.slice(hash + 1);
    if (variant !== undefined && !found.rungs.includes(variant)) return false;
    return true;
  });
  if (models.length === draft.models.length) return draft;
  const held = new Set(models.map((one) => one.alias));
  return {
    ...draft,
    models,
    profiles: draft.profiles.map((one) =>
      one.pinned !== undefined && !held.has(one.pinned) ? { ...one, pinned: undefined } : one,
    ),
  };
};

export type SelectedModel = {
  readonly alias: string;
  readonly ref: string;
  readonly model: Model | undefined;
};

const stripVariant = (ref: string): string => {
  const hash = ref.indexOf("#");
  return hash === -1 ? ref : ref.slice(0, hash);
};

export const selectedModelFor = (
  draft: Draft,
  models: ReadonlyArray<Model>,
  profile: Profile,
): SelectedModel | undefined => {
  const cleanDraft = usableDraft(draft, models);
  if (profile.pinned !== undefined) {
    const pinnedEntry = cleanDraft.models.find((one) => one.alias === profile.pinned);
    if (pinnedEntry !== undefined) {
      return {
        alias: pinnedEntry.alias,
        ref: stripVariant(pinnedEntry.ref),
        model: findCatalogModel(models, pinnedEntry.ref),
      };
    }
    return {
      alias: profile.pinned,
      ref: profile.pinned,
      model: undefined,
    };
  }

  const resolvedRows = resolveDraft(cleanDraft, models);
  const profileIndex = cleanDraft.profiles.findIndex((one) => one.name === profile.name);
  const resolved =
    profileIndex !== -1
      ? resolvedRows[profileIndex]
      : resolveDraft({ ...cleanDraft, profiles: [profile] }, models)[0];

  if (resolved?.ref !== undefined) {
    const baseRef = stripVariant(resolved.ref);
    const catalogModel = findCatalogModel(models, resolved.ref);
    const entry = cleanDraft.models.find(
      (one) => stripVariant(one.ref) === baseRef || one.ref === resolved.ref,
    );
    return {
      alias: entry?.alias ?? baseRef,
      ref: baseRef,
      model: catalogModel,
    };
  }

  for (const entry of cleanDraft.models) {
    const catalogModel = findCatalogModel(models, entry.ref);
    if (isModelUsable(catalogModel, cleanDraft.provider)) {
      return {
        alias: entry.alias,
        ref: stripVariant(entry.ref),
        model: catalogModel,
      };
    }
  }

  const firstEntry = cleanDraft.models[0];
  if (firstEntry !== undefined) {
    return {
      alias: firstEntry.alias,
      ref: stripVariant(firstEntry.ref),
      model: findCatalogModel(models, firstEntry.ref),
    };
  }

  return undefined;
};

export type EffortOptionRow = {
  readonly name: string;
  readonly available: boolean;
  readonly current: boolean;
  readonly targetRef: string;
  readonly cost: string | undefined;
  readonly reason: string | undefined;
};

export const effortOptionsFor = (
  draft: Draft,
  models: ReadonlyArray<Model>,
  profile: Profile,
): ReadonlyArray<EffortOptionRow> => {
  const selected = selectedModelFor(draft, models, profile);
  const model = selected?.model;
  const declaredRungs = model !== undefined ? rungsOf(model) : [];
  const allNames: Array<string> = [...KNOWN_ORDER];

  for (const rung of declaredRungs) {
    if (!allNames.includes(rung)) allNames.push(rung);
  }
  if (profile.effort !== undefined && !allNames.includes(profile.effort)) {
    allNames.push(profile.effort);
  }

  return allNames.map((name): EffortOptionRow => {
    const current = profile.effort === name && profile.pinned === undefined;
    if (model === undefined) {
      const fallbackRef = selected?.ref ?? "No model selected";
      return {
        name,
        available: true,
        current,
        targetRef: selected !== undefined ? `${selected.ref}#${name}` : fallbackRef,
        cost: undefined,
        reason: selected === undefined ? "Add a model to the allowlist" : undefined,
      };
    }

    const available = declaredRungs.length === 0 ? name === "none" : declaredRungs.includes(name);
    const baseRef = refOf(model);
    const targetRef =
      declaredRungs.length === 0 && name === "none" ? baseRef : `${baseRef}#${name}`;

    if (available) {
      return {
        name,
        available: true,
        current,
        targetRef,
        cost: costLabelOf(model),
        reason: undefined,
      };
    }

    return {
      name,
      available: false,
      current,
      targetRef: baseRef,
      cost: undefined,
      reason: `not supported by ${baseRef}`,
    };
  });
};

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

export const effortModal = (input: {
  readonly profile: Profile;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
  readonly onSelect: (effort: string) => void;
  readonly onCancel: () => void;
}): JSX.Element => {
  const context = usePlugin();
  const dialogTheme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const colors = palette(context.theme, dialogTheme);
  const selected = selectedModelFor(input.draft, input.models, input.profile);
  const rows = effortOptionsFor(input.draft, input.models, input.profile);
  const enabledIndices = rows.flatMap((row, idx) => (row.available ? [idx] : []));
  const initialIndex = (() => {
    const currentIdx = rows.findIndex((row) => row.current && row.available);
    if (currentIdx !== -1) return currentIdx;
    return enabledIndices[0] ?? 0;
  })();

  const [focusedIndex, setFocusedIndex] = createSignal(initialIndex);

  const stepFocus = (delta: number): void => {
    if (enabledIndices.length === 0) return;
    const currentPos = enabledIndices.indexOf(focusedIndex());
    const nextPos =
      currentPos === -1 ? 0 : (currentPos + delta + enabledIndices.length) % enabledIndices.length;
    const target = enabledIndices[nextPos];
    if (target !== undefined) setFocusedIndex(target);
  };

  bindKeyboard(context.renderer, (event: KeyEvent) => {
    const key = event.name || event.sequence || "";
    if (key === "down" || key === "j") {
      event.preventDefault();
      event.stopPropagation();
      stepFocus(1);
      return;
    }
    if (key === "up" || key === "k") {
      event.preventDefault();
      event.stopPropagation();
      stepFocus(-1);
      return;
    }
    if (key === "return" || key === "enter") {
      event.preventDefault();
      event.stopPropagation();
      const row = rows[focusedIndex()];
      if (row?.available) input.onSelect(row.name);
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      input.onCancel();
    }
  });

  const selectedModelText =
    selected?.model !== undefined
      ? `${selected.alias} (${refOf(selected.model)})`
      : (selected?.ref ?? "No model selected");
  const supportedList =
    selected?.model !== undefined
      ? rungsOf(selected.model).join(", ") || "None"
      : "All catalogue efforts";

  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
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
        h(
          "text",
          { fg: colors.text, attributes: TextAttributes.BOLD },
          `The effort for "${input.profile.name}"`,
        ),
        h("text", { fg: colors.teal, onMouseUp: input.onCancel }, "Esc"),
      ),
      field(dialogTheme, "Selected model", () => selectedModelText),
      field(dialogTheme, "Available efforts", () => supportedList),
    ),
    h(
      "box",
      {
        flexDirection: "column",
        width: "100%",
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
      },
      h(
        "box",
        {
          flexDirection: "row",
          width: "100%",
          columnGap: 2,
          paddingBottom: 1,
          border: ["bottom"],
          borderColor: colors.border,
        },
        h("text", { width: 3, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, ""),
        h("text", { width: 12, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, "Effort"),
        h("text", { width: 12, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, "Status"),
        h(
          "text",
          { width: 36, flexGrow: 1, flexShrink: 1, minWidth: 0, fg: colors.blue, wrapMode: "none" },
          "Selected model",
        ),
        h("text", { width: 12, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, () =>
          "Cost".padStart(12),
        ),
      ),
      ...rows.map((row, index) => {
        const [hovered, setHovered] = createSignal(false);
        const isFocused = () => focusedIndex() === index;
        const marker = () => {
          if (row.current && isFocused()) return "▸●";
          if (row.current) return " ●";
          if (isFocused()) return "▸ ";
          return "  ";
        };
        const nameColor = () => {
          if (!row.available) return colors.disabled;
          if (isFocused() || hovered()) return colors.cyan;
          return colors.green;
        };
        const statusColor = () => (row.available ? colors.green : colors.disabled);
        const targetColor = () => {
          if (!row.available) return colors.disabled;
          if (isFocused() || hovered()) return colors.text;
          return colors.teal;
        };

        return h(
          "box",
          {
            flexDirection: "row",
            width: "100%",
            columnGap: 2,
            backgroundColor: () =>
              row.available && (isFocused() || hovered()) ? colors.rowHoverBg : undefined,
            onMouseOver: () => {
              setHovered(true);
              if (row.available) setFocusedIndex(index);
            },
            onMouseOut: () => setHovered(false),
            onMouseUp: () => {
              if (row.available) input.onSelect(row.name);
            },
          },
          h(
            "text",
            {
              width: 3,
              flexShrink: 0,
              fg: () => (row.available ? colors.cyan : colors.disabled),
              wrapMode: "none",
            },
            marker,
          ),
          h(
            "text",
            {
              width: 12,
              flexShrink: 0,
              fg: nameColor,
              attributes: row.available ? TextAttributes.BOLD : TextAttributes.DIM,
              wrapMode: "none",
            },
            row.name,
          ),
          h(
            "text",
            {
              width: 12,
              flexShrink: 0,
              fg: statusColor,
              wrapMode: "none",
            },
            row.available ? "available" : "disabled",
          ),
          h(
            "text",
            {
              width: 36,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              fg: targetColor,
              truncate: true,
              wrapMode: "none",
            },
            row.available ? row.targetRef : (row.reason ?? "not supported"),
          ),
          h(
            "text",
            {
              width: 12,
              flexShrink: 0,
              fg: () => (row.available ? colors.muted : colors.disabled),
              wrapMode: "none",
            },
            () => (row.cost ?? "-").padStart(12),
          ),
        );
      }),
    ),
    h(
      "box",
      {
        flexDirection: "row",
        justifyContent: "space-between",
        backgroundColor: colors.insetBg,
        border: ["top"],
        borderColor: colors.border,
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
      },
      h(
        "box",
        { flexDirection: "row", gap: 3 },
        h(
          "text",
          { fg: colors.text, attributes: TextAttributes.BOLD },
          "Enter ",
          h("span", { style: { fg: colors.muted } }, "Select effort"),
        ),
        h(
          "text",
          { fg: colors.text, attributes: TextAttributes.BOLD },
          "↑/↓ ",
          h("span", { style: { fg: colors.muted } }, "Navigate available"),
        ),
      ),
      h(
        "text",
        { fg: colors.text, attributes: TextAttributes.BOLD, onMouseUp: input.onCancel },
        "Esc ",
        h("span", { style: { fg: colors.muted } }, "Back"),
      ),
    ),
  );
};

export const effortPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
  readonly profile: Profile;
}): Promise<Edit | undefined> =>
  new Promise<Edit | undefined>((resolve) => {
    let settled = false;
    const finish = (value: Edit | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    input.dialog.show(
      () =>
        effortModal({
          profile: input.profile,
          draft: input.draft,
          models: input.models,
          onSelect: (chosen) => {
            if (chosen === input.profile.effort && input.profile.pinned === undefined) {
              finish(undefined);
              return;
            }
            finish({ kind: "effort", profile: input.profile.name, effort: chosen });
          },
          onCancel: () => finish(undefined),
        }),
      () => finish(undefined),
    );
    input.dialog.set({ size: "large", centered: true });
  });

export const profileInfoModal = (input: {
  readonly profile: Profile;
  readonly resolution: Resolution | undefined;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
  readonly onClose: () => void;
}): JSX.Element => {
  const context = usePlugin();
  const dialogTheme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const colors = palette(context.theme, dialogTheme);
  const { profile, resolution } = input;
  const selected = selectedModelFor(input.draft, input.models, profile);
  const effortText =
    profile.pinned !== undefined ? `Pinned to ${profile.pinned}` : (profile.effort ?? "Not set");
  const modelText =
    resolution?.ref ??
    (selected?.model !== undefined ? refOf(selected.model) : (selected?.ref ?? "Unresolved"));
  const crosscheckConfig =
    profile.crosscheck === undefined
      ? "None"
      : `${profile.crosscheck.effort ?? profile.effort ?? "default"}${profile.crosscheck.prefer === "free" ? " (prefer free)" : ""}`;
  const costText = normalizeCost(resolution?.cost) ?? "-";

  bindKeyboard(context.renderer, (event: KeyEvent) => {
    const key = event.name || event.sequence || "";
    if (key === "escape" || key === "return" || key === "enter" || key === "i") {
      event.preventDefault();
      event.stopPropagation();
      input.onClose();
    }
  });

  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
      border: true,
      borderStyle: "rounded",
      borderColor: colors.borderOuter,
      backgroundColor: colors.modalBg,
    },
    h(
      "box",
      {
        flexDirection: "column",
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
        gap: 1,
        border: ["bottom"],
        borderColor: colors.border,
      },
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between", width: "100%" },
        h(
          "text",
          { fg: colors.cyan, attributes: TextAttributes.BOLD },
          `Profile "${profile.name}"`,
        ),
        h("text", { fg: colors.teal, onMouseUp: input.onClose }, "Esc"),
      ),
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between", width: "100%" },
        field(dialogTheme, "Effort", () => effortText),
        field(dialogTheme, "Agent", () => profile.agent),
      ),
      h(
        "box",
        { flexDirection: "row", justifyContent: "space-between", width: "100%" },
        field(dialogTheme, "Selected model", () => modelText),
        field(dialogTheme, "Cost", () => costText),
      ),
      field(dialogTheme, "Crosscheck", () =>
        resolution?.crosscheck !== undefined
          ? `${crosscheckConfig} → ${resolution.crosscheck}`
          : crosscheckConfig,
      ),
    ),
    h(
      "box",
      {
        flexDirection: "column",
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
        gap: 1,
      },
      h(
        "box",
        {
          flexDirection: "column",
          border: true,
          borderStyle: "rounded",
          borderColor: colors.border,
          backgroundColor: colors.insetBg,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          gap: 1,
        },
        h("text", { fg: colors.blue, attributes: TextAttributes.BOLD }, "When to use (match)"),
        h(
          "text",
          { fg: colors.text, wrapMode: "word" },
          profile.match ?? "No match rule configured for this profile.",
        ),
      ),
      h(
        "box",
        {
          flexDirection: "column",
          border: true,
          borderStyle: "rounded",
          borderColor: colors.border,
          backgroundColor: colors.insetBg,
          paddingLeft: 2,
          paddingRight: 2,
          paddingTop: 1,
          paddingBottom: 1,
          gap: 1,
        },
        h("text", { fg: colors.blue, attributes: TextAttributes.BOLD }, "Why (rationale)"),
        h(
          "text",
          { fg: colors.muted, wrapMode: "word" },
          profile.why ?? "No rationale recorded for this profile.",
        ),
      ),
      show(
        () => resolution?.problem !== undefined,
        () =>
          h(
            "box",
            {
              flexDirection: "column",
              border: true,
              borderStyle: "rounded",
              borderColor: colors.warning,
              paddingLeft: 2,
              paddingRight: 2,
              paddingTop: 1,
              paddingBottom: 1,
            },
            h("text", { fg: colors.warning, wrapMode: "word" }, resolution?.problem ?? ""),
          ),
      ),
    ),
    h(
      "box",
      {
        flexDirection: "row",
        justifyContent: "space-between",
        backgroundColor: colors.insetBg,
        border: ["top"],
        borderColor: colors.border,
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
      },
      h(
        "text",
        { fg: colors.text, attributes: TextAttributes.BOLD, onMouseUp: input.onClose },
        "i / Enter ",
        h("span", { style: { fg: colors.muted } }, "Return to profiles"),
      ),
      h(
        "text",
        { fg: colors.text, attributes: TextAttributes.BOLD, onMouseUp: input.onClose },
        "Esc ",
        h("span", { style: { fg: colors.muted } }, "Close"),
      ),
    ),
  );
};

export const profileInfo = async (input: {
  readonly dialog: Dialog;
  readonly profile: Profile;
  readonly resolution: Resolution | undefined;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): Promise<undefined> =>
  new Promise<undefined>((resolve) => {
    let settled = false;
    const finish = (): void => {
      if (settled) return;
      settled = true;
      resolve(undefined);
    };

    input.dialog.show(
      () =>
        profileInfoModal({
          profile: input.profile,
          resolution: input.resolution,
          draft: input.draft,
          models: input.models,
          onClose: finish,
        }),
      finish,
    );
    input.dialog.set({ size: "large", centered: true });
  });

export type ProviderOptionRow = {
  readonly name: string;
  readonly available: boolean;
  readonly current: boolean;
  readonly modelCount: number;
  readonly freeCount: number;
};

export const providerOptionsFor = (
  draft: Draft,
  models: ReadonlyArray<Model>,
): ReadonlyArray<ProviderOptionRow> => {
  const available = availableProviders(models);
  const allNames: Array<string> = [...available];
  if (draft.provider !== undefined && !allNames.includes(draft.provider)) {
    allNames.unshift(draft.provider);
  }
  return allNames.map((name): ProviderOptionRow => {
    const providerModels = models.filter((one) => isModelUsable(one, name));
    const freeCount = providerModels.filter((one) => isFree(knownOf(one))).length;
    return {
      name,
      available: available.includes(name),
      current: draft.provider === name,
      modelCount: providerModels.length,
      freeCount,
    };
  });
};

export const providerModal = (input: {
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
  readonly onSelect: (provider: string) => void;
  readonly onCancel: () => void;
}): JSX.Element => {
  const context = usePlugin();
  const dialogTheme =
    typeof context.theme.surface === "function" ? context.theme.surface("dialog") : context.theme;
  const colors = palette(context.theme, dialogTheme);
  const rows = providerOptionsFor(input.draft, input.models);
  const enabledIndices = rows.flatMap((row, idx) => (row.available ? [idx] : []));
  const initialIndex = (() => {
    const currentIdx = rows.findIndex((row) => row.current && row.available);
    if (currentIdx !== -1) return currentIdx;
    return enabledIndices[0] ?? 0;
  })();

  const [focusedIndex, setFocusedIndex] = createSignal(initialIndex);

  const stepFocus = (delta: number): void => {
    if (enabledIndices.length === 0) return;
    const currentPos = enabledIndices.indexOf(focusedIndex());
    const nextPos =
      currentPos === -1 ? 0 : (currentPos + delta + enabledIndices.length) % enabledIndices.length;
    const target = enabledIndices[nextPos];
    if (target !== undefined) setFocusedIndex(target);
  };

  bindKeyboard(context.renderer, (event: KeyEvent) => {
    const key = event.name || event.sequence || "";
    if (key === "down" || key === "j") {
      event.preventDefault();
      event.stopPropagation();
      stepFocus(1);
      return;
    }
    if (key === "up" || key === "k") {
      event.preventDefault();
      event.stopPropagation();
      stepFocus(-1);
      return;
    }
    if (key === "return" || key === "enter") {
      event.preventDefault();
      event.stopPropagation();
      const row = rows[focusedIndex()];
      if (row?.available) input.onSelect(row.name);
      return;
    }
    if (key === "escape") {
      event.preventDefault();
      event.stopPropagation();
      input.onCancel();
    }
  });

  const currentProviderText = input.draft.provider ?? `${DEFAULT_PROVIDER} (default)`;
  const availableList =
    rows
      .filter((one) => one.available)
      .map((one) => one.name)
      .join(", ") || "None";

  return h(
    "box",
    {
      flexDirection: "column",
      width: "100%",
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
        h("text", { fg: colors.text, attributes: TextAttributes.BOLD }, "Select default provider"),
        h("text", { fg: colors.teal, onMouseUp: input.onCancel }, "Esc"),
      ),
      field(dialogTheme, "Current provider", () => currentProviderText),
      field(dialogTheme, "Available providers", () => availableList),
    ),
    h(
      "box",
      {
        flexDirection: "column",
        width: "100%",
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
      },
      h(
        "box",
        {
          flexDirection: "row",
          width: "100%",
          columnGap: 2,
          paddingBottom: 1,
          border: ["bottom"],
          borderColor: colors.border,
        },
        h("text", { width: 3, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, ""),
        h("text", { width: 20, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, "Provider"),
        h("text", { width: 12, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, "Status"),
        h(
          "text",
          { width: 28, flexGrow: 1, flexShrink: 1, minWidth: 0, fg: colors.blue, wrapMode: "none" },
          "Models",
        ),
        h("text", { width: 12, flexShrink: 0, fg: colors.blue, wrapMode: "none" }, () =>
          "Free".padStart(12),
        ),
      ),
      ...rows.map((row, index) => {
        const [hovered, setHovered] = createSignal(false);
        const isFocused = () => focusedIndex() === index;
        const marker = () => {
          if (row.current && isFocused()) return "▸●";
          if (row.current) return " ●";
          if (isFocused()) return "▸ ";
          return "  ";
        };
        const nameColor = () => {
          if (!row.available) return colors.disabled;
          if (isFocused() || hovered()) return colors.cyan;
          return colors.green;
        };
        const statusColor = () => (row.available ? colors.green : colors.disabled);
        const detailColor = () => {
          if (!row.available) return colors.disabled;
          if (isFocused() || hovered()) return colors.text;
          return colors.teal;
        };

        return h(
          "box",
          {
            flexDirection: "row",
            width: "100%",
            columnGap: 2,
            backgroundColor: () =>
              row.available && (isFocused() || hovered()) ? colors.rowHoverBg : undefined,
            onMouseOver: () => {
              setHovered(true);
              if (row.available) setFocusedIndex(index);
            },
            onMouseOut: () => setHovered(false),
            onMouseUp: () => {
              if (row.available) input.onSelect(row.name);
            },
          },
          h(
            "text",
            {
              width: 3,
              flexShrink: 0,
              fg: () => (row.available ? colors.cyan : colors.disabled),
              wrapMode: "none",
            },
            marker,
          ),
          h(
            "text",
            {
              width: 20,
              flexShrink: 0,
              fg: nameColor,
              attributes: row.available ? TextAttributes.BOLD : TextAttributes.DIM,
              wrapMode: "none",
            },
            row.name,
          ),
          h(
            "text",
            {
              width: 12,
              flexShrink: 0,
              fg: statusColor,
              wrapMode: "none",
            },
            row.available ? "available" : "disabled",
          ),
          h(
            "text",
            {
              width: 28,
              flexGrow: 1,
              flexShrink: 1,
              minWidth: 0,
              fg: detailColor,
              truncate: true,
              wrapMode: "none",
            },
            row.available
              ? `${row.modelCount} usable model${row.modelCount === 1 ? "" : "s"}`
              : "Not available in this session",
          ),
          h(
            "text",
            {
              width: 12,
              flexShrink: 0,
              fg: () => (row.available ? colors.muted : colors.disabled),
              wrapMode: "none",
            },
            () => (row.available ? `${row.freeCount} free` : "-").padStart(12),
          ),
        );
      }),
    ),
    h(
      "box",
      {
        flexDirection: "row",
        justifyContent: "space-between",
        backgroundColor: colors.insetBg,
        border: ["top"],
        borderColor: colors.border,
        paddingLeft: 3,
        paddingRight: 3,
        paddingTop: 1,
        paddingBottom: 1,
      },
      h(
        "box",
        { flexDirection: "row", gap: 3 },
        h(
          "text",
          { fg: colors.text, attributes: TextAttributes.BOLD },
          "Enter ",
          h("span", { style: { fg: colors.muted } }, "Select provider"),
        ),
        h(
          "text",
          { fg: colors.text, attributes: TextAttributes.BOLD },
          "↑/↓ ",
          h("span", { style: { fg: colors.muted } }, "Navigate available"),
        ),
      ),
      h(
        "text",
        { fg: colors.text, attributes: TextAttributes.BOLD, onMouseUp: input.onCancel },
        "Esc ",
        h("span", { style: { fg: colors.muted } }, "Back"),
      ),
    ),
  );
};

export const providerPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): Promise<Edit | undefined> => {
  const providers = availableProviders(input.models);
  if (providers.length === 0) return undefined;

  return new Promise<Edit | undefined>((resolve) => {
    let settled = false;
    const finish = (value: Edit | undefined): void => {
      if (settled) return;
      settled = true;
      resolve(value);
    };

    input.dialog.show(
      () =>
        providerModal({
          draft: input.draft,
          models: input.models,
          onSelect: (chosen) => {
            if (chosen === input.draft.provider) {
              finish(undefined);
              return;
            }
            finish({ kind: "provider", provider: chosen });
          },
          onCancel: () => finish(undefined),
        }),
      () => finish(undefined),
    );
    input.dialog.set({ size: "large", centered: true });
  });
};

export const pinPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models?: ReadonlyArray<Model> | undefined;
  readonly profile: Profile;
}): Promise<Edit | undefined> => {
  const cleanDraft =
    input.models !== undefined ? usableDraft(input.draft, input.models) : input.draft;
  const options: Array<DialogSelectOption<string>> = [
    {
      title: "Auto (by effort)",
      value: "",
      description: `profiles.${input.profile.name}.model`,
      footer: "Unpinned",
    },
    ...cleanDraft.models.map((one) => ({
      title: one.alias,
      value: one.alias,
      description: one.ref,
      footer: "Pinned",
    })),
  ];

  const pending = input.dialog.select({
    title: `The model "${input.profile.name}" spends`,
    placeholder: "Search the allowlist",
    options,
    current: input.profile.pinned ?? "",
  });
  input.dialog.set({ size: "xlarge", centered: true });
  const chosen = await pending;

  if (chosen === undefined) return undefined;
  if ((chosen === "") === (input.profile.pinned === undefined)) return undefined;
  return { kind: "pin", profile: input.profile.name, alias: chosen === "" ? undefined : chosen };
};

const aliasProblem = (name: string, taken: ReadonlyArray<string>): string | undefined => {
  if (name === "") return "Type an alias. Use lowercase letters, digits and hyphens only.";
  if (!/^[a-z0-9][a-z0-9-]*$/.test(name))
    return "Use lowercase letters, digits and hyphens only. A slash or a hash would make the alias look like a ref.";
  if (taken.includes(name)) return `The allowlist already holds "${name}". Choose another alias.`;
  return undefined;
};

export const aliasPrompt = async (input: {
  readonly dialog: Dialog;
  readonly ref: string;
  readonly proposed: string;
  readonly taken: ReadonlyArray<string>;
}): Promise<string | undefined> => {
  let value = input.proposed;

  for (;;) {
    const pending = input.dialog.prompt({
      title: `The alias for ${input.ref}`,
      description:
        "Use lowercase letters, digits and hyphens only. The first character is a letter or a digit.",
      placeholder: input.proposed,
      value,
    });
    input.dialog.set({ size: "large", centered: true });
    const answer = await pending;
    if (answer === undefined) return undefined;

    const problem = aliasProblem(answer, input.taken);
    if (problem === undefined) return answer;

    value = answer;
    await input.dialog.alert({ title: "The alias is not valid", message: problem });
  }
};

export const modelPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): Promise<Edit | undefined> => {
  const cleanDraft = usableDraft(input.draft, input.models);
  const taken = cleanDraft.models.map((one) => one.alias);
  const compatible = compatibleModelsFor(input.models, cleanDraft.provider);

  const options: Array<DialogSelectOption<string>> = compatible.map((one) => {
    const ref = refOf(one);
    const held = cleanDraft.models.some(
      (entry) => entry.ref === ref || entry.ref.startsWith(`${ref}#`),
    );
    const familyText = one.family === undefined ? "No family" : one.family;
    return {
      title: ref,
      value: ref,
      description: `${familyText} · ${describeModel(one)}`,
      footer: held ? "In allowlist" : costLabelOf(one),
      category: one.providerID,
      disabled: held,
    };
  });

  const pending = input.dialog.select({
    title: "Add a model to the allowlist",
    placeholder: "Search compatible provider models",
    options,
    search: matches,
  });
  input.dialog.set({ size: "xlarge", centered: true });
  const ref = await pending;
  if (ref === undefined) return undefined;

  const model = compatible.find((one) => refOf(one) === ref);
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

export const removeModelPicker = async (input: {
  readonly dialog: Dialog;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): Promise<Edit | undefined> => {
  const cleanDraft = usableDraft(input.draft, input.models);
  if (cleanDraft.models.length === 0) return undefined;

  const options: Array<DialogSelectOption<string>> = cleanDraft.models.map((entry) => {
    const model = findCatalogModel(input.models, entry.ref);
    const cost = model !== undefined ? costLabelOf(model) : "-";
    return {
      title: entry.alias,
      value: entry.alias,
      description: entry.ref,
      footer: cost,
    };
  });

  const pending = input.dialog.select({
    title: "Remove a model from the allowlist",
    placeholder: "Search the allowlist",
    options,
    search: matches,
  });
  input.dialog.set({ size: "large", centered: true });
  const alias = await pending;
  if (alias === undefined) return undefined;

  return { kind: "remove-model", alias };
};

export const preview = (input: {
  readonly theme: ResolvedTheme;
  readonly draft: Draft;
  readonly models: ReadonlyArray<Model>;
}): JSX.Element => {
  const colors = palette(input.theme);
  const cleanDraft = usableDraft(input.draft, input.models);
  const jsonText = formatConfig(cleanDraft);
  const lines = jsonText
    .split("\n")
    .map((line) => h("text", { fg: colors.teal, wrapMode: "word" }, line));

  return h("box", { flexDirection: "column" }, ...lines);
};

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
        one.pinned === undefined ? (one.effort ?? "Not set") : `Pinned to ${one.pinned}`,
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
      field(theme, "Add a model", () => "Open the catalogue"),
    ),
    preview({ theme, draft: input.draft, models: input.models }),
  );
};
