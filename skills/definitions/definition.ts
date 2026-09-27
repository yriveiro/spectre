import { join } from "node:path";
import type { Skill } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";

export type Definition = Omit<Skill.Info, "content">;

export const anchor = (directory: string): AbsolutePath =>
  AbsolutePath.make(join(directory, "SKILL.md"));
