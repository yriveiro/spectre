import { Plugin } from "@opencode/plugin/tui";
import { routing } from "../blocks/routing/tui/index.tsx";

export default Plugin.define({
  id: "yriveiro.spectre",
  setup: async (context) => {
    const cleanup = await routing.setup(context);
    return async () => {
      await cleanup?.();
    };
  },
});
