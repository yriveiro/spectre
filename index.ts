import { defineBundle } from "./packages/core/index.ts";
import { routing } from "./blocks/routing/index.ts";

export const bundle = defineBundle({
  id: "yriveiro.spectre",
  blocks: [routing({ agents: ["spectre"] })],
});

export default bundle.plugin;
