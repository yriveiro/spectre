import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { catalogue, read, resolve, save } from "../../tui/data";

const scratch = () => join(Bun.env.TMPDIR ?? "/tmp", `spectre-tui-data-${crypto.randomUUID()}`);

const row = (input: {
  id: string;
  family: string;
  name: string;
  rungs: string[];
  cost: [number, number];
  enabled?: boolean;
  status?: string;
  tools?: boolean;
}) => ({
  providerID: "opencode-go",
  id: input.id,
  name: input.name,
  family: input.family,
  variants: input.rungs.map((id) => ({ id })),
  cost: [{ input: input.cost[0], output: input.cost[1], cache: { read: 0, write: 0 } }],
  enabled: input.enabled ?? true,
  status: (input.status ?? "active") as "active" | "deprecated" | "alpha" | "beta",
  capabilities: { tools: input.tools ?? true, input: [], output: [] },
});

const models = [
  row({
    id: "deepseek-v4.1-flash",
    family: "deepseek-flash",
    name: "DeepSeek",
    rungs: ["low", "high", "max"],
    cost: [0.15, 0.6],
  }),
  row({
    id: "glm-5.3-flash",
    family: "glm-flash",
    name: "GLM",
    rungs: ["low", "high", "max"],
    cost: [0.15, 0.5],
  }),
  row({
    id: "minimax-m3.1-flash-free",
    family: "minimax",
    name: "MiniMax",
    rungs: ["low", "medium", "high", "xhigh", "max"],
    cost: [0, 0],
  }),
  row({ id: "muse-spark", family: "muse", name: "Muse", rungs: [], cost: [0.1, 0.2] }),
  row({
    id: "kimi-k3",
    family: "kimi-k3",
    name: "Kimi",
    rungs: ["max"],
    cost: [3, 15],
    enabled: false,
  }),
  row({
    id: "old",
    family: "old",
    name: "Old",
    rungs: ["high"],
    cost: [1, 2],
    status: "deprecated",
  }),
  row({
    id: "no-tools",
    family: "no-tools",
    name: "No Tools",
    rungs: ["high"],
    cost: [1, 1],
    tools: false,
  }),
] as unknown as Parameters<typeof catalogue>[0];

const config = {
  $schema: "./schema.json",
  setup: "declined",
  provider: "opencode-go",
  models: {
    "no-tools": "opencode-go/no-tools",
    "deepseek-flash": "opencode-go/deepseek-v4.1-flash",
    minimax: "opencode-go/minimax-m3.1-flash-free",
    muse: "opencode-go/muse-spark",
    "glm-flash": "opencode-go/glm-5.3-flash#high",
    dead: "opencode-go/kimi-k3",
    ghost: "opencode-go/ghost",
  },
  profiles: {
    mechanical: { effort: "low", match: "one command", why: "cheap" },
    worker: { effort: "high", crosscheck: { effort: "high", prefer: "free" }, agent: "sicko" },
    pinned: { model: ["ghost", "glm-flash"] },
    lost: { effort: "xhigh" },
    empty: { match: "nothing" },
  },
  dictionary: "relative/dictionary.json",
};

const project = async () => {
  const at = scratch();
  await Bun.write(`${at}/.keep`, "");
  await Bun.write(`${at}/spectre.json`, JSON.stringify(config));
  return at;
};

