import { describe, expect, test } from "bun:test";
import { RGBA } from "@opentui/core";
import { createComponent, testRender } from "@opentui/solid";
import { PluginContextProvider } from "@opencode/plugin/tui";
import { type Draft, type Model, type Resolution } from "../../tui/data";
import { page } from "../../tui/page";

/**
 * The page, in a real renderer.
 *
 * The terminal's own test renderer draws the tree the host would draw, and the
 * host's own context provider supplies the theme and the dialogs. So the frame
 * below is the frame a person sees, and the presses are the presses they make.
 */

const GREY = RGBA.fromInts(200, 200, 200, 255);
const WARNING = RGBA.fromInts(255, 180, 0, 255);

const theme = {
  text: {
    base: GREY,
    muted: GREY,
    faint: GREY,
    feedback: { warning: { base: WARNING, muted: GREY } },
  },
};

const models: ReadonlyArray<Model> = [
  {
    providerID: "acme",
    id: "muse-spark-1.3",
    name: "Muse Spark",
    family: "muse",
    rungs: ["minimal", "low", "medium", "high", "xhigh"],
    costInput: 0.1,
    costOutput: 0.2,
    enabled: true,
    deprecated: false,
    tools: true,
  },
  {
    providerID: "acme",
    id: "glm-5.3-flash",
    name: "GLM Flash",
    family: "glm-flash",
    rungs: ["low", "high", "max"],
    costInput: 0.15,
    costOutput: 0.5,
    enabled: true,
    deprecated: false,
    tools: true,
  },
];

const draft: Draft = {
  provider: "acme",
  models: [
    { alias: "muse", ref: "acme/muse-spark-1.3" },
    { alias: "glm-flash", ref: "acme/glm-5.3-flash" },
  ],
  profiles: [
    {
      name: "worker",
      effort: "high",
      match: "a decided change across several files",
      why: "cheap",
      crosscheck: undefined,
      agent: "spectre",
      pinned: undefined,
    },
    {
      name: "pinned",
      effort: "max",
      match: undefined,
      why: undefined,
      crosscheck: undefined,
      agent: "spectre",
      pinned: "muse",
    },
  ],
};

const spent: Resolution = {
  profile: "worker",
  ref: "acme/muse-spark-1.3#high",
  rung: "high",
  cost: "$0.1 in, $0.2 out",
  crosscheck: undefined,
  problem: undefined,
};

const rows = [
  { profile: draft.profiles[0]!, resolution: spent },
  {
    profile: draft.profiles[1]!,
    resolution: {
      profile: "pinned",
      ref: undefined,
      rung: undefined,
      cost: undefined,
      crosscheck: undefined,
      problem: 'profiles.pinned.model: "ghost" is not an allowed model in this session.',
    },
  },
];

const entries = [
  { alias: "muse", ref: "acme/muse-spark-1.3", model: models[0] },
  { alias: "glm-flash", ref: "acme/glm-5.3-flash", model: models[1] },
];

/** A host whose dialogs answer what the test tells them to. */
const host = (answer?: string) => {
  const asked: Array<string> = [];
  const dialog = {
    select: async (options: { title: string; options: ReadonlyArray<{ title: string }> }) => {
      asked.push(options.title);
      return answer;
    },
    prompt: async () => undefined,
    alert: async () => {},
    show: () => {},
    clear: () => {},
    set: () => {},
    confirm: async () => undefined,
  };
  const context = { theme, ui: { dialog, toast: { show: () => {} } } };
  return { asked, context };
};

const frame = async (input: {
  readonly answer?: string;
  readonly onSave?: () => void;
  readonly onChange?: (next: Draft) => void;
}) => {
  const { asked, context } = host(input.answer);
  const setup = await testRender(
    () =>
      createComponent(PluginContextProvider, {
        value: context as never,
        get children() {
          return page({
            rows,
            models: entries,
            catalogue: models,
            draft,
            onChange: input.onChange ?? (() => {}),
            onSave: input.onSave ?? (() => {}),
            source: "/tmp/project/spectre.json",
          });
        },
      }),
    { width: 100, height: 30 },
  );
  await setup.renderOnce();
  return { setup, asked };
};

describe("the page draws what the session would spend", () => {
  test("the frame carries the three tables and the write line", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("Routing");
    expect(drawn).toContain("Profiles");
    expect(drawn).toContain("Allowlist");
    expect(drawn).toContain("Catalogue");
    expect(drawn).toContain("write it");
    await setup.dispose();
  });

  test("a profile shows its effort, the model it spends and the cost", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("worker");
    expect(drawn).toContain("high");
    expect(drawn).toContain("acme/muse-spark-1.3#high");
    expect(drawn).toContain("$0.1 in");
    await setup.dispose();
  });

  test("a profile that resolves to nothing says so", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("pinned");
    expect(drawn).toContain("is not an allowed model");
    await setup.dispose();
  });

  test("the allowlist keeps the order the resolver reads", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn.indexOf("muse")).toBeLessThan(drawn.indexOf("glm-flash"));
    await setup.dispose();
  });
});

describe("the page changes the draft and writes it only when asked", () => {
  test("a press on a profile name opens the effort picker", async () => {
    const { setup, asked } = await frame({ answer: "max" });
    // The press lands on the name the frame shows, wherever the frame put it.
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("worker"));
    expect(row).toBeGreaterThan(-1);
    await setup.mockMouse.click(lines[row]!.indexOf("worker"), row);
    await setup.flush();
    expect(asked.join(" ")).toContain("effort");
    await setup.dispose();
  });

  test("the write line is the only thing that writes", async () => {
    let saved = 0;
    const { setup } = await frame({ onSave: () => saved++ });
    const drawn = setup.captureCharFrame();
    const line = drawn.split("\n").findIndex((one) => one.includes("write it"));
    expect(line).toBeGreaterThan(-1);
    await setup.mockMouse.click(drawn.split("\n")[line]!.indexOf("write it"), line);
    await setup.flush();
    expect(saved).toBe(1);
    await setup.dispose();
  });
});
