/**
 * The routing harness: it prices the profiles, runs the arms, and prints one
 * table with the price beside the hit rate.
 *
 * The price comes from the resolver the tool runs, over the config the tool
 * reads and the catalogue the server holds. The lexical arm needs no server to
 * answer rows, but both arms need one to price the table, so the server boots
 * in every run.
 *
 * The server boots with no plugin. The question in `arms.ts` carries the
 * profiles in its own text, and this process reads the config through the
 * tool's own loader, so nothing the run measures depends on the plugin.
 */
import type { Model } from "@opencode/schema/model";
import { Effect } from "effect";
import {
  candidates,
  DEFAULT_AGENT,
  DEFAULT_TIMEOUT_MS,
  jevJudge,
  load,
  resolveProfile,
  SYSTEMONE_ENDPOINT,
  SYSTEMONE_KEY_ENV,
} from "../../tools/definitions/routing";
import { boot } from "../boot";
import { head, systemic } from "../guard";
import { progress } from "../progress";
import { ask, type Description, jev, lexical } from "./arms";
import { blind, tuned } from "./fixture";
import { prices } from "./prices";
import { type Report, score } from "./score";

// The root sits two levels up from here, one more than `eval/run.ts` reports
// for its own home. `boot` joins `index.ts` onto the path it is given, so the
// string has to end with a separator.
const PLUGIN = new URL("../../", import.meta.url).pathname;
// The project the config is read from. The checkout's own file is the default,
// and the override points a run at a scratch directory, which is how the
// refusal paths are proved without touching the checkout's config.
const PROJECT = Bun.env.SPECTRE_ROUTING_PROJECT ?? PLUGIN;
// 4490, not the skill harness's 4489, so the two evals can run at once.
const PORT = Number(Bun.env.SPECTRE_ROUTING_PORT ?? 4490);
const BLIND = Bun.argv.includes("--blind");
const TUNED = Bun.argv.includes("--tuned");
const NO_MODEL = Bun.argv.includes("--no-model");
const ROWS = Number(Bun.argv.find((a) => a.startsWith("--rows="))?.slice("--rows=".length) ?? 0);
const ARM_MODEL = Bun.env.SPECTRE_ROUTING_MODEL ?? "opencode-go/minimax-m3.1-flash-free";
// `Model.Ref` on the wire is a struct of provider, id and an optional variant
// (`packages/schema/src/model.ts:19-23` at `v2.1.1`), even though its `parse`
// takes a string. The written ref is split once, here, and sent split.
const armRef = (() => {
  const slash = ARM_MODEL.indexOf("/");
  if (slash <= 0) throw new Error(`SPECTRE_ROUTING_MODEL: "${ARM_MODEL}" is not provider/id`);
  const hash = ARM_MODEL.indexOf("#", slash + 1);
  const id = hash === -1 ? ARM_MODEL.slice(slash + 1) : ARM_MODEL.slice(slash + 1, hash);
  if (id === "") throw new Error(`SPECTRE_ROUTING_MODEL: "${ARM_MODEL}" is not provider/id`);
  const variant = hash === -1 ? undefined : ARM_MODEL.slice(hash + 1);
  return {
    providerID: ARM_MODEL.slice(0, slash),
    id,
    ...(variant === undefined || variant === "" ? {} : { variant }),
  };
})();
const CONCURRENCY = Math.max(1, Number(Bun.env.SPECTRE_ROUTING_CONCURRENCY ?? 3));
const DELAY = Number(Bun.env.SPECTRE_ROUTING_DELAY ?? 0);
const TIMEOUT_MS = Number(Bun.env.SPECTRE_ROUTING_TIMEOUT ?? 120_000);
const RETRIES = 3;
const ABORT_AFTER = Number(Bun.env.SPECTRE_ROUTING_ABORT_AFTER ?? 3);

const say = (line: string): void => {
  process.stdout.write(`${line}\n`);
};

/**
 * A refused run, not a failed one. The reasons are on the console, so the error
 * carries no message of its own. It is thrown rather than the process ending
 * here, because a run that ends in place would leave the booted server bound
 * to its port and the scratch directory on the disk.
 */
class Refused extends Error {}

