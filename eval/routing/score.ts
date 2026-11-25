import { effortOf } from "../../tools/definitions/routing";
import type { Row } from "./fixture";

export const NONE = "none";

const NO_REPLY = "(no reply)";

export type Price = {
  readonly profile: string;
  readonly rate: number;
  readonly effort: string | undefined;
};

export type Miss = {
  readonly prompt: string;
  readonly want: string;
  readonly got: string;
  readonly cost: number;
};

export type PerProfile = {
  readonly profile: string;
  readonly rows: number;
  readonly hit: number;
  readonly regret: number;
};

export type Report = {
  readonly scored: number;
  readonly hit: number;
  readonly hitRate: number;
  readonly abstained: number;
  readonly fired: number;
  readonly byProfile: ReadonlyArray<PerProfile>;
  readonly misses: ReadonlyArray<Miss>;
  readonly regret: number;
  readonly regretPerRow: number;
};

export const blendedRate = (costInput: number, costOutput: number): number =>
  (10 * costInput + costOutput) / 11;

const requirePrice = (
  byName: ReadonlyMap<string, Price>,
  profile: string,
  prompt: string,
): Price => {
  const found = byName.get(profile);
  if (found === undefined) {
    throw new Error(
      `no price for the profile "${profile}" on row "${prompt}", and a redo priced at zero reads as free`,
    );
  }
  return found;
};

const missRegret = (want: Price, got: Price): number => {
  const wantEffort = want.effort === undefined ? undefined : effortOf(want.effort);
  const gotEffort = got.effort === undefined ? undefined : effortOf(got.effort);

  if (wantEffort?.kind === "known" && gotEffort?.kind === "known") {
    if (gotEffort.rank < wantEffort.rank) return got.rate + want.rate;
    if (gotEffort.rank > wantEffort.rank) return Math.max(0, got.rate - want.rate);
    return got.rate + want.rate;
  }

  return got.rate > want.rate ? Math.max(0, got.rate - want.rate) : got.rate + want.rate;
};

const scoreNegativeRow = (
  prompt: string,
  got: string,
  byName: ReadonlyMap<string, Price>,
): { readonly fired: number; readonly miss?: Miss } => {
  if (got === NONE) return { fired: 0 };
  if (got === NO_REPLY) return { fired: 0, miss: { prompt, want: NONE, got, cost: 0 } };
  const gotPrice = requirePrice(byName, got, prompt);
  return { fired: 1, miss: { prompt, want: NONE, got, cost: gotPrice.rate } };
};

export const score = (
  rows: ReadonlyArray<Row>,
  predictions: ReadonlyArray<{ readonly prompt: string; readonly got: string }>,
  prices: ReadonlyArray<Price>,
): Report => {
  const answered = new Map(predictions.map((one) => [one.prompt, one.got]));
  const byName = new Map(prices.map((one) => [one.profile, one]));
  const per = new Map<string, { rows: number; hit: number; regret: number }>();
  const misses: Array<Miss> = [];
  let scored = 0;
  let hit = 0;
  let abstained = 0;
  let fired = 0;
  let regret = 0;

  for (const row of rows) {
    const got = answered.get(row.prompt) ?? NO_REPLY;

    if (row.provenance === "neg") {
      const neg = scoreNegativeRow(row.prompt, got, byName);
      fired += neg.fired;
      if (neg.miss !== undefined) {
        regret += neg.miss.cost;
        misses.push(neg.miss);
      }
      continue;
    }

    const wantPrice = requirePrice(byName, row.label, row.prompt);
    const entry = per.get(row.label) ?? { rows: 0, hit: 0, regret: 0 };
    per.set(row.label, entry);
    scored += 1;
    entry.rows += 1;

    if (got === row.label) {
      hit += 1;
      entry.hit += 1;
      continue;
    }

    if (got === NONE) abstained += 1;
    const cost =
      got === NONE || got === NO_REPLY
        ? wantPrice.rate
        : missRegret(wantPrice, requirePrice(byName, got, row.prompt));
    regret += cost;
    entry.regret += cost;
    misses.push({ prompt: row.prompt, want: row.label, got, cost });
  }

  return {
    scored,
    hit,
    hitRate: scored === 0 ? 0 : hit / scored,
    abstained,
    fired,
    byProfile: [...per].map(([profile, entry]) => ({ profile, ...entry })),
    misses,
    regret,
    regretPerRow: scored > 0 ? regret / scored : rows.length > 0 ? regret / rows.length : 0,
  };
};
