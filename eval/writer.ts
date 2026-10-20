/**
 * The writer of a fresh blind batch.
 *
 * A row in the blind slice is held to a stricter bar than "routes correctly":
 * nothing the instrument already knows may have shaped it, or the batch is
 * measuring our editing of it rather than the descriptions. This script is the
 * guarantee that the batch can prove. It boots OpenCode with the plugin absent,
 * so the writer sees no descriptions, no skills, and none of our prose — then
 * asks for one sentence in the voice of a person at work, per id.
 *
 * The ids the writer sees are the corpus's own labels. An id names a moment
 * ("principle-build-the-lever"); it is not a description, and the batch of rows
 * this script produces is judged against that difference by `eval/bar.ts` before
 * a row is accepted.
 *
 * The script's guarantee ends where review begins: it cannot know whether the
 * sentence it receives is a fair instantiation of the id, only that the writer —
 * which saw no description — produced it. The reviewer, who may read the
 * descriptions, keeps the rows whose moment fits the leaf and drops those the
 * writer invented a different situation for. Only the fair rows land in
 * `eval/fixture.ts`, and a blind row with a wrong label is noise in the
 * denominator, not a miss.
 *
 * Run it redirected, so stdout carries only the batch:
 *
 *   bun eval/writer.ts > eval/batch.json 2> writer.log
 *
 * The turn uses the `generate` route (one completion, no agent loop) because a
 * person's sentence is the whole job here: a prompt loop would tool-call its way
 * around the scratch project and never write the sentence.
 *
 * A re-ask run pins leaves by id:
 *
 *   SPECTRE_WRITER_ONLY="principle-evidence,riprwire" SPECTRE_WRITER_NEGATIVES=0 \
 *     bun eval/writer.ts > eval/reask.json 2> reask.log
 */
import { offences, permitted } from "./bar";
import { boot } from "./boot";
import { blind, heldOut, tuned } from "./fixture";
import { systemic } from "./guard";
import { ref, select } from "./models";
import type { Model, Opencode } from "./opencode";

const PORT = Number(Bun.env.SPECTRE_WRITER_PORT ?? 4494);
const CONCURRENCY = Number(Bun.env.SPECTRE_WRITER_CONCURRENCY ?? 6);
const ABORT_AFTER = Number(Bun.env.SPECTRE_WRITER_ABORT_AFTER ?? 3);
const ATTEMPTS = Number(Bun.env.SPECTRE_WRITER_ATTEMPTS ?? 3);
const NEGATIVES = Number(Bun.env.SPECTRE_WRITER_NEGATIVES ?? 5);
/** SPECTRE_WRITER_LIMIT trims the leaf list for a smoke run; 0 means all. */
const LIMIT = Number(Bun.env.SPECTRE_WRITER_LIMIT ?? 0);
/** SPECTRE_WRITER_ONLY pins the leaf list by id, comma separated, for a re-ask run. */
const ONLY = (Bun.env.SPECTRE_WRITER_ONLY ?? "")
  .split(",")
  .map((one) => one.trim())
  .filter((one) => one !== "");

/**
 * `low` on purpose. A fresh batch wants the voice of a tired person at work, and
 * more reasoning effort writes principled prose, which is what the four-word bar
 * exists to reject. `SPECTRE_WRITER_VARIANT` overrides it for an arm of a
 * different effort, never silently.
 */
const VARIANT = Bun.env.SPECTRE_WRITER_VARIANT ?? "low";

/**
 * The leaves the batch covers: every id the corpus names today, judged slices
 * included. Replacing `blind` keeps whatever the held-out and tuned slices
 * measure, so the fresh batch covers exactly those ids and nothing invents
 * itself here.
 */
const leaves = () =>
  [...new Set([...tuned, ...heldOut, ...blind].filter((r) => r.label !== "none").flatMap((r) => permitted(r.label)))]
    .toSorted();

const PERSONAS = [
  "a backend engineer maintaining a small fleet of services",
  "a frontend engineer who owns a component library",
  "the person on call for a data pipeline",
  "an SRE halfway through a migration",
  "one reviewer with nine open pull requests",
  "a platform engineer building internal tooling",
  "a startup's only developer",
  "a QA engineer who writes the regression suite",
];

const ask = (id: string, persona: string, retry: number): string => {
  const again = retry === 0 ? "" : " Your previous line was rejected. Write a different sentence: plainer, more concrete, a new angle on the same situation.";
  return `You are ${persona}, mid-task. Below is a work situation named by an id from a study of engineering practice:

<id>${id}</id>

Write exactly one sentence that a real person might say out loud — to a teammate or to an assistant — at the moment that situation is happening to them. The sentence is the moment, not the lesson: say what is going on, not what should be done about it.${again}

Rules: plain everyday english, lower case like a chat message; 6 to 24 words; name something concrete (a service, a schema, a pull request, a dashboard, a cron job, a test suite) when it fits; no lists, no markdown, no code, no quotation marks, no trailing period; never use the words skill, principle, agent, router.
Reply with the sentence and nothing else.`;
};

const negativesAsk = (persona: string, retry: number): string => {
  const again = retry === 0 ? "" : " Your previous line was rejected. Write a different sentence about a different ordinary task.";
  return `You are ${persona}, at work. Write exactly one sentence a developer might say today about an ordinary, routine task — a chore about files, tooling or process, not a question about how to do something well.${again}

Rules: plain everyday english, lower case like a chat message; 6 to 18 words; no lists, no markdown, no quotation marks, no trailing period; never use the words skill, principle, agent, router.
Reply with the sentence and nothing else.`;
};

/**
 * The sentence has to be one line of chat. Anything else — a list, a fence, an
 * explanation of the id — repeats what the bar test would reject later, so the
 * writer rejects it earlier and spends the retry there.
 */
