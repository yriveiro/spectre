import { Message } from "@opencode/ai";
import type { Plugin } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { join } from "node:path";
import { ledger } from "./ledger";
import type { Claim } from "./neuron";

const CAP = 600;
const COLD = "brain is cold: 0 claims. tools.spectre.brain action=recall answers nothing until it has claims; mnemonic seeds it";

export { COLD };

// Tokens are characters / 4, the rough estimate features/brain.md allows.
const tokens = (text: string): number => Math.ceil(text.length / 4);

type Index = {
  readonly key: string;
  readonly claims: ReadonlyArray<string>;
};

const headline = (claim: Claim): string => `${claim.id} [${claim.kind}] ${claim.claim}`;

const render = (shown: ReadonlyArray<string>, total: number): string => {
  const lines = [`brain index (${shown.length} of ${total} claims, capped at 600 tokens):`];
  for (const entry of shown) lines.push(`- ${entry}`);
  if (shown.length < total) lines.push(`truncated to 600 tokens: showing ${shown.length} of ${total} claims`);
  return `<UNTRUSTED_CONTENT>\n${lines.join("\n")}\n</UNTRUSTED_CONTENT>`;
};

const build = (claims: ReadonlyArray<string>): string => {
  let shown = claims;
  while (shown.length > 0 && tokens(render(shown, claims.length)) > CAP) shown = shown.slice(0, -1);
  return render(shown, claims.length);
};

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
    if (brain.claims.length === 0 && latest < 0) return { key: "cold", claims: [] };
    return { key: String(latest), claims: brain.claims.map(headline) };
  });

const seen = new Map<string, string>();

export const attach = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (event.agent === "mnemonic") return;
        const info = yield* Effect.catch(
          ctx.session.get({ sessionID: event.sessionID }),
          () => Effect.succeed(undefined),
        );
        if (info === undefined || info.parentID !== undefined) return;
        const project = AbsolutePath.make(ctx.location.directory);
        const index = yield* Effect.catch(readIndex(project), () => Effect.succeed(undefined));
        if (index === undefined) return;
        if (seen.get(project) === index.key) return;
        const text = index.claims.length === 0 ? `<UNTRUSTED_CONTENT>\n${COLD}\n</UNTRUSTED_CONTENT>` : build(index.claims);
        // Before the user's prompt, matching where agent-switch reminders land.
        const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length;
        event.messages.splice(at, 0, Message.user(text));
        seen.set(project, index.key);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("brain injection failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered brain injection", { trigger: "session.context" });
  });
