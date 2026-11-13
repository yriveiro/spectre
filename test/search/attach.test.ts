import { describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect, Exit } from "effect";
import { memories } from "../../tools/definitions/search/state";
import { capturePrompt, forget, promptEvent } from "./host";

/**
 * Discovery is a `session.prompt` hook: the host resolves the attached skill
 * body once and persists it in that message, so the test can only assert what
 * the payload carries. One `Memory` per session is the state that decides it,
 * and a child is a session of its own.
 */

describe("the first prompt carries the map once", () => {
  test("two prompts, one body", async () => {
    const callback = await capturePrompt({ skills: ["ripwire-first"] });

    const first = promptEvent("ses_attach_twice");
    await Effect.runPromise(callback(first));
    expect(first.prompt.skills).toEqual([{ id: "ripwire-first" }]);

    const second = promptEvent("ses_attach_twice");
    await Effect.runPromise(callback(second));
    expect(second.prompt.skills).toBeUndefined();

    forget("ses_attach_twice");
  });

  test("a child session attaches once", async () => {
    const callback = await capturePrompt({ skills: ["ripwire-first"], parentID: "ses_attach_parent" });

    const first = promptEvent("ses_attach_child");
    await Effect.runPromise(callback(first));
    expect(first.prompt.skills).toHaveLength(1);
    expect(memories.get(Session.ID.make("ses_attach_child"))?.subagent).toBe(true);

    const second = promptEvent("ses_attach_child");
    await Effect.runPromise(callback(second));
    expect(second.prompt.skills).toBeUndefined();

    forget("ses_attach_child");
  });

  test("a map the user already attached is not attached twice", async () => {
    const callback = await capturePrompt({ skills: ["ripwire-first"] });

    const asked = promptEvent("ses_attach_manual");
    asked.prompt.skills = [{ id: "ripwire-first" }];
    await Effect.runPromise(callback(asked));
    expect(asked.prompt.skills).toHaveLength(1);

    forget("ses_attach_manual");
  });
});

describe("a session with no map passes unchanged", () => {
  test("a missing skill id leaves the prompt unchanged", async () => {
    const callback = await capturePrompt({ skills: ["another-skill"] });

    const alone = promptEvent("ses_attach_missing");
    await Effect.runPromise(callback(alone));
    expect(alone.prompt.skills).toBeUndefined();
    expect(memories.get(Session.ID.make("ses_attach_missing"))?.attached).toBe(false);

    forget("ses_attach_missing");
  });

  test("a skill list that cannot answer leaves the prompt unchanged", async () => {
    const callback = await capturePrompt({ broken: true });

    const alone = promptEvent("ses_attach_broken");
    const exit = await Effect.runPromiseExit(callback(alone));
    expect(Exit.isSuccess(exit)).toBe(true);
    expect(alone.prompt.skills).toBeUndefined();

    forget("ses_attach_broken");
  });
});
