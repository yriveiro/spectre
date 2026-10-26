import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PluginContextProvider } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { createComponent, testRender } from "@opentui/solid";
import {
  applied,
  compatibleModelsFor,
  effortModal,
  effortOptionsFor,
  effortPicker,
  isProviderAvailable,
  pinPicker,
  profileInfoModal,
  providerModal,
  usableDraft,
} from "../../tui/controls";
import { type Draft, type Model, type Resolution, resolve as resolveDraft } from "../../tui/data";
import { sidebarSection, subagentFooter, subagentLine } from "../../tui/index";
import { type EntryRow, layoutMetrics, type ProfileRow, page, type TabId } from "../../tui/page";

const GREY = RGBA.fromInts(200, 200, 200, 255);
const RAISED = RGBA.fromInts(40, 40, 48, 255);
const WARNING = RGBA.fromInts(255, 180, 0, 255);

const surfaceTokens = {
  text: {
    base: GREY,
    muted: GREY,
    faint: GREY,
    feedback: { warning: { base: WARNING, muted: GREY } },
  },
  background: {
    base: RAISED,
    raised: { base: RAISED, high: RAISED, max: RAISED },
    feedback: { warning: { base: RAISED }, error: { base: RAISED } },
  },
};

const theme = {
  ...surfaceTokens,
  surface: () => surfaceTokens,
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
  cost: "$0.1/$0.2",
  crosscheck: undefined,
  problem: undefined,
};

const [first, second] = draft.profiles;
if (first === undefined || second === undefined) throw new Error("the draft holds two profiles");

