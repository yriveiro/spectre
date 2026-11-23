import { describe, expect, test } from "bun:test";
import type { ResolvedTheme } from "@opencode/theme/tui";
import { RGBA } from "@opentui/core";
import { testRender } from "@opentui/solid";
import { palette } from "../../tui/render";
import { type preview as previewFn, tokenizeJsonLine } from "../../tui/routing/controls";
import type { Draft, Model } from "../../tui/routing/data";

const loadPreview = async (): Promise<typeof previewFn> => {
  const clearAll: unknown = Reflect.get(Bun.plugin, "clearAll");
  if (typeof clearAll === "function") clearAll();
  const tuiDir = `${import.meta.dir}/../../tui`;
  for (const file of [
    "index.tsx",
    "render.ts",
    "routing/page.tsx",
    "routing/controls.tsx",
    "routing/data.ts",
  ]) {
    delete require.cache[Bun.resolveSync(`${tuiDir}/${file}`, import.meta.dir)];
  }
  const mod = await import("../../tui/routing/controls.tsx");
  return mod.preview;
};

const TEXT = RGBA.fromInts(220, 224, 232, 255);
const MUTED = RGBA.fromInts(150, 156, 168, 255);
const FAINT = RGBA.fromInts(100, 108, 120, 255);
const RAISED = RGBA.fromInts(40, 44, 52, 255);
const VARIABLE = RGBA.fromInts(143, 188, 187, 255);
const STRING = RGBA.fromInts(163, 190, 140, 255);
const NUMBER = RGBA.fromInts(208, 135, 112, 255);
const KEYWORD = RGBA.fromInts(129, 161, 193, 255);
const PUNCTUATION = RGBA.fromInts(110, 118, 136, 255);

const syntaxTheme = {
  text: {
    base: TEXT,
    muted: MUTED,
    faint: FAINT,
    feedback: {
      warning: { base: NUMBER, muted: MUTED },
      success: { base: STRING, muted: MUTED },
      error: { base: NUMBER, muted: MUTED },
      info: { base: KEYWORD, muted: MUTED },
    },
  },
  background: {
    base: RAISED,
    raised: { base: RAISED, high: RAISED, max: RAISED },
    feedback: {
      warning: { base: RAISED },
      error: { base: RAISED },
      success: { base: RAISED },
      info: { base: RAISED },
    },
  },
  syntax: {
    comment: MUTED,
    keyword: KEYWORD,
    function: KEYWORD,
    variable: VARIABLE,
    string: STRING,
    number: NUMBER,
    type: VARIABLE,
    operator: PUNCTUATION,
    punctuation: PUNCTUATION,
  },
  surface: () => syntaxTheme,
} as unknown as ResolvedTheme;

const models: ReadonlyArray<Model> = [
  {
    providerID: "acme",
    id: "muse-spark-1.3",
    name: "Muse Spark",
    family: "muse",
    rungs: ["low", "medium", "high"],
    costInput: 0.1,
    costOutput: 0.2,
    enabled: true,
    status: "active",
    tools: true,
  },
  {
    providerID: "acme",
    id: "minimax-m2.7",
    name: "MiniMax",
    family: "minimax",
    rungs: ["low", "high"],
    costInput: 0.15,
    costOutput: 0.4,
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
    { alias: "muse", ref: "acme/muse-spark-1.3#high", priority: 1 },
    { alias: "minimax", ref: "acme/minimax-m2.7", priority: 2 },
  ],
  crosscheck: ["minimax", "muse"],
  profiles: [
    {
      name: "worker",
      effort: "high",
      match: "decided multi-file edits",
      why: "fast",
      crosscheck: undefined,
      agent: "spectre",
      pinned: undefined,
    },
  ],
  judge: {
    kind: "jev",
    model: "pele/jev-1.13-free",
    timeout: 2000,
    threshold: 0.7,
  },
};

