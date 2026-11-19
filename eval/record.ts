import type { Prediction, Report, ReportUsage } from "./score";

export type Run = {
  readonly at: string;
  readonly slice: "all" | "held-out" | "blind";
  readonly catalogue: ReadonlyArray<string>;
  readonly arms: ReadonlyArray<{
    readonly name: string;
    readonly hitRate: number;
    readonly hit: number;
    readonly scored: number;
    readonly unparsable: number;
    readonly abstained: number;
    readonly perSkill: ReadonlyArray<{
      id: string;
      permitted: number;
      won: number;
      stolen: number;
    }>;
    readonly predictions: ReadonlyArray<Prediction>;
    readonly usage?: ReportUsage;
  }>;
};

export const snapshot = (
  slice: Run["slice"],
  catalogue: ReadonlyArray<string>,
  arms: ReadonlyArray<{ name: string; report: Report; predictions: ReadonlyArray<Prediction> }>,
): Run => ({
  at: new Date().toISOString(),
  slice,
  catalogue,
  arms: arms.map(({ name, report, predictions }) => ({
    name,
    hitRate: report.hitRate,
    hit: report.hit,
    scored: report.scored,
    unparsable: report.unparsable,
    abstained: report.abstained,
    perSkill: report.perSkill,
    predictions,
    ...(report.usage === undefined ? {} : { usage: report.usage }),
  })),
});

export type UsageDelta = {
  readonly before: ReportUsage;
  readonly after: ReportUsage;
  readonly total: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly cost: number;
  readonly tokensPerHit?: number;
};

export type Delta = {
  readonly arm: string;
  readonly before?: number;
  readonly after: number;
  readonly change?: number;
  readonly state: "new" | "gone" | "up" | "down" | "same";
  readonly usage?: UsageDelta;
};

const pct = (value: number) => `${(value * 100).toFixed(1)}%`;
const signedInt = (value: number) => `${value > 0 ? "+" : ""}${value}`;
const signedUsd = (value: number) =>
  `${value > 0 ? "+" : value < 0 ? "-" : ""}$${Math.abs(value).toFixed(4)}`;

/** Signed change per arm, so a sweep can be read as progress rather than a snapshot. */
export const deltas = (before: Run | undefined, after: Run): ReadonlyArray<Delta> => {
  const was = new Map((before?.arms ?? []).map((arm) => [arm.name, arm]));
  const now = new Map(after.arms.map((arm) => [arm.name, arm]));
  const names = [...new Set([...was.keys(), ...now.keys()])].toSorted();
  return names.map((name) => {
    const a = was.get(name);
    const b = now.get(name);
    if (a === undefined) return { arm: name, after: b!.hitRate, state: "new" as const };
    if (b === undefined) return { arm: name, before: a.hitRate, after: 0, state: "gone" as const };
    const change = b.hitRate - a.hitRate;
    const usage: UsageDelta | undefined =
      a.usage !== undefined && b.usage !== undefined
        ? {
            before: a.usage,
            after: b.usage,
            total: b.usage.total - a.usage.total,
            cacheRead: b.usage.cacheRead - a.usage.cacheRead,
            cacheWrite: b.usage.cacheWrite - a.usage.cacheWrite,
            cost: b.usage.cost - a.usage.cost,
            ...(a.usage.tokensPerHit !== undefined && b.usage.tokensPerHit !== undefined
              ? { tokensPerHit: b.usage.tokensPerHit - a.usage.tokensPerHit }
              : {}),
          }
        : undefined;
    return {
      arm: name,
      before: a.hitRate,
      after: b.hitRate,
      change,
      state: change > 0 ? ("up" as const) : change < 0 ? ("down" as const) : ("same" as const),
      ...(usage === undefined ? {} : { usage }),
    };
  });
};

export const deltaTable = (rows: ReadonlyArray<Delta>) => {
  const width = Math.max(24, ...rows.map((r) => r.arm.length));
  const hasUsage = rows.some((r) => r.usage !== undefined);
  const paired = rows.map((row) => {
    const u = row.usage;
    return {
      row,
      u:
        u === undefined
          ? { tokens: "-", cache: "-", cost: "-" }
          : {
              tokens: signedInt(u.total),
              cache: `${signedInt(u.cacheRead)}/${signedInt(u.cacheWrite)}`,
              cost: signedUsd(u.cost),
            },
    };
  });
  const tokensWidth = Math.max("tokens".length, ...paired.map(({ u }) => u.tokens.length));
  const cacheWidth = Math.max("cache(r/w)".length, ...paired.map(({ u }) => u.cache.length));
  const costWidth = Math.max("cost".length, ...paired.map(({ u }) => u.cost.length));
  const usageHeader = hasUsage
    ? `  ${"tokens".padStart(tokensWidth)}  ${"cache(r/w)".padStart(cacheWidth)}  ${"cost".padStart(costWidth)}`
    : "";
  const out = [
    `${"arm".padEnd(width)}  ${"before".padStart(7)}  ${"after".padStart(7)}  ${"change".padStart(8)}${usageHeader}`,
  ];
  for (const { row, u } of paired) {
    const before = row.before === undefined ? "-" : pct(row.before);
    const change =
      row.change === undefined
        ? row.state === "new"
          ? "new"
          : "gone"
        : `${row.change > 0 ? "+" : ""}${(row.change * 100).toFixed(1)}pp`;
    const usageSuffix = hasUsage
      ? `  ${u.tokens.padStart(tokensWidth)}  ${u.cache.padStart(cacheWidth)}  ${u.cost.padStart(costWidth)}`
      : "";
    out.push(
      `${row.arm.padEnd(width)}  ${before.padStart(7)}  ${pct(row.after).padStart(7)}  ${change.padStart(8)}${usageSuffix}`,
    );
  }
  return out.join("\n");
};

export type Flip = {
  readonly arm: string;
  readonly prompt: string;
  readonly from: string;
  readonly to: string;
};

/**
 * Rows that changed verdict between two runs. A leaf that gains four rows and
 * loses four is not progress, and the aggregate hides that, so the flips are
 * reported separately from the score.
 */
export const flips = (before: Run | undefined, after: Run): ReadonlyArray<Flip> => {
  if (before === undefined) return [];
  const was = new Map(
    before.arms.map((arm) => [arm.name, new Map(arm.predictions.map((p) => [p.prompt, p.got]))]),
  );
  const out: Array<Flip> = [];
  for (const arm of after.arms) {
    const old = was.get(arm.name);
    if (old === undefined) continue;
    for (const prediction of arm.predictions) {
      const from = old.get(prediction.prompt);
      if (from !== undefined && from !== prediction.got)
        out.push({ arm: arm.name, prompt: prediction.prompt, from, to: prediction.got });
    }
  }
  return out;
};
