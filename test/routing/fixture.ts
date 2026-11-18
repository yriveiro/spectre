import { afterEach, beforeEach } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";

export const CATALOGUE = [
  {
    providerID: "acme",
    id: "falcon-mini",
    variants: [{ id: "none" }, { id: "high" }],
  },
  { providerID: "acme", id: "falcon-max", variants: [{ id: "high" }] },
  { providerID: "opencode", id: "gpt-5", variants: [] },
];

/**
 * The only domain the tool reads is the catalogue, so the fake context is one
 * call. `OPENCODE_CONFIG_DIR` is pinned to an empty directory so a developer's
 * own global config cannot reach a test.
 */
export const useScratch = () => {
  const saved = Bun.env.OPENCODE_CONFIG_DIR;
  let root = "";

  const globalDir = () => `${root}/global`;
  const projectDir = () => `${root}/project`;

  beforeEach(async () => {
    root = (await Bun.$`mktemp -d -t spectre-routing`.text()).trim();
    await Bun.write(`${globalDir()}/.keep`, "");
    Bun.env.OPENCODE_CONFIG_DIR = globalDir();
  });

  afterEach(() => {
    if (saved === undefined) delete Bun.env.OPENCODE_CONFIG_DIR;
    else Bun.env.OPENCODE_CONFIG_DIR = saved;
  });

  return {
    globalDir,
    projectDir,
    writeGlobal: (body: string, name = "spectre.json") => Bun.write(`${globalDir()}/${name}`, body),
    writeProject: (body: string, name = "spectre.json") =>
      Bun.write(`${projectDir()}/${name}`, body),
  };
};

export type SessionModel = {
  readonly providerID: string;
  readonly id: string;
  readonly variant?: string;
};

export type SessionRow =
  | string
  | {
      readonly directory: string;
      readonly parentID?: string;
      readonly model?: SessionModel;
    };

export type Sessions = Record<string, SessionRow>;

export const context = (
  directory: string,
  list: () => Effect.Effect<unknown, unknown> = () =>
    Effect.succeed({ location: {}, data: CATALOGUE }),
  sessions: Sessions = {},
  decide: () => Effect.Effect<unknown, unknown> = () =>
    Effect.fail({ message: "Model not found: opencode/jev-1.13-free" }),
  defaultModel?: SessionModel,
) =>
  ({
    location: { directory },
    model: {
      list,
      ...(defaultModel === undefined
        ? {}
        : {
            default: () => Effect.succeed({ location: {}, data: defaultModel }),
          }),
    },
    experimental: { generate: { decisions: decide } },
    session: {
      get: ({ sessionID }: { readonly sessionID: string }) => {
        const at = sessions[sessionID];
        if (at === undefined) return Effect.fail(new Error(`no session ${sessionID}`));
        if (typeof at === "string")
          return Effect.succeed({ id: sessionID, location: { directory: at } });
        return Effect.succeed({
          id: sessionID,
          location: { directory: at.directory },
          ...(at.parentID === undefined ? {} : { parentID: at.parentID }),
          ...(at.model === undefined ? {} : { model: at.model }),
        });
      },
    },
  }) as unknown as Plugin.Context;
