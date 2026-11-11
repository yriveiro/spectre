/**
 * The allowlist in priority order.
 *
 * The file states the order in `priority`, never in the order the `models`
 * object happens to have. Object order is insertion order, and insertion order
 * is a record of when a model was added, not a decision about what to spend.
 * The two structures are checked against each other so a name that is missing,
 * unknown, or listed twice is a problem rather than a silent reordering.
 */

export type Ranked = {
  readonly alias: string;
  readonly ref: string;
  /** The one-based position in the preference order. */
  readonly priority: number;
};

export type Ordered = {
  readonly ranked: ReadonlyArray<Ranked>;
  readonly problems: ReadonlyArray<string>;
};

const names = (models: Readonly<Record<string, string>>): ReadonlyArray<string> =>
  Object.keys(models);

/**
 * The models in priority order, and every disagreement between `models` and
 * `priority`.
 *
 * A file that states no `priority` is ordered by insertion so a page can still
 * show what it read, and the problem says the order is not explicit. The tool
 * withholds the table on any problem, so an implicit order never routes.
 */
export const priorityOf = (
  models: Readonly<Record<string, string>>,
  priority: ReadonlyArray<string> | undefined,
): Ordered => {
  if (priority === undefined) {
    if (names(models).length === 0) return { ranked: [], problems: [] };
    return {
      ranked: names(models).map((alias, at) => ({
        alias,
        ref: models[alias] ?? "",
        priority: at + 1,
      })),
      problems: [
        "priority: states no priority order. The page writes it; list every model name in the order the resolver reads.",
      ],
    };
  }

  const problems: Array<string> = [];
  const seen = new Set<string>();
  const ranked: Array<Ranked> = [];

  for (const alias of priority) {
    if (!Object.hasOwn(models, alias)) {
      problems.push(
        `priority: "${alias}" is not a model in models. Names: ${names(models).join(", ") || "none"}`,
      );
      continue;
    }
    if (seen.has(alias)) {
      problems.push(`priority: "${alias}" is listed twice.`);
      continue;
    }
    seen.add(alias);
    ranked.push({ alias, ref: models[alias] ?? "", priority: ranked.length + 1 });
  }

  for (const alias of names(models))
    if (!seen.has(alias))
      problems.push(`priority: "${alias}" is missing. Every model needs a place in the order.`);

  return { ranked, problems };
};

export type CrosscheckOrder = {
  /** The aliases that may serve a crosscheck, in fallback order. */
  readonly listed: ReadonlyArray<string>;
  readonly problems: ReadonlyArray<string>;
};

/**
 * The crosscheck fallback order.
 *
 * The list is a subset of the allowlist, so a model that is absent is off
 * rather than missing. Undefined keeps the old behaviour: every allowed model
 * is a candidate, in allowlist priority order. An empty list is a decision:
 * no model serves a second opinion.
 */
export const crosscheckOf = (
  models: Readonly<Record<string, string>>,
  crosscheck: ReadonlyArray<string> | undefined,
  fallback: ReadonlyArray<string>,
): CrosscheckOrder => {
  if (crosscheck === undefined) return { listed: fallback, problems: [] };

  const problems: Array<string> = [];
  const listed: Array<string> = [];
  const seen = new Set<string>();

  for (const alias of crosscheck) {
    if (!Object.hasOwn(models, alias)) {
      problems.push(
        `crosscheck: "${alias}" is not a model in models. Names: ${names(models).join(", ") || "none"}`,
      );
      continue;
    }
    if (seen.has(alias)) {
      problems.push(`crosscheck: "${alias}" is listed twice.`);
      continue;
    }
    seen.add(alias);
    listed.push(alias);
  }

  return { listed, problems };
};
