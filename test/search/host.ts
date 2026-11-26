import { type Plugin, Tool } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, type Schema } from "effect";
import { attachCatalogue, attachGuard } from "../../tools/definitions/search/apply";
import { attachMeasure } from "../../tools/definitions/search/measure";
import type { Ask } from "../../tools/definitions/search/policy";
import { memories } from "../../tools/definitions/search/state";

/**
 * The shared host fixture for the guard tests: a stub ripwire binary, a
 * registration that captures the `execute.before` callback, and the event
 * shape the host hands it. A non-test file, so `bun test` does not run it.
 */

export const READY_BIN = `#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.7.0 (Release, built_from=test)"
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

export const captureGuard = async (
  assert: () => Effect.Effect<void, unknown> = () => Effect.void,
  read?: (event: unknown) => Ask | undefined,
): Promise<Guard> => {
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
  const registered = read === undefined ? attachGuard(ctx) : attachGuard(ctx, read);
  await Effect.runPromise(Effect.scoped(registered));
  if (callback === undefined) throw new Error("guard did not register");
  return { callback, asserts };
};

export interface ToolEvent {
  tool: string;
  readonly sessionID: Session.ID;
  readonly agent: string;
  readonly messageID: string;
  readonly id: Tool.CallID;
  input: Record<string, unknown>;
}

export const toolEvent = (
  tool: string,
  input: Record<string, unknown>,
  session: string,
  id: string,
  agent = "spectre",
): ToolEvent => ({
  tool,
  sessionID: Session.ID.make(session),
  agent,
  messageID: "msg_guard_rows",
  id: Tool.CallID.make(id),
  input,
});

/** The `apply.test.ts` text event: the default session, so a cleanup can name it. */
export const guardEvent = (pattern: string, id: string = "call_guard_test"): unknown =>
  toolEvent("ripgrep", { pattern }, "ses_guard_test_c", id);

/** Drop the in-process memories a test seeded, so a later case starts clean. */
export const forget = (...names: Array<string>): void => {
  for (const name of names) memories.delete(Session.ID.make(name));
};

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

/** One project, and the storage domain the usage record reads and writes. */
export const PROJECT = "prj_measure_test";

export const locationOf = (project: string, directory: string = "/tmp") => ({
  directory,
  project: { id: project, directory, canonical: directory },
});

/** A `ctx.storage` over a map, ordered the way the host's KV scan orders keys. */
export const makeStorage = (values: Map<string, Schema.Json>): Plugin.Context["storage"] => ({
  get: (key) => Effect.sync(() => values.get(key)),
  set: (key, value) =>
    Effect.sync(() => {
      values.set(key, value);
    }),
  remove: (key) =>
    Effect.sync(() => {
      values.delete(key);
    }),
  scan: (options) =>
    Effect.sync(() => {
      const keys = [...values.keys()]
        .filter((key) => key.startsWith(options.prefix))
        .filter((key) => options.after === undefined || key > options.after)
        .sort();
      const kept = options.limit === undefined ? keys : keys.slice(0, options.limit);
      return {
        entries: kept.map((key) => ({ key, value: values.get(key) ?? null })),
        ...(options.limit !== undefined && keys.length > options.limit ? { next: keys[options.limit] } : {}),
      };
    }),
});

export interface After {
  readonly callback: (event: unknown) => Effect.Effect<void>;
  readonly values: Map<string, Schema.Json>;
  readonly project: string;
}

/** The `execute.after` hook, captured with the storage its writes land in. */
export const captureAfter = async (
  project: string = PROJECT,
  values: Map<string, Schema.Json> = new Map(),
): Promise<After> => {
  let callback: ((event: unknown) => Effect.Effect<void>) | undefined;
  const ctx = {
    location: locationOf(project),
    storage: makeStorage(values),
    tool: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachMeasure(ctx)));
  if (callback === undefined) throw new Error("measure did not register");
  return { callback, values, project };
};

export interface MovedSession {
  readonly directory: string;
  readonly resources?: Array<ReadonlyArray<string>>;
}

/** A `Plugin.Context` for a tool that reads storage or checks paths, with optional moved-session location. */
export const readingContext = (
  project: string,
  values: Map<string, Schema.Json> = new Map(),
  directory: string = "/tmp",
  moved?: MovedSession,
): Plugin.Context =>
  ({
    location: locationOf(project, directory),
    storage: makeStorage(values),
    ...(moved === undefined
      ? {}
      : {
          session: {
            get: () => Effect.succeed({ location: { directory: moved.directory } }),
          },
        }),
    permission: {
      assert: (input: { readonly resources: ReadonlyArray<string> }) => {
        moved?.resources?.push(input.resources);
        return Effect.void;
      },
    },
  }) as unknown as Plugin.Context;

/** A completed `execute.after` event, with the output the tool returned. */
export const afterEvent = (
  tool: string,
  input: unknown,
  session: string,
  id: string,
  output?: unknown,
  agent = "spectre",
): unknown => ({
  tool,
  sessionID: Session.ID.make(session),
  agent,
  messageID: "msg_measure_rows",
  id: Tool.CallID.make(id),
  input,
  status: "completed",
  result: output === undefined ? {} : { output },
});

/** A failed `execute.after` event: the tool ran and returned a `Tool.Error`. */
export const failedEvent = (tool: string, input: unknown, session: string, id: string): unknown => ({
  tool,
  sessionID: Session.ID.make(session),
  agent: "spectre",
  messageID: "msg_measure_rows",
  id: Tool.CallID.make(id),
  input,
  status: "error",
  error: new Tool.Error({ message: "the tool failed" }),
});

export const toolContext = (session: string, id: string = "call_report_rows"): Tool.Context => ({
  sessionID: Session.ID.make(session),
  agent: "build" as Tool.Context["agent"],
  messageID: "msg_report_rows" as Tool.Context["messageID"],
  id: Tool.CallID.make(id),
  progress: () => Effect.void,
});
