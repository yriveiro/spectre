import { Message } from "@opencode/ai";
import type { Plugin } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Stream } from "effect";
import { join } from "node:path";
import { VERIFIED } from "./verified";

/**
 * Watches for the Effect version moving, so the body is re-aligned before a reader meets a
 * stale spelling.
 *
 * The forcing half is not here. `test/skills/effect-version.test.ts` fails when the pin moves
 * without the stamp, and `bun run typecheck` fails when the pin moved an export, because
 * `probe.ts` uses every symbol the body names. Those two catch the drift in CI and in a
 * pre-commit. This catches it in the session, where nobody is running either.
 *
 * Why two mechanisms for one check. The stream can see a file change but cannot add a turn,
 * and the session hook can add a message but only fires when a turn is already starting. So
 * the stream records the drift and the hook delivers it, which means the reminder costs
 * nothing on a session that never opens.
 *
 * `installation.updated` carries a version and looks like the better trigger, and it is
 * subscribable: `InstallationEvent.Updated` is in the event manifest. But the function that
 * publishes it — `updated` on the server process, read at `v2.1.1` — has no caller in `src`,
 * and the only call to its sibling `updateAvailable` is a test. So the event never fires, and a
 * subscription to it is a check that cannot run. `filesystem.changed` carries the path that changed and
 * is what this uses.
 */

const PIN = "package.json";

const pinned = async (project: AbsolutePath) => {
  const file = Bun.file(join(project, PIN));
  if (!(await file.exists())) return undefined;
  try {
    const parsed = (await file.json()) as { dependencies?: Record<string, string> };
    return parsed.dependencies?.["effect"];
  } catch (cause) {
    // A half-written package.json is a normal state while an editor holds the buffer, so
    // this is a skip rather than a failure. The next change event re-reads it.
    if (cause instanceof SyntaxError) return undefined;
    throw cause;
  }
};

const REMINDER = `<UNTRUSTED_CONTENT>
effect moved: this project pins effect at a version other than ${VERIFIED.effect}, which is what
effect-best-practices was verified against. Run /effect-align before relying on that skill.
</UNTRUSTED_CONTENT>`;

/**
 * Module state rather than a service: one watcher per plugin instance, and the drift it holds
 * is a fact about this process rather than something a caller supplies.
 */
const drifted = new Set<string>();

const isPin = (file: string) => {
  // A dependency's own `package.json` ends in the same three segments, and an install writes
  // hundreds of them, so matching on the suffix alone would wake the watcher on every
  // `bun install` in any project that has the plugin loaded. The pin is the project's.
  if (file.includes("node_modules/")) return false;
  return file === PIN || file.endsWith(`/${PIN}`);
};

export const attach = (ctx: Plugin.Context) =>
  Effect.gen(function* () {
    yield* ctx.event
      .subscribe()
      .pipe(
        Stream.filter((event) => event.type === "filesystem.changed"),
        Stream.filter((event) => event.data.event !== "unlink" && isPin(event.data.file)),
        Stream.runForEach((event) =>
          Effect.gen(function* () {
            const project = AbsolutePath.make(ctx.location.directory);
            const version = yield* Effect.promise(() => pinned(project));
            if (version === undefined || version === VERIFIED.effect) return;
            drifted.add(project);
            yield* Effect.logWarning("effect version moved", {
              pinned: version,
              verified: VERIFIED.effect,
              command: "/effect-align",
            });
          }).pipe(Effect.catchCause((cause) => Effect.logWarning("effect watch failed", { cause }).pipe(Effect.asVoid))),
        ),
        // Detached so the plugin's own `effect` returns and the host keeps booting. A
        // subscription is meant to outlive the caller that registered it, which is the one
        // case where nothing registering a finalizer is the right answer.
        Effect.forkDetach,
        Effect.asVoid,
      )
      .pipe(Effect.catchCause((cause) => Effect.logWarning("effect watch failed", { cause }).pipe(Effect.asVoid)));

    yield* ctx.session.hook("context", (event) =>
      Effect.gen(function* () {
        if (event.agent === "mnemonic") return;
        const project = AbsolutePath.make(ctx.location.directory);
        if (!drifted.has(project)) return;
        const info = yield* Effect.catch(
          ctx.session.get({ sessionID: event.sessionID }),
          () => Effect.succeed(undefined),
        );
        if (info === undefined || info.parentID !== undefined) return;
        const at = event.messages.at(-1)?.role === "user" ? event.messages.length - 1 : event.messages.length;
        event.messages.splice(at, 0, Message.user(REMINDER));
        drifted.delete(project);
      }).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("effect reminder failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered effect version watcher", { verified: VERIFIED.effect });
  });

export { isPin, pinned };