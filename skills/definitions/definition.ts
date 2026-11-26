import { join } from "node:path";
import type { Skill } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import type { Session } from "@opencode/schema/session";
import type { Effect } from "effect";

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

export interface PreloadContext {
  readonly directory: AbsolutePath;
  readonly sessionID: Session.ID;
  readonly signal: AbortSignal;
}

export type PreloadOutcome =
  | {
      readonly kind: "ok";
      readonly body: string;
    }
  | {
      readonly kind: "skip";
      readonly reason: string;
    };

export interface SkillPreload {
  /** Provenance label shown on the `<skill_preload>` header. */
  readonly source: string;
  /** Workspace-relative resources checked against read permission before running. */
  readonly readResources?: ReadonlyArray<string>;
  /** Wall-clock limit in ms; clamped to [100, 5_000]. */
  readonly timeoutMs?: number;
  /** UTF-8 byte cap for the framed block; clamped to 4_096. */
  readonly maxBytes?: number;
  /** Line cap for the framed block; clamped to 80. */
  readonly maxLines?: number;
  /** Local, read-only workspace probe that honors `context.signal`. */
  readonly run: (context: PreloadContext) => Effect.Effect<PreloadOutcome, unknown>;
}

export type Definition = Omit<Skill.Info, "content" | "description"> & {
  readonly description: string;
  readonly catalog: SkillCatalog;
  readonly preload?: SkillPreload;
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