const rows = [
  { profile: first, resolution: spent },
  {
    profile: second,
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

const entries: ReadonlyArray<EntryRow> = [
  { alias: "muse", ref: "acme/muse-spark-1.3", model: models[0] },
  { alias: "glm-flash", ref: "acme/glm-5.3-flash", model: models[1] },
];

const host = (answer?: string) => {
  const asked: Array<string> = [];
  const shownRenders: Array<() => unknown> = [];
  const dialog = {
    select: async (options: { title: string; options: ReadonlyArray<{ title: string }> }) => {
      asked.push(options.title);
      return answer;
    },
    prompt: async (options: { title: string; value?: string }) => {
      asked.push(options.title);
      return answer ?? options.value;
    },
    alert: async () => {},
    show: (render: () => unknown) => {
      shownRenders.push(render);
      asked.push("custom-submodal");
    },
    clear: () => {},
    set: () => {},
    confirm: async () => undefined,
  };
  const context = { theme, ui: { dialog, toast: { show: () => {} } } };
  return { asked, shownRenders, context };
};

const frame = async (input: {
  readonly answer?: string;
  readonly tab?: TabId;
  readonly rows?: ReadonlyArray<ProfileRow>;
  readonly draft?: Draft;
  readonly models?: ReadonlyArray<EntryRow>;
  readonly catalogue?: ReadonlyArray<Model>;
  readonly jevAvailable?: boolean;
  readonly width?: number;
  readonly height?: number;
  readonly onTabChange?: (tab: TabId) => void;
  readonly onSave?: () => void;
  readonly onClose?: () => void;
  readonly onChange?: (next: Draft) => void;
  readonly onProviderChange?: (next: Draft) => void;
}) => {
  const { asked, shownRenders, context } = host(input.answer);
  const setup = await testRender(
    () =>
      createComponent(PluginContextProvider, {
        value: context as never,
        get children() {
          return page({
            rows: input.rows ?? rows,
            models: input.models ?? entries,
            catalogue: input.catalogue ?? models,
            draft: input.draft ?? draft,
            tab: input.tab,
            jevAvailable: input.jevAvailable,
            onTabChange: input.onTabChange,
            onChange: input.onChange ?? (() => {}),
            onProviderChange: input.onProviderChange,
            onSave: input.onSave ?? (() => {}),
            onClose: input.onClose ?? (() => {}),
            source: "/tmp/project/spectre.json",
          });
        },
      }),
    { width: input.width ?? 100, height: input.height ?? 32 },
  );
  await setup.renderOnce();
  return { setup, asked, shownRenders, context };
};

describe("the modal draws what the session would spend", () => {
  test("the modal frame carries the header with Esc, the provider select, the Jev toggle, the tabs, the Info column and the footer bar", async () => {
    const { setup } = await frame({ jevAvailable: false });
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("Routing");
    expect(drawn).toContain("Esc");
    expect(drawn).toContain("Provider:");
    expect(drawn).toContain("acme");
    expect(drawn).toContain("Judge:");
    expect(drawn).toContain("jev-1.13-free");
    expect(drawn).toContain("(○) Disabled (no OPENCODE_KEY)");
    expect(drawn).toContain("Configured (2)");
    expect(drawn).toContain("Profiles (2)");
    expect(drawn).toContain("Allowlist (2)");
    expect(drawn).toContain("Preview");
    expect(drawn).toContain("Profile");
    expect(drawn).toContain("Info");
    expect(drawn).toContain("Effort");
    expect(drawn).toContain("Model");
    expect(drawn).toContain("Cost");
    expect(drawn).not.toContain("the requirement each profile names");
    expect(drawn).toContain("Enter");
    expect(drawn).toContain("Write it");
    expect(drawn).toContain("Add model");
    expect(drawn).toContain("Remove model");
    expect(drawn).toContain("Profile info");
    expect(drawn).toContain("Close");
    await setup.dispose();
  });

  test("layoutMetrics calculates available space so model names are not trimmed in wide terminals", async () => {
    const narrow = layoutMetrics({
      terminalWidth: 88,
      terminalHeight: 32,
      rows,
      models: entries,
    });
    const wide = layoutMetrics({
      terminalWidth: 120,
      terminalHeight: 44,
      rows,
      models: entries,
    });
    expect(wide.modalWidth).toBe(116);
    expect(wide.profileColumns.info).toBe(4);
    expect(wide.profileColumns.model).toBeGreaterThan(narrow.profileColumns.model);
    expect(wide.entryColumns.model).toBeGreaterThan(narrow.entryColumns.model);
    expect(wide.bodyHeight).toBeGreaterThan(narrow.bodyHeight);

    const { setup } = await frame({ width: 116, height: 36 });
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("acme/muse-spark-1.3#high");
    expect(drawn).not.toContain("a decided change across several files");
    await setup.dispose();
  });

  test("the Jev toggle appears disabled without OPENCODE_KEY and toggles the judge when available", async () => {
    let changed: Draft | undefined;
    const { setup: disabledSetup } = await frame({
      jevAvailable: false,
      onChange: (next) => {
        changed = next;
      },
    });
    const disabledLines = disabledSetup.captureCharFrame().split("\n");
    const disabledRow = disabledLines.findIndex((one) => one.includes("Judge:"));
    expect(disabledRow).toBeGreaterThan(-1);
    await disabledSetup.mockMouse.click(10, disabledRow);
    await disabledSetup.flush();
    expect(changed).toBeUndefined();
    await disabledSetup.dispose();

    const { setup: availableSetup } = await frame({
      jevAvailable: true,
      onChange: (next) => {
        changed = next;
      },
    });
    const availableFrame = availableSetup.captureCharFrame();
    expect(availableFrame).toContain("( ) On  (●) Off");
    const availableRow = availableFrame.split("\n").findIndex((one) => one.includes("Judge:"));
    expect(availableRow).toBeGreaterThan(-1);
    await availableSetup.mockMouse.click(10, availableRow);
    await availableSetup.flush();
    expect(changed?.judge?.kind).toBe("jev");
    expect(changed?.judge?.model).toBe("jev-1.13-free");
    await availableSetup.dispose();

    const { setup: enabledSetup } = await frame({
      jevAvailable: true,
      draft: changed,
    });
    expect(enabledSetup.captureCharFrame()).toContain("(●) On  ( ) Off");
    await enabledSetup.dispose();
  });

  test("clicking Esc in the modal closes it", async () => {
    let closed = 0;
    const { setup } = await frame({ onClose: () => closed++ });
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("Routing") && one.includes("Esc"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no header row");
    await setup.mockMouse.click(line.lastIndexOf("Esc"), row);
    await setup.flush();
    expect(closed).toBe(1);
    await setup.dispose();
  });

  test("a profile shows its effort, info icon, the model it spends and the normalized cost", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("worker");
    expect(drawn).toContain("ⓘ");
    expect(drawn).toContain("high");
    expect(drawn).toContain("acme/muse-spark-1.3#high");
    expect(drawn).toContain("$0.1/$0.2");
    await setup.dispose();
  });

  test("a profile that resolves to nothing says so", async () => {
    const { setup } = await frame({});
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("pinned");
    expect(drawn).toContain("is not an allowed model");
    await setup.dispose();
  });

  test("the allowlist tab hides unusable or incompatible models, and the preview tab renders the spectre.json that will be written", async () => {
    let selectedTab: TabId | undefined;
    const { setup: tabClickSetup } = await frame({
      onTabChange: (next) => {
        selectedTab = next;
      },
    });
    const tabLines = tabClickSetup.captureCharFrame().split("\n");
    const tabRow = tabLines.findIndex((one) => one.includes("Allowlist (2)"));
    expect(tabRow).toBeGreaterThan(-1);
    const tabLine = tabLines[tabRow];
    if (tabLine === undefined) throw new Error("the frame has no tab bar");
    await tabClickSetup.mockMouse.click(tabLine.indexOf("Allowlist"), tabRow);
    await tabClickSetup.flush();
    expect(selectedTab).toBe("allowlist");
    await tabClickSetup.dispose();

    const mixedEntries: ReadonlyArray<EntryRow> = [
      ...entries,
      { alias: "ghost", ref: "opencode-go/ghost", model: undefined },
      {
        alias: "other",
        ref: "other/model-1",
        model: {
          providerID: "other",
          id: "model-1",
          name: "Other",
          family: "other",
          rungs: ["low"],
          costInput: 0.1,
          costOutput: 0.2,
          enabled: true,
          deprecated: false,
          tools: true,
        },
      },
    ];
    const { setup: allowSetup } = await frame({ tab: "allowlist", models: mixedEntries });
    const allowDrawn = allowSetup.captureCharFrame();
    expect(allowDrawn).toContain("Allowlist (2)");
    expect(allowDrawn.indexOf("muse")).toBeLessThan(allowDrawn.indexOf("glm-flash"));
    expect(allowDrawn).not.toContain("opencode-go/ghost");
    expect(allowDrawn).not.toContain("other/model-1");
    await allowSetup.dispose();

    const { setup: previewSetup } = await frame({ tab: "preview" });
    const previewDrawn = previewSetup.captureCharFrame();
    expect(previewDrawn).toContain('"provider": "acme"');
    expect(previewDrawn).toContain('"models": {');
    expect(previewDrawn).toContain('"muse": "acme/muse-spark-1.3"');
    expect(previewDrawn).toContain('"profiles": {');
    expect(previewDrawn).toContain('"worker": {');
    await previewSetup.dispose();
  });

  test("compatibleModelsFor and usableDraft keep only usable models matching the configured provider", () => {
    const mixedCatalog: ReadonlyArray<Model> = [
      ...models,
      {
        providerID: "other-provider",
        id: "foreign",
        name: "Foreign",
        family: "foreign",
        rungs: ["high"],
        costInput: 0.2,
        costOutput: 0.4,
        enabled: true,
        deprecated: false,
        tools: true,
      },
      {
        providerID: "acme",
        id: "disabled-model",
        name: "Disabled",
        family: "disabled",
        rungs: ["high"],
        costInput: 0.2,
        costOutput: 0.4,
        enabled: false,
        deprecated: false,
        tools: true,
      },
    ];
    expect(compatibleModelsFor(mixedCatalog, "acme").map((one) => one.id)).toEqual([
      "muse-spark-1.3",
      "glm-5.3-flash",
    ]);

    const dirtyDraft: Draft = {
      ...draft,
      models: [
        ...draft.models,
        { alias: "foreign", ref: "other-provider/foreign" },
        { alias: "missing", ref: "acme/missing-model" },
      ],
    };
    const cleaned = usableDraft(dirtyDraft, mixedCatalog);
    expect(cleaned.models).toEqual(draft.models);
  });
});

describe("the page changes the draft and writes it only when asked", () => {
  test("a press on a profile name opens the effort submodal", async () => {
    const { setup, shownRenders } = await frame({ answer: "max" });
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("worker"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no worker row");
    await setup.mockMouse.click(line.indexOf("worker"), row);
    await setup.flush();
    expect(shownRenders.length).toBe(1);
    await setup.dispose();
  });

  test("a press on the effort dropdown opens the effort submodal and a press on the model dropdown opens the pin picker", async () => {
    const { setup, asked, shownRenders } = await frame({ answer: "muse" });
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("worker"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no worker row");
    await setup.mockMouse.click(line.indexOf("high"), row);
    await setup.flush();
    expect(shownRenders.length).toBe(1);
    await setup.mockMouse.click(line.indexOf("acme/muse-spark-1.3#high"), row);
    await setup.flush();
    expect(asked.at(-1)).toContain('The model "worker" spends');
    await setup.dispose();
  });

  test("pressing + on the keyboard opens the model picker just like clicking + Add model", async () => {
    const { setup, asked } = await frame({});
    setup.mockInput.pressKey("+");
    await setup.flush();
    expect(asked).toContain("Add a model to the allowlist");
    await setup.dispose();
  });

  test("removing a model in the allowlist via ✕ or - removes it from the draft and clears its pin", async () => {
    const changes: Array<Draft> = [];
    const { setup } = await frame({
      tab: "allowlist",
      onChange: (next) => {
        changes.push(next);
      },
    });
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("muse") && one.includes("✕"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no muse row");
    await setup.mockMouse.click(line.indexOf("✕"), row);
    await setup.flush();
    expect(changes[0]?.models.map((one) => one.alias)).toEqual(["glm-flash"]);
    expect(changes[0]?.profiles.find((one) => one.name === "pinned")?.pinned).toBeUndefined();

    setup.mockInput.pressKey("-");
    await setup.flush();
    expect(changes[1]?.models.map((one) => one.alias)).toEqual(["glm-flash"]);
    await setup.dispose();
  });

  test("the Profiles tab lists default and custom profiles, toggles enabled state, and adds or removes custom profiles", async () => {
    const changes: Array<Draft> = [];
    const { setup, asked } = await frame({
      tab: "profiles",
      answer: "custom-one",
      onChange: (next) => {
        changes.push(next);
      },
    });
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("Configured (2)");
    expect(drawn).toContain("Profiles (2)");
    expect(drawn).toContain("Kind");
    expect(drawn).toContain("Status");
    expect(drawn).toContain("When to use");
    expect(drawn).toContain("worker");
    expect(drawn).toContain("default");
    expect(drawn).toContain("pinned");
    expect(drawn).toContain("custom");
    expect(drawn).toContain("[●] On");
    expect(drawn).toContain("Space Toggle");
    expect(drawn).toContain("Add profile");
    expect(drawn).toContain("Remove profile");

    setup.mockInput.pressKey(" ");
    await setup.flush();
    expect(changes[0]?.profiles.find((one) => one.name === "worker")?.enabled).toBe(false);

    setup.mockInput.pressKey("+");
    await setup.flush();
    expect(asked).toContain("The name for the custom profile");
    expect(asked).toContain('When to use "custom-one" (match)');
    expect(asked).toContain('Why "custom-one" exists (rationale)');
    expect(changes[1]?.profiles.map((one) => one.name)).toEqual(["worker", "pinned", "custom-one"]);

    const lines = drawn.split("\n");
    const customRow = lines.findIndex((one) => one.includes("pinned") && one.includes("✕"));
    expect(customRow).toBeGreaterThan(-1);
    const customLine = lines[customRow];
    if (customLine === undefined) throw new Error("the frame has no pinned row");
    await setup.mockMouse.click(customLine.indexOf("✕"), customRow);
    await setup.flush();
    expect(changes[2]?.profiles.map((one) => one.name)).toEqual(["worker"]);
    await setup.dispose();

    const toggledDraft = changes[0];
    if (toggledDraft === undefined) throw new Error("expected toggled draft");
    const { setup: configuredSetup } = await frame({
      tab: "configured",
      draft: toggledDraft,
      rows: [
        { profile: toggledDraft.profiles[0] ?? first, resolution: spent },
        { profile: toggledDraft.profiles[1] ?? second, resolution: rows[1]?.resolution },
      ],
    });
    const configuredDrawn = configuredSetup.captureCharFrame();
    expect(configuredDrawn).toContain("Configured (1)");
    expect(configuredDrawn).toContain("Profiles (2)");
    expect(configuredDrawn).not.toContain("acme/muse-spark-1.3#high");
    expect(configuredDrawn).toContain("pinned");
    await configuredSetup.dispose();
  });

  test("the provider selector uses the same table submodal style as the effort selector", async () => {
    const { context } = host();
    let selectedProvider: string | undefined;
    const providerSetup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return providerModal({
              draft: { ...draft, provider: "opencode-go" },
              models,
              onSelect: (chosen) => {
                selectedProvider = chosen;
              },
              onCancel: () => {},
            });
          },
        }),
      { width: 92, height: 20 },
    );
    await providerSetup.renderOnce();
    const drawn = providerSetup.captureCharFrame();
    expect(drawn).toContain("Select default provider");
    expect(drawn).toContain("opencode-go");
    expect(drawn).toContain("disabled");
    expect(drawn).toContain("acme");
    expect(drawn).toContain("available");
    expect(drawn).toContain("2 usable models");

    const lines = drawn.split("\n");
    const acmeRow = lines.findIndex((one) => one.includes("acme") && one.includes("available"));
    expect(acmeRow).toBeGreaterThan(-1);
    await providerSetup.mockMouse.click(10, acmeRow);
    await providerSetup.flush();
    expect(selectedProvider).toBe("acme");
    await providerSetup.dispose();
  });

  test("clicking the info icon or pressing i opens the profile explanation submodal", async () => {
    const { setup, shownRenders, context } = await frame({});
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("worker"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no worker row");

    await setup.mockMouse.click(line.indexOf("ⓘ"), row);
    await setup.flush();
    expect(shownRenders.length).toBe(1);

    setup.mockInput.pressKey("i");
    await setup.flush();
    expect(shownRenders.length).toBe(2);
    await setup.dispose();

    let closed = 0;
    const infoSetup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return profileInfoModal({
              profile: first,
              resolution: spent,
              draft,
              models,
              onClose: () => {
                closed += 1;
              },
            });
          },
        }),
      { width: 88, height: 26 },
    );
    await infoSetup.renderOnce();
    const infoFrame = infoSetup.captureCharFrame();
    expect(infoFrame).toContain('Profile "worker"');
    expect(infoFrame).toContain("When to use (match)");
    expect(infoFrame).toContain("a decided change across several files");
    expect(infoFrame).toContain("Why (rationale)");
    expect(infoFrame).toContain("cheap");
    expect(infoFrame).toContain("acme/muse-spark-1.3#high");
    expect(infoFrame).toContain("$0.1/$0.2");

    infoSetup.mockInput.pressKey("i");
    await infoSetup.flush();
    expect(closed).toBe(1);
    await infoSetup.dispose();
  });

  test("the effort selector shows full effort names, marks unsupported efforts as disabled, and refers to the selected model", async () => {
    const options = effortOptionsFor(draft, models, first);
    const byName = new Map(options.map((one) => [one.name, one]));

    expect(byName.get("none")?.available).toBe(false);
    expect(byName.get("none")?.reason).toContain("not supported by acme/muse-spark-1.3");
    expect(byName.get("minimal")?.available).toBe(true);
    expect(byName.get("minimal")?.targetRef).toBe("acme/muse-spark-1.3#minimal");
    expect(byName.get("low")?.available).toBe(true);
    expect(byName.get("medium")?.available).toBe(true);
    expect(byName.get("high")?.available).toBe(true);
    expect(byName.get("high")?.current).toBe(true);
    expect(byName.get("xhigh")?.available).toBe(true);
    expect(byName.get("max")?.available).toBe(false);
    expect(byName.get("max")?.reason).toContain("not supported by acme/muse-spark-1.3");

    const { context } = host();
    let selectedEffort: string | undefined;
    const effortSetup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return effortModal({
              profile: first,
              draft,
              models,
              onSelect: (chosen) => {
                selectedEffort = chosen;
              },
              onCancel: () => {},
            });
          },
        }),
      { width: 92, height: 24 },
    );
    await effortSetup.renderOnce();
    const drawn = effortSetup.captureCharFrame();

    expect(drawn).toContain('The effort for "worker"');
    expect(drawn).toContain("none");
    expect(drawn).toContain("minimal");
    expect(drawn).toContain("medium");
    expect(drawn).toContain("xhigh");
    expect(drawn).toContain("max");
    expect(drawn).toContain("available");
    expect(drawn).toContain("disabled");
    expect(drawn).toContain("acme/muse-spark-1.3#high");
    expect(drawn).toContain("not supported by acme/muse-spark-1.3");
    expect(drawn).not.toContain("allowed models reach this effort");

    const lines = drawn.split("\n");
    const maxRow = lines.findIndex((one) => one.includes("max") && one.includes("disabled"));
    expect(maxRow).toBeGreaterThan(-1);
    await effortSetup.mockMouse.click(10, maxRow);
    await effortSetup.flush();
    expect(selectedEffort).toBeUndefined();

    const lowRow = lines.findIndex((one) => one.includes("acme/muse-spark-1.3#low"));
    expect(lowRow).toBeGreaterThan(-1);
    await effortSetup.mockMouse.click(10, lowRow);
    await effortSetup.flush();
    expect(selectedEffort).toBe("low");
    await effortSetup.dispose();
  });

  test("adjusting effort shows efforts available to the selected model with unsupported efforts disabled, and choosing an effort does not reset the selected model", async () => {
    const pinnedDraft = applied(draft, { kind: "pin", profile: "worker", alias: "glm-flash" });
    const pinnedProfile = pinnedDraft.profiles.find((one) => one.name === "worker");
    if (pinnedProfile === undefined) throw new Error("worker profile missing");
    expect(pinnedProfile.pinned).toBe("glm-flash");

    const options = effortOptionsFor(pinnedDraft, models, pinnedProfile);
    const byName = new Map(options.map((one) => [one.name, one]));
    expect(byName.get("none")?.available).toBe(false);
    expect(byName.get("none")?.reason).toBe("not supported by acme/glm-5.3-flash");
    expect(byName.get("minimal")?.available).toBe(false);
    expect(byName.get("minimal")?.reason).toBe("not supported by acme/glm-5.3-flash");
    expect(byName.get("low")?.available).toBe(true);
    expect(byName.get("low")?.targetRef).toBe("acme/glm-5.3-flash#low");
    expect(byName.get("medium")?.available).toBe(false);
    expect(byName.get("medium")?.reason).toBe("not supported by acme/glm-5.3-flash");
    expect(byName.get("high")?.available).toBe(true);
    expect(byName.get("high")?.current).toBe(true);
    expect(byName.get("high")?.targetRef).toBe("acme/glm-5.3-flash#high");
    expect(byName.get("xhigh")?.available).toBe(false);
    expect(byName.get("xhigh")?.reason).toBe("not supported by acme/glm-5.3-flash");
    expect(byName.get("max")?.available).toBe(true);
    expect(byName.get("max")?.targetRef).toBe("acme/glm-5.3-flash#max");

    const afterEffort = applied(pinnedDraft, {
      kind: "effort",
      profile: "worker",
      effort: "low",
    });
    const updatedWorker = afterEffort.profiles.find((one) => one.name === "worker");
    expect(updatedWorker?.effort).toBe("low");
    expect(updatedWorker?.pinned).toBe("glm-flash");
    const resolvedWorker = resolveDraft(afterEffort, models).find(
      (one) => one.profile === "worker",
    );
    expect(resolvedWorker?.ref).toBe("acme/glm-5.3-flash#low");

    const unpinnedMaxDraft: Draft = {
      ...draft,
      profiles: [
        {
          name: "thinking",
          effort: "max",
          match: undefined,
          why: undefined,
          crosscheck: undefined,
          agent: "spectre",
          pinned: undefined,
        },
      ],
    };
    const thinkingProfile = unpinnedMaxDraft.profiles[0];
    if (thinkingProfile === undefined) throw new Error("thinking profile missing");
    const { shownRenders, context } = host();
    const pendingEdit = effortPicker({
      dialog: context.ui.dialog as never,
      draft: unpinnedMaxDraft,
      models,
      profile: thinkingProfile,
    });
    expect(shownRenders.length).toBe(1);
    const pickerSetup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return shownRenders[0]?.() as never;
          },
        }),
      { width: 92, height: 24 },
    );
    await pickerSetup.renderOnce();
    const pickerFrame = pickerSetup.captureCharFrame();
    expect(pickerFrame).toContain("glm-flash (acme/glm-5.3-flash)");
    expect(pickerFrame).toContain("not supported by acme/glm-5.3-flash");
    const pickerLines = pickerFrame.split("\n");
    const lowLine = pickerLines.findIndex((one) => one.includes("acme/glm-5.3-flash#low"));
    expect(lowLine).toBeGreaterThan(-1);
    await pickerSetup.mockMouse.click(10, lowLine);
    await pickerSetup.flush();
    const edit = await pendingEdit;
    expect(edit).toEqual({
      kind: "effort",
      profile: "thinking",
      effort: "low",
      pinned: "glm-flash",
    });
    if (edit === undefined) throw new Error("expected an effort edit");
    const afterPicker = applied(unpinnedMaxDraft, edit);
    expect(resolveDraft(afterPicker, models)[0]?.ref).toBe("acme/glm-5.3-flash#low");
    await pickerSetup.dispose();

    const updatedThinking = afterPicker.profiles[0];
    if (updatedThinking === undefined) throw new Error("thinking profile missing");
    const { context: pinCtx } = host("muse");
    const switchedPin = await pinPicker({
      dialog: pinCtx.ui.dialog as never,
      draft: afterPicker,
      models,
      profile: updatedThinking,
    });
    expect(switchedPin).toEqual({
      kind: "pin",
      profile: "thinking",
      alias: "muse",
      effort: "low",
    });
  });

  test("the write line writes the draft", async () => {
    let saved = 0;
    const { setup } = await frame({ onSave: () => saved++ });
    const drawn = setup.captureCharFrame();
    const line = drawn.split("\n").findIndex((one) => one.includes("Write it"));
    expect(line).toBeGreaterThan(-1);
    const target = drawn.split("\n")[line];
    if (target === undefined) throw new Error("the frame has no write line");
    await setup.mockMouse.click(target.indexOf("Write it"), line);
    await setup.flush();
    expect(saved).toBe(1);
    await setup.dispose();
  });
});

