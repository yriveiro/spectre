import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Exit } from "effect";
import { attachDiscovery } from "../../tools/definitions/search/apply";
import { memories } from "../../tools/definitions/search/state";

/**
 * Discovery is a `session.prompt` hook: the host resolves the attached skill
 * body once and persists it in that message, so the test can only assert what
 * the payload carries. One `Memory` per session is the state that decides it,
 * and a child is a session of its own.
 */

type Prompt = {
  sessionID: Session.ID;
  prompt: { text: string; skills?: Array<{ readonly id: string }> };
};

const prompt = (session: string): Prompt => ({
  sessionID: Session.ID.make(session),
  prompt: { text: "carry on" },
});

const forget = (session: string) => memories.delete(Session.ID.make(session));

type Listing = {
  readonly skills?: ReadonlyArray<string>;
  readonly parentID?: string;
  readonly broken?: boolean;
};

const capture = async (listing: Listing = {}) => {
  let callback: ((event: unknown) => Effect.Effect<void, never>) | undefined;
  const data = (listing.skills ?? []).map((id) => ({ id }));
  const ctx = {
    skill: {
      list: () =>
        listing.broken === true
          ? Effect.die(new Error("the skill registry did not answer"))
          : Effect.succeed({ location: {}, data }),
    },
    session: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, never>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
      get: () => Effect.succeed(listing.parentID === undefined ? {} : { parentID: listing.parentID }),
    },
  } as unknown as Plugin.Context;

  await Effect.runPromise(Effect.scoped(attachDiscovery(ctx)));
  if (callback === undefined) throw new Error("discovery did not register");
  return callback;
};

describe("the first prompt carries the map once", () => {
  test("two prompts, one body", async () => {
    const callback = await capture({ skills: ["ripwire-first"] });

    const first = prompt("ses_attach_twice");
    await Effect.runPromise(callback(first));
    expect(first.prompt.skills).toEqual([{ id: "ripwire-first" }]);

    const second = prompt("ses_attach_twice");
    await Effect.runPromise(callback(second));
    expect(second.prompt.skills).toBeUndefined();

    forget("ses_attach_twice");
  });

  test("a child session attaches once", async () => {
    const callback = await capture({ skills: ["ripwire-first"], parentID: "ses_attach_parent" });

    const first = prompt("ses_attach_child");
    await Effect.runPromise(callback(first));
    expect(first.prompt.skills).toHaveLength(1);
    expect(memories.get(Session.ID.make("ses_attach_child"))?.subagent).toBe(true);

    const second = prompt("ses_attach_child");
    await Effect.runPromise(callback(second));
    expect(second.prompt.skills).toBeUndefined();

    forget("ses_attach_child");
  });

  test("a map the user already attached is not attached twice", async () => {
    const callback = await capture({ skills: ["ripwire-first"] });

    const asked = prompt("ses_attach_manual");
    asked.prompt.skills = [{ id: "ripwire-first" }];
    await Effect.runPromise(callback(asked));
    expect(asked.prompt.skills).toHaveLength(1);

    forget("ses_attach_manual");
  });
});

describe("a session with no map passes unchanged", () => {
  test("a missing skill id leaves the prompt unchanged", async () => {
    const callback = await capture({ skills: ["another-skill"] });

    const alone = prompt("ses_attach_missing");
    await Effect.runPromise(callback(alone));
    expect(alone.prompt.skills).toBeUndefined();
    expect(memories.get(Session.ID.make("ses_attach_missing"))?.attached).toBe(false);

    forget("ses_attach_missing");
  });

  test("a skill list that cannot answer leaves the prompt unchanged", async () => {
    const callback = await capture({ broken: true });

    const alone = prompt("ses_attach_broken");
    const exit = await Effect.runPromiseExit(callback(alone));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(alone.prompt.skills).toBeUndefined();

    forget("ses_attach_broken");
  });
});
