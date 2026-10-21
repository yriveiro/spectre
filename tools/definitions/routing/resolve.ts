import { isFree, ladder } from "./catalogue";
import { type Effort, effortOf, type Fit, fit, type Ladder, ladderOf } from "./effort";
import type { Candidate, Excluded, Pick, ProfileEntry, Resolution } from "./types";

/**
 * The selection policy, and the report it produces.
 *
 * The policy is one rule: the first candidate in the allowlist's order that
 * meets the requirement is the one that is spent. Cost is reported beside it
 * and never reorders it.
 *
 * The effort rule is `effort.ts` and the catalogue read is `catalogue.ts`.
 * Nothing here reads a `Model.Info`, and nothing here compares two effort
 * names: both decisions are made below this file.
 */

/** The ladder the allowlist asks this candidate for. A pinned variant is the only rung. */
const asked = (candidate: Candidate): Ladder =>
  candidate.pinned === undefined ? ladder(candidate.model) : ladderOf([{ id: candidate.pinned }]);

/** The rung to ask a candidate for, and why. */
export const rungFor = (candidate: Candidate, want: Effort): Fit => fit(asked(candidate), want);

/**
 * True when the fit meets the requirement.
 *
 * A model with no rung at all has no thinking control. `features/routing.md`
 * says it "qualifies only for `none`", because a profile that asks for nothing
 * is served by the model as it is.
 */
const qualifies = (got: Fit, want: Effort): boolean => {
  if (got.kind === "rung") return true;
  if (got.kind === "floor") return want.kind === "known" && want.name === "none";
  return false;
};

/** The highest rung a fit names, which is how far a candidate reaches. */
const reaches = (got: Fit): string | undefined => {
  if (got.kind === "rung") return got.at.name;
  if (got.kind === "short") return got.best?.name;
  return undefined;
};

/** Which role a requirement is read for, so the report can name it. */
type Role = "effort" | "crosscheck";

/** The requirement as a sentence fragment. */
const askOf = (role: Role, want: Effort): string =>
  role === "crosscheck" ? `the crosscheck at "${want.name}"` : `"${want.name}"`;

/** Why a candidate cannot serve a requirement. */
const reason = (got: Fit, role: Role, want: Effort): string => {
  const ask = askOf(role, want);
  const cannot = role === "crosscheck" ? `cannot serve ${ask}` : `cannot reach ${ask}`;
  if (got.kind === "floor") return `has no thinking control, so it ${cannot}`;
  const top = got.kind === "short" ? got.best?.name : undefined;
  return top === undefined
    ? `${cannot}. The effort order places none of its rungs`
    : `${cannot}. Its highest rung is "${top}"`;
};

/** The report's row for a model that was spent. */
export const pick = (
  candidate: Candidate,
  rung: string | undefined,
  flags: {
    readonly pinned: boolean;
    readonly steppedUp: boolean;
    readonly below: string | undefined;
  },
): Pick => ({
  alias: candidate.alias,
  ref: candidate.ref,
  rung,
  pinned: flags.pinned,
  steppedUp: flags.steppedUp,
  below: flags.below,
  family: candidate.model.family,
  rungs: [...candidate.model.rungs],
  costInput: candidate.model.costInput,
  costOutput: candidate.model.costOutput,
});

/**
 * The row for a spent candidate.
 *
 * A pin asks for no rung, so it reports the variant the allowlist named and
 * nothing else. A floor model reports no rung too, because it has none to ask
 * for. A rung the ladder had to step up to keeps the requirement beside it, so
 * the reader can see the gap.
 */
const spent = (candidate: Candidate, got: Fit | undefined, pinned: boolean): Pick => {
  if (pinned)
    return pick(candidate, candidate.pinned, {
      pinned: true,
      steppedUp: false,
      below: undefined,
    });
  if (got === undefined || got.kind !== "rung")
    return pick(candidate, undefined, { pinned: false, steppedUp: false, below: undefined });
  return pick(candidate, got.at.name, {
    pinned: false,
    steppedUp: got.at.name !== got.want.name,
    below: got.below?.name,
  });
};

