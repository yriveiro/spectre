import { boot } from "./boot";
import { verify } from "./catalogue";
import { observe } from "./observe";
import { complete, head, systemic } from "./guard";
import { ref, select } from "./models";
import { plan } from "./progress";
import { reporter } from "./reporter";
import { deltaTable, deltas, flips, snapshot, type Run } from "./record";
import { score, table, type Prediction, type Report } from "./score";
import type { Model, Opencode } from "./opencode";
import { heldOut, rows, type Row } from "./fixture";

// One level up from this file, which lives in `eval/`. When the harness lived in
// `test/skills/eval/` this needed three, and leaving it at three pointed the
// plugin at the directory above the repository, so it failed to load and the
// verification correctly refused. `boot` asserts the entrypoint is here so that
// class of mistake cannot be silent again.
const PLUGIN = new URL("../", import.meta.url).pathname;
const PORT = Number(Bun.env.SPECTRE_EVAL_PORT ?? 4489);
const FAST = Bun.argv.includes("--fast");
const ROWS = Number(Bun.argv.find((a) => a.startsWith("--rows="))?.slice("--rows=".length) ?? (FAST ? 12 : 0));
// The pinned model answers 429 under load, so a tier that has to finish in a
// coffee break runs one request at a time with a gap between them.
const CONCURRENCY = Number(Bun.env.SPECTRE_EVAL_CONCURRENCY ?? (FAST ? 1 : 6));
const DELAY = Number(Bun.env.SPECTRE_EVAL_DELAY ?? (FAST ? 1500 : 0));
const ABORT_AFTER = Number(Bun.env.SPECTRE_EVAL_ABORT_AFTER ?? 3);
const BASELINE = Bun.env.SPECTRE_EVAL_BASELINE;
const HELD_OUT = Bun.argv.includes("--held-out");
const ONLY = Bun.argv.find((a) => a.startsWith("--model="))?.slice("--model=".length);
const SKIP_LEXICAL = Bun.argv.includes("--no-ripwire");

/**
 * The model is asked to act, not to introspect, so the answer is a tool call
 * whenever the model makes one. A model that only replies in prose is counted in
 * its own column rather than blended with the models that called the tool,
 * because the two are measuring different things.
 */
const ASK =
  "Which one of the available skills should be loaded for the request below, or the word none if " +
  "none of them applies? If one applies, load it with the skill tool, then say its id and nothing " +
  "else. Do not do the work and do not use any other tool.";

const log = reporter();

const evaluate = async (
  client: Opencode,
  model: Model,
  corpus: ReadonlyArray<Row>,
  ids: ReadonlyArray<string>,
): Promise<ReadonlyArray<Prediction>> => {
  const out: Array<Prediction> = [];
  const bar = log.bar(ref(model), corpus.length);
  const reasons: Array<string | undefined> = [];
  let halted: string | undefined;
  let next = 0;
  const worker = async (): Promise<void> => {
    for (;;) {
      if (halted !== undefined) return;
      if (DELAY > 0) await Bun.sleep(DELAY);
      const index = next++;
      if (index >= corpus.length) return;
      const row = corpus[index]!;
      const session = await client.session(model);
      try {
        await client.prompt(session.id, `${ASK}\n\nRequest: ${row.prompt}`);
        await client.wait(session.id);
        const transcript = await client.transcript(session.id);
        if (transcript.failure !== undefined) throw new Error(transcript.failure.reason);
        const seen = observe(transcript, ids);
        out[index] = { prompt: row.prompt, ...seen };
        bar.advance(seen.via === "silent" ? "no assistant text or skill call" : undefined);
      } catch (cause) {
        const why = (cause as Error).message.slice(0, 80);
        out[index] = { prompt: row.prompt, got: `(failed: ${why})`, via: "silent" };
        bar.fail(why);
        reasons.push(why);
        halted = systemic(reasons, ABORT_AFTER);
        if (halted !== undefined)
          log.say(`  halted   ${ref(model)}: ${ABORT_AFTER} rows failed with the same reason, not a routing result`);
        bar.advance(why);
      } finally {
        await client.remove(session.id).catch(() => {});
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, corpus.length) }, worker));
  bar.finish();
  return out;
};

