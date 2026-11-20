import { afterEach, describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { attachCatalogue, endOfWorkSynced } from "../../tools/definitions/search/apply";
import { type Draft, shape } from "../../tools/definitions/search/catalogue";
import { CONTRACT, END_OF_WORK } from "../../tools/definitions/search/contract";
import { contextRule, type Memory } from "../../tools/definitions/search/policy";
import { memories } from "../../tools/definitions/search/state";
import { captureContext, cleanupDirs, makeBin, READY_BIN, withBinary } from "./host";

const draft = (overrides?: Partial<Draft>): Draft => ({
  system: [],
  tools: {},
  ...overrides,
});

const held = (overrides?: Partial<Memory>): Memory => ({
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  editedCode: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  ...overrides,
});

interface EntryPut {
  readonly sessionID: Session.ID;
  readonly key: string;
  readonly value: unknown;
}

interface EntryRemove {
  readonly sessionID: Session.ID;
  readonly key: string;
}

const captureContextWithEntries = async () => {
  let callback: ((event: unknown) => Effect.Effect<void, never>) | undefined;
  const puts: Array<EntryPut> = [];
  const removes: Array<EntryRemove> = [];
  const stored = new Map<string, string>();
  const ctx = {
    session: {
      hook: (_name: string, cb: (event: unknown) => Effect.Effect<void, never>) => {
        callback = cb;
        return Effect.succeed({ dispose: Effect.void });
      },
      instructions: {
        entry: {
          put: (input: EntryPut) =>
            Effect.sync(() => {
              puts.push(input);
              stored.set(`${input.sessionID}:${input.key}`, String(input.value));
            }),
          remove: (input: EntryRemove) =>
            Effect.sync(() => {
              removes.push(input);
              stored.delete(`${input.sessionID}:${input.key}`);
            }),
        },
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachCatalogue(ctx)));
  if (callback === undefined) throw new Error("catalogue did not register");
  return { callback, puts, removes, stored };
};

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
    expect(asked.tools.ripgrep?.description).toBe(CONTRACT.ripgrep);
    expect(asked.tools.ripgrep?.description).toContain(
      "Pass one existing file or directory in `path`; put multi-folder globs such as `{test,scripts}/**` in `include`.",
    );
    expect(asked.tools.ripgrep?.input).toBe(input);
    expect(asked.tools.ripgrep).toBe(grep);
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
    expect(asked.tools.ripgrep?.description).toBe("kept");
  });

  test("the appended rule names both spectre_search and ripgrep", () => {
    const asked = draft();
    shape(asked);
    const rule = asked.system.at(-1)?.text ?? "";
    expect(rule).toContain("spectre_search");
    expect(rule).toContain("ripgrep");
  });
});

describe("a stock agent's request is left as the host built it", () => {
  test("no rule is appended, grep keeps its name, and ripgrep gains nothing", async () => {
    const callback = await captureContext();
    const asked = {
      sessionID: Session.ID.make("ses_catalogue_stock"),
      agent: "build",
      system: [] as Array<{ type: "text"; text: string }>,
      tools: { grep: { description: "grep", input: {} } },
    };

    await Effect.runPromise(callback(asked));

    expect(asked.system).toEqual([]);
    expect(asked.tools.grep?.description).toBe("grep");
    expect("ripgrep" in asked.tools).toBe(false);
  });
});

describe("KV-cache invariant system prefix and durable end-of-work entry", () => {
  test("event.system stays byte-identical before, during, and after code edits while spectre.end-of-work puts once and removes once", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const { callback, puts, removes, stored } = await captureContextWithEntries();
      const name = Session.ID.make("ses_catalogue_end");
      const base = {
        sessionID: name,
        agent: "spectre",
        system: [{ type: "text" as const, text: "agent system prompt" }],
        tools: { spectre_search: { description: "search", input: {} } },
      };

      const beforeEdit = structuredClone(base);
      await Effect.runPromise(callback(beforeEdit));
      const baseline = JSON.stringify(beforeEdit.system);
      expect(beforeEdit.system.at(-1)?.text).toBe(
        contextRule({ kind: "ready", binary: bin, version: "0.6.10" }),
      );
      expect(puts).toEqual([]);
      expect(removes).toEqual([]);

      memories.set(name, held({ mutation: 1, editedCode: new Set(["src/retry.ts"]) }));
      const duringFirstEdit = structuredClone(base);
      await Effect.runPromise(callback(duringFirstEdit));
      expect(JSON.stringify(duringFirstEdit.system)).toBe(baseline);
      expect(duringFirstEdit.system.some((part) => part.text.includes(END_OF_WORK))).toBe(false);
      expect(puts).toEqual([{ sessionID: name, key: "spectre.end-of-work", value: END_OF_WORK }]);
      expect(stored.get(`${name}:spectre.end-of-work`)).toBe(END_OF_WORK);

      memories.set(
        name,
        held({ mutation: 2, editedCode: new Set(["src/retry.ts", "src/attach.ts"]) }),
      );
      const duringSecondEdit = structuredClone(base);
      await Effect.runPromise(callback(duringSecondEdit));
      expect(JSON.stringify(duringSecondEdit.system)).toBe(baseline);
      expect(puts).toHaveLength(1);

      memories.set(
        name,
        held({
          mutation: 2,
          editedCode: new Set(["src/retry.ts", "src/attach.ts"]),
          measured: { delta: 2, affected: 2 },
        }),
      );
      const afterMeasure = structuredClone(base);
      await Effect.runPromise(callback(afterMeasure));
      expect(JSON.stringify(afterMeasure.system)).toBe(baseline);
      expect(removes).toEqual([{ sessionID: name, key: "spectre.end-of-work" }]);
      expect(stored.has(`${name}:spectre.end-of-work`)).toBe(false);

      const afterMeasureAgain = structuredClone(base);
      await Effect.runPromise(callback(afterMeasureAgain));
      expect(removes).toHaveLength(1);

      memories.delete(name);
      endOfWorkSynced.delete(name);
    });
  });
});
