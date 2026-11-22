import { join } from "node:path";
import type { Plugin } from "@opencode/plugin/effect";
import { InstructionEntry } from "@opencode/schema/instruction-entry";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { ledger } from "./ledger";
import type { Claim } from "./neuron";
import { standing } from "./standing";

const BRAIN_KEY = InstructionEntry.Key.make("spectre.brain");
const CORTEX_CAP = 600;
const COLD =
  "brain is cold: 0 claims. tools.spectre.brain action=recall answers nothing until it has claims; mnemonic seeds it";

export { COLD, CORTEX_CAP };

// Tokens are characters / 4, the rough estimate features/brain.md allows.
export const tokens = (text: string): number => Math.ceil(text.length / 4);

type Index = {
  readonly key: string;
  readonly claims: ReadonlyArray<string>;
  readonly totalOnDisk: number;
};

export const headline = (claim: Claim): string => `${claim.id} [${claim.kind}] ${claim.claim}`;

export const newestFirst = (a: Claim, b: Claim): number =>
  (a.at < b.at ? 1 : a.at > b.at ? -1 : 0) || (a.id < b.id ? 1 : a.id > b.id ? -1 : 0);

const renderRetired = (totalOnDisk: number): string =>
  `<UNTRUSTED_CONTENT>\nbrain index (0 active of ${totalOnDisk} claims): every claim is retired.\n</UNTRUSTED_CONTENT>`;

const render = (shown: ReadonlyArray<string>, total: number): string => {
  const lines = [`brain index (${shown.length} of ${total} claims, capped at 600 tokens):`];
  for (const entry of shown) lines.push(`- ${entry}`);
  if (shown.length < total)
    lines.push(`truncated to 600 tokens: showing ${shown.length} of ${total} claims`);
  return `<UNTRUSTED_CONTENT>\n${lines.join("\n")}\n</UNTRUSTED_CONTENT>`;
};

export const cortexWindow = (
  claims: ReadonlyArray<string>,
): {
  readonly shown: ReadonlyArray<string>;
  readonly text: string;
  readonly usedTokens: number;
} => {
  let shown = claims;
  while (shown.length > 0 && tokens(render(shown, claims.length)) > CORTEX_CAP)
    shown = shown.slice(0, -1);
  const text = render(shown, claims.length);
  return { shown, text, usedTokens: tokens(text) };
};

const build = (claims: ReadonlyArray<string>): string => cortexWindow(claims).text;

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

const readIndex = (project: AbsolutePath): Effect.Effect<Index, Error> =>
  Effect.gen(function* () {
    const opened = ledger(project);
    const brain = yield* opened.read();
    const latest = yield* Effect.promise(() =>
      latestOf(AbsolutePath.make(join(project, ".spectre", "brain"))),
    );
    if (brain.claims.length === 0 && latest < 0) return { key: "cold", claims: [], totalOnDisk: 0 };
    const claims = standing(brain.claims, brain.edges).active.toSorted(newestFirst).map(headline);
    return {
      key: `${latest}:${brain.claims.length}:${Bun.hash(claims.join("\n"))}`,
      claims,
      totalOnDisk: brain.claims.length,
    };
  });

const renderIndex = (index: Index): string => {
  if (index.totalOnDisk === 0) return `<UNTRUSTED_CONTENT>\n${COLD}\n</UNTRUSTED_CONTENT>`;
  if (index.claims.length === 0) return renderRetired(index.totalOnDisk);
  return build(index.claims);
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
        if (info === undefined || info.parentID !== undefined || info.agent === "mnemonic") return;
        const entry = ctx.session.instructions?.entry;
        if (entry === undefined) return;
        const project = AbsolutePath.make(info.location?.directory ?? ctx.location.directory);
        const index = yield* Effect.catch(readIndex(project), () => Effect.succeed(undefined));
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
