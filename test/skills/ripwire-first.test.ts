import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { load, notALeaf } from "../../skills/definitions/index";
import { CONTRACT } from "../../tools/definitions/search/contract";

/**
 * The compact map is attached by id on the first prompt, and nothing else reads
 * it before it reaches the model. So it is checked here: the verb a row names
 * exists in the installed binary, the search moment quotes the same rule the
 * context part writes, and the id resolves without joining the available list.
 */

const BODY = "skills/definitions/ripwire-first/SKILL.md";
const ID = "ripwire-first";

const MOMENTS: ReadonlyArray<string> = [
  "search",
  "first read",
  "before a new symbol",
  "edit contract",
  "fan-out",
  "before done",
  "session memory",
  "branch cleanup",
  "doctor",
];

const body = async () => Bun.file(BODY).text();

const rows = async () => {
  const text = await body();
  return [...text.matchAll(/^\| ([a-z][a-z -]+) \| (.+?) \| `(ripwire-[a-z-]+)` \|$/gm)].map(
    (match) => ({
      moment: match[1]!,
      answer: match[2]!,
      depth: match[3]!,
    }),
  );
};

const RIPWIRE = Bun.which("ripwire");

describe("the map quotes the contract", () => {
  test("the search moment carries CONTRACT.rule verbatim", async () => {
    expect(await body()).toContain(CONTRACT.rule);
  });

  test("every moment the first prompt promises has a row", async () => {
    const listed = (await rows()).map((row) => row.moment);

    expect(listed).toEqual([...MOMENTS]);
  });
});

describe("every verb the map names is a verb ripwire has", () => {
  test.skipIf(!RIPWIRE)("no verb has drifted out of the installed ripwire", async () => {
    const help = Bun.spawnSync([RIPWIRE!, "--help"]).stdout.toString();
    const named = new Set<string>();

    for (const line of (await body()).split("\n")) {
      if (line.includes("deprecat")) continue;
      for (const [, flag] of line.matchAll(/--([a-z][a-z0-9-]{2,})/g)) named.add(flag!);
    }

    expect(named.size).toBeGreaterThan(10);
    expect([...named].filter((flag) => !help.includes(`--${flag}`)).sort()).toEqual([]);
  });
});

describe("the skill resolves by id", () => {
  test("it resolves by id, stays out of the available list, and carries no map row", async () => {
    const skills = await Effect.runPromise(load());
    const found = skills.find((one) => one.id === ID);

    expect(found?.autoinvoke).toBe(false);
    expect(found?.content).toContain(CONTRACT.rule);
    expect(notALeaf.has(ID)).toBe(true);
  });

  test("the body stays a compact map", async () => {
    expect((await rows()).length).toBe(MOMENTS.length);
    expect(Bun.file(BODY).size).toBeLessThan(3000);
  });
});