/** The row for a candidate that did not qualify. */
const excludedRow = (candidate: Candidate, got: Fit, why: string): Excluded => ({
  alias: candidate.alias,
  ref: candidate.ref,
  reason: why,
  // The model's own rungs, in catalogue order. What it was asked for is the
  // fit's business, and `reaches` reports that.
  rungs: [...candidate.model.rungs],
  reaches: reaches(got),
});

/** The pin names as a list, whether the caller read the file or the tables. */
const names = (model: ProfileEntry["model"]): ReadonlyArray<string> => {
  if (model === undefined) return [];
  return typeof model === "string" ? [model] : model;
};

/** One candidate, and what it was asked for under each requirement. */
type Row = {
  readonly candidate: Candidate;
  readonly got: Fit | undefined;
  readonly cross: Fit | undefined;
};

/** Every candidate with the fit of each requirement, in the allowlist's order. */
const rowsFor = (
  candidates: ReadonlyArray<Candidate>,
  want: Effort | undefined,
  crossWant: Effort | undefined,
): ReadonlyArray<Row> =>
  candidates.map((candidate) => ({
    candidate,
    got: want === undefined ? undefined : rungFor(candidate, want),
    cross: crossWant === undefined ? undefined : rungFor(candidate, crossWant),
  }));

/**
 * The crosscheck: the first candidate whose catalogue family differs from the
 * primary's, and never the first whose alias differs.
 *
 * `prefer: "free"` takes the first zero-cost one that qualifies. It falls back
 * to the first qualifying one, because a preference that found nothing is not a
 * filter.
 */
const crossOf = (
  rows: ReadonlyArray<Row>,
  primary: Candidate,
  crossWant: Effort,
  prefer: "free" | undefined,
): Row | undefined => {
  const family = primary.model.family;
  // A second opinion needs two stated families. A row whose catalogue gives no
  // family cannot be shown to differ from the primary, so this rule does not
  // read it as a different one.
  if (family === undefined) return undefined;

  const eligible = rows.filter((one) => {
    if (one.cross === undefined) return false;
    if (one.candidate === primary) return false;
    const theirs = one.candidate.model.family;
    if (theirs === undefined || theirs === family) return false;
    return qualifies(one.cross, crossWant);
  });
  const free = eligible.find((one) => isFree(one.candidate.model));
  return prefer === "free" ? (free ?? eligible[0]) : eligible[0];
};

/**
 * Every candidate that did not qualify, in the allowlist's order, with the
 * highest rung it reaches.
 *
 * A candidate that meets the profile's requirement but not the crosscheck's is
 * reported for the crosscheck, and only when its family makes it a candidate
 * for that role. A model that was spent is never excluded, whatever the other
 * requirement would have said about it.
 */
const excludedBy = (
  rows: ReadonlyArray<Row>,
  primary: Candidate | undefined,
  want: Effort | undefined,
  crossWant: Effort | undefined,
  crossRow: Row | undefined,
): ReadonlyArray<Excluded> => {
  const excluded: Array<Excluded> = [];

  for (const one of rows) {
    if (one.candidate === primary || one.candidate === crossRow?.candidate) continue;

    if (want !== undefined) {
      if (one.got === undefined || !qualifies(one.got, want)) {
        if (one.got !== undefined)
          excluded.push(excludedRow(one.candidate, one.got, reason(one.got, "effort", want)));
        continue;
      }
    }

    if (crossWant === undefined || primary === undefined) continue;
    const family = primary.model.family;
    const theirs = one.candidate.model.family;
    // The same rule the crosscheck reads: two stated families that differ.
    if (family === undefined || theirs === undefined || theirs === family) continue;
    if (one.cross === undefined || qualifies(one.cross, crossWant)) continue;
    excluded.push(
      excludedRow(one.candidate, one.cross, reason(one.cross, "crosscheck", crossWant)),
    );
  }

  return excluded;
};

