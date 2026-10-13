import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { load } from "./definitions";
import { attach as watchEffectVersion } from "./definitions/effect-best-practices/watch";

export const update = (ctx: Pick<Plugin.Context, "skill"> & Plugin.Context) =>
  Effect.gen(function* () {
    const skills = yield* load();

    yield* ctx.skill.transform((editor) => {
      for (const skill of skills) editor.add(skill);
    });

    // The watcher is not a skill: it reads `package.json` and reads the event stream, and it
    // exists to hold one body to one pin. It rides here because that body registers here,
    // not because every skill needs one.
    yield* watchEffectVersion(ctx);

    yield* Effect.logInfo("Registered skills", {
      skills: skills.map((skill) => skill.id),
    });
  });