const refuse = (line: string): never => {
  say(`  REFUSING  ${line}`);
  throw new Refused();
};

/**
 * One row per arm: the hit rate, and the price of the wrong answers beside it.
 * A hit rate without the price reads as progress and says nothing about money.
 */
const WIDTHS = { hit: 9, rate: 6, regret: 8, "regret/row": 10, abstain: 7, fired: 5 } as const;
const COLUMNS = Object.keys(WIDTHS) as ReadonlyArray<keyof typeof WIDTHS>;

const table = (arms: ReadonlyArray<{ name: string; report: Report }>): string => {
  const width = Math.max(...arms.map((one) => one.name.length), 4);
  const bar = COLUMNS.map((one) => "-".repeat(WIDTHS[one]));
  const lines = [
    `${"arm".padEnd(width)}  ${COLUMNS.map((one) => one.padStart(WIDTHS[one])).join("  ")}`,
    `${"-".repeat(width)}  ${bar.join("  ")}`,
  ];
  for (const arm of arms) {
    const r = arm.report;
    lines.push(
      [
        arm.name.padEnd(width),
        `${r.hit}/${r.scored}`.padStart(WIDTHS.hit),
        `${(r.hitRate * 100).toFixed(1)}%`.padStart(WIDTHS.rate),
        r.regret.toFixed(3).padStart(WIDTHS.regret),
        r.regretPerRow.toFixed(3).padStart(WIDTHS["regret/row"]),
        String(r.abstained).padStart(WIDTHS.abstain),
        String(r.fired).padStart(WIDTHS.fired),
      ].join("  "),
    );
  }
  return lines.join("\n");
};

const all = [...tuned, ...blind];
const corpus = BLIND ? blind : TUNED ? tuned : ROWS === 0 ? all : head(all, ROWS);

// The tool reads the global file first and the project's second. The eval reads
// through the same loader, so the surface it prices is the surface the tool
// routes on, and not a file it re-decoded its own way.
const found = await Effect.runPromise(load(PROJECT));
if (found.problems.length > 0) refuse(found.problems.join("\n            "));
if (found.sources.length === 0)
  refuse(
    `no routing config anywhere the tool reads, so there is nothing to price. Write ${PROJECT}spectre.json.`,
  );
const tables = found.tables;

const allowed = Object.entries(tables.models).map(([alias, ref]) => ({
  alias,
  ref,
  pinned: undefined,
}));
if (allowed.length === 0) refuse(`${PROJECT}spectre.json: models is empty, so no model routes`);

// The judge's settings, from the same config the tool reads.
const judgeSettings = tables.judge;

const slice = BLIND ? "blind" : TUNED ? "tuned" : "all";
say(
  `  ${corpus.length} rows (${slice}), ${Object.keys(tables.profiles).length} profiles, ` +
    `allowlist ${allowed.length} model${allowed.length === 1 ? "" : "s"}`,
);

const scratch = `${Bun.env.TMPDIR ?? "/tmp"}spectre-routing-eval-${process.pid}`;
const booting = progress({ label: "starting opencode", total: 1 });
const { client, stop } = await boot({ directory: scratch, port: PORT });
booting.advance();
booting.finish("listening");

