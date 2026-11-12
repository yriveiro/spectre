import type { Plugin } from "@opencode/plugin/effect";
import { Effect, type Scope } from "effect";
import { CONTRACT, type Contract } from "./contract";

export interface Draft {
  system: Array<{ type: "text"; text: string }>;
  tools: Record<string, { description: string; input: unknown }>;
}

export const shape = (draft: Draft, contract: Contract = CONTRACT): void => {
  if (draft.system.at(-1)?.text !== contract.rule) {
    draft.system.push({ type: "text", text: contract.rule });
  }

  if ("grep" in draft.tools) {
    const grep = draft.tools["grep"];
    delete draft.tools["grep"];
    if (grep !== undefined && !("ripgrep" in draft.tools)) {
      // The host resolves a renamed tool by object identity
      // (v2.2.7:packages/core/src/session/model-request.ts:274-308), so the
      // existing entry moves and its description is mutated in place. A fresh
      // object would be dropped and the model would see neither tool.
      grep.description = contract.ripgrep;
      draft.tools["ripgrep"] = grep;
    }
  }
};

export const attachContext = (ctx: Plugin.Context): Effect.Effect<void, never, Scope.Scope> =>
  Effect.gen(function* () {
    yield* ctx.session.hook("context", (event) =>
      Effect.sync(() => shape(event)).pipe(
        Effect.catchCause((cause) =>
          Effect.logWarning("search context failed", { cause }).pipe(Effect.asVoid),
        ),
      ),
    );

    yield* Effect.logInfo("Registered search context", { trigger: "session.context" });
  });
