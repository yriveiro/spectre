import { expect, test } from "bun:test";
import { Effect } from "effect";
import { runBlock, surfaceProblems, testContext } from "../../../packages/core/index.ts";
import { routing } from "../index.ts";

test("routing declares the tool and skill it registers", async () => {
  const block = routing({ agents: ["spectre"] });
  const context = testContext();
  const recorded = await Effect.runPromise(Effect.scoped(runBlock(block, context)));

  expect(recorded.tools).toEqual(["spectre_routing"]);
  expect(recorded.skills).toEqual(["model-router"]);
  expect(surfaceProblems(block, recorded)).toEqual([]);
});
