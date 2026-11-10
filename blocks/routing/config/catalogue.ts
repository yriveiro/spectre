import { Model } from "@opencode/schema/model";
import { type Ladder, ladderOf } from "./effort";
import { type Allowed, type Candidate, formatRef, type Known } from "./types";

/**
 * What a catalogue row means, read once.
 *
 * One normalizer and two callers. The check and the resolver both read the
 * catalogue, and two readers of the same shape drift, so the shape is settled
 * here and nowhere else.
 *
 * The row is the host's. `Model.Info` declares every field this file reads
 * (`packages/schema/src/model.ts:103-126` at `v2.1.1`), and `Model.Info.default`
 * is the platform's own answer for a row that states nothing
 * (`packages/schema/src/model.ts:129-144` at `v2.1.1`). A thin row takes that
 * answer, so a caller that carries only part of the shape cannot crash a
 * routing decision.
 */

/** A row with the host's own defaults under it. */
const complete = (info: Model.Info): Model.Info => ({
  ...Model.Info.default(info.providerID, info.id),
  ...info,
});

/** The catalogue row, reduced to what a decision needs. */
export const known = (info: Model.Info): Known => {
  const row = complete(info);

  // The base cost is the entry with no context tier. The catalogue builds that
  // entry first and always, because `cost()` returns `[base, ...tiers]`
  // (`packages/core/src/models-dev.ts:139-150` at `v2.1.1`) and the tier is
  // optional on the entry (`packages/schema/src/model.ts:83-95` at `v2.1.1`).
  // A row with no cost entry costs nothing, and this reader states zero rather
  // than inventing a price from a tier it was not asked about.
  const base = row.cost.find((one) => one.tier === undefined);

  return {
    providerID: row.providerID,
    id: row.id,
    name: row.name,
    family: row.family,
    // The variant ids are the effort names, and this keeps the order the
    // catalogue gives them. `ladderOf` sorts, so a page can show the provider's
    // own list and still compare by the known order.
    rungs: row.variants.map((one) => one.id),
    costInput: base?.input ?? 0,
    costOutput: base?.output ?? 0,
    enabled: row.enabled,
    status: row.status,
    tools: row.capabilities.tools,
  };
};

/** The ladder a model holds, for the pages and the reports. */
export const ladder = (model: Known): Ladder => ladderOf(model.rungs.map((id) => ({ id })));

/** True when the model costs nothing. */
export const isFree = (model: Known): boolean => model.costInput === 0 && model.costOutput === 0;

/**
 * Why this row cannot be spent, or undefined when it can.
 *
 * A variant the model does not declare is refused here as well as in the check.
 * `rungFor` would otherwise ask the host for a rung the model cannot run, and a
 * redirect that reaches this normalizer alone must still be safe.
 */
const refused = (model: Known, variant: string | undefined): string | undefined => {
  const ref = `${model.providerID}/${model.id}`;
  if (!model.enabled) return `${ref} is disabled`;
  if (model.status === "deprecated") return `${ref} is deprecated`;
  if (!model.tools) return `${ref} cannot call tools`;
  if (variant !== undefined && !model.rungs.includes(variant))
    return `${ref} has no variant "${variant}". Variants: ${model.rungs.join(", ") || "none"}`;
  return undefined;
};

/**
 * The allowlist as candidates, in the order the file lists them.
 *
 * The order is the preference order, so it is never sorted. An entry that
 * does not resolve, is disabled, is deprecated, or cannot call tools is
 * reported as missing rather than dropped in silence.
 */
export const candidates = (
  allowed: ReadonlyArray<Allowed>,
  catalogue: ReadonlyArray<Model.Info>,
): {
  readonly kept: ReadonlyArray<Candidate>;
  readonly missing: ReadonlyArray<{
    readonly alias: string;
    readonly ref: string;
    readonly reason: string;
  }>;
} => {
  const kept: Array<Candidate> = [];
  const missing: Array<{ alias: string; ref: string; reason: string }> = [];

  for (const entry of allowed) {
    let ref: Model.Ref;
    try {
      // One parser for every ref in this folder. The check reads the same
      // string through `Model.Ref.parse`, so a shape one caller accepts is a
      // shape the other caller accepts.
      ref = Model.Ref.parse(entry.ref);
    } catch (e) {
      missing.push({ alias: entry.alias, ref: entry.ref, reason: (e as Error).message });
      continue;
    }

    // The variant the allowlist pinned is the only rung the model is asked
    // for, and it stays in the ref so the session can pass the string back
    // unchanged.
    const variant = entry.pinned ?? ref.variant;
    const written =
      variant === undefined
        ? formatRef(ref)
        : formatRef({ ...ref, variant: Model.VariantID.make(variant) });

    const info = catalogue.find((one) => one.providerID === ref.providerID && one.id === ref.id);
    if (info === undefined) {
      missing.push({
        alias: entry.alias,
        ref: written,
        reason: `${ref.providerID}/${ref.id} is not a model this session can see`,
      });
      continue;
    }

    const model = known(info);
    const why = refused(model, variant);
    if (why !== undefined) {
      missing.push({ alias: entry.alias, ref: written, reason: why });
      continue;
    }

    kept.push({ alias: entry.alias, ref: written, model, pinned: variant });
  }

  return { kept, missing };
};
