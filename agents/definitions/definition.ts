import type { Agent } from "@opencode/plugin/effect";

export type Definition = Omit<Partial<Agent.Info>, "permissions"> & Pick<Agent.Info, "id">;
