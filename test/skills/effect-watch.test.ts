import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Exit, PubSub, Stream } from "effect";
import {
  attach,
  isPin,
  pendingReminder,
  pinned,
} from "../../skills/definitions/effect-best-practices/watch";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("effect-watch");

const manifest = async (body: string) => {
  const dir = temp();
  await Bun.write(`${dir}/package.json`, body);
  return AbsolutePath.make(dir);
};

interface PromptEvent {
  readonly sessionID: string;
  readonly messageID: string;
  prompt: {
    text: string;
    agents?: Array<{ readonly name: string }>;
  };
  delivery: "steer" | "queue";
}

interface EntryPut {
  readonly sessionID: string;
  readonly key: string;
  readonly value: unknown;
}

describe("the effect watcher wakes on the right file", () => {
  test("a bare package.json and a nested one both match", () => {
    expect(isPin("package.json")).toBe(true);
    expect(isPin("/repo/package.json")).toBe(true);
    expect(isPin("/repo/packages/app/package.json")).toBe(true);
  });

  test("a lockfile is not a package.json, however much it looks like one", () => {
    // `bun.lock` is where the resolved versions land, so waking on it would read the pin and
    // find it already moved. This is the filter that stops that.
    expect(isPin("bun.lock")).toBe(false);
    expect(isPin("/repo/bun.lock")).toBe(false);
  });

  test("a dependency's own manifest does not match", () => {
    // An install writes hundreds of those, so matching the bare suffix would wake the
    // watcher on every `bun install` in any project that loaded the plugin.
    expect(isPin("/repo/node_modules/effect/package.json")).toBe(false);
  });

  test("an unrelated file does not match", () => {
    expect(isPin("skills/definitions/effect-best-practices/SKILL.md")).toBe(false);
  });
});

describe("the effect watcher reads the pin", () => {
  test("it returns the effect dependency, whatever the pin says", async () => {
    // A fixture rather than this repo's own package.json: the assertion is a literal, so it
    // keeps testing the read path on every version bump instead of demanding an edit here.
    const root = await manifest(
      JSON.stringify({ dependencies: { effect: "9.9.9", other: "1.0.0" } }),
    );
    expect(await pinned(root)).toBe("9.9.9");
  });

  test("a manifest with no effect dependency is undefined rather than an error", async () => {
    const root = await manifest(JSON.stringify({ dependencies: { other: "1" } }));
    expect(await pinned(root)).toBeUndefined();
  });

  test("it reads a dev pin when the dependency section is absent", async () => {
    // Spectre itself declares effect as a peer plus a dev pin, so a manifest that carries
    // only the dev section is the shape most projects have now.
    const root = await manifest(
      JSON.stringify({ devDependencies: { effect: "9.9.9", other: "1.0.0" } }),
    );
    expect(await pinned(root)).toBe("9.9.9");
  });

  test("a half-written manifest is skipped rather than thrown", async () => {
    // An editor holding the buffer mid-save is the normal case here, and a throw would take
    // the watcher down for the rest of the session.
    const root = await manifest('{"dependencies": {"eff');
    expect(await pinned(root)).toBeUndefined();
  });

  test("a directory with no package.json is undefined rather than an error", async () => {
    expect(await pinned(AbsolutePath.make(temp()))).toBeUndefined();
  });
});

describe("the reminder reaches every session once per drift", () => {
  const drifted = (version: string) => new Map([["/proj", version]]);
  const told = (session: string, version: string) => new Map([[session, version]]);

  test("no drift tells nothing", () => {
    expect(pendingReminder(new Map(), new Map(), "/proj", "ses_a")).toBeUndefined();
  });

  test("drift tells a session that never heard it", () => {
    expect(pendingReminder(drifted("4.0.1"), new Map(), "/proj", "ses_a")).toBe("4.0.1");
  });

  test("a told session is not told the same drift again", () => {
    expect(
      pendingReminder(drifted("4.0.1"), told("ses_a", "4.0.1"), "/proj", "ses_a"),
    ).toBeUndefined();
  });

  test("a second session is told what the first already heard", () => {
    expect(pendingReminder(drifted("4.0.1"), told("ses_a", "4.0.1"), "/proj", "ses_b")).toBe(
      "4.0.1",
    );
  });

  test("a newer drift re-tells a session told the older one", () => {
    expect(pendingReminder(drifted("4.0.2"), told("ses_a", "4.0.1"), "/proj", "ses_a")).toBe(
      "4.0.2",
    );
  });

  test("drift in another project tells nothing here", () => {
    expect(pendingReminder(drifted("4.0.1"), new Map(), "/other", "ses_a")).toBeUndefined();
  });
});

