import { describe, expect, test } from "bun:test";
import { VERIFIED } from "../../skills/definitions/effect-best-practices/verified";

/**
 * `effect-best-practices/SKILL.md` makes claims about one Effect build. This holds that build
 * to the pin, so a version bump cannot leave the body describing an Effect that is no longer
 * installed.
 *
 * The suite fails in two places when the pin moves and nobody re-aligns. Here, because the
 * stamp no longer matches the pin. In `bun run typecheck`, because `probe.ts` uses every
 * symbol the body names and the compiler checks each one. Neither fails on its own: a
 * matching stamp with a moved export passes this file, and a matching export with a stale
 * stamp compiles. Together they cover a bump that renames something and a bump that only
 * moves the number.
 */

const DIR = "skills/definitions/effect-best-practices";
const PIN = "package.json";

const pinned = async () => {
  const text = await Bun.file(PIN).text();
  // `bun.lock` is not consulted: it records what resolved, not what the repo asked for, so
  // it agrees with a pin that has already moved and would hide the bump this is for.
  return (JSON.parse(text) as { dependencies: Record<string, string> }).dependencies["effect"];
};

const installed = async () => {
  const file = Bun.file("node_modules/effect/package.json");
  if (!(await file.exists())) {
    throw new Error("node_modules/effect is absent: run `bun install` before this suite");
  }
  return (await file.json()) as { version: string };
};

describe("effect-best-practices is aligned with the installed Effect", () => {
  test("the stamp is the pinned version", async () => {
    expect(await pinned()).toBe(VERIFIED.effect);
  });

  test("the stamp is the installed version", async () => {
    const { version } = await installed();
    expect(version).toBe(VERIFIED.effect);
  });

  test("the body names the stamped version", async () => {
    // Without this the stamp could drift from the prose and the test would still pass,
    // which is the one thing the reader sees first.
    const body = await Bun.file(`${DIR}/SKILL.md`).text();
    expect(body).toContain(VERIFIED.effect);
  });

  test("the probe is on disk, because a deleted probe is a check that cannot fail", async () => {
    expect(await Bun.file(`${DIR}/probe.ts`).exists()).toBe(true);
  });

  test("the probe is inside the typecheck, or nothing compiles it", async () => {
    // `include` covers `skills`, so the probe compiles without naming it. Assert the rule
    // rather than the path: a `files` entry that drops `skills` takes the probe with it.
    const tsconfig = await Bun.file("tsconfig.json").text();
    expect(tsconfig).toContain('"skills"');
  });
});