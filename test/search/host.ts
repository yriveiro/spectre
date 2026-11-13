import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { attachCatalogue, attachGuard } from "../../tools/definitions/search/apply";

/**
 * The shared host fixture for the guard tests: a stub ripwire binary, a
 * registration that captures the `execute.before` callback, and the event
 * shape the host hands it. A non-test file, so `bun test` does not run it.
 */

export const READY_BIN = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, built_from=test)"
  exit 0
fi
exit 1
`;

const dirs: Array<string> = [];

export const tempDir = (): string => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  dirs.push(dir);
  return dir;
};

export const cleanupDirs = async (): Promise<void> => {
  const created = dirs.splice(0);
  await Promise.all(created.map((dir) => Bun.spawn(["rm", "-rf", dir]).exited));
};

export const makeBin = async (body: string): Promise<string> => {
  const dir = tempDir();
  const bin = `${dir}/ripwire`;
  await Bun.write(bin, body);
  await Bun.spawn(["chmod", "+x", bin]).exited;
  return bin;
};

export const withBinary = async (bin: string, fn: () => Promise<void>): Promise<void> => {
  const prev = Bun.env.SPECTRE_RIPWIRE;
  try {
    Bun.env.SPECTRE_RIPWIRE = bin;
    await fn();
  } finally {
    if (prev === undefined) delete Bun.env.SPECTRE_RIPWIRE;
    else Bun.env.SPECTRE_RIPWIRE = prev;
  }
};

export interface Asserts {
  readonly action: string;
  readonly resources: ReadonlyArray<string>;
}

export interface Guard {
  readonly callback: (event: unknown) => Effect.Effect<void, Tool.Error>;
  readonly asserts: ReadonlyArray<Asserts>;
}

export const captureGuard = async (assert: () => Effect.Effect<void, unknown> = () => Effect.void): Promise<Guard> => {
  const asserts: Array<Asserts> = [];
  let callback: ((event: unknown) => Effect.Effect<void, Tool.Error>) | undefined;
  const ctx = {
    location: { directory: "/tmp" },
    tool: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, Tool.Error>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
    permission: {
      assert: (input: Asserts) => {
        asserts.push({ action: input.action, resources: input.resources });
        return assert();
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachGuard(ctx)));
  if (callback === undefined) throw new Error("guard did not register");
  return { callback, asserts };
};

export const toolEvent = (tool: string, input: unknown, session: string, id: string): unknown => ({
  tool,
  sessionID: Session.ID.make(session),
  agent: "build",
  messageID: "msg_guard_rows",
  id: Tool.CallID.make(id),
  input,
});

/** The `apply.test.ts` text event: the default session, so a cleanup can name it. */
export const guardEvent = (pattern: string, id: string = "call_guard_test"): unknown =>
  toolEvent("ripgrep", { pattern }, "ses_guard_test_c", id);

/** The `session.context` hook, captured for a test that seeds a session's memory. */
export const captureContext = async (): Promise<((event: unknown) => Effect.Effect<void, never>)> => {
  let callback: ((event: unknown) => Effect.Effect<void, never>) | undefined;
  const ctx = {
    session: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, never>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachCatalogue(ctx)));
  if (callback === undefined) throw new Error("catalogue did not register");
  return callback;
};