const corpus: ReadonlyArray<Row> = HELD_OUT ? heldOut : ROWS === 0 ? rows : head(rows, ROWS);

const scratch = `${Bun.env.TMPDIR ?? "/tmp"}spectre-skill-eval-${process.pid}`;
const booting = log.bar("starting opencode", 1);
const { client, registered, stop } = await boot({ plugin: PLUGIN, directory: scratch, port: PORT });
booting.advance();
booting.finish("listening");

try {
  const { load } = await import("../skills/definitions");
  const { Effect } = await import("effect");
  const ours: ReadonlyArray<string> = (await Effect.runPromise(load())).map((s) => s.id).toSorted();

  // A session has to exist before the registration line is emitted, so this waits
  // on a session rather than on a timer. The route is only accepted as evidence
  // once it actually carries one of our ids: on a fresh project it answers with
  // the global catalogue first, and taking that at face value reports thirteen
  // missing leaves when the plugin has simply not loaded yet.
  const probe = await client.session({ providerID: "opencode", id: "mimo-v2.6-flash-free" });
  await client.prompt(probe.id, "reply with the single word: ok");
  await client.wait(probe.id);

  const deadline = Date.now() + 30_000;
  let source: "log" | "route" | "none" = "none";
  let registeredIds: ReadonlyArray<string> | undefined;
  for (;;) {
    const logged = registered();
    if (logged !== undefined && logged.length > 0) {
      source = "log";
      registeredIds = logged;
      break;
    }
    const viaRoute = (await client.skills().catch(() => [])).map((s) => s.id);
    if (viaRoute.some((id) => ours.includes(id))) {
      source = "route";
      registeredIds = viaRoute;
    }
    if (Date.now() > deadline) break;
    await Bun.sleep(400);
  }
  await client.remove(probe.id).catch(() => {});

  const problems = verify(registeredIds, ours, source);
  if (problems.length > 0) {
    for (const p of problems) log.say(`  REFUSING  ${p}`);
    throw new Error("catalogue not verified, see above");
  }
  log.say(`  verified  ${ours.length} skills, source: the ${source}\n`);

  const picked = select(await client.models(), {
    models: ONLY ?? Bun.env.SPECTRE_EVAL_MODELS,
    variant: Bun.env.SPECTRE_EVAL_VARIANT,
    skip: Bun.env.SPECTRE_EVAL_SKIP,
  });
  const models = picked.models;
  for (const skip of picked.skipped)
    log.say(`  skipped  ${skip.ref.padEnd(44)} ${skip.why}`);
  if (models.length === 0) throw new Error("every free model was excluded, nothing to compare");

  log.say(
    `  ${corpus.length} rows (${HELD_OUT ? "held out" : "all"}), ${ours.length} skills, ${models.length} free model${models.length === 1 ? "" : "s"}`,
  );
  log.say(plan({ models: models.length, rows: corpus.length, concurrency: CONCURRENCY }) + "\n");

  const arms: Array<{ name: string; report: Report; predictions: ReadonlyArray<Prediction> }> = [];

  if (!SKIP_LEXICAL) {
    const ripwire = Bun.which("ripwire") as string | null;
    if (ripwire === null) log.say("  ripwire is not on PATH, skipping the lexical arms\n");
    else {
      const { writeMirror } = await import("./mirror");
      const mirror = `${scratch}/mirror`;
      const bar = log.bar("lexical arms (ripwire)", 1);
      await writeMirror(mirror);
      await Bun.write(
        `${scratch}/eval.tsv`,
        `${corpus.map((r) => `${r.prompt}\t${r.label}\t${r.provenance}`).join("\n")}\n`,
      );
      const run = Bun.spawnSync([ripwire, mirror, `--eval-skills=${scratch}/eval.tsv`], {
        stdout: "pipe",
        stderr: "pipe",
      });
      const out = `${run.stdout.toString()}${run.stderr.toString()}`;
      for (const arm of ["bm25-desc", "bm25-full", "overlap", "for-routed", "random"]) {
        const hitRate = Number(
          out.match(new RegExp(`^ *${arm} +\\S+ +\\S+ +\\S+ +([0-9.]+)`, "m"))?.[1] ?? 0,
        );
        arms.push({
          name: `lex:${arm}`,
          predictions: [],
          report: {
            scored: corpus.length,
            hit: Math.round(hitRate * corpus.length),
            hitRate,
            unparsable: 0,
            abstained: 0,
            byVia: { skill: 0, tool: 0, text: 0, silent: 0 },
            perSkill: [],
            misses: [],
          },
        });
      }
      bar.advance();
      bar.finish("done");
    }
  }

  for (const model of models) {
    const predictions = await evaluate(client, model, corpus, ours);
    if (!complete(predictions, corpus.length)) {
      // A halted run leaves holes. Scoring them as misses would report a rate
      // limit as a routing result, which is the exact false green this harness
      // already produced once.
      const answered = predictions.filter((one) => one !== undefined).length;
      log.say(`  skipped  ${ref(model)}: ${answered} of ${corpus.length} rows answered, which is not a result`);
      continue;
    }
    const report = score(corpus, predictions, ours);
    arms.push({ name: `model:${ref(model)}`, report, predictions });
    log.setResult(ref(model), report.hitRate);
  }

  log.say(`\n${table(arms.map(({ name, report }) => ({ name, report })))}`);

  const byPrompt = new Map<string, Map<string, number>>();
  for (const arm of arms.filter((a) => a.name.startsWith("model:")))
    for (const miss of arm.report.misses) {
      const answers = byPrompt.get(miss.prompt) ?? new Map<string, number>();
      answers.set(miss.got, (answers.get(miss.got) ?? 0) + 1);
      byPrompt.set(miss.prompt, answers);
    }
  if (byPrompt.size > 0) {
    const weight = ([, a]: [string, Map<string, number>]) =>
      [...a.values()].reduce((x, y) => x + y, 0);
    log.say(`\nrows models miss (${byPrompt.size} of ${corpus.length}), and what they answer instead:`);
    for (const [prompt, answers] of [...byPrompt].sort((a, b) => weight(b) - weight(a)).slice(0, 18)) {
      const got = [...answers].sort((a, b) => b[1] - a[1]).map(([id, n]) => `${id} x${n}`).join(", ");
      log.say(`  ${JSON.stringify(prompt).padEnd(54)} -> ${got}`);
    }
  }

  const current = snapshot(HELD_OUT ? "held-out" : "all", ours, arms);
  if (BASELINE !== undefined) {
    const previous = (await Bun.file(BASELINE).exists())
      ? ((await Bun.file(BASELINE).json()) as Run)
      : undefined;
    log.say(`\n${deltaTable(deltas(previous, current))}`);
    const changed = flips(previous, current);
    if (changed.length > 0) {
      log.say(`\n${changed.length} answers changed since ${previous?.at ?? "the baseline"}:`);
      for (const flip of changed.slice(0, 24))
        log.say(
          `  ${flip.arm.padEnd(32)} ${JSON.stringify(flip.prompt).slice(0, 40).padEnd(42)} ${flip.from} -> ${flip.to}`,
        );
      if (changed.length > 24) log.say(`  ... and ${changed.length - 24} more`);
    }
    await Bun.write(BASELINE, `${JSON.stringify(current, null, 2)}\n`);
    log.say(`\n  baseline written to ${BASELINE}`);
  } else {
    log.say("\n  set SPECTRE_EVAL_BASELINE=<path> to keep a run and diff the next one");
  }
} finally {
  stop();
  log.close(false);
  await Bun.$`rm -rf ${scratch}`.quiet();
}
