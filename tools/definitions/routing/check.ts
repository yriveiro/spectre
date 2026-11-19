import { Model } from "@opencode/plugin/effect";
import { known as readKnown } from "./catalogue";
import { ceilingProblems, pinCeilingProblem } from "./ceiling";
import { effortOf, fit, ladderOf } from "./effort";
import { crosscheckOf, priorityOf } from "./order";
import { type CostCeiling, defaultAgentFor, formatRef, modelNames, type Tables } from "./types";

export type Row = { name: string; model: string };

/**
 * The contradiction between a pin and a ceiling, for one role.
 *
 * A pin names a model and a ceiling names a price. When the first is above the
 * second, the profile says two things that cannot both hold, and the report
 * names the role so the reader knows which one to change.
 */
const pinCeilingProblems = (
  label: string,
  pins: ReadonlyArray<string>,
  ceiling: CostCeiling | undefined,
  resolved: ReadonlyMap<string, string>,
  known: ReadonlyMap<string, Model.Info>,
): ReadonlyArray<string> => {
  if (ceiling === undefined) return [];
  const spent = pins.find((asked) => resolved.has(asked));
  const found = spent === undefined ? undefined : known.get(spent);
  const pin =
    spent === undefined || found === undefined ? undefined : { alias: spent, ...readKnown(found) };
  const problem = pinCeilingProblem(label, pin, ceiling);
  return problem === undefined ? [] : [problem];
};

export type Checked = {
  readonly models: ReadonlyArray<Row>;
  readonly profiles: ReadonlyArray<{
    name: string;
    models: ReadonlyArray<Row>;
    agent: string;
    why: string;
  }>;
  readonly problems: ReadonlyArray<string>;
};

/** The alias names a model, never a policy, so it cannot carry a variant suffix. */
const ALIAS = /^[a-z0-9][a-z0-9-]*$/;

/**
 * The allowlist is the whole vocabulary. A ref that does not resolve is reported
 * against the models the user did allow, never against the catalogue, so the list
 * is short enough not to need a cap and every name in it is one they chose.
 */
const allowed = (resolved: ReadonlyMap<string, string>): string =>
  [...resolved].map(([name, ref]) => `${name} (${ref})`).join(", ") || "none";

/**
 * How far one model's ladder reaches, for a report that puts what was asked for
 * beside what the ladder holds. Asking for `max` is the widest ask there is, so
 * what it answers is the top of the ladder.
 */
const reaches = (variants: Model.Info["variants"]): string => {
  const top = fit(ladderOf(variants), effortOf("max"));
  if (top.kind === "short")
    return top.best === undefined ? "nothing the effort order ranks" : top.best.name;
  return top.kind === "rung" ? top.at.name : "nothing";
};

/**
 * Every check collects, so one run shows the whole list. A model whose ref failed
 * is left out of `resolved`, so the profile pointing at it is skipped rather than
 * reported twice.
 */