const clean = (raw: string): string | undefined => {
  let text = raw
    .trim()
    .replace(/^```[a-z]*\s*/i, "")
    .replace(/```\s*$/, "")
    .trim();
  text = text
    .split("\n")
    .map((line) => line.trim().replace(/^(?:[-*]|\d+[.)])\s+/, ""))
    .filter((line) => line !== "")
    .join(" ");
  if (text.startsWith('"') && text.endsWith('"')) text = text.slice(1, -1).trim();
  if (text.startsWith("'") && text.endsWith("'")) text = text.slice(1, -1).trim();
  if (text.endsWith(".")) text = text.slice(0, -1).trim();
  text = text.charAt(0).toLowerCase() + text.slice(1);
  if (text.length < 10) return undefined;
  if (/```|\||http|^\s*#/.test(text)) return undefined;
  if (/\b(skill|skills|principle|agent|router|instruction)\b/i.test(text)) return undefined;
  const count = text.split(/\s+/).length;
  if (count < 6 || count > 24) return undefined;
  if (!/[a-z]/.test(text)) return undefined;
  return text;
};

/**
 * Writes one leaf by throwing fresh sessions at it. Returns the row, or a reason
 * for the caller to count, because three leaves failing for one quota is not a
 * batch of opinions — the run stops there instead of grinning through it.
 */
const writeOne = async (
  client: Opencode,
  model: Model,
  id: string,
  personaIndex: number,
  descriptions: ReadonlyMap<string, string>,
  taken: ReadonlySet<string>,
): Promise<{ prompt: string } | { why: string }> => {
  let why: string | undefined;
  for (let attempt = 0; attempt < ATTEMPTS; attempt++) {
    const persona = PERSONAS[(personaIndex + attempt) % PERSONAS.length]!;
    const isNegative = id.startsWith("neg-");
    const text = isNegative ? negativesAsk(persona, attempt) : ask(id, persona, attempt);
    const session = await client.session(model);
    try {
      const result = await client.generate(session.id, text);
      const answer = result.text ?? result.content ?? result.data ?? "";
      const prompt = clean(String(answer));
      if (prompt === undefined) {
        why = "unreadable sentence";
        continue;
      }
      if (taken.has(prompt.toLowerCase())) {
        why = "duplicate of a row the corpus already holds";
        continue;
      }
      if (!isNegative) {
        const bad = offences([{ prompt, label: id }], descriptions);
        if (bad.length > 0) {
          why = `shares a run with the description it names (${bad[0]!.shared} words)`;
          continue;
        }
      }
      return { prompt };
    } catch (cause) {
      why = (cause as Error).message.slice(0, 120);
    } finally {
      await client.remove(session.id).catch(() => {});
    }
  }
  return { why: why ?? "no attempts left" };
};

const say = (line: string) => console.error(`[writer] ${line}`);

const scratch = `${Bun.env.TMPDIR ?? "/tmp"}spectre-writer-${process.pid}`;
const { client, stop } = await boot({ directory: scratch, port: PORT });

const { load } = await import("../skills/definitions");
const { Effect } = await import("effect");

try {
  const definitions = await Effect.runPromise(load());
  const descriptions = new Map<string, string>(
    definitions.map((one) => [one.id as string, one.description ?? ""]),
  );

  const targets = (ONLY.length > 0 ? leaves().filter((id) => ONLY.includes(id)) : leaves()).toSorted();
  const shown = LIMIT > 0 ? targets.slice(0, LIMIT) : targets;
  const negatives = Array.from({ length: NEGATIVES }, (_, index) => `neg-${index}`);
  say(`${shown.length} leaves, ${negatives.length} negatives, model pinned, concurrency ${CONCURRENCY}`);

  const model = select(await client.models(), { variant: VARIANT }).models[0]!;
  say(`writer: ${ref(model)} (plugin absent, so the descriptions are not in its context)`);

  const taken = new Set(
    [...tuned, ...heldOut].map((row) => row.prompt.toLowerCase()),
  );

  const rows: Record<string, string> = {};
  const failures: Array<{ id: string; why: string }> = [];
  const reasons: Array<string> = [];
  let halted: string | undefined;

  let next = 0;
  const queue = [...shown, ...negatives];
  const worker = async (workerIndex: number): Promise<void> => {
    for (;;) {
      if (halted !== undefined) return;
      const index = next++;
      if (index >= queue.length) return;
      const id = queue[index]!;
      const result = await writeOne(client, model, id, workerIndex, descriptions, taken);
      if ("why" in result) {
        failures.push({ id, why: result.why });
        reasons.push(result.why.split("(")[0]!.trim());
        if (systemic(reasons, ABORT_AFTER) !== undefined) {
          halted = `${ABORT_AFTER} rows failed with the same reason: ${result.why}`;
          say(`halted: ${halted}, not a batch of opinions`);
        }
        continue;
      }
      rows[id] = result.prompt;
      taken.add(result.prompt.toLowerCase());
      say(`${Object.keys(rows).length}/${queue.length} ${id}`);
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, (_, i) => worker(i)));

  if (halted !== undefined) throw new Error(`writer aborted: ${halted}`);
  if (failures.length > 0)
    for (const f of failures) say(`MISSING ${f.id}: ${f.why}`);

  console.log(
    JSON.stringify(
      {
        model: ref(model),
        leaves: Object.fromEntries(
        targets
          .filter((id) => rows[id] !== undefined && (LIMIT <= 0 || shown.includes(id)))
          .map((id) => [id, rows[id]!]),
      ),
        negatives: negatives.flatMap((id) => (rows[id] === undefined ? [] : [rows[id]!])),
        failed: failures.map((f) => f.id),
      },
      null,
      2,
    ),
  );
} finally {
  stop();
}
