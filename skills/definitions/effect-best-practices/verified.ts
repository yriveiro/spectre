/**
 * The version `effect-best-practices/SKILL.md` was checked against.
 *
 * The body makes claims about one Effect build: an export exists, a call takes a type
 * parameter, a module carries a name. Every claim is a claim about `effect@4.0.1` and no
 * other version. This module is where that version is written down, so the claim has a
 * single home and a test can compare it against what is installed.
 *
 * `test/skills/effect-version.test.ts` compares `effect` against `package.json` and against
 * the installed package. Moving the pin without moving this string fails the suite, and
 * `bun run typecheck` compiles `probe.ts`, which exercises every symbol the body names. So
 * a version bump fails in two places: the stamp, and any export the bump moved.
 *
 * The OpenCode version is recorded because the pin follows it. `AGENTS.md` holds the rule:
 * `effect` tracks the build OpenCode ships, so a change to `engines.opencode` is a reason to
 * re-read the catalog and expect the pin to move.
 */
export const VERIFIED = {
  opencode: "2.0.29",
  effect: "4.0.1",
} as const;