/** The answer once a model was spent. */
const spentBy = (
  profile: string,
  agent: string,
  primary: Pick,
  crossRow: Row | undefined,
  excluded: ReadonlyArray<Excluded>,
  crossWant: Effort | undefined,
): {
  readonly resolution: Resolution | undefined;
  readonly excluded: ReadonlyArray<Excluded>;
  readonly problem: string | undefined;
} => ({
  resolution: {
    profile,
    agent,
    primary,
    crosscheck:
      crossRow === undefined || crossRow.cross === undefined
        ? undefined
        : spent(crossRow.candidate, crossRow.cross, false),
    crosscheckProblem:
      crossWant === undefined || crossRow !== undefined
        ? undefined
        : `the crosscheck at "${crossWant.name}" found no allowed model from another family.`,
    excluded,
  },
  excluded,
  problem: undefined,
});

/**
 * One profile, resolved. The crosscheck is the first candidate whose
 * catalogue family differs from the primary's, and `prefer: "free"` takes the
 * first zero-cost one.
 */
export const resolve = (
  profile: string,
  entry: ProfileEntry,
  candidates: ReadonlyArray<Candidate>,
  defaultAgent: string,
): {
  readonly resolution: Resolution | undefined;
  readonly excluded: ReadonlyArray<Excluded>;
  readonly problem: string | undefined;
} => {
  const agent = entry.agent ?? defaultAgent;
  const pins = names(entry.model);

  // A pin skips the requirement. The first pinned name the allowlist holds is
  // the one spent, so a pin list keeps the preference order the old file gave
  // `model`.
  let pinned: Candidate | undefined;
  for (const name of pins) {
    pinned = candidates.find((one) => one.alias === name);
    if (pinned !== undefined) break;
  }
  if (pins.length > 0 && pinned === undefined)
    return {
      resolution: undefined,
      excluded: [],
      problem: `profiles.${profile}.model: "${pins[0]}" is not an allowed model in this session, so the pin cannot be resolved.`,
    };

  // The crosscheck states its own effort. A crosscheck with none reads the
  // profile's own requirement, so the second opinion is asked at the same
  // level by default.
  const crossName =
    entry.crosscheck === undefined ? undefined : (entry.crosscheck.effort ?? entry.effort);
  const crossWant = crossName === undefined ? undefined : effortOf(crossName);

  if (pinned !== undefined) {
    const rows = rowsFor(candidates, undefined, crossWant);
    const crossRow =
      crossWant === undefined
        ? undefined
        : crossOf(rows, pinned, crossWant, entry.crosscheck?.prefer);
    return spentBy(
      profile,
      agent,
      spent(pinned, undefined, true),
      crossRow,
      excludedBy(rows, pinned, undefined, crossWant, crossRow),
      crossWant,
    );
  }

  if (entry.effort === undefined)
    return {
      resolution: undefined,
      excluded: [],
      problem: `profiles.${profile}: it states no effort and no model, so the resolver has no requirement.`,
    };

  const want = effortOf(entry.effort);
  const rows = rowsFor(candidates, want, crossWant);

  // The primary is the first candidate in the allowlist's order that meets the
  // requirement. Cost is never read here.
  const chosen = rows.find((one) => one.got !== undefined && qualifies(one.got, want));

  if (chosen === undefined) {
    const capacity = rows.map(
      (one) =>
        `${one.candidate.alias} ${one.got === undefined ? "no rung" : (reaches(one.got) ?? "no rung")}`,
    );
    const verb = want.kind === "known" ? "reaches" : "declares";
    return {
      resolution: undefined,
      excluded: excludedBy(rows, undefined, want, crossWant, undefined),
      problem: `profiles.${profile}.effort: no allowed model ${verb} "${want.name}". Highest rungs: ${capacity.join(", ") || "none"}.`,
    };
  }

  const crossRow =
    crossWant === undefined
      ? undefined
      : crossOf(rows, chosen.candidate, crossWant, entry.crosscheck?.prefer);

  return spentBy(
    profile,
    agent,
    spent(chosen.candidate, chosen.got, false),
    crossRow,
    excludedBy(rows, chosen.candidate, want, crossWant, crossRow),
    crossWant,
  );
};