describe("attach delivers spectre.effect-watch durably on prompt", () => {
  const promptEvent = (sessionID: string, agents?: Array<{ readonly name: string }>): PromptEvent => ({
    sessionID,
    messageID: "msg_watch",
    prompt: { text: "continue", ...(agents === undefined ? {} : { agents }) },
    delivery: "steer",
  });

  const setupWatch = async (
    sessions: Record<string, { readonly parentID?: string; readonly agent?: string }>,
    withInstructions: boolean = true,
  ) => {
    const dir = temp();
    const hub = await Effect.runPromise(
      PubSub.unbounded<{ readonly type: string; readonly data: { readonly event: string; readonly file: string } }>(),
    );
    let hookName: string | undefined;
    let handler: ((event: PromptEvent) => Effect.Effect<void>) | undefined;
    const puts: Array<EntryPut> = [];
    const stored = new Map<string, Map<string, unknown>>();
    const ctx = {
      location: { directory: dir },
      event: {
        subscribe: () => Stream.fromPubSub(hub),
      },
      session: {
        hook: (name: string, cb: (event: PromptEvent) => Effect.Effect<void>) => {
          hookName = name;
          handler = cb;
          return Effect.void;
        },
        get: (input: { readonly sessionID: string }) => Effect.succeed(sessions[input.sessionID]),
        ...(withInstructions
          ? {
              instructions: {
                entry: {
                  put: (input: EntryPut) =>
                    Effect.sync(() => {
                      puts.push(input);
                      const byKey = stored.get(input.sessionID) ?? new Map<string, unknown>();
                      byKey.set(input.key, input.value);
                      stored.set(input.sessionID, byKey);
                    }),
                },
              },
            }
          : {}),
      },
    };
    await Effect.runPromise(attach(ctx as never) as Effect.Effect<void>);
    if (handler === undefined || hookName === undefined) throw new Error("watch hook did not register");
    const emitPinChange = async (version: string) => {
      await Bun.write(`${dir}/package.json`, JSON.stringify({ devDependencies: { effect: version } }));
      await Effect.runPromise(
        PubSub.publish(hub, {
          type: "filesystem.changed",
          data: { event: "change", file: "package.json" },
        }),
      );
      await Bun.sleep(25);
    };
    return { dir, hookName, handler, puts, stored, emitPinChange };
  };

  test("puts spectre.effect-watch once per drift on root sessions, persists across steps, and skips mnemonic and subagents", async () => {
    const { hookName, handler, puts, stored, emitPinChange } = await setupWatch({
      ses_watch_root: { agent: "spectre" },
      ses_watch_mnemonic: { agent: "mnemonic" },
      ses_watch_subagent: { agent: "spectre", parentID: "ses_watch_root" },
    });

    expect(hookName).toBe("prompt");
    await emitPinChange("9.9.9");

    await Effect.runPromise(handler(promptEvent("ses_watch_mnemonic")));
    await Effect.runPromise(handler(promptEvent("ses_watch_subagent")));
    await Effect.runPromise(handler(promptEvent("ses_watch_root", [{ name: "mnemonic" }])));
    expect(puts).toEqual([]);

    await Effect.runPromise(handler(promptEvent("ses_watch_root")));
    expect(puts.length).toBe(1);
    expect(puts[0]?.sessionID).toBe("ses_watch_root");
    expect(puts[0]?.key).toBe("spectre.effect-watch");
    const reminder = String(puts[0]?.value ?? "");
    expect(reminder).toContain("<UNTRUSTED_CONTENT>");
    expect(reminder).toContain("/effect-align");

    expect(stored.get("ses_watch_root")?.get("spectre.effect-watch")).toBe(reminder);
    expect(stored.get("ses_watch_root")?.get("spectre.effect-watch")).toBe(reminder);

    await Effect.runPromise(handler(promptEvent("ses_watch_root")));
    expect(puts.length).toBe(1);

    await emitPinChange("9.9.10");
    await Effect.runPromise(handler(promptEvent("ses_watch_root")));
    expect(puts.length).toBe(2);
    expect(puts[1]?.key).toBe("spectre.effect-watch");
  });

  test("degrades gracefully when session.instructions is omitted", async () => {
    const { handler, emitPinChange } = await setupWatch({ ses_watch_plain: { agent: "spectre" } }, false);
    await emitPinChange("9.9.9");
    const exit = await Effect.runPromiseExit(handler(promptEvent("ses_watch_plain")));
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