export const check = (
  tables: Tables,
  catalogue: ReadonlyArray<Model.Info>,
  defaultAgent: string,
  spectreAgents: ReadonlyArray<string>,
): Checked => {
  const problems: Array<string> = [];
  const unresolved: Array<{ name: string; ref: string }> = [];
  const resolved = new Map<string, string>();
  const known = new Map<string, Model.Info>();
  const models: Array<Row> = [];

  const ordered = priorityOf(tables.models, tables.priority);
  problems.push(...ordered.problems);
  const crosscheck = crosscheckOf(
    tables.models,
    tables.crosscheck,
    ordered.ranked.map((one) => one.alias),
  );
  problems.push(...crosscheck.problems);

  for (const { alias: name, ref: raw } of ordered.ranked) {
    if (!ALIAS.test(name)) {
      problems.push(
        `models.${name}: "${name}" is not an alias the standard allows. The charset is ^[a-z0-9][a-z0-9-]*$`,
      );
      continue;
    }

    let ref: Model.Ref;
    try {
      ref = Model.Ref.parse(raw);
    } catch (e) {
      problems.push(`models.${name}: ${(e as Error).message}`);
      continue;
    }

    const found = catalogue.find((one) => one.providerID === ref.providerID && one.id === ref.id);
    if (found === undefined) {
      unresolved.push({ name, ref: formatRef(ref) });
      continue;
    }

    if (ref.variant !== undefined && !found.variants.some((one) => one.id === ref.variant)) {
      const have = found.variants.map((one) => one.id).join(", ");
      problems.push(
        `models.${name}: "${ref.variant}" is not a variant of ${ref.providerID}/${ref.id}. Variants: ${have || "none"}`,
      );
      continue;
    }

    resolved.set(name, formatRef(ref));
    known.set(name, found);
    models.push({ name, model: formatRef(ref) });
  }

  // Reported after the loop, so the list is the same whatever order the file
  // was written in.
  for (const one of unresolved)
    problems.push(
      `models.${one.name}: ${one.ref} is not a model this session can see. Allowed: ${allowed(resolved)}`,
    );

  const profiles: Array<{
    name: string;
    models: Array<Row>;
    agent: string;
    why: string;
  }> = [];

  for (const [name, entry] of Object.entries(tables.profiles)) {
    // The pin and the effort are alternatives, and a profile needs one of them:
    // neither states no requirement at all. Both together are legal, and the pin
    // wins — that precedence is the resolver's to honour, not this check's. The
    // effort is still read beside a pin, because a name the catalogue does not
    // carry is a typo whichever one wins.
    const pinned = entry.model ?? [];
    let ok = true;

    // A ceiling is a price, so it must be a finite number at or above zero, and
    // a ceiling that names no side constrains nothing.
    const ceiling = entry.maxCost;
    const checkedCeiling = ceilingProblems(`profiles.${name}.maxCost`, ceiling);
    problems.push(...checkedCeiling.problems);
    if (!checkedCeiling.ok) ok = false;

    const crossCeiling = entry.crosscheck?.maxCost;
    const checkedCrossCeiling = ceilingProblems(
      `profiles.${name}.crosscheck.maxCost`,
      crossCeiling,
    );
    problems.push(...checkedCrossCeiling.problems);
    if (!checkedCrossCeiling.ok) ok = false;

    const agent = entry.agent ?? defaultAgentFor(name, defaultAgent);
    if (!spectreAgents.includes(agent)) {
      problems.push(
        `profiles.${name}.agent: "${agent}" is not a spectre agent, so the run would not be in spectre mode. Spectre agents: ${spectreAgents.join(", ")}`,
      );
      ok = false;
    }

    if (entry.effort === undefined && pinned.length === 0) {
      problems.push(`profiles.${name}: states no requirement. Name an "effort", or pin a "model".`);
      ok = false;
    }

    if (entry.effort !== undefined) {
      const want = effortOf(entry.effort);
      if (!catalogue.some((one) => one.variants.some((v) => v.id === entry.effort))) {
        problems.push(
          `profiles.${name}.effort: "${entry.effort}" is not an effort any model in the catalogue declares`,
        );
        ok = false;
      } else {
        const reach = [...resolved].map(([alias, ref]) => {
          const ladder = ladderOf(known.get(alias)?.variants ?? []);
          return {
            alias,
            ref,
            qualifies: fit(ladder, want).kind === "rung",
            reaches: reaches(known.get(alias)?.variants ?? []),
          };
        });
        if (reach.every((one) => !one.qualifies)) {
          const detail =
            reach.length === 0
              ? "No model is allowed."
              : reach.map((one) => `${one.alias} (${one.ref}) reaches ${one.reaches}`).join("; ");
          problems.push(
            `profiles.${name}.effort: "${entry.effort}" is an effort no allowed model reaches. ${detail}`,
          );
          ok = false;
        }
      }
    }

    const rows: Array<Row> = [];
    for (const asked of pinned) {
      const model = resolved.get(asked);
      if (model === undefined) {
        if (!(asked in tables.models))
          problems.push(
            `profiles.${name}.model: "${asked}" is not a name in models. Names: ${
              Object.keys(tables.models).join(", ") || "none"
            }`,
          );
        continue;
      }
      rows.push({ name: asked, model });
    }
    if (rows.length !== pinned.length) ok = false;

    // A pin and a ceiling are two statements about the same spend. A pin above
    // the ceiling contradicts it, and the resolver cannot honour both.
    const primaryPinProblems = ok
      ? pinCeilingProblems(`profiles.${name}.maxCost`, pinned, ceiling, resolved, known)
      : [];
    problems.push(...primaryPinProblems);
    if (primaryPinProblems.length > 0) ok = false;

    // A crosscheck pin names an allowlist model too. The resolver spends the
    // first name it finds, so a name no model carries is a problem rather than
    // a silent fall back to the crosscheck list.
    for (const asked of modelNames(entry.crosscheck?.model)) {
      if (resolved.has(asked)) continue;
      if (!(asked in tables.models)) {
        problems.push(
          `profiles.${name}.crosscheck.model: "${asked}" is not a name in models. Names: ${
            Object.keys(tables.models).join(", ") || "none"
          }`,
        );
        ok = false;
      }
    }

    // The crosscheck's own ceiling wins; with none, the profile's ceiling is
    // the budget for the whole topology, the second call included.
    const crossLimit = crossCeiling ?? ceiling;
    const crossPinProblems = ok
      ? pinCeilingProblems(
          `profiles.${name}.crosscheck.maxCost`,
          modelNames(entry.crosscheck?.model),
          crossLimit,
          resolved,
          known,
        )
      : [];
    problems.push(...crossPinProblems);
    if (crossPinProblems.length > 0) ok = false;

    if (!ok) continue;
    profiles.push({ name, models: rows, agent, why: entry.why ?? "" });
  }

  return { models, profiles, problems };
};
