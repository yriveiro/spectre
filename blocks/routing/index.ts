import { Effect } from "effect";
import { defineBlock } from "../../packages/core/index.ts";
import { modelRouter } from "./skills/model-router/index.ts";
import { routing as tool } from "./tool.ts";

const body = Effect.tryPromise({
  try: () => Bun.file(modelRouter.path).text(),
  catch: (cause) =>
    new Error(`Cannot read the body of ${modelRouter.id}: ${modelRouter.path} (${cause})`),
}).pipe(Effect.orDie);

export const routing = (deps: { readonly agents: ReadonlyArray<string> }) =>
  defineBlock({
    id: "spectre.routing",
    surfaces: {
      tools: ["spectre_routing"],
      skills: ["model-router"],
      commands: [],
      agents: [],
      hooks: [],
    },
    effect: (ctx) =>
      Effect.gen(function* () {
        const content = yield* body;
        yield* ctx.skill.transform((editor) => editor.add({ ...modelRouter, content }));
        yield* ctx.tool.transform((editor) => editor.add(tool(ctx, deps.agents)));
      }),
  });
