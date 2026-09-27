import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { load } from "./definitions";

export const update = (ctx: Pick<Plugin.Context, "skill">) =>
  Effect.gen(function* () {
    const skills = yield* load();

    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill);
    });

    yield* Effect.logInfo("Registered skills", {
      skills: skills.map((skill) => skill.id),
    });
  });
