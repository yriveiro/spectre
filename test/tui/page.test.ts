import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { PluginContextProvider } from "@opencode/plugin/tui";
import { RGBA } from "@opentui/core";
import { createComponent, testRender } from "@opentui/solid";
import {
  applied,
  compatibleModelsFor,
  crosscheckEffortOptionsFor,
  crosscheckEffortPicker,
  crosscheckModelPicker,
  effortModal,
  effortOptionsFor,
  effortPicker,
  isProviderAvailable,
  pinPicker,
  profileInfoModal,
  providerModal,
  usableDraft,
} from "../../tui/controls";
import {
  type Draft,
  type Model,
  type Profile,
  type Resolution,
  resolve as resolveDraft,
} from "../../tui/data";
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
    status: "active",
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
    status: "active",
    tools: true,
  },
];

const draft: Draft = {
  directory: "/tmp/project",
  source: "/tmp/project/spectre.json",
  problems: [],
  provider: "acme",
  models: [
    { alias: "muse", ref: "acme/muse-spark-1.3", priority: 1 },
    { alias: "glm-flash", ref: "acme/glm-5.3-flash", priority: 2 },
  ],
  crosscheck: ["muse", "glm-flash"],
  profiles: [
    {
      name: "worker",
      effort: "high",
      maxCost: undefined,
      match: "a decided change across several files",
      why: "cheap",
      crosscheck: undefined,
      agent: "spectre",
      pinned: undefined,
    },
    {
      name: "pinned",
      effort: "max",
      maxCost: undefined,
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
  alias: "muse",
  ref: "acme/muse-spark-1.3#high",
  rung: "high",
  cost: "$0.1/$0.2",
  crosscheck: undefined,
  crosscheckCost: undefined,
  crosscheckProblem: undefined,
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
      alias: undefined,
      ref: undefined,
      rung: undefined,
      cost: undefined,
      crosscheck: undefined,
      crosscheckCost: undefined,
      crosscheckProblem: undefined,
      problem: 'profiles.pinned.model: "ghost" is not an allowed model in this session.',
    },
  },
];

const entries: ReadonlyArray<EntryRow> = [
  { alias: "muse", ref: "acme/muse-spark-1.3", priority: 1, model: models[0] },
  { alias: "glm-flash", ref: "acme/glm-5.3-flash", priority: 2, model: models[1] },
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
  readonly sessionModel?: string;
  readonly width?: number;
  readonly height?: number;
  readonly onTabChange?: (tab: TabId) => void;
  readonly onSave?: () => void;
  readonly onClose?: () => void;
  readonly onChange?: (next: Draft) => void;
  readonly onProviderChange?: (next: Draft) => void;
  /** `null` renders the page for a directory with no file. */
  readonly source?: string | null;
  readonly loading?: boolean;
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
            loading: input.loading,
            sessionModel: input.sessionModel,
            jevAvailable: input.jevAvailable ?? false,
            onTabChange: input.onTabChange,
            onChange: input.onChange ?? (() => {}),
            onProviderChange: input.onProviderChange,
            onSave: input.onSave ?? (() => {}),
            onClose: input.onClose ?? (() => {}),
            source:
              input.source === null ? undefined : (input.source ?? "/tmp/project/spectre.json"),
          });
        },
      }),
    { width: input.width ?? 100, height: input.height ?? 32 },
  );
  await setup.renderOnce();
  return { setup, asked, shownRenders, context };
};

