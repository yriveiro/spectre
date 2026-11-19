import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { attachSkillToolContract } from "./catalog";
import { load, toSkillInfo } from "./definitions";
import { attach as watchEffectVersion } from "./definitions/effect-best-practices/watch";

const hasRipwire = () =>
  Boolean(Bun.env.SPECTRE_RIPWIRE?.trim()) ||
  Bun.which("ripwire", { PATH: Bun.env.PATH ?? "" }) !== null;

export const update = (ctx: Pick<Plugin.Context, "skill"> & Plugin.Context) =>
  Effect.gen(function* () {
    const skills = yield* load();

    yield* ctx.skill.transform((editor) => {
      const available = hasRipwire();
      for (const skill of skills) {
        const info = toSkillInfo(skill);
        editor.add(info.id === "ripwire" && !available ? { ...info, autoinvoke: false } : info);
      }
    });

    yield* attachSkillToolContract(ctx);
    yield* watchEffectVersion(ctx);

    yield* Effect.logInfo("Registered skills", {
      skills: skills.map((skill) => skill.id),
    });
  });
