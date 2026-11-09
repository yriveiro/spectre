import { describe, expect, test } from "bun:test";
import type { Tool } from "@opencode/schema/tool";
import { Effect, Schema } from "effect";
import {
  defineBlock,
  defineBundle,
  runBlock,
  surfaceProblems,
  testContext,
  type Block,
  type Surfaces,
} from "../index";

const surfaces = (over: Partial<Surfaces> = {}): Surfaces => ({
  tools: [],
  skills: [],
  commands: [],
  agents: [],
  hooks: [],
  ...over,
});

const block = (id: string, declared: Surfaces = surfaces()): Block =>
  defineBlock({ id, surfaces: declared, effect: () => Effect.void });

const tool = (name: string): Tool.Info => ({
  name,
  description: name,
  input: Schema.Struct({}),
  execute: () => Effect.succeed({}),
  options: { namespace: "spectre" },
});

class BlockFailure extends Schema.TaggedError<BlockFailure>()("BlockFailure", {}) {}

const registersTool = (declared: Surfaces): Block =>
  defineBlock({
    id: "a",
    surfaces: declared,
    effect: (ctx) =>
      Effect.gen(function* () {
        yield* ctx.tool.transform((editor) => {
          editor.add(tool("x"));
        });
      }),
  });

describe("defineBundle", () => {
  test("rejects a duplicate block id", () => {
    expect(() => defineBundle({ id: "test", blocks: [block("a"), block("a")] })).toThrow(
      "duplicate block id: a",
    );
  });

  test("rejects two blocks that declare the same tool", () => {
    expect(() =>
      defineBundle({
        id: "test",
        blocks: [
          block("a", surfaces({ tools: ["spectre_x"] })),
          block("b", surfaces({ tools: ["spectre_x"] })),
        ],
      }),
    ).toThrow("declared by a and b");
  });

  test("allows an empty bundle", () => {
    expect(defineBundle({ id: "test", blocks: [] }).id).toBe("test");
  });
});

describe("block registration", () => {
  test("registers through the SDK transform", async () => {
    const declared = surfaces({ tools: ["spectre_x"] });
    const registered = registersTool(declared);

    const recorded = await Effect.runPromise(Effect.scoped(runBlock(registered)));

    expect(surfaceProblems(registered, recorded)).toEqual([]);
  });

  test("reports a declared surface that was never registered", async () => {
    const declared = surfaces({ tools: ["spectre_missing"] });
    const registered = registersTool(declared);

    const recorded = await Effect.runPromise(Effect.scoped(runBlock(registered)));

    expect(surfaceProblems(registered, recorded)).toEqual([
      "a: declared tools never registered: spectre_missing",
      "a: registered tools never declared: spectre_x",
    ]);
  });
});

describe("bundle lifecycle", () => {
  test("a failed block is rolled back while a healthy sibling stays", async () => {
    const context = testContext();

    const bad = defineBlock({
      id: "bad",
      surfaces: surfaces({ tools: ["spectre_bad"] }),
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.tool.transform((editor) => {
            editor.add(tool("bad"));
          });
          return yield* new BlockFailure();
        }),
    });

    const good = defineBlock({
      id: "good",
      surfaces: surfaces({ agents: ["good"] }),
      effect: (ctx) =>
        Effect.gen(function* () {
          yield* ctx.agent.transform((editor) => {
            editor.update("good", () => {});
          });
        }),
    });

    const bundle = defineBundle({ id: "test", blocks: [bad, good] });
    await Effect.runPromise(Effect.scoped(bundle.plugin.effect(context.ctx)));

    expect(context.disposed).toEqual(["tool", "agent"]);
  });
});
