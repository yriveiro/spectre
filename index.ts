import { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

export default Plugin.define({
  id: "yriveiro.spectre",
  effect: (ctx) =>
    Effect.gen(function* () {
      yield* Effect.logInfo("spectre loaded", {
        version: ctx.app.version,
      });
    }),
});