describe("the sidebar section shows the routing status and collapses like MCP", () => {
  const sidebarRows: ReadonlyArray<Resolution> = [
    spent,
    {
      profile: "pinned",
      ref: undefined,
      rung: undefined,
      cost: undefined,
      crosscheck: undefined,
      problem: 'profiles.pinned.model: "ghost" is not an allowed model in this session.',
    },
  ];

  test("the sidebar section lists each profile when open, toggles on header click, and renders the summary when collapsed", async () => {
    let openState = true;
    let modalOpened = 0;
    const openSetup = await testRender(
      () =>
        sidebarSection({
          theme: theme as never,
          open: () => openState,
          onToggle: () => {
            openState = !openState;
          },
          onOpenModal: () => {
            modalOpened += 1;
          },
          rows: () => sidebarRows,
        }),
      { width: 42, height: 10 },
    );
    await openSetup.renderOnce();

    const expanded = openSetup.captureCharFrame();
    expect(expanded).toContain("▼");
    expect(expanded).toContain("Routing");
    expect(expanded).toContain("worker");
    expect(expanded).toContain("muse-spark-1.3#high");
    expect(expanded).toContain("pinned");
    expect(expanded).toContain("Error");

    const workerLine = expanded.split("\n").findIndex((one) => one.includes("worker"));
    expect(workerLine).toBeGreaterThan(-1);
    await openSetup.mockMouse.click(4, workerLine);
    await openSetup.flush();
    expect(modalOpened).toBe(1);

    const headerLine = expanded.split("\n").findIndex((one) => one.includes("Routing"));
    expect(headerLine).toBeGreaterThan(-1);
    await openSetup.mockMouse.click(2, headerLine);
    await openSetup.flush();
    expect(openState).toBe(false);
    await openSetup.dispose();

    const closedSetup = await testRender(
      () =>
        sidebarSection({
          theme: theme as never,
          open: () => openState,
          onToggle: () => {
            openState = !openState;
          },
          onOpenModal: () => {},
          rows: () => sidebarRows,
        }),
      { width: 42, height: 10 },
    );
    await closedSetup.renderOnce();

    const collapsed = closedSetup.captureCharFrame();
    expect(collapsed).toContain("▶ Routing (1 active, 1 error)");
    expect(collapsed).not.toContain("muse-spark-1.3#high");
    await closedSetup.dispose();
  });

  test("the docked composer footer renders nothing in the main session and shows the profile and normalized cost on a subagent", async () => {
    const mainLine = subagentLine({
      session: { parentID: undefined, agent: "spectre" },
      profiles: draft.profiles,
      resolutions: sidebarRows,
    });
    expect(mainLine).toBeUndefined();

    const mainSetup = await testRender(
      () => subagentFooter({ theme: theme as never, line: () => mainLine }),
      { width: 60, height: 2 },
    );
    await mainSetup.renderOnce();
    expect(mainSetup.captureCharFrame().trim()).toBe("");
    await mainSetup.dispose();

    const childLine = subagentLine({
      session: {
        parentID: "ses_root",
        agent: "spectre",
        model: { providerID: "acme", id: "muse-spark-1.3", variant: "high" },
      },
      profiles: draft.profiles,
      resolutions: sidebarRows,
    });
    expect(childLine).toBe("worker uses acme/muse-spark-1.3#high, $0.1/$0.2");

    const childSetup = await testRender(
      () => subagentFooter({ theme: theme as never, line: () => childLine }),
      { width: 80, height: 2 },
    );
    await childSetup.renderOnce();
    expect(childSetup.captureCharFrame()).toContain(
      "Routing worker uses acme/muse-spark-1.3#high, $0.1/$0.2",
    );
    await childSetup.dispose();
  });
});

