import { join } from "node:path";
import type { Skill } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";

export type PushGroup = "leaf" | "communication";

export type PullCategory =
  | "playbook"
  | "stack"
  | "visual"
  | "design"
  | "verification"
  | "writing";

export type SkillCatalog =
  | {
      readonly tier: "push";
      readonly group: PushGroup;
      readonly trigger: string;
    }
  | {
      readonly tier: "hub";
      readonly summary: string;
    }
  | {
      readonly tier: "pull";
      readonly category: PullCategory;
      readonly summary: string;
    };

export type Definition = Omit<Skill.Info, "content" | "description"> & {
  readonly description: string;
  readonly catalog: SkillCatalog;
};

export type LoadedSkill = Definition & {
  readonly content: string;
};

export const anchor = (directory: string): AbsolutePath =>
  AbsolutePath.make(join(directory, "SKILL.md"));

export const toSkillInfo = (skill: LoadedSkill): Skill.Info => ({
  id: skill.id,
  name: skill.name,
  description: skill.description,
  ...(skill.autoinvoke === undefined ? {} : { autoinvoke: skill.autoinvoke }),
  path: skill.path,
  content: skill.content,
});