try {
  // The route answers `Location.response(Schema.Array(Model.Info))`
  // (`packages/protocol/src/groups/model.ts:10-12` at `v2.1.1`), so the wire
  // carries cost, family, status and tools. The local `ModelInfo` type names
  // only the fields the skill eval reads, hence the cast.
  const listed = (await client.models()) as ReadonlyArray<Model.Info>;
  const kept = candidates(allowed, listed);
  if (kept.missing.length > 0)
    refuse(
      kept.missing
        .map((one) => `models.${one.alias}: ${one.ref} — ${one.reason}`)
        .join("\n            "),
    );

  // The number `prices` returns is the resolver's. Two facts of a resolver
  // answer do not fit a price: the ref that was spent, and the reason a
  // profile found no model. The side maps hold them for the printed table.
  const spentRefs = new Map<string, string>();
  const refusals = new Map<string, string>();
  const priced = (name: string) => {
    const entry = tables.profiles[name];
    if (entry === undefined) return undefined;
    const one = resolveProfile(name, entry, kept.kept, DEFAULT_AGENT);
    if (one.problem !== undefined) {
      refusals.set(name, one.problem);
      return undefined;
    }
    if (one.resolution === undefined) {
      refusals.set(name, "the resolver returned no model");
      return undefined;
    }
    const primary = one.resolution.primary;
    // The ref as the tool composes the spend string (`tools/definitions/routing/index.ts:166-167`):
    // a ref the allowlist pinned carries its variant, and a rung is added only to a bare one.
    spentRefs.set(
      name,
      primary.rung === undefined || primary.ref.includes("#")
        ? primary.ref
        : `${primary.ref}#${primary.rung}`,
    );
    return { rate: primary.costInput + primary.costOutput, effort: entry.effort };
  };

  const profileRows = Object.entries(tables.profiles).map(([name, entry]) => ({
    name,
    effort: entry.effort,
  }));
  const priceList = prices(profileRows, priced);

  // A judged row with no price stops the run, because the score would price
  // the redo at zero and read as free. The reason is the resolver's own.
  const judged = new Set(
    corpus.filter((row) => row.provenance === "judged").map((row) => row.label),
  );
  const unpriced = [...judged].filter((name) => !priceList.some((one) => one.profile === name));
  if (unpriced.length > 0) {
    for (const name of unpriced)
      say(
        `  REFUSING  ${name}: ` +
          (tables.profiles[name] === undefined
            ? "the config carries no profile of this name"
            : (refusals.get(name) ?? "the resolver named no model")),
      );
    throw new Refused();
  }

  say("\n  prices, from the resolver over the live catalogue:");
  for (const one of priceList)
    say(
      `    ${one.profile.padEnd(11)} ${(one.effort ?? "pinned").padEnd(7)} ` +
        `${(spentRefs.get(one.profile) ?? "").padEnd(46)} ${one.rate.toFixed(3)}/m`,
    );

  // The surface both arms rank: the `match` lines, in the order the config
  // lists the profiles. A profile with no match line cannot be picked by
  // reading the surface, so it is named and left out rather than dropped in
  // silence.
  const described: Array<Description> = [];
  for (const [name, entry] of Object.entries(tables.profiles)) {
    if (entry.match === undefined) {
      say(`  note      ${name}: no match line, so no arm can pick it by reading the surface`);
      continue;
    }
    described.push({ profile: name, text: entry.match });
  }
  if (described.length === 0)
    refuse("no profile carries a match line, so there is no surface to rank");

  const prompts = corpus.map((row) => row.prompt);
  const arms: Array<{ name: string; report: Report }> = [
    { name: "lex:match", report: score(corpus, lexical(described, prompts), priceList) },
  ];

  // The System One arm, when the config asks for a judge and the key is
  // there. It is the third arm the feature file names, and it is the one that
  // carries a probability.
  if (judgeSettings !== undefined) {
    const key = judgeSettings.key ?? SYSTEMONE_KEY_ENV;
    if (Bun.env[key] === undefined) say(`\n  jev arm: skipped, ${key} is not in the environment\n`);
    else {
      say(`\n  jev arm: ${judgeSettings.model ?? "the configured model"}`);
      // The arm reads the key from the environment itself, so the settings
      // carry the variable's name and not its value. The second argument is
      // the surface: the profile names and their match lines.
      const judge = jevJudge(
        {
          model: judgeSettings.model ?? "jev-1.13-free",
          endpoint: judgeSettings.endpoint ?? SYSTEMONE_ENDPOINT,
          keyEnv: key,
          timeout: judgeSettings.timeout ?? DEFAULT_TIMEOUT_MS,
        },
        Object.fromEntries(
          Object.entries(tables.profiles).map(([name, entry]) => [name, entry.match]),
        ),
      );
      arms.push({ name: "jev", report: score(corpus, await jev(judge, prompts), priceList) });
    }
  }

  if (!NO_MODEL) {
    say(`\n  model arm: ${ARM_MODEL}, ${CONCURRENCY} at a time`);
    const bar = progress({ label: ARM_MODEL, total: corpus.length });
    const failures: Array<{ prompt: string; reason: string }> = [];
    const reasons: Array<string | undefined> = [];
    let halted: string | undefined;

    // `ask` sends every prompt at once, so the cap lives here. One release
    // hands the slot straight to the next waiter, so a waiter that resumes
    // late can never read the count as free.
    let inFlight = 0;
    const waiters: Array<() => void> = [];
    const acquire = async (): Promise<void> => {
      if (inFlight < CONCURRENCY) {
        inFlight += 1;
        return;
      }
      await new Promise<void>((done) => waiters.push(done));
    };
    const release = (): void => {
      const next = waiters.shift();
      if (next !== undefined) next();
      else inFlight -= 1;
    };

    // The route is the one-shot generation the server holds
    // (`packages/protocol/src/groups/generate.ts:8-14` at `v2.1.1`): one call,
    // one reply, no session, and the model named in the payload. One attempt,
    // thrown on anything that is not a reply, so the retry loop has exactly
    // one caller and the failure reason is raised in one place.
    const once = async (prompt: string): Promise<string> => {
      const out = await client.raw<{ text: string }>("/api/experimental/generate", {
        method: "POST",
        body: JSON.stringify({ prompt, model: armRef }),
        signal: AbortSignal.timeout(TIMEOUT_MS),
      });
      if (out.text.trim() === "") throw new Error("an empty reply");
      return out.text;
    };

    const generate = async (prompt: string): Promise<string> => {
      await acquire();
      try {
        if (halted !== undefined) {
          failures.push({ prompt, reason: halted });
          return "";
        }
        if (DELAY > 0) await Bun.sleep(DELAY);
        for (let attempt = 1; ; attempt++) {
          try {
            return await once(prompt);
          } catch (cause) {
            const why = (cause as Error).message.slice(0, 120);
            if (attempt >= RETRIES) {
              failures.push({ prompt, reason: why });
              reasons.push(why);
              bar.fail(why);
              halted = systemic(reasons, ABORT_AFTER);
              if (halted !== undefined)
                say(
                  `  halted   ${ARM_MODEL}: ${ABORT_AFTER} rows failed with the same reason, not a routing result`,
                );
              return "";
            }
            await Bun.sleep(attempt === 1 ? 2000 : 6000);
          }
        }
      } finally {
        release();
        bar.advance();
      }
    };

    const predictions = await ask(generate, described, prompts);
    bar.finish();

    // The skill harness's rule: a run with holes is not a result. The holes
    // here carry a prediction of `none`, so the guard is the failure list and
    // not the shape of the array.
    if (failures.length > 0) {
      const distinct = [...new Set(failures.map((one) => one.reason))];
      say(
        `  skipped  ${ARM_MODEL}: ${failures.length} of ${corpus.length} rows failed upstream, which is not a result`,
      );
      for (const why of distinct.slice(0, 4)) say(`           ${why}`);
      if (distinct.length > 4) say(`           ... and ${distinct.length - 4} more`);
    } else {
      arms.push({ name: `model:${ARM_MODEL}`, report: score(corpus, predictions, priceList) });
    }
  }

  say(`\n${table(arms)}`);

  // The rows, priced and sorted by what they cost. A row that fired on a
  // negative row costs zero and sits at the foot of the list.
  for (const arm of arms) {
    const misses = [...arm.report.misses].sort((a, b) => b.cost - a.cost);
    if (misses.length === 0) continue;
    say(
      `\nwhere the money went — ${arm.name} (${misses.length} miss${misses.length === 1 ? "" : "es"}, ` +
        `${arm.report.regret.toFixed(3)} total):`,
    );
    for (const miss of misses)
      say(
        `  ${miss.cost.toFixed(3).padStart(7)}  ${miss.want} -> ${miss.got}  ` +
          `${JSON.stringify(miss.prompt).slice(0, 64)}`,
      );
  }
} catch (cause) {
  // A refusal is not a crash, so the console already holds the reasons and the
  // error is swallowed after the server is stopped. Anything else propagates.
  if (!(cause instanceof Refused)) throw cause;
  process.exitCode = 1;
} finally {
  stop();
  await Bun.$`rm -rf ${scratch}`.quiet();
}
