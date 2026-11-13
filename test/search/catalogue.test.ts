import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { shape, type Draft } from "../../tools/definitions/search/catalogue";
import { CONTRACT, END_OF_WORK } from "../../tools/definitions/search/contract";
import type { Memory } from "../../tools/definitions/search/policy";
import { memories } from "../../tools/definitions/search/state";
import { captureContext, cleanupDirs, makeBin, READY_BIN, withBinary } from "./host";

const draft = (overrides?: Partial<Draft>): Draft => ({
  system: [],
  tools: {},
  ...overrides,
});

const held = (overrides?: Partial<Memory>): Memory => ({
  attached: false,
  subagent: false,
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  ...overrides,
});

afterEach(cleanupDirs);

describe("search context shape", () => {
  test("shape appends the rule once, and a second call does not append a second copy", () => {
    const asked = draft();
    shape(asked);
    expect(asked.system).toHaveLength(1);
    expect(asked.system.at(-1)?.text).toBe(CONTRACT.rule);

    shape(asked);
    expect(asked.system).toHaveLength(1);
  });

  test("a draft with tools.grep loses grep and gains ripgrep with the ripgrep description and the same input", () => {
    const input = { type: "object" };
    const grep = { description: "old", input };
    const asked = draft({ tools: { grep } });
    shape(asked);
    expect("grep" in asked.tools).toBe(false);
    expect(asked.tools["ripgrep"]?.description).toBe(CONTRACT.ripgrep);
    expect(asked.tools["ripgrep"]?.input).toBe(input);
    expect(asked.tools["ripgrep"]).toBe(grep);
  });

  test("a draft that already has ripgrep keeps its description and loses grep", () => {
    const asked = draft({
      tools: {
        grep: { description: "old", input: {} },
        ripgrep: { description: "kept", input: {} },
      },
    });
    shape(asked);
    expect("grep" in asked.tools).toBe(false);
    expect(asked.tools["ripgrep"]?.description).toBe("kept");
  });

  test("the appended rule names both spectre_search and ripgrep", () => {
    const asked = draft();
    shape(asked);
    const rule = asked.system.at(-1)?.text ?? "";
    expect(rule).toContain("spectre_search");
    expect(rule).toContain("ripgrep");
  });
});

describe("the context row above the landing", () => {
  test("an unmeasured edit puts the end-of-work nudge in the request", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const callback = await captureContext();
      const name = Session.ID.make("ses_catalogue_end");
      memories.set(name, held({ mutation: 2 }));
      const asked = {
        sessionID: name,
        system: [] as Array<{ type: "text"; text: string }>,
        tools: { spectre_search: { description: "search", input: {} } },
      };
      await Effect.runPromise(callback(asked));
      const text = asked.system.at(-1)?.text ?? "";
      expect(text).toContain(END_OF_WORK);
      expect(text).toContain(CONTRACT.rule);
      memories.delete(name);
    });
  });
});
