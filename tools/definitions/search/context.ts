import type { Plugin } from "@opencode/plugin/effect";
import { Effect, type Scope } from "effect";
import { CONTRACT, type Contract } from "./contract";

export interface Draft {
  system: Array<{ text: string }>;
  tools: Record<string, { description: string; input: unknown }>;
}

export const shape = (draft: Draft, contract: Contract = CONTRACT): void => {
  if (draft.system.at(-1)?.text !== contract.rule) {
    // The plan's Draft names only `text`, while the live SessionContext carries
    // full SystemParts. The cast keeps the declared shape and the runtime shape
    // (which needs `type: "text"`) true at once.
    draft.system.push({ type: "text", text: contract.rule } as Draft["system"][number]);
  }

  if ("grep" in draft.tools) {
    const grep = draft.tools["grep"];
    delete draft.tools["grep"];
    if (grep !== undefined && !("ripgrep" in draft.tools)) {
      // The host resolves a renamed tool by object identity
      // (v2.2.7:packages/core/src/session/model-request.ts:279-310), so the
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
