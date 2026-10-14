import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load } from "../../skills/definitions/index";

/**
 * Work is isolated in a worktree, and a branch is never cut in the checkout the
 * reader is standing in. `spectre-mode/SKILL.md` states it, and nothing watched
 * it: `playbook-opening-a-pr` was the only other file that said so, inside its
 * own Phase A, so a session running `playbook-feature` branched in main.
 *
 * Two ways to break the rule, both checked here: the hub losing it, and a leaf
 * gaining an instruction that contradicts it.
 */

const DIR = "skills/definitions";
const HUB = `${DIR}/spectre-mode/SKILL.md`;

/** Bounded by the next heading, so a rule filed under another one fails. */
const nonNegotiable = async (): Promise<string> => {
  const section = (await Bun.file(HUB).text()).match(/^## Non Negotiable\n([\s\S]*?)\n^## /m);
  return section?.[1] ?? "";
};

/** The lines a reader could copy and run. */
const fenced = (text: string): ReadonlyArray<string> =>
  [...text.matchAll(/^```[a-z]*\n([\s\S]*?)^```/gm)].flatMap((block) =>
    // The capture is a `+` the surrounding pattern guarantees, so this is the
    // compiler's index type rather than a case that happens.
    block[1] === undefined ? [] : block[1].split("\n"),
  );

describe("the hub states the worktree rule", () => {
  test("Non Negotiable is a section that exists", async () => {
    // A heading that does not match yields "", which reads as a missing rule.
    expect(await nonNegotiable()).not.toBe("");
  });

  test("the rule names the call that opens the worktree", async () => {
    expect(await nonNegotiable()).toContain('action: "start"');
  });

  test("the rule forbids branching in the checkout the reader is in", async () => {
    const section = await nonNegotiable();
    expect(section).toMatch(/never create a branch/i);
    expect(section).toMatch(/worktree/i);
  });

  test("the trigger that fires on branching names the rule", async () => {
    const row = (await Bun.file(HUB).text()).match(/^\|.*creat\w+ a branch.*\|$/m);
    expect(row?.[0]).toContain("worktree rule");
  });
});

describe("no leaf ships the command", () => {
  /**
   * Both spellings of the same wrong move, and neither has an exemption.
   *
   * `git worktree add -b` was one, and it was the worst of the three. It does
   * make a worktree, so it looked compliant, but it does not move the session:
   * the directory appeared beside main while the session kept working in main.
   * That is how a branch ends up cut in the checkout you were standing in with
   * a stray directory beside it, so `playbook-opening-a-pr` taught it as the
   * fallback for every refusal until it stopped.
   *
   * Fenced blocks only, and that is the whole scope. A leaf has to be able to
   * name the command it is forbidding, which means this check cannot read prose
   * without tripping over its own prohibition, and a regex that tries to tell
   * "never run X" from "run X" is a regex that will eventually be wrong in the
   * direction that passes. A fenced block is the part an agent copies, so that
   * is the part worth refusing. The hub carries the rule in prose, where naming
   * the command is the point.
   */
  const BRANCH_BY_HAND = /git worktree add\b|git (?:checkout|switch) -[bBcC]\b/;

  test("no leaf ships a code block that makes a worktree or a branch by hand", async () => {
    const offending: Array<string> = [];

    // Every body the plugin actually loads, rather than a glob of the directory: `load`
    // is the same read `skills/definitions/index.ts` uses to notice a forgotten
    // definition, so a leaf this misses is one the plugin does not ship either.
    for (const one of await Effect.runPromise(load())) {
      for (const line of fenced(await Bun.file(one.path).text())) {
        if (BRANCH_BY_HAND.test(line)) offending.push(`${one.path}: ${line.trim()}`);
      }
    }

    expect(offending).toEqual([]);
  });
});
