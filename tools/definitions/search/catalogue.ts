import { CONTRACT, type Contract } from "./contract";

/** The parts of a `session.context` request the catalogue may rewrite. */
export interface Draft {
  system: Array<{ type: "text"; text: string }>;
  tools: Record<string, { description: string; input: unknown }>;
}

/**
 * The prose rule and the tool catalogue for one request.
 *
 * The catalogue replaces `grep` with `ripgrep` in place. The host resolves a
 * renamed tool by object identity (`v2.2.7:packages/core/src/session/model-request.ts:274-308`),
 * so the existing entry moves and its description is mutated in place. A fresh
 * object would be dropped and the model would see neither tool.
 */
export const shape = (draft: Draft, contract: Contract = CONTRACT): void => {
  if (draft.system.at(-1)?.text !== contract.rule) {
    draft.system.push({ type: "text", text: contract.rule });
  }

  if ("grep" in draft.tools) {
    const grep = draft.tools["grep"];
    delete draft.tools["grep"];
    if (grep !== undefined && !("ripgrep" in draft.tools)) {
      grep.description = contract.ripgrep;
      draft.tools["ripgrep"] = grep;
    }
  }
};
