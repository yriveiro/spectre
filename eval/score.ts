import type { Row } from "./fixture";
import { addUsage, type UsageSummary } from "./opencode";

export type { UsageSummary };

export const NONE = "none";

export const permitted = (label: string): ReadonlyArray<string> =>
  label === NONE ? [NONE] : label.split(",").map((one) => one.trim());

/**
 * What the model did, in the order the evidence gets stronger. `skill` is an
 * activation OpenCode recorded, which is the thing it routes on. `tool` is a
 * skill tool call the model made. `text` is prose that named an id, and `silent`
 * is nothing at all. They are four different measurements, so the table prints
 * four columns.
 */
export type Via = "skill" | "tool" | "text" | "silent";

/** A prediction the model produced for one prompt. `got` is NONE when it declined. */
export type Prediction = { prompt: string; got: string; via: Via; usage?: UsageSummary };

export type Miss = { prompt: string; want: ReadonlyArray<string>; got: string };

export type PerSkill = {
  readonly id: string;
  readonly permitted: number;
  readonly won: number;
  readonly stolen: number;
};

export type ReportUsage = UsageSummary & {
  readonly tokensPerHit?: number;
};

export type Report = {
  readonly scored: number;
  readonly hit: number;
  readonly hitRate: number;
  readonly unparsable: number;
  readonly abstained: number;
  readonly byVia: Readonly<Record<Via, number>>;
  readonly perSkill: ReadonlyArray<PerSkill>;
  readonly misses: ReadonlyArray<Miss>;
  readonly usage?: ReportUsage;
};

const rate = (hit: number, total: number) => (total === 0 ? 0 : hit / total);

/**
 * A `got` that is not a skill this plugin registers and not `none` is a
 * disagreement about the catalog, not a routing mistake, so it is counted as a
 * miss and reported apart. Folding it into the miss list hides the one failure
 * a reader most needs to see: the model reaching for something that is not here.
 */
export const score = (
  rows: ReadonlyArray<Row>,
  predictions: ReadonlyArray<Prediction>,
  catalogue: ReadonlyArray<string>,
): Report => {
  const byPrompt = new Map(predictions.map((one) => [one.prompt, one]));
  const predictionFor = (prompt: string) => byPrompt.get(prompt);
  const got = new Map(predictions.map((one) => [one.prompt, one.got]));
  const known = new Set([...catalogue, NONE]);

  const per = new Map<string, { permitted: number; won: number; stolen: number }>();
  for (const id of catalogue) per.set(id, { permitted: 0, won: 0, stolen: 0 });

  const misses: Array<Miss> = [];
  const usages: Array<UsageSummary> = [];
  const byVia: Record<Via, number> = { skill: 0, tool: 0, text: 0, silent: 0 };
  let hit = 0;
  let unparsable = 0;
  let abstained = 0;

  for (const row of rows) {
    const want = permitted(row.label);
    const prediction = predictionFor(row.prompt);
    const answer = got.get(row.prompt);
    for (const id of want) {
      const entry = per.get(id);
      if (entry !== undefined) entry.permitted += 1;
    }
    byVia[prediction?.via ?? "silent"] += 1;
    if (prediction?.usage !== undefined) usages.push(prediction.usage);
    if (answer === undefined) {
      misses.push({ prompt: row.prompt, want, got: "(no reply)" });
      continue;
    }
    if (!known.has(answer)) unparsable += 1;
    if (answer === NONE) abstained += 1;
    if (want.includes(answer)) {
      hit += 1;
      const entry = per.get(answer);
      if (entry !== undefined) entry.won += 1;
    } else {
      misses.push({ prompt: row.prompt, want, got: answer });
      const entry = per.get(answer);
      if (entry !== undefined) entry.stolen += 1;
    }
  }

  let usage: ReportUsage | undefined;
  if (usages.length > 0) {
    const summed = addUsage(usages);
    usage = {
      ...summed,
      ...(hit > 0 ? { tokensPerHit: summed.total / hit } : {}),
    };
  }

  return {
    scored: rows.length,
    hit,
    hitRate: rate(hit, rows.length),
    unparsable,
    abstained,
    byVia,
    perSkill: [...per].map(([id, entry]) => ({ id, ...entry })),
    misses,
    ...(usage === undefined ? {} : { usage }),
  };
};

