import { describe, expect, test } from "bun:test";
import { type Plugin, Skill } from "@opencode/plugin/effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { Effect, Stream } from "effect";
import { update } from "../../skills";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("ripwire-autoinvoke");

const withSyncEnv = <T>(
  overrides: { PATH?: string | undefined; SPECTRE_RIPWIRE?: string | undefined },
  run: () => T,
): T => {
  const prevPath = Bun.env.PATH;
  const prevRipwire = Bun.env.SPECTRE_RIPWIRE;

  if (overrides.PATH === undefined) delete Bun.env.PATH;
  else Bun.env.PATH = overrides.PATH;

  if (overrides.SPECTRE_RIPWIRE === undefined) delete Bun.env.SPECTRE_RIPWIRE;
  else Bun.env.SPECTRE_RIPWIRE = overrides.SPECTRE_RIPWIRE;

  try {
    return run();
  } finally {
    if (prevPath === undefined) delete Bun.env.PATH;
    else Bun.env.PATH = prevPath;

    if (prevRipwire === undefined) delete Bun.env.SPECTRE_RIPWIRE;
    else Bun.env.SPECTRE_RIPWIRE = prevRipwire;
  }
};

const registeredSkills = async (overrides: {
  PATH?: string | undefined;
  SPECTRE_RIPWIRE?: string | undefined;
}): Promise<ReadonlyArray<Skill.Info>> => {
  const added: Array<Skill.Info> = [];
  const ctx = {
    location: { directory: AbsolutePath.make(process.cwd()) },
    skill: {
      transform: (fn: (editor: { add: (info: Skill.Info) => void }) => void) =>
        Effect.sync(() => {
          withSyncEnv(overrides, () => {
            fn({
              add: (info) => {
                added.push(info);
              },
            });
          });
          return { dispose: Effect.void };
        }),
    },
    event: {
      subscribe: () => Stream.empty,
    },
    session: {
      hook: () => Effect.succeed({ dispose: Effect.void }),
    },
  } as unknown as Plugin.Context;

  await Effect.runPromise(Effect.scoped(update(ctx)));
  return added;
};

describe("skills.update gates ripwire autoinvoke on binary presence", () => {
  test("sets autoinvoke to false on ripwire when PATH and SPECTRE_RIPWIRE hold no binary", async () => {
    const emptyBin = temp("empty");
    await Bun.write(`${emptyBin}/.keep`, "");

    const added = await registeredSkills({ PATH: emptyBin, SPECTRE_RIPWIRE: undefined });
    const ripwire = added.find((skill) => skill.id === "ripwire");
    const autoInvoked = added.filter((skill) => skill.autoinvoke).map((skill) => skill.id);

    expect(ripwire?.autoinvoke).toBe(false);
    expect(autoInvoked).toEqual([]);
  });

  test("keeps autoinvoke true on ripwire when PATH contains an executable ripwire", async () => {
    const binDir = temp("path-bin");
    const binPath = `${binDir}/ripwire`;
    await Bun.write(binPath, "#!/bin/sh\nexit 0\n");
    await Bun.spawn(["chmod", "+x", binPath]).exited;

    const added = await registeredSkills({ PATH: binDir, SPECTRE_RIPWIRE: undefined });
    const ripwire = added.find((skill) => skill.id === "ripwire");
    const autoInvoked = added.filter((skill) => skill.autoinvoke).map((skill) => skill.id);

    expect(ripwire?.autoinvoke).toBe(true);
    expect(autoInvoked).toEqual([Skill.ID.make("ripwire")]);
  });

  test("keeps autoinvoke true on ripwire when SPECTRE_RIPWIRE is set", async () => {
    const emptyBin = temp("env-only");
    const customBin = `${emptyBin}/custom-ripwire`;
    await Bun.write(customBin, "#!/bin/sh\nexit 0\n");

    const added = await registeredSkills({
      PATH: temp("missing-path"),
      SPECTRE_RIPWIRE: customBin,
    });
    const ripwire = added.find((skill) => skill.id === "ripwire");

    expect(ripwire?.autoinvoke).toBe(true);
  });
});
