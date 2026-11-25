import { join } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
import { InstructionEntry } from "@opencode/schema/instruction-entry";
import type { PromptInput } from "@opencode/schema/prompt-input";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { ledger } from "./ledger";
import type { Claim } from "./neuron";
import { standing } from "./standing";

const BRAIN_KEY = InstructionEntry.Key.make("spectre.brain");
const CORTEX_CAP = 600;
const WORKER_CAP = 250;
const COLD =
  "brain is cold: 0 claims. tools.spectre.brain action=recall answers nothing until it has claims; mnemonic seeds it";

export { COLD, CORTEX_CAP, WORKER_CAP };

// Tokens are characters / 4, the rough estimate features/brain.md allows.
export const tokens = (text: string): number => Math.ceil(text.length / 4);

type Index = {
  readonly key: string;
  readonly claims: ReadonlyArray<string>;
  readonly totalOnDisk: number;
  readonly cap: number;
};

type PromptSignals = {
  readonly paths: ReadonlyArray<string>;
  readonly basenames: ReadonlySet<string>;
  readonly tokens: ReadonlySet<string>;
};

const normalizePath = (raw: string): string =>
  raw
    .replace(/^file:\/\//i, "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .toLowerCase();

const tokenize = (text: string): ReadonlyArray<string> =>
  text.toLowerCase().match(/[a-z0-9_-]{2,}/g) ?? [];

const promptSignals = (prompt: PromptInput.Prompt): PromptSignals => {
  const paths: Array<string> = [];
  const basenames = new Set<string>();
  const tokens = new Set<string>();

  const addPath = (raw: string | undefined) => {
    if (raw === undefined || raw.length === 0) return;
    const norm = normalizePath(raw);
    paths.push(norm);
    const base = norm.split("/").at(-1) ?? norm;
    if (base.length > 0) basenames.add(base);
    for (const tok of tokenize(norm)) tokens.add(tok);
  };

  for (const file of prompt.files ?? []) {
    addPath(file.uri);
    if (file.source?.type === "uri") addPath(file.source.uri);
    addPath(file.name);
    addPath(file.mention?.text);
  }

  for (const match of prompt.text.matchAll(/[a-zA-Z0-9_.-]+(?:\/[a-zA-Z0-9_.-]+)+/g)) {
    addPath(match[0]);
  }
  for (const tok of tokenize(prompt.text)) tokens.add(tok);

  return { paths, basenames, tokens };
};

const scoreClaim = (claim: Claim, signals: PromptSignals, boostKinds: boolean): number => {
  let score = 0;

  for (const subj of claim.subject) {
    const norm = normalizePath(subj);
    const exactOrSuffix = signals.paths.some(
      (p) => p === norm || p.endsWith(`/${norm}`) || norm.endsWith(`/${p}`),
    );
    if (exactOrSuffix) {
      score += 20;
    } else if (signals.basenames.has(norm.split("/").at(-1) ?? norm)) {
      score += 10;
    }
  }

  const claimTokens = new Set(tokenize(`${claim.claim} ${claim.subject.join(" ")}`));
  for (const tok of claimTokens) {
    if (signals.tokens.has(tok)) score += 3;
  }

  if (boostKinds && (claim.kind === "gotcha" || claim.kind === "constraint")) {
    score += 5;
  }

  return score;
};

export const headline = (claim: Claim): string => `${claim.id} [${claim.kind}] ${claim.claim}`;

export const newestFirst = (a: Claim, b: Claim): number =>
  (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const renderRetired = (totalOnDisk: number): string =>
  `<UNTRUSTED_CONTENT>\nbrain index (0 active of ${totalOnDisk} claims): every claim is retired.\n</UNTRUSTED_CONTENT>`;

const render = (shown: ReadonlyArray<string>, total: number, cap: number = CORTEX_CAP): string => {
  const lines = [`brain index (${shown.length} of ${total} claims, capped at ${cap} tokens):`];
  for (const entry of shown) lines.push(`- ${entry}`);
  if (shown.length < total)
    lines.push(`truncated to ${cap} tokens: showing ${shown.length} of ${total} claims`);
  return `<UNTRUSTED_CONTENT>\n${lines.join("\n")}\n</UNTRUSTED_CONTENT>`;
};

export const cortexWindow = (
  claims: ReadonlyArray<string>,
  cap: number = CORTEX_CAP,
): {
  readonly shown: ReadonlyArray<string>;
  readonly text: string;
  readonly usedTokens: number;
} => {
  let shown = claims;
  while (shown.length > 0 && tokens(render(shown, claims.length, cap)) > cap)
    shown = shown.slice(0, -1);
  const text = render(shown, claims.length, cap);
  return { shown, text, usedTokens: tokens(text) };
};

const build = (claims: ReadonlyArray<string>, cap: number = CORTEX_CAP): string =>
  cortexWindow(claims, cap).text;

const latestOf = async (brain: AbsolutePath): Promise<number> => {
  let latest = -1;
  try {
    const neurons = new Bun.Glob("*.md").scan({ cwd: `${brain}/neurons`, onlyFiles: true });
    for await (const entry of neurons) {
      const stat = await Bun.file(`${brain}/neurons/${entry}`).stat();
      if (stat.mtimeMs > latest) latest = stat.mtimeMs;
    }
  } catch (error) {
    if ((error as { code?: unknown }).code !== "ENOENT") throw error;
  }
  const ledger = Bun.file(`${brain}/synapses.ndjson`);
  if (await ledger.exists()) {
    const stat = await ledger.stat();
    if (stat.mtimeMs > latest) latest = stat.mtimeMs;
  }
  return latest;
};

const readIndex = (
  project: AbsolutePath,
  prompt: PromptInput.Prompt,
  workerOnly: boolean,
): Effect.Effect<Index | undefined, Error> =>
  Effect.gen(function* () {
    const opened = ledger(project);
    const brain = yield* opened.read();
    const latest = yield* Effect.promise(() =>
      latestOf(AbsolutePath.make(join(project, ".spectre", "brain"))),
    );
    if (brain.claims.length === 0 && latest < 0) {
      return workerOnly
        ? undefined
        : { key: "cold", claims: [], totalOnDisk: 0, cap: CORTEX_CAP };
    }
    const active = standing(brain.claims, brain.edges).active;
    const pool = workerOnly
      ? active.filter((claim) => claim.kind === "gotcha" || claim.kind === "constraint")
      : active;
    if (workerOnly && pool.length === 0) return undefined;

    const signals = promptSignals(prompt);
    const ranked = pool.toSorted(
      (a, b) =>
        scoreClaim(b, signals, !workerOnly) - scoreClaim(a, signals, !workerOnly) ||
        newestFirst(a, b),
    );
    const claims = ranked.map(headline);
    const cap = workerOnly ? WORKER_CAP : CORTEX_CAP;
    return {
      key: `${workerOnly ? "w" : "r"}:${latest}:${brain.claims.length}:${Bun.hash(claims.join("\n"))}`,
      claims,
      totalOnDisk: brain.claims.length,
      cap,
    };
  });

const renderIndex = (index: Index): string => {
  if (index.totalOnDisk === 0) return `<UNTRUSTED_CONTENT>\n${COLD}\n</UNTRUSTED_CONTENT>`;
  if (index.claims.length === 0) return renderRetired(index.totalOnDisk);
  return build(index.claims, index.cap);
};

const MAX_SEEN = 256;
const seen = new Map<string, string>();

export const attach = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    yield* ctx.session.hook("prompt", (event) =>
      Effect.gen(function* () {
        if (event.prompt.agents?.some((agent) => agent.name === "mnemonic") === true) return;
        const info = yield* Effect.catch(ctx.session.get({ sessionID: event.sessionID }), () =>
          Effect.succeed(undefined),
        );
        if (info === undefined || info.agent === "mnemonic" || info.agent === "nocturna") return;
        const entry = ctx.session.instructions?.entry;
        if (entry === undefined) return;
        const project = AbsolutePath.make(info.location?.directory ?? ctx.location.directory);
        const workerOnly = info.parentID !== undefined;
        const index = yield* Effect.catch(readIndex(project, event.prompt, workerOnly), () =>
          Effect.succeed(undefined),
        );
        if (index === undefined) return;
        if (seen.get(event.sessionID) === index.key) return;
        const text = renderIndex(index);
        yield* entry.put({
          sessionID: event.sessionID,
          key: BRAIN_KEY,
          value: text,
        });
        if (!seen.has(event.sessionID) && seen.size >= MAX_SEEN) {
          const oldest = seen.keys().next().value;
          if (oldest !== undefined) seen.delete(oldest);
        }
        seen.set(event.sessionID, index.key);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("brain injection failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered brain injection", { trigger: "session.prompt" });
  });
