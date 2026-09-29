import type { Plugin } from "@opencode/plugin/effect";
import { Effect } from "effect";
import { afterEach, beforeEach } from "bun:test";

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
 * own global `spectre.jsonc` cannot reach a test.
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
    writeGlobal: (body: string) => Bun.write(`${globalDir()}/spectre.jsonc`, body),
    writeProject: (body: string) => Bun.write(`${projectDir()}/spectre.jsonc`, body),
  };
};

export const context = (
  directory: string,
  list: () => Effect.Effect<unknown, unknown> = () =>
    Effect.succeed({ location: {}, data: CATALOGUE }),
) => ({ location: { directory }, model: { list } }) as unknown as Plugin.Context;