describe("the page reads the repository's own file", () => {
  test("a file with no config reads with the default profiles enabled", async () => {
    const at = scratch();
    await Bun.write(`${at}/.keep`, "");
    const draft = await read(at);
    expect(draft.models).toEqual([]);
    expect(draft.profiles.map((one) => one.name)).toEqual([
      "mechanical",
      "search",
      "worker",
      "judgment",
      "thinking",
      "deep",
      "refactor",
    ]);
    expect(draft.profiles.every((one) => one.enabled !== false)).toBe(true);
  });

  test("a file with configured profiles marks unconfigured default profiles as disabled", async () => {
    const draft = await read(await project());
    const enabled = draft.profiles.filter((one) => one.enabled !== false).map((one) => one.name);
    const disabled = draft.profiles.filter((one) => one.enabled === false).map((one) => one.name);
    expect(enabled).toEqual(["mechanical", "worker", "pinned", "lost", "empty"]);
    expect(disabled).toEqual(["search", "judgment", "thinking", "deep", "refactor"]);
  });

  test("the global file is not folded into the draft", async () => {
    const at = await project();
    const global = scratch();
    await Bun.write(`${global}/.keep`, "");
    await Bun.write(
      `${global}/spectre.json`,
      JSON.stringify({ models: { global: "opencode-go/ghost" }, provider: "from-global" }),
    );
    const saved = Bun.env.OPENCODE_CONFIG_DIR;
    Bun.env.OPENCODE_CONFIG_DIR = global;
    try {
      const draft = await read(at);
      expect(draft.provider).toBe("opencode-go");
      expect(draft.models.map((one) => one.alias)).not.toContain("global");
    } finally {
      if (saved === undefined) delete Bun.env.OPENCODE_CONFIG_DIR;
      else Bun.env.OPENCODE_CONFIG_DIR = saved;
    }
  });

  test("the allowlist keeps the order the file lists", async () => {
    const draft = await read(await project());
    expect(draft.models.map((one) => one.alias)).toEqual([
      "no-tools",
      "deepseek-flash",
      "minimax",
      "muse",
      "glm-flash",
      "dead",
      "ghost",
    ]);
  });

  test("a profile with no effort and no pin says so", async () => {
    const draft = await read(await project());
    const empty = draft.profiles.find((one) => one.name === "empty");
    expect(empty?.effort).toBeUndefined();
    expect(empty?.pinned).toBeUndefined();
  });
});

describe("the page resolves what the tool resolves", () => {
  test("a profile spends the first allowed model that meets its effort", async () => {
    const at = await project();
    const rows = resolve(await read(at), catalogue(models));
    const mechanical = rows.find((one) => one.profile === "mechanical");
    expect(mechanical?.ref).toBe("opencode-go/deepseek-v4.1-flash#low");
    expect(mechanical?.rung).toBe("low");
    expect(mechanical?.cost).toBe("$0.15/$0.6");
  });

  test("a second opinion comes from another family, and the free one when it is asked for", async () => {
    const at = await project();
    const rows = resolve(await read(at), catalogue(models));
    const worker = rows.find((one) => one.profile === "worker");
    expect(worker?.ref).toBe("opencode-go/deepseek-v4.1-flash#high");
    expect(worker?.crosscheck).toContain("minimax");
  });

  test("a pin the allowlist does not hold is a problem, not a guess", async () => {
    const at = await project();
    const rows = resolve(await read(at), catalogue(models));
    const pinned = rows.find((one) => one.profile === "pinned");
    expect(pinned?.ref).toBeUndefined();
    expect(pinned?.problem).toContain("ghost");
  });

  test("a profile that states no requirement says so", async () => {
    const at = await project();
    const rows = resolve(await read(at), catalogue(models));
    const empty = rows.find((one) => one.profile === "empty");
    expect(empty?.problem).toContain("states no effort and no model");
  });
});

describe("the page writes through the writer", () => {
  test("the save keeps the keys the page does not edit, and drops the decline", async () => {
    const at = await project();
    const draft = await read(at);
    await save(at, {
      ...draft,
      profiles: draft.profiles.map((one) =>
        one.name === "mechanical" ? { ...one, effort: "high" } : one,
      ),
    });
    const written = (await Bun.file(`${at}/spectre.json`).json()) as Record<string, unknown>;
    expect(written.$schema).toBe("./schema.json");
    expect(written.dictionary).toBe("relative/dictionary.json");
    expect(written.setup).toBeUndefined();
    const profiles = written.profiles as Record<string, { effort?: string }>;
    expect(profiles.mechanical?.effort).toBe("high");
  });

  test("a file that does not decode is refused and left alone", async () => {
    const at = await project();
    await Bun.write(`${at}/spectre.json`, "{ broken");
    const draft = await read(at);
    await expect(save(at, draft)).rejects.toThrow();
    expect(await Bun.file(`${at}/spectre.json`).text()).toBe("{ broken");
  });
});
