import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import type { File, Known } from "../../tools/definitions/routing/types";
import { proposeAlias, serialise, writeConfig } from "../../tools/definitions/routing/write";
import { useScratch } from "./fixture";

const scratch = useScratch();
const run = (path: string, config: File) => Effect.runPromise(writeConfig(path, config));

const known = (over: Partial<Known> = {}): Known => ({
  providerID: "opencode-go",
  id: "muse-spark-1.3-contributor",
  name: "Muse Spark 1.3 Contributor",
  family: "muse",
  rungs: [],
  costInput: 0,
  costOutput: 0,
  enabled: true,
  status: "active",
  tools: true,
  ...over,
});

const config: File = {
  provider: "opencode-go",
  models: {
    glm: "opencode-go/glm-5.3-flash",
    muse: "opencode-go/muse-spark-1.3-contributor",
  },
  profiles: {
    worker: {
      effort: "high",
      match: "Use for a spawned worker run.",
      why: "cheap and deep enough",
    },
  },
  dictionary: "/abs/ste100.json",
};

const CHARSET = /^[a-z0-9][a-z0-9-]*$/;

describe("serialise", () => {
  test("the file is plain JSON, two spaces of indent, one trailing newline", () => {
    const text = serialise(config);
    expect(text.endsWith("\n")).toBe(true);
    expect(text.endsWith("\n\n")).toBe(false);
    expect(text).toBe(`${JSON.stringify(JSON.parse(text), null, 2)}\n`);
    expect(text).not.toContain("//");
  });

  test("the top-level key order is provider, models, profiles, dictionary, setup", () => {
    const shuffled: File = {
      dictionary: "/abs/ste100.json",
      profiles: config.profiles,
      models: config.models,
      provider: "opencode-go",
    };
    expect(Object.keys(JSON.parse(serialise(shuffled)))).toEqual([
      "provider",
      "models",
      "profiles",
      "dictionary",
    ]);
  });

  test("$schema goes first, when the file carries one", () => {
    const withSchema: File = { $schema: "https://opencode.ai/config.json", models: {} };
    expect(Object.keys(JSON.parse(serialise(withSchema)))).toEqual(["$schema", "models"]);
  });

  test("the order inside models is the order the user wrote", () => {
    const preference: File = {
      models: { deepseek: "opencode-go/deepseek-v4.1-flash", glm: "opencode-go/glm-5.3-flash" },
    };
    expect(Object.keys(JSON.parse(serialise(preference)).models)).toEqual(["deepseek", "glm"]);
  });

  test("a null, which removes an inherited entry, is written and not dropped", () => {
    const removal: File = { models: { glm: null } };
    expect(JSON.parse(serialise(removal)).models).toEqual({ glm: null });
  });
});

describe("writeConfig", () => {
  test("a write to a scratch directory lands as the serialised file", async () => {
    const path = `${scratch.projectDir()}/spectre.json`;
    await run(path, config);
    expect(await Bun.file(path).text()).toBe(serialise(config));
  });

  test("the rename leaves no temporary file beside the target", async () => {
    const directory = scratch.projectDir();
    await run(`${directory}/spectre.json`, config);
    const left = await Array.fromAsync(new Bun.Glob("*").scan({ cwd: directory }));
    expect(left).toEqual(["spectre.json"]);
  });

  test("a second write replaces the file whole", async () => {
    const path = `${scratch.projectDir()}/spectre.json`;
    await run(path, config);
    const next: File = { provider: "opencode-go", models: { glm: "opencode-go/glm-5.3-flash" } };
    await run(path, next);
    expect(await Bun.file(path).text()).toBe(serialise(next));
  });

  test("a write is refused over a file that does not decode, and the file stands", async () => {
    const path = `${scratch.projectDir()}/spectre.json`;
    const broken = "{ this is not json";
    await Bun.write(path, broken);
    const failure = run(path, config);
    expect(failure).rejects.toThrow(`${path}: JSONC Parse error`);
    await failure.catch(() => {});
    expect(await Bun.file(path).text()).toBe(broken);
  });

  test("a file the reader accepts is written over, comments included", async () => {
    const path = `${scratch.projectDir()}/spectre.json`;
    await Bun.write(path, '{\n  // the page wrote this\n  "provider": "opencode-go"\n}');
    await run(path, config);
    expect(await Bun.file(path).text()).toBe(serialise(config));
  });

  test("a working config is never overwritten by a broken one", async () => {
    const path = `${scratch.projectDir()}/spectre.json`;
    await Bun.write(path, JSON.stringify({ provider: "opencode-go", arena: true }));
    const failure = run(path, config);
    expect(failure).rejects.toThrow(`${path}:`);
    await failure.catch(() => {});
    expect(await Bun.file(path).text()).toBe('{"provider":"opencode-go","arena":true}');
  });
});

describe("proposeAlias", () => {
  test("the family, slugged, is the alias", () => {
    expect(proposeAlias(known(), [])).toBe("muse");
  });

  test("when the family is taken, the tail of the id extends it", () => {
    expect(proposeAlias(known(), ["muse"])).toBe("muse-spark-1-3-contributor");
  });

  test("when the family and the tail are taken, the provider extends it", () => {
    expect(proposeAlias(known(), ["muse", "muse-spark-1-3-contributor"])).toBe("muse-opencode-go");
  });

  test("an id that does not carry the family as its head is all tail", () => {
    const model = known({ id: "kimi-k3", family: "kimi-k3" });
    expect(proposeAlias(model, ["kimi-k3"])).toBe("kimi-k3-opencode-go");
  });

  test("a model with no family falls back to the tail, then the provider", () => {
    expect(proposeAlias(known({ id: "gpt-5", family: undefined }), [])).toBe("gpt-5");
    expect(proposeAlias(known({ id: "gpt-5", family: undefined }), ["gpt-5"])).toBe("opencode-go");
  });

  test("every alias proposed meets the alias charset", () => {
    const models = [
      known(),
      known({ id: "glm-5.3-flash", family: "glm-flash" }),
      known({ id: "deepseek-v4.1-flash", family: "deepseek-flash" }),
      known({ id: "GPT 5 Turbo!", family: "OpenAI / GPT" }),
    ];
    const taken: Array<string> = [];
    for (const model of models) {
      const alias = proposeAlias(model, taken);
      expect(alias).toMatch(CHARSET);
      expect(taken).not.toContain(alias);
      taken.push(alias);
    }
  });

  test("every rung taken still returns a name inside the charset", () => {
    const model = known({ providerID: "opencode-go" });
    const alias = proposeAlias(model, ["muse", "muse-spark-1-3-contributor", "muse-opencode-go"]);
    expect(alias).toMatch(CHARSET);
    expect(alias.startsWith("muse-opencode-go")).toBe(true);
  });
});
