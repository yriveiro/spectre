import type { Row } from "./fixture";

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
export type Prediction = { prompt: string; got: string; via: Via };

export type Miss = { prompt: string; want: ReadonlyArray<string>; got: string };

export type PerSkill = {
  readonly id: string;
  readonly permitted: number;
  readonly won: number;
  readonly stolen: number;
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
  const byVia: Record<Via, number> = { skill: 0, tool: 0, text: 0, silent: 0 };
  let hit = 0;
  let unparsable = 0;
  let abstained = 0;

  for (const row of rows) {
    const want = permitted(row.label);
    const answer = got.get(row.prompt);
    for (const id of want) {
      const entry = per.get(id);
      if (entry !== undefined) entry.permitted += 1;
    }
    byVia[predictionFor(row.prompt)?.via ?? "silent"] += 1;
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

  return {
    scored: rows.length,
    hit,
    hitRate: rate(hit, rows.length),
    unparsable,
    abstained,
    byVia,
    perSkill: [...per].map(([id, entry]) => ({ id, ...entry })),
    misses,
  };
};

export type Arm = { readonly name: string; readonly report: Report };

/** One table, so a model arm and a lexical arm can be read against each other. */
export const table = (arms: ReadonlyArray<Arm>) => {
  const width = Math.max(...arms.map((arm) => arm.name.length), 4);
  const cells = (r: Report) =>
    `${r.byVia.skill}/${r.byVia.tool}/${r.byVia.text}/${r.byVia.silent}`;
  const lines = [
    `${"arm".padEnd(width)}  ${"hit@1".padStart(6)}  ${"hits".padStart(7)}  ${"skill/tool/text/silent".padStart(23)}  ${"off-catalogue".padStart(13)}`,
    `${"-".repeat(width)}  ${"-".repeat(6)}  ${"-".repeat(7)}  ${"-".repeat(23)}  ${"-".repeat(13)}`,
  ];
  for (const arm of arms) {
    const r = arm.report;
    lines.push(
      `${arm.name.padEnd(width)}  ${(rate(r.hitRate, 1) * 100).toFixed(1).padStart(5)}%  ${`${r.hit}/${r.scored}`.padStart(7)}  ${cells(r).padStart(23)}  ${String(r.unparsable).padStart(13)}`,
    );
  }
  return lines.join("\n");
};