describe("tokenizeJsonLine", () => {
  test("classifies keys, strings with colons/escapes/#//, numbers, booleans, null, arrays and punctuation while preserving exact line text", () => {
    const document = [
      "{",
      '  "provider": "acme",',
      '  "endpoint": "https://example.com:8443/v1",',
      '  "model": "acme/muse-spark-1.3#high",',
      '  "escaped": "say \\"hi: there\\" \\\\",',
      '  "timeout": 2000,',
      '  "threshold": 0.7,',
      '  "offset": -1.5e-2,',
      '  "enabled": true,',
      '  "legacy": false,',
      '  "fallback": null,',
      '  "priority": ["minimax", "muse"]',
      "}",
    ];

    for (const line of document) {
      const tokens = tokenizeJsonLine(line);
      expect(tokens.map((one) => one.text).join("")).toBe(line);
    }

    expect(tokenizeJsonLine('  "endpoint": "https://example.com:8443/v1",')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"endpoint"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "string", text: '"https://example.com:8443/v1"' },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  "model": "acme/muse-spark-1.3#high",')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"model"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "string", text: '"acme/muse-spark-1.3#high"' },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  "escaped": "say \\"hi: there\\" \\\\",')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"escaped"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "string", text: '"say \\"hi: there\\" \\\\"' },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  "timeout": 2000,')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"timeout"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "number", text: "2000" },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  "threshold": 0.7,')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"threshold"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "number", text: "0.7" },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  "flags": [true, false, null],')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "key", text: '"flags"' },
      { kind: "punctuation", text: ":" },
      { kind: "whitespace", text: " " },
      { kind: "punctuation", text: "[" },
      { kind: "keyword", text: "true" },
      { kind: "punctuation", text: "," },
      { kind: "whitespace", text: " " },
      { kind: "keyword", text: "false" },
      { kind: "punctuation", text: "," },
      { kind: "whitespace", text: " " },
      { kind: "keyword", text: "null" },
      { kind: "punctuation", text: "]" },
      { kind: "punctuation", text: "," },
    ]);

    expect(tokenizeJsonLine('  ["minimax", "muse"]')).toEqual([
      { kind: "whitespace", text: "  " },
      { kind: "punctuation", text: "[" },
      { kind: "string", text: '"minimax"' },
      { kind: "punctuation", text: "," },
      { kind: "whitespace", text: " " },
      { kind: "string", text: '"muse"' },
      { kind: "punctuation", text: "]" },
    ]);
  });

  test("falls back to punctuation on malformed characters without throwing or losing bytes", () => {
    const malformed = '  "unclosed: xtrue @';
    const tokens = tokenizeJsonLine(malformed);
    expect(tokens.map((one) => one.text).join("")).toBe(malformed);
    expect(tokens.some((one) => one.kind === "keyword")).toBe(false);
    const nonWhitespace = tokens.filter((one) => one.kind !== "whitespace");
    expect(nonWhitespace.every((one) => one.kind === "punctuation")).toBe(true);
  });
});

describe("preview", () => {
  test("renders synchronous line numbers and distinct theme syntax colors on frame 1", async () => {
    const preview = await loadPreview();
    const setup = await testRender(() => preview({ theme: syntaxTheme, draft, models }), {
      width: 100,
      height: 40,
    });
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain(" 1 │ {");
    expect(frame).toContain(' 2 │   "provider": "acme",');
    expect(frame).toContain('"models": {');
    expect(frame).toContain('"muse": "acme/muse-spark-1.3#high"');
    expect(frame).toContain('"priority": [');
    expect(frame).toContain('"crosscheck": [');
    expect(frame).toContain('"timeout": 2000');
    expect(frame).toContain('"threshold": 0.7');

    const spans = setup.captureSpans().lines.flatMap((line) => line.spans);
    const spanColor = (needle: string) =>
      spans.find((span) => span.text === needle || span.text.trim() === needle)?.fg.toInts();

    expect(spanColor("1 │")).toEqual(FAINT.toInts());
    expect(spanColor("{")).toEqual(PUNCTUATION.toInts());
    expect(spanColor(":")).toEqual(PUNCTUATION.toInts());
    expect(spanColor('"provider"')).toEqual(VARIABLE.toInts());
    expect(spanColor('"timeout"')).toEqual(VARIABLE.toInts());
    expect(spanColor('"acme"')).toEqual(STRING.toInts());
    expect(spanColor('"acme/muse-spark-1.3#high"')).toEqual(STRING.toInts());
    expect(spanColor("2000")).toEqual(NUMBER.toInts());
    expect(spanColor("0.7")).toEqual(NUMBER.toInts());

    await setup.dispose();
  });

  test("widens the line-number gutter when the formatted JSON reaches 100 lines", async () => {
    const manyProfiles: Draft = {
      ...draft,
      profiles: Array.from({ length: 25 }, (_, index) => ({
        name: `profile-${index + 1}`,
        effort: "low",
        match: "a task",
        why: "a reason",
        crosscheck: undefined,
        agent: "spectre",
        pinned: undefined,
      })),
    };

    const preview = await loadPreview();
    const setup = await testRender(
      () => preview({ theme: syntaxTheme, draft: manyProfiles, models }),
      {
        width: 100,
        height: 150,
      },
    );
    await setup.renderOnce();

    const frame = setup.captureCharFrame();
    expect(frame).toContain("  1 │ {");
    expect(frame).toContain("100 │");

    await setup.dispose();
  });

  test("resolves syntax tokens when present and falls back to feedback and muted tokens when syntax is absent", () => {
    const withSyntax = palette(syntaxTheme);
    expect(withSyntax.jsonKey.toInts()).toEqual(VARIABLE.toInts());
    expect(withSyntax.jsonString.toInts()).toEqual(STRING.toInts());
    expect(withSyntax.jsonNumber.toInts()).toEqual(NUMBER.toInts());
    expect(withSyntax.jsonKeyword.toInts()).toEqual(KEYWORD.toInts());
    expect(withSyntax.jsonPunctuation.toInts()).toEqual(PUNCTUATION.toInts());

    const withoutSyntaxTheme = {
      text: syntaxTheme.text,
      background: syntaxTheme.background,
      surface: () => withoutSyntaxTheme,
    } as unknown as ResolvedTheme;
    const withoutSyntax = palette(withoutSyntaxTheme);
    expect(withoutSyntax.jsonString.toInts()).toEqual(STRING.toInts());
    expect(withoutSyntax.jsonNumber.toInts()).toEqual(NUMBER.toInts());
    expect(withoutSyntax.jsonPunctuation.toInts()).toEqual(MUTED.toInts());
  });
});