describe("the modal draws what the session would spend", () => {
  test("the modal frame carries the header with Esc, the provider select, the profile selection bar, the tabs, the Info column and the footer bar", async () => {
    const { setup } = await frame({ jevAvailable: false });
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("Routing");
    expect(drawn).toContain("Esc");
    expect(drawn).toContain("Config: /tmp/project/spectre.json");
    expect(drawn).toContain("Provider:");
    expect(drawn).toContain("acme");
    expect(drawn).toContain("Profile selection:");
    expect(drawn).toContain("(●) Session LLM");
    expect(drawn).toContain("(○) JEV unavailable (jev-1.13-free)");
    expect(drawn).not.toContain("Warnings:");
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

  test("the frame renders Warnings below Profile selection when unconfigured or broken, and hides Warnings when clean", async () => {
    const broken = await frame({
      draft: {
        ...draft,
        problems: ["/tmp/project/spectre.json: Expected a value at models"],
      },
    });
    const brokenFrame = broken.setup.captureCharFrame();
    const brokenLines = brokenFrame.split("\n");
    const brokenSelectionLine = brokenLines.findIndex((one) => one.includes("Profile selection:"));
    const brokenWarningsLine = brokenLines.findIndex((one) => one.includes("Warnings:"));
    expect(brokenSelectionLine).toBeGreaterThan(-1);
    expect(brokenWarningsLine).toBeGreaterThan(brokenSelectionLine);
    expect(brokenFrame).toContain("• ⚠");
    expect(brokenFrame).toContain("Expected a value at models");
    await broken.setup.dispose();

    const missing = await frame({
      draft: { ...draft, source: undefined, problems: [] },
      source: null,
    });
    const missingFrame = missing.setup.captureCharFrame();
    const missingLines = missingFrame.split("\n");
    const configLine = missingLines.findIndex((one) => one.includes("Config: None"));
    const providerLine = missingLines.findIndex((one) => one.includes("Provider:"));
    const selectionLine = missingLines.findIndex((one) => one.includes("Profile selection:"));
    const warningsLine = missingLines.findIndex((one) => one.includes("Warnings:"));
    expect(configLine).toBeGreaterThan(-1);
    expect(providerLine).toBeGreaterThan(configLine);
    expect(selectionLine).toBeGreaterThan(providerLine);
    expect(warningsLine).toBeGreaterThan(selectionLine);
    expect(missingFrame).toContain("acme (session)");
    expect(missingFrame).toContain("• ⚠");
    expect(missingFrame).toContain(
      "No spectre.json found in /tmp/project — using defaults from current session model.",
    );
    await missing.setup.dispose();

    const reading = await frame({
      draft: { ...draft, source: undefined, problems: [] },
      source: null,
      loading: true,
    });
    const readingFrame = reading.setup.captureCharFrame();
    expect(readingFrame).toContain("Reading /tmp/project");
    expect(readingFrame).not.toContain("Warnings:");
    expect(readingFrame).not.toContain("No spectre.json found in /tmp/project");
    await reading.setup.dispose();
  });

  test("the configured tab carries a crosscheck model and effort control on every profile, and None opens the picker", async () => {
    const { setup, asked } = await frame({});
    const lines = setup.captureCharFrame().split("\n");
    const noneLine = lines.findIndex(
      (one) => one.includes("↳ crosscheck:") && one.includes("None") && one.includes("Off"),
    );
    expect(noneLine).toBeGreaterThan(-1);
    const line = lines[noneLine];
    if (line === undefined) throw new Error("the frame has no crosscheck line");
    await setup.mockMouse.click(line.indexOf("None"), noneLine);
    await setup.flush();
    expect(asked).toContain('The crosscheck model "worker" spends');
    await setup.dispose();
  });

  test("the crosscheck is nested under the profile", async () => {
    const configured: Draft = {
      ...draft,
      profiles: draft.profiles.map((one, at) =>
        at === 0
          ? { ...one, crosscheck: { effort: "high", pinned: undefined, maxCost: undefined } }
          : one,
      ),
    };
    const firstRow = rows[0];
    const firstProfile = configured.profiles[0];
    if (firstRow === undefined || firstProfile === undefined)
      throw new Error("the worker row is missing");
    const { setup } = await frame({
      draft: configured,
      rows: [
        {
          ...firstRow,
          profile: firstProfile,
          resolution: {
            ...spent,
            crosscheck: "acme/glm-5.3-flash#high",
            crosscheckCost: "$0.15/$0.5",
          },
        },
        rows[1] ?? firstRow,
      ],
    });
    const lines = setup.captureCharFrame().split("\n");
    const nameLine = lines.findIndex((one) => one.includes("worker"));
    const crossLine = lines.findIndex((one) => one.includes("↳ crosscheck:"));
    expect(nameLine).toBeGreaterThan(-1);
    expect(crossLine).toBeGreaterThan(nameLine);
    const name = lines[nameLine];
    const cross = lines[crossLine];
    if (name === undefined || cross === undefined) throw new Error("the frame has no crosscheck");
    expect(cross.indexOf("↳")).toBeGreaterThan(-1);
    expect(cross.indexOf("↳")).toBeLessThan(cross.indexOf("acme/glm-5.3-flash#high"));
    expect(cross.indexOf("acme/glm-5.3-flash#high")).toBe(name.indexOf("acme/muse-spark-1.3#high"));
    expect(cross).not.toContain("free");

    const header = lines.find((one) => one.includes("Info") && one.includes("Profile"));
    if (header === undefined) throw new Error("the frame has no header row");
    expect(header.indexOf("Info")).toBeLessThan(header.indexOf("Profile"));
    // The crosscheck effort select sits in the same column as the primary's.
    expect(cross.lastIndexOf("high")).toBe(header.indexOf("Effort") + 1);

    const primaryCost = "$0.1/$0.2";
    const crossCost = "$0.15/$0.5";
    const primaryEnd = name.indexOf(primaryCost) + primaryCost.length;
    const crossEnd = cross.indexOf(crossCost) + crossCost.length;
    expect(cross).toContain(crossCost);
    expect(crossEnd).toBe(primaryEnd);

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

  test("Profile selection shows the session model, disables JEV when unavailable, toggles JEV on and off when available, and displays Lexical", async () => {
    let changed: Draft | undefined;
    const { setup: disabledSetup } = await frame({
      jevAvailable: false,
      sessionModel: "github-copilot/gemini-4-carbon",
      onChange: (next) => {
        changed = next;
      },
    });
    const disabledFrame = disabledSetup.captureCharFrame();
    expect(disabledFrame).toContain("Profile selection:");
    expect(disabledFrame).toContain("(●) Session LLM (gemini-4-carbon)");
    expect(disabledFrame).toContain("(○) JEV unavailable (jev-1.13-free)");
    const disabledLines = disabledFrame.split("\n");
    const disabledRow = disabledLines.findIndex((one) => one.includes("Profile selection:"));
    expect(disabledRow).toBeGreaterThan(-1);
    await disabledSetup.mockMouse.click(10, disabledRow);
    await disabledSetup.flush();
    expect(changed).toBeUndefined();
    await disabledSetup.dispose();

    const { setup: availableSetup } = await frame({
      jevAvailable: true,
      sessionModel: "github-copilot/gemini-4-carbon",
      onChange: (next) => {
        changed = next;
      },
    });
    const availableFrame = availableSetup.captureCharFrame();
    expect(availableFrame).toContain("(●) Session LLM (gemini-4-carbon)   ( ) JEV (jev-1.13-free)");
    const availableRow = availableFrame
      .split("\n")
      .findIndex((one) => one.includes("Profile selection:"));
    expect(availableRow).toBeGreaterThan(-1);
    await availableSetup.mockMouse.click(10, availableRow);
    await availableSetup.flush();
    expect(changed?.judge?.kind).toBe("jev");
    expect(changed?.judge?.model).toBe("opencode/jev-1.13-free");
    await availableSetup.dispose();

    const { setup: enabledSetup } = await frame({
      jevAvailable: true,
      sessionModel: "github-copilot/gemini-4-carbon",
      draft: changed,
      onChange: (next) => {
        changed = next;
      },
    });
    const enabledFrame = enabledSetup.captureCharFrame();
    expect(enabledFrame).toContain("( ) Session LLM (gemini-4-carbon)   (●) JEV (jev-1.13-free)");
    const enabledRow = enabledFrame
      .split("\n")
      .findIndex((one) => one.includes("Profile selection:"));
    expect(enabledRow).toBeGreaterThan(-1);
    await enabledSetup.mockMouse.click(10, enabledRow);
    await enabledSetup.flush();
    expect(changed?.judge).toBeUndefined();
    await enabledSetup.dispose();

    const { setup: lexicalSetup } = await frame({
      width: 120,
      jevAvailable: false,
      sessionModel: "github-copilot/gemini-4-carbon",
      draft: { ...draft, judge: { kind: "lexical" } },
    });
    expect(lexicalSetup.captureCharFrame()).toContain(
      "( ) Session LLM (gemini-4-carbon)   (●) Lexical (BM25)   (○) JEV unavailable (jev-1.13-free)",
    );
    await lexicalSetup.dispose();
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
      { alias: "ghost", ref: "opencode-go/ghost", priority: 3, model: undefined },
      {
        alias: "other",
        ref: "other/model-1",
        priority: 4,
        model: {
          providerID: "other",
          id: "model-1",
          name: "Other",
          family: "other",
          rungs: ["low"],
          costInput: 0.1,
          costOutput: 0.2,
          enabled: true,
          status: "active",
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
    expect(previewDrawn).toContain('"priority": [');
    expect(previewDrawn).toContain('"crosscheck": [');
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
        status: "active",
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
        status: "active",
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
        { alias: "foreign", ref: "other-provider/foreign", priority: 3 },
        { alias: "missing", ref: "acme/missing-model", priority: 4 },
      ],
    };
    const cleaned = usableDraft(dirtyDraft, mixedCatalog);
    expect(cleaned.models).toEqual(draft.models);
    expect(cleaned.crosscheck).toEqual(draft.crosscheck);

    const dirtyCrosscheck: Draft = { ...draft, crosscheck: ["muse", "foreign"] };
    const crosscheckCleaned = usableDraft(dirtyCrosscheck, mixedCatalog);
    expect(crosscheckCleaned.crosscheck).toEqual(["muse"]);
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
    await setup.mockMouse.click(line.lastIndexOf("high"), row);
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

  test("the allowlist shows priority and moves a model with the arrows", async () => {
    const changes: Array<Draft> = [];
    const { setup } = await frame({
      tab: "allowlist",
      onChange: (next) => {
        changes.push(next);
      },
    });
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain("Priority");
    const lines = drawn.split("\n");
    const row = lines.findIndex((one) => one.includes("glm-flash") && one.includes("↑"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no glm-flash row");
    // The arrows are inside the Priority cell, beside the number.
    expect(/\b2\s+↑\s+↓/.test(line)).toBe(true);
    await setup.mockMouse.click(line.indexOf("↑"), row);
    await setup.flush();
    expect(changes[0]?.models.map((one) => [one.alias, one.priority])).toEqual([
      ["glm-flash", 1],
      ["muse", 2],
    ]);
    await setup.dispose();
  });

  test("the Crosscheck tab toggles a model with Space and the badge", async () => {
    const changes: Array<Draft> = [];
    const { setup } = await frame({
      tab: "crosscheck",
      onChange: (next) => {
        changes.push(next);
      },
    });
    expect(setup.captureCharFrame()).toContain("Crosscheck (2)");

    setup.mockInput.pressKey(" ");
    await setup.flush();
    expect(changes[0]?.crosscheck).toEqual(["glm-flash"]);
    await setup.dispose();

    const partial: Draft = { ...draft, crosscheck: ["muse"] };
    const enabled: Array<Draft> = [];
    const off = await frame({
      tab: "crosscheck",
      draft: partial,
      onChange: (next) => {
        enabled.push(next);
      },
    });
    const lines = off.setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("glm-flash") && one.includes("[ ] Off"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no disabled glm-flash row");
    await off.setup.mockMouse.click(line.indexOf("[ ] Off"), row);
    await off.setup.flush();
    expect(enabled[0]?.crosscheck).toEqual(["muse", "glm-flash"]);
    await off.setup.dispose();
  });

  test("the Crosscheck tab moves an enabled model up in fallback order", async () => {
    const changes: Array<Draft> = [];
    const { setup } = await frame({
      tab: "crosscheck",
      onChange: (next) => {
        changes.push(next);
      },
    });
    const lines = setup.captureCharFrame().split("\n");
    const row = lines.findIndex((one) => one.includes("glm-flash") && one.includes("↑"));
    expect(row).toBeGreaterThan(-1);
    const line = lines[row];
    if (line === undefined) throw new Error("the frame has no glm-flash row");
    expect(/\b2\s+↑\s+↓/.test(line)).toBe(true);
    await setup.mockMouse.click(line.indexOf("↑"), row);
    await setup.flush();
    expect(changes[0]?.crosscheck).toEqual(["glm-flash", "muse"]);
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
      { width: 88, height: 40 },
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

  test("the profile info modal shows the crosscheck model's cost beside its effort", async () => {
    const cross: Profile = {
      ...first,
      crosscheck: { effort: "high", pinned: undefined, maxCost: undefined },
    };
    const { context } = host();
    const infoSetup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return profileInfoModal({
              profile: cross,
              resolution: {
                ...spent,
                crosscheck: "acme/glm-5.3-flash#high",
                crosscheckCost: "$0.15/$0.5",
              },
              draft,
              models,
              onClose: () => {},
            });
          },
        }),
      { width: 88, height: 26 },
    );
    await infoSetup.renderOnce();
    expect(infoSetup.captureCharFrame()).toContain("high → acme/glm-5.3-flash#high · $0.15/$0.5");
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
          maxCost: undefined,
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

  test("the crosscheck model picker pins a model, and Off turns the second opinion off", async () => {
    const target = draft.profiles[0];
    if (target === undefined) throw new Error("the worker profile is missing");

    const { asked, context } = host("glm-flash");
    const pinned = await crosscheckModelPicker({
      dialog: context.ui.dialog as never,
      draft,
      models,
      profile: target,
    });
    expect(asked).toContain('The crosscheck model "worker" spends');
    expect(pinned).toEqual({
      kind: "crosscheck",
      profile: "worker",
      crosscheck: { effort: undefined, pinned: "glm-flash", maxCost: undefined },
    });

    if (pinned === undefined) throw new Error("the pin was not chosen");
    const configured = applied(draft, pinned);
    const worker = configured.profiles[0];
    if (worker === undefined) throw new Error("the configured worker profile is missing");

    const offHost = host("off");
    const off = await crosscheckModelPicker({
      dialog: offHost.context.ui.dialog as never,
      draft: configured,
      models,
      profile: worker,
    });
    expect(off).toEqual({ kind: "crosscheck", profile: "worker", crosscheck: undefined });

    const cleared = applied(configured, {
      kind: "crosscheck",
      profile: "worker",
      crosscheck: undefined,
    });
    expect(
      resolveDraft(cleared, models).find((one) => one.profile === "worker")?.crosscheck,
    ).toBeUndefined();
  });

  test("the crosscheck effort picker keeps the pin and sets the effort", async () => {
    const configured: Draft = {
      ...draft,
      profiles: draft.profiles.map((one, at) =>
        at === 0
          ? { ...one, crosscheck: { effort: undefined, pinned: "glm-flash", maxCost: undefined } }
          : one,
      ),
    };
    const worker = configured.profiles[0];
    if (worker === undefined) throw new Error("the configured worker profile is missing");

    const { shownRenders, context } = host();
    const pending = crosscheckEffortPicker({
      dialog: context.ui.dialog as never,
      draft: configured,
      models,
      profile: worker,
    });
    expect(shownRenders.length).toBe(1);
    const setup = await testRender(
      () =>
        createComponent(PluginContextProvider, {
          value: context as never,
          get children() {
            return shownRenders[0]?.() as never;
          },
        }),
      { width: 96, height: 28 },
    );
    await setup.renderOnce();
    const drawn = setup.captureCharFrame();
    expect(drawn).toContain('The crosscheck effort for "worker"');
    expect(drawn).toContain("glm-flash (acme/glm-5.3-flash)");
    expect(drawn).toContain("low, high, max");

    const highLine = drawn.split("\n").findIndex((one) => /\bhigh\s+available/.test(one));
    expect(highLine).toBeGreaterThan(-1);
    await setup.mockMouse.click(6, highLine);
    await setup.flush();
    expect(await pending).toEqual({
      kind: "crosscheck",
      profile: "worker",
      crosscheck: { effort: "high", pinned: "glm-flash", maxCost: undefined },
    });
    await setup.dispose();
  });

  test("the crosscheck effort options read the pin's rungs, and the list when there is no pin", () => {
    const pinned: Draft = {
      ...draft,
      profiles: draft.profiles.map((one, at) =>
        at === 0
          ? { ...one, crosscheck: { effort: "high", pinned: "glm-flash", maxCost: undefined } }
          : one,
      ),
    };
    const worker = pinned.profiles[0];
    if (worker === undefined) throw new Error("the worker profile is missing");
    const options = crosscheckEffortOptionsFor(pinned, models, worker);
    const byName = new Map(options.map((one) => [one.name, one]));

    expect(byName.get("Profile effort")?.value).toBeUndefined();
    expect(byName.get("Profile effort")?.available).toBe(true);
    expect(byName.get("Profile effort")?.targetRef).toBe("acme/glm-5.3-flash#high");
    expect(byName.get("high")?.available).toBe(true);
    expect(byName.get("high")?.current).toBe(true);
    expect(byName.get("high")?.targetRef).toBe("acme/glm-5.3-flash#high");
    expect(byName.get("medium")?.available).toBe(false);
    expect(byName.get("medium")?.reason).toContain("not supported by acme/glm-5.3-flash");

    const target = draft.profiles[0];
    if (target === undefined) throw new Error("the worker profile is missing");
    const auto = crosscheckEffortOptionsFor(draft, models, target);
    const autoByName = new Map(auto.map((one) => [one.name, one]));
    expect(autoByName.get("high")?.available).toBe(true);
    expect(autoByName.get("high")?.targetRef).toBe("acme/glm-5.3-flash#high");
  });

  test("the crosscheck effort options disable a Profile effort the pin cannot take", () => {
    const pinned: Draft = {
      ...draft,
      profiles: draft.profiles.map((one, at) =>
        at === 0
          ? {
              ...one,
              effort: "medium",
              crosscheck: { effort: undefined, pinned: "glm-flash", maxCost: undefined },
            }
          : one,
      ),
    };
    const worker = pinned.profiles[0];
    if (worker === undefined) throw new Error("the worker profile is missing");
    const profileRow = crosscheckEffortOptionsFor(pinned, models, worker).find(
      (one) => one.name === "Profile effort",
    );
    expect(profileRow?.available).toBe(false);
    expect(profileRow?.reason).toContain("not supported by acme/glm-5.3-flash");
  });

  test("a pinned crosscheck with no profile effort still offers the pin", () => {
    const pinned: Draft = {
      ...draft,
      profiles: draft.profiles.map((one, at) =>
        at === 0
          ? {
              ...one,
              effort: undefined,
              pinned: "muse",
              crosscheck: { effort: undefined, pinned: "glm-flash", maxCost: undefined },
            }
          : one,
      ),
    };
    const worker = pinned.profiles[0];
    if (worker === undefined) throw new Error("the worker profile is missing");
    const profileRow = crosscheckEffortOptionsFor(pinned, models, worker).find(
      (one) => one.name === "Profile effort",
    );
    expect(profileRow?.available).toBe(true);
    expect(profileRow?.targetRef).toBe("acme/glm-5.3-flash");
  });

  test("the configured tab shows a crosscheck no other family can serve", async () => {
    const row = rows[0];
    if (row === undefined) throw new Error("the worker row is missing");
    const { setup } = await frame({
      rows: [
        {
          ...row,
          resolution: {
            ...spent,
            crosscheck: undefined,
            crosscheckProblem:
              'the crosscheck at "max" found no model in the crosscheck list from another family.',
          },
        },
      ],
    });
    expect(setup.captureCharFrame()).toContain(
      "found no model in the crosscheck list from another family",
    );
    await setup.dispose();
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
      alias: undefined,
      ref: undefined,
      rung: undefined,
      cost: undefined,
      crosscheck: undefined,
      crosscheckCost: undefined,
      crosscheckProblem: undefined,
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
    expect(expanded).toContain("Session");
    expect(expanded).toContain("worker");
    expect(expanded).toContain("muse");
    expect(expanded).toContain("●●●○");
    expect(expanded).not.toContain("muse-spark-1.3#high");
    expect(expanded).toContain("pinned");
    expect(expanded).toContain("Error");
    expect(expanded).not.toContain("No spectre.json — using defaults");

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
    expect(collapsed).toContain("▶ Routing (1 active, 1 error · Session)");
    expect(collapsed).not.toContain("muse");
    expect(collapsed).not.toContain("●●●○");
    await closedSetup.dispose();
  });

  test("the sidebar in default mode shows method badge, warning-colored dots, a blank spacer row before the bottom warning, and collapsed defaults summary", async () => {
    const SUCCESS = RGBA.fromInts(80, 220, 120, 255);
    const ERROR = RGBA.fromInts(240, 80, 80, 255);
    const richTokens = {
      ...surfaceTokens,
      text: {
        ...surfaceTokens.text,
        feedback: {
          warning: { base: WARNING, muted: GREY },
          success: { base: SUCCESS },
          error: { base: ERROR },
        },
      },
    };
    const richTheme = { ...richTokens, surface: () => richTokens };

    const defaultRows: ReadonlyArray<Resolution> = [
      spent,
      {
        profile: "refactor",
        alias: "muse",
        ref: "acme/muse-spark-1.3#high",
        rung: "high",
        cost: "$0.1/$0.2",
        crosscheck: undefined,
        crosscheckCost: undefined,
        crosscheckProblem: undefined,
        problem: undefined,
      },
    ];

    let modalOpened = 0;
    const defaultSetup = await testRender(
      () =>
        sidebarSection({
          theme: richTheme as never,
          open: () => true,
          onToggle: () => {},
          onOpenModal: () => {
            modalOpened += 1;
          },
          rows: () => defaultRows,
          usingDefaults: () => true,
          method: () => "JEV",
        }),
      { width: 37, height: 10 },
    );
    await defaultSetup.renderOnce();

    const frameText = defaultSetup.captureCharFrame();
    const lines = frameText.split("\n");
    expect(lines[0]).toContain("▼ Routing");
    expect(lines[0]).toContain("JEV");

    const refactorIdx = lines.findIndex((one) => one.includes("refactor"));
    expect(refactorIdx).toBeGreaterThan(0);
    expect(lines[refactorIdx + 1]?.trim()).toBe("");
    expect(lines[refactorIdx + 2]).toContain("⚠ No spectre.json — using defaults");

    const nonEmptyIndices = lines.flatMap((line, idx) => (line.trim().length > 0 ? [idx] : []));
    expect(nonEmptyIndices.at(-1)).toBe(refactorIdx + 2);

    const captured = defaultSetup.captureSpans();
    const dotSpans = captured.lines
      .flatMap((line) => line.spans)
      .filter((span) => span.text.includes("•"));
    expect(dotSpans.length).toBe(2);
    for (const span of dotSpans) {
      expect(span.fg).toEqual(WARNING);
    }
    const warnSpan = captured.lines
      .flatMap((line) => line.spans)
      .find((span) => span.text.includes("⚠"));
    expect(warnSpan?.fg).toEqual(WARNING);

    await defaultSetup.mockMouse.click(4, refactorIdx + 2);
    await defaultSetup.flush();
    expect(modalOpened).toBe(1);
    await defaultSetup.dispose();

    const configuredSetup = await testRender(
      () =>
        sidebarSection({
          theme: richTheme as never,
          open: () => true,
          onToggle: () => {},
          onOpenModal: () => {},
          rows: () => defaultRows,
          usingDefaults: () => false,
          method: () => "Session",
        }),
      { width: 37, height: 10 },
    );
    await configuredSetup.renderOnce();
    const configuredDots = configuredSetup
      .captureSpans()
      .lines.flatMap((line) => line.spans)
      .filter((span) => span.text.includes("•"));
    expect(configuredDots.length).toBe(2);
    for (const span of configuredDots) {
      expect(span.fg).toEqual(SUCCESS);
    }
    await configuredSetup.dispose();

    const collapsedSetup = await testRender(
      () =>
        sidebarSection({
          theme: richTheme as never,
          open: () => false,
          onToggle: () => {},
          onOpenModal: () => {},
          rows: () => defaultRows,
          usingDefaults: () => true,
          method: () => "Session",
        }),
      { width: 37, height: 4 },
    );
    await collapsedSetup.renderOnce();
    expect(collapsedSetup.captureCharFrame()).toContain("▶ Routing (⚠ defaults · Session)");
    await collapsedSetup.dispose();
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
    expect(childLine).toBe("worker muse ●●●○, $0.1/$0.2");

    const failedRow = sidebarRows[1];
    const failedProfile = draft.profiles[1];
    if (failedRow === undefined || failedProfile === undefined)
      throw new Error("the pinned row is missing");
    const failedLine = subagentLine({
      session: {
        parentID: "ses_root",
        agent: "spectre",
        model: { providerID: "acme", id: "muse-spark-1.3", variant: "high" },
      },
      profiles: [failedProfile],
      resolutions: [failedRow],
    });
    expect(failedLine).toBe("Error");

    const childSetup = await testRender(
      () => subagentFooter({ theme: theme as never, line: () => childLine }),
      { width: 80, height: 2 },
    );
    await childSetup.renderOnce();
    expect(childSetup.captureCharFrame()).toContain("Routing worker muse ●●●○, $0.1/$0.2");
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
          default: () => ({ directory: tempDir }),
          model: {
            list: () => [
              {
                providerID: "acme",
                id: "muse-spark-1.3",
                modelID: "muse-spark-1.3",
                name: "Muse Spark",
                family: "muse",
                variants: [{ id: "high" }],
                cost: [{ input: 0.1, output: 0.2, cache: { read: 0, write: 0 } }],
                enabled: true,
                status: "active",
                capabilities: { tools: true, input: [], output: [] },
                time: { released: 0 },
                limit: { context: 200_000, output: 32_000 },
              },
            ],
          },
        },
        session: { get: () => undefined },
      },
      client: {
        model: {
          list: async () => ({
            location: { directory: tempDir },
            data: [{ providerID: "opencode", id: "jev-1.13-free" }],
          }),
        },
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

    const unconfiguredDir = join(
      Bun.env.TMPDIR ?? "/tmp",
      `spectre-tui-defaults-${crypto.randomUUID()}`,
    );
    await Bun.write(`${unconfiguredDir}/.keep`, "");

    let defaultsShown: (() => unknown) | undefined;
    let defaultsDialogOptions: { size?: string; centered?: boolean } | undefined;
    let defaultsCommandRun: (() => void) | undefined;
    createdTexts.length = 0;

    const defaultsContext = {
      ...fullContext,
      location: { directory: unconfiguredDir },
      data: {
        ...fullContext.data,
        location: {
          ...fullContext.data.location,
          default: () => ({ directory: unconfiguredDir }),
        },
        session: {
          get: (id: string) =>
            id === "ses_defaults"
              ? {
                  id: "ses_defaults",
                  location: { directory: unconfiguredDir },
                  model: { providerID: "acme", id: "muse-spark-1.3" },
                }
              : undefined,
        },
      },
      keymap: {
        layer: (factory: () => { mode?: string; commands: ReadonlyArray<{ run: () => void }> }) => {
          const built = factory();
          if (built.mode === "global" && built.commands[0]) {
            defaultsCommandRun = built.commands[0].run;
          }
        },
      },
      ui: {
        ...fullContext.ui,
        dialog: {
          ...fullContext.ui.dialog,
          show: (render: () => unknown) => {
            defaultsShown = render;
          },
          set: (options: { size?: string; centered?: boolean }) => {
            defaultsDialogOptions = options;
          },
        },
        router: {
          register: () => () => {},
          navigate: () => {},
          current: () => ({ type: "session" as const, sessionID: "ses_defaults" }),
        },
      },
    };

    await mod.default.setup(defaultsContext);
    if (defaultsCommandRun === undefined)
      throw new Error("the entrypoint registered no opener command for unconfigured session");
    defaultsCommandRun();
    await Bun.sleep(20);

    if (defaultsShown === undefined) throw new Error("the opener did not call dialog.show");
    expect(defaultsDialogOptions).toEqual({ size: "xlarge", centered: true });
    const renderDefaultsModal = defaultsShown;

    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: defaultsContext as never,
          get children() {
            return renderDefaultsModal() as never;
          },
        });
      },
    });
    expect(createdTexts).not.toContain("Select default provider");
    expect(createdTexts).toContain("acme (session)");
    expect(createdTexts).toContain("None");
    expect(createdTexts).toContain("Warnings:");
    expect(
      createdTexts.some((text) => text.includes(`No spectre.json found in ${unconfiguredDir}`)),
    ).toBe(true);

    const emptyModelsDir = join(
      Bun.env.TMPDIR ?? "/tmp",
      `spectre-tui-empty-models-${crypto.randomUUID()}`,
    );
    await Bun.write(
      `${emptyModelsDir}/spectre.json`,
      JSON.stringify({
        provider: "acme",
        models: {},
        priority: [],
        crosscheck: [],
        profiles: {
          worker: { effort: "high", crosscheck: { effort: "high" } },
        },
      }),
    );

    let sidebarRender: ((input: { sessionID: string }) => unknown) | undefined;
    let emptyModalShown: (() => unknown) | undefined;
    let emptyCommandRun: (() => void) | undefined;
    let modelReady = false;
    let syncCalls = 0;

    const emptyContext = {
      ...fullContext,
      location: { directory: emptyModelsDir },
      data: {
        ...fullContext.data,
        location: {
          ...fullContext.data.location,
          default: () => ({ directory: emptyModelsDir }),
          model: {
            list: () =>
              modelReady
                ? [
                    {
                      providerID: "acme",
                      id: "muse-spark-1.3",
                      modelID: "muse-spark-1.3",
                      name: "Muse Spark",
                      family: "muse",
                      variants: [{ id: "high" }],
                      cost: [{ input: 0.1, output: 0.2, cache: { read: 0, write: 0 } }],
                      enabled: true,
                      status: "active",
                      capabilities: { tools: true, input: [], output: [] },
                      time: { released: 0 },
                      limit: { context: 200_000, output: 32_000 },
                    },
                    {
                      providerID: "acme",
                      id: "child-only",
                      modelID: "child-only",
                      name: "Child Only",
                      family: "child",
                      variants: [{ id: "high" }],
                      cost: [{ input: 0.2, output: 0.4, cache: { read: 0, write: 0 } }],
                      enabled: true,
                      status: "active",
                      capabilities: { tools: true, input: [], output: [] },
                      time: { released: 0 },
                      limit: { context: 200_000, output: 32_000 },
                    },
                  ]
                : undefined,
            sync: async () => {
              syncCalls += 1;
            },
          },
        },
        session: {
          get: (id: string) => {
            if (id === "ses_main") {
              return {
                id: "ses_main",
                location: { directory: emptyModelsDir },
                model: { providerID: "acme", id: "muse-spark-1.3" },
              };
            }
            if (id === "ses_child") {
              return {
                id: "ses_child",
                parentID: "ses_main",
                location: { directory: emptyModelsDir },
                model: { providerID: "acme", id: "child-only" },
              };
            }
            return undefined;
          },
        },
      },
      keymap: {
        layer: (factory: () => { mode?: string; commands: ReadonlyArray<{ run: () => void }> }) => {
          const built = factory();
          if (built.mode === "global" && built.commands[0]) {
            emptyCommandRun = built.commands[0].run;
          }
        },
      },
      ui: {
        ...fullContext.ui,
        dialog: {
          ...fullContext.ui.dialog,
          show: (render: () => unknown) => {
            emptyModalShown = render;
          },
        },
        router: {
          register: () => () => {},
          navigate: () => {},
          current: () => ({ type: "session" as const, sessionID: "ses_child" }),
        },
        slot: (claim: { append?: string; render: (input: { sessionID: string }) => unknown }) => {
          if (claim.append === "sidebar.content") sidebarRender = claim.render;
          return () => {};
        },
      },
    };

    await mod.default.setup(emptyContext);
    if (sidebarRender === undefined || emptyCommandRun === undefined) {
      throw new Error("the entrypoint did not register the sidebar slot and opener");
    }
    const renderSidebar = sidebarRender;

    createdTexts.length = 0;
    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: emptyContext as never,
          get children() {
            return renderSidebar({ sessionID: "ses_child" }) as never;
          },
        });
      },
    });
    await Bun.sleep(20);
    createdTexts.length = 0;
    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: emptyContext as never,
          get children() {
            return renderSidebar({ sessionID: "ses_child" }) as never;
          },
        });
      },
    });
    expect(syncCalls).toBeGreaterThan(0);
    expect(createdTexts).not.toContain("Error");

    modelReady = true;
    createdTexts.length = 0;
    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: emptyContext as never,
          get children() {
            return renderSidebar({ sessionID: "ses_child" }) as never;
          },
        });
      },
    });
    expect(createdTexts).not.toContain("Error");
    expect(createdTexts).toContain("muse");
    expect(createdTexts).toContain("No models — using defaults");

    createdTexts.length = 0;
    emptyCommandRun();
    await Bun.sleep(20);
    if (emptyModalShown === undefined) throw new Error("the opener did not show the modal");
    const renderEmptyModal = emptyModalShown;
    createComponent(HostRenderer.Provider, {
      value: true,
      get children() {
        return createComponent(PluginContextProvider, {
          value: emptyContext as never,
          get children() {
            return renderEmptyModal() as never;
          },
        });
      },
    });
    expect(createdTexts).not.toContain("Select default provider");
    expect(createdTexts).toContain("acme (session)");
    expect(
      createdTexts.some((text) =>
        text.includes(`No models configured in ${emptyModelsDir}/spectre.json`),
      ),
    ).toBe(true);
  });
});
