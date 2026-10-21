import { describe, expect, test } from "bun:test";
import { AbsolutePath } from "@opencode/schema/schema";
import {
  isPin,
  pendingReminder,
  pinned,
} from "../../skills/definitions/effect-best-practices/watch";
import { useTempDirs } from "../fixture";

/**
 * The watcher cannot be tested end to end without an OpenCode event stream, so these cover the
 * two pure decisions it makes: which file wakes it, and what it reads out of that file.
 *
 * The subscription itself is not covered here and `principle-evidence` is the reason. A test
 * that built a fake stream would prove that a fake stream works. What matters is the filter
 * and the comparison, because those are where a rename or a schema change silently stops the
 * watcher from ever firing.
 */

const temp = useTempDirs("effect-watch");

const manifest = async (body: string) => {
  const dir = temp();
  await Bun.write(`${dir}/package.json`, body);
  return AbsolutePath.make(dir);
};

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
