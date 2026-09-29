import type { Model, ModelInfo } from "./opencode";

/**
 * The one model the eval runs on, and the reason it is the only one. The
 * measurements that decided it:
 *
 * - `longcat` measured 23m56s for 54 rows at concurrency 6, an order of magnitude
 *   slower per call than the pinned model, and it exhausted the session twice.
 * - The rest of the free catalogue is paid per token on some providers, and
 *   routing quality is not the variable under test here. The pinned model costs
 *   zero.
 *
 * One model with five variants is worth more than nine models with one arm each:
 * `minimal` through `xhigh` differ only in reasoning effort, so the spread between
 * them is the part of the measurement that is actually about our descriptions.
 */
export const PINNED = "opencode/muse-spark-1.3-contributor-free";

export type Selection = {
  readonly models: ReadonlyArray<Model>;
  readonly skipped: ReadonlyArray<{ ref: string; why: string }>;
};

export const ref = (model: Model) =>
  `${model.providerID}/${model.id}${model.variant === undefined ? "" : `#${model.variant}`}`;

const wanted = (list: string | undefined) =>
  (list ?? "")
    .split(",")
    .map((one) => one.trim())
    .filter((one) => one !== "");

export type Options = {
  /** Override the pinned model. Comma separated, exact or substring. */
  readonly models?: string;
  /** Pin one variant instead of sweeping them all. */
  readonly variant?: string;
  /** Drop a variant, by name. */
  readonly skip?: string;
};

export const select = (all: ReadonlyArray<ModelInfo>, options: Options = {}): Selection => {
  const asked = wanted(options.models);
  const target = asked.length > 0 ? asked : [PINNED];
  const skip = wanted(options.skip);
  const models: Array<Model> = [];
  const skipped: Array<{ ref: string; why: string }> = [];

  for (const info of all) {
    const name = `${info.providerID}/${info.id}`;
    if (!target.some((entry) => name === entry || name.includes(entry))) continue;

    const variants = (info.variants ?? []).map((v) => v.id);
    if (options.variant !== undefined) {
      if (variants.includes(options.variant))
        models.push({ providerID: info.providerID, id: info.id, variant: options.variant });
      else
        throw new Error(
          `"${name}" has no variant "${options.variant}". It has: ${variants.join(", ") || "none"}`,
        );
      continue;
    }

    // No variants means one arm, named plainly rather than with an empty suffix.
    if (variants.length === 0) models.push({ providerID: info.providerID, id: info.id });
    for (const variant of variants) {
      if (skip.includes(variant)) {
        skipped.push({ ref: `${name}#${variant}`, why: "excluded by SPECTRE_EVAL_SKIP" });
        continue;
      }
      models.push({ providerID: info.providerID, id: info.id, variant });
    }
  }

  models.sort((a, b) => ref(a).localeCompare(ref(b)));

  if (models.length === 0)
    throw new Error(
      `no model matched ${target.join(", ")}. This session sees: ${all.map((m) => `${m.providerID}/${m.id}`).join(", ")}`,
    );

  return { models, skipped };
};