export type Arm = { readonly name: string; readonly report: Report };

/**
 * ripwire prints one row per arm: the arm name, then hit@1, hit@2, mrr, the
 * separation AUC and the fire/abstain bound. The hit rate is the first column
 * after the name.
 *
 * Reading a later column read the AUC as a hit rate, and the table showed the
 * random floor at 50%. A random ranking over 82 skills cannot hit half the
 * rows, so the random arm is the check on this parser: it reads a fraction of
 * one percent, not a half.
 */
export const hitRateOf = (out: string, arm: string): number =>
  Number(out.match(new RegExp(`^ *${arm} +([0-9.]+)%`, "m"))?.[1] ?? 0) / 100;

/** One table, so a model arm and a lexical arm can be read against each other. */
export const table = (arms: ReadonlyArray<Arm>) => {
  const width = Math.max(...arms.map((arm) => arm.name.length), 4);
  const cells = (r: Report) => `${r.byVia.skill}/${r.byVia.tool}/${r.byVia.text}/${r.byVia.silent}`;
  const hasUsage = arms.some((arm) => arm.report.usage !== undefined);
  const usageCells = (r: Report) => {
    const u = r.usage;
    if (u === undefined) return { tokens: "-", cache: "-", perHit: "-", cost: "-" };
    return {
      tokens: String(u.total),
      cache: `${u.cacheRead}/${u.cacheWrite}`,
      perHit: u.tokensPerHit === undefined ? "-" : u.tokensPerHit.toFixed(0),
      cost: `$${u.cost.toFixed(4)}`,
    };
  };
  const paired = arms.map((arm) => ({ arm, u: usageCells(arm.report) }));
  const tokensWidth = Math.max("tokens".length, ...paired.map(({ u }) => u.tokens.length));
  const cacheWidth = Math.max("cache(r/w)".length, ...paired.map(({ u }) => u.cache.length));
  const perHitWidth = Math.max("tok/hit".length, ...paired.map(({ u }) => u.perHit.length));
  const costWidth = Math.max("cost".length, ...paired.map(({ u }) => u.cost.length));
  const usageHeader = hasUsage
    ? `  ${"tokens".padStart(tokensWidth)}  ${"cache(r/w)".padStart(cacheWidth)}  ${"tok/hit".padStart(perHitWidth)}  ${"cost".padStart(costWidth)}`
    : "";
  const usageBar = hasUsage
    ? `  ${"-".repeat(tokensWidth)}  ${"-".repeat(cacheWidth)}  ${"-".repeat(perHitWidth)}  ${"-".repeat(costWidth)}`
    : "";
  const lines = [
    `${"arm".padEnd(width)}  ${"hit@1".padStart(6)}  ${"hits".padStart(7)}  ${"skill/tool/text/silent".padStart(23)}  ${"off-catalogue".padStart(13)}${usageHeader}`,
    `${"-".repeat(width)}  ${"-".repeat(6)}  ${"-".repeat(7)}  ${"-".repeat(23)}  ${"-".repeat(13)}${usageBar}`,
  ];
  for (const { arm, u } of paired) {
    const r = arm.report;
    const usageSuffix = hasUsage
      ? `  ${u.tokens.padStart(tokensWidth)}  ${u.cache.padStart(cacheWidth)}  ${u.perHit.padStart(perHitWidth)}  ${u.cost.padStart(costWidth)}`
      : "";
    lines.push(
      `${arm.name.padEnd(width)}  ${(rate(r.hitRate, 1) * 100).toFixed(1).padStart(5)}%  ${`${r.hit}/${r.scored}`.padStart(7)}  ${cells(r).padStart(23)}  ${String(r.unparsable).padStart(13)}${usageSuffix}`,
    );
  }
  return lines.join("\n");
};
