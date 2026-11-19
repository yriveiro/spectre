import { join } from "node:path";
import type { Plugin, Skill } from "@opencode/plugin/effect";
// From the subpath rather than the barrel: the barrel re-exports `Command`, which is the
// schema namespace holding `Command.Info`, and not the plugin's `CommandDefinition`.
import type { CommandDefinition } from "@opencode/plugin/effect/command";
import { Effect } from "effect";

const PROMPT = "prompt.md";

const mergeSkills = (
  existing: ReadonlyArray<{ readonly id: Skill.ID }> | undefined,
  extra: ReadonlyArray<Skill.ID> | undefined,
) => {
  if (extra === undefined || extra.length === 0) return existing;
  const base = existing ?? [];
  const seen = new Set(base.map((one) => one.id));
  const added = extra.filter((id) => !seen.has(id)).map((id) => ({ id }));
  return [...base, ...added];
};

export const promptCommand = (
  ctx: Pick<Plugin.Context, "session">,
  directory: string,
  spec: {
    readonly name: string;
    readonly description: string;
    readonly skills?: ReadonlyArray<Skill.ID>;
    readonly context?: (sessionDirectory: string) => Promise<string | undefined>;
  },
): CommandDefinition => ({
  name: spec.name,
  description: spec.description,
  execute: (input) =>
    Effect.gen(function* () {
      const text = yield* Effect.tryPromise({
        try: () => Bun.file(join(directory, PROMPT)).text(),
        catch: (cause) => new Error(`Cannot read the /${spec.name} prompt at ${PROMPT}: ${cause}`),
      }).pipe(Effect.orDie);

      let extra: string | undefined;
      const contextFn = spec.context;
      if (contextFn !== undefined && typeof ctx.session.get === "function") {
        const info = yield* Effect.result(ctx.session.get({ sessionID: input.sessionID }));
        const sessionDir = info._tag === "Success" ? info.success.location.directory : "";
        if (sessionDir !== "") {
          extra = yield* Effect.promise(() => contextFn(sessionDir));
        }
      }

      const said = input.prompt.text.trim();
      const body = extra === undefined ? text : `${text}\n\n${extra}`;
      const skills = mergeSkills(input.prompt.skills, spec.skills);

      yield* ctx.session.prompt({
        ...input.prompt,
        sessionID: input.sessionID,
        text: said === "" ? body : `${body}\n\nThe user added: ${said}`,
        ...(skills === undefined ? {} : { skills }),
        delivery: input.delivery,
      });
    }).pipe(Effect.asVoid),
});