describe("the entrypoint opens the modal under the host's runtime plugin loader", () => {
  test("running the opener opens the provider submodal when unavailable and opens the modal with xlarge size when available", async () => {
    expect(isProviderAvailable("opencode-go", models)).toBe(false);
    expect(isProviderAvailable("acme", models)).toBe(true);

    const coreRuntime = await import("@opentui/core");
    const { createRuntimePlugin } = await import("@opentui/core/runtime-plugin");
    const solidJsRuntime = await import("solid-js");
    const solidJsStoreRuntime = await import("solid-js/store");
    const solidRuntime = await import("@opentui/solid");
    const { Plugin, usePlugin } = await import("@opencode/plugin/tui");
    const { createContext, useContext } = solidJsRuntime;

    const HostRenderer = createContext<unknown>();
    const created: Array<string> = [];
    const createdTexts: Array<string> = [];
    const hostSolid = {
      ...solidRuntime,
      createElement: (tag: string) => {
        if (!useContext(HostRenderer)) throw new Error("No renderer found");
        created.push(tag);
        return { tag };
      },
      createTextNode: (text: string) => {
        createdTexts.push(text);
        return { text };
      },
      insertNode: () => {},
      insert: (_parent: unknown, accessor: unknown) => {
        if (typeof accessor === "function") accessor();
      },
      setProp: () => {},
      effect: (fn: (prev: unknown) => unknown) => {
        fn(undefined);
      },
      memo: <T>(fn: () => T) => fn,
    };

    Bun.plugin(
      createRuntimePlugin({
        core: coreRuntime,
        additional: {
          "@opentui/solid": hostSolid,
          "solid-js": solidJsRuntime,
          "solid-js/store": solidJsStoreRuntime,
          "@opencode/plugin/tui": { Plugin, PluginContextProvider, usePlugin },
        },
      }),
    );

    const path = `${import.meta.dir}/../../tui`;
    for (const file of ["index.tsx", "page.tsx", "render.ts", "controls.tsx", "data.ts"]) {
      delete require.cache[Bun.resolveSync(`${path}/${file}`, import.meta.dir)];
    }

    const mod = (await import(Bun.pathToFileURL(`${path}/index.tsx`).href)) as {
      default: { setup: (ctx: unknown) => Promise<void> };
    };

    const tempDir = join(Bun.env.TMPDIR ?? "/tmp", `spectre-tui-provider-${crypto.randomUUID()}`);
    await Bun.write(
      `${tempDir}/spectre.json`,
      JSON.stringify({
        provider: "acme",
        models: { muse: "acme/muse-spark-1.3" },
        profiles: { worker: { effort: "high" } },
      }),
    );

    let shown: (() => unknown) | undefined;
    let dialogOptions: { size?: string; centered?: boolean } | undefined;
    let commandRun: (() => void) | undefined;
    const slotTargets: Array<string> = [];
    const { context } = host("acme");
    const fullContext = {
      ...context,
      location: { directory: tempDir },
      renderer: { keyInput: { on: () => {}, off: () => {} } },
      storage: {
        store: <T extends object>(_k: string, opts: { initial: T }) =>
          [opts.initial, async (fn: (d: T) => void) => fn(opts.initial)] as const,
        memory: <T extends object>(_k: string, opts: { initial: T }) =>
          [opts.initial, (fn: (d: T) => void) => fn(opts.initial)] as const,
      },
      data: {
        location: {
          model: {
            list: () => [
              {
                providerID: "acme",
                id: "muse-spark-1.3",
                name: "Muse Spark",
                family: "muse",
                variants: [{ id: "high" }],
                cost: [{ input: 0.1, output: 0.2, cache: { read: 0, write: 0 } }],
                enabled: true,
                status: "active",
                capabilities: { tools: true, input: [], output: [] },
              },
            ],
          },
        },
        session: { get: () => undefined },
      },
      keymap: {
        layer: (factory: () => { mode?: string; commands: ReadonlyArray<{ run: () => void }> }) => {
          const built = factory();
          if (built.mode === "global" && built.commands[0]) {
            commandRun = built.commands[0].run;
          }
        },
      },
      ui: {
        ...context.ui,
        dialog: {
          ...context.ui.dialog,
          show: (render: () => unknown) => {
            shown = render;
          },
          set: (options: { size?: string; centered?: boolean }) => {
            dialogOptions = options;
          },
        },
        router: {
          register: () => () => {},
          navigate: () => {},
          current: () => ({ type: "home" }),
        },
        slot: (claim: { append?: string }) => {
          if (claim.append) slotTargets.push(claim.append);
          return () => {};
        },
      },
    };

    await mod.default.setup(fullContext);
    expect(slotTargets).toEqual(["sidebar.content", "session.composer.top"]);
    if (commandRun === undefined) throw new Error("the entrypoint registered no opener command");
    commandRun();
    await Bun.sleep(20);

    if (shown === undefined) throw new Error("the opener did not call dialog.show");
    expect(dialogOptions).toEqual({ size: "xlarge", centered: true });
    const renderModal = shown;

    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: fullContext as never,
          get children() {
            return renderModal() as never;
          },
        });
      },
    });
    expect(created).toContain("scrollbox");
  });
});
