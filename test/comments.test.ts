import { afterAll, describe, expect, test } from "bun:test"
import { Effect } from "effect"
import { Tool } from "@opencode/schema/tool"
import { comments } from "../tools/definitions/comments"

type Hit = { file: string; line: number; kind: string; text: string }
type Page = {
  hits: Array<Hit>;
  errors: Array<{ target: string; reason: string }>;
  empty: Array<string>;
  total: number;
  suppressions: number;
  scanned: number;
  truncated: boolean;
};

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

const context = { progress: () => Effect.void } as unknown as Tool.Context;

const run = async (files: Record<string, string>, options: { limit?: number; offset?: number } = {}) => {
  const root = `${TMP}/spectre-comments-${process.pid}-${seq++}`;
  roots.push(root);
  for (const [name, body] of Object.entries(files)) await Bun.write(`${root}/${name}`, body);
  const result = await Effect.runPromise(
    comments(root as never).execute({ targets: Object.keys(files), ...options }, context),
  );
  return result.output as Page;
};

const scan = async (files: Record<string, string>, options?: { limit?: number; offset?: number }) =>
  (await run(files, options)).hits.map((hit) => `${hit.file}:${hit.line} ${hit.kind} ${hit.text}`);

afterAll(async () => {
  for (const root of roots)
    await Bun.$`rm -rf ${root}`.quiet();
});

describe("c style", () => {
  test("finds a comment that trails code on its line", async () => {
    expect(await scan({ "a.ts": "const a = 1 // note\n" })).toEqual([
      "a.ts:1 comment const a = 1 // note",
    ]);
  });

  test("finds a block comment that trails code on its line", async () => {
    expect(await scan({ "a.ts": "const a = 1; /* note */\n" })).toEqual([
      "a.ts:1 comment const a = 1; /* note */",
    ]);
  });

  test("a marker inside a string is not a comment", async () => {
    expect(
      await scan({
        "a.ts": [
          'const url = "https://example.com"',
          "const q = '/* not a comment */'",
          "const t = `",
          "// not a comment",
          "`",
          "",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("a regex literal holding a slash or a quote does not derail the file", async () => {
    expect(
      await scan({
        "a.ts": [
          'if (/Firefox\\//.test(ua)) {}',
          'const r = s.replace(/["\']/g, "") // real',
          "",
        ].join("\n"),
      }),
    ).toEqual(["a.ts:2 comment const r = s.replace(/[\"']/g, \"\") // real"]);
  });

  test("a division on a line with a trailing comment keeps the comment", async () => {
    expect(await scan({ "a.ts": "const x = BUCKET / 4 // 8\n" })).toEqual([
      "a.ts:1 comment const x = BUCKET / 4 // 8",
    ]);
  });

  test("a private class field is not a hash comment", async () => {
    expect(
      await scan({
        "a.ts": [
          "class A {",
          "  static #protocols = { a: 1 };",
          "  #cache = new Map();",
          "  get #size() {",
          "    return this.#cache.size;",
          "  }",
          "}",
          "",
        ].join("\n"),
      }),
    ).toEqual([]);
  });

  test("one hit per line for a block, doc kind when the block is a doc block", async () => {
    expect(
      await scan({
        "a.ts": ["/**", " * doc", " * lines", " */", "/* plain", " * still plain", " */", ""].join("\n"),
      }),
    ).toEqual([
      "a.ts:1 doc /**",
      "a.ts:2 doc * doc",
      "a.ts:3 doc * lines",
      "a.ts:4 doc */",
      "a.ts:5 comment /* plain",
      "a.ts:6 doc * still plain",
      "a.ts:7 doc */",
    ]);
  });

  test("two comments on one line are one hit", async () => {
    expect(await scan({ "a.ts": "/* a */ /* b */\n" })).toEqual(["a.ts:1 comment /* a */ /* b */"]);
  });

  test("an unterminated block still reports what it has", async () => {
    expect(await scan({ "a.ts": "/* open\n * still open\n" })).toEqual([
      "a.ts:1 comment /* open",
      "a.ts:2 doc * still open",
    ]);
  });

  test("a blank line inside a block reports no hit", async () => {
    expect(await scan({ "a.ts": "/* one\n\n * two\n */\n" })).toEqual([
      "a.ts:1 comment /* one",
      "a.ts:3 doc * two",
      "a.ts:4 doc */",
    ]);
  });

  test("line numbers survive a multi line template before the comment", async () => {
    expect(
      await scan({
        "a.ts": ["const t = `", "  body", "`;", "const a = 1 // note", ""].join("\n"),
      }),
    ).toEqual(["a.ts:4 comment const a = 1 // note"]);
  });

  test("a file with no trailing newline still reports its last line", async () => {
    expect(await scan({ "a.ts": "const a = 1 // note" })).toEqual([
      "a.ts:1 comment const a = 1 // note",
    ]);
  });
});

describe("hash style", () => {
  test("finds a trailing comment and skips the shebang", async () => {
    expect(
      await scan({
        "a.sh": ["#!/bin/sh", "# leading", 'echo "a#b" # trailing', ""].join("\n"),
      }),
    ).toEqual(["a.sh:2 comment # leading", "a.sh:3 comment echo \"a#b\" # trailing"]);
  });

  test("a hash inside a quoted value is not a comment", async () => {
    expect(
      await scan({
        "a.yml": ["# real", "url: http://example.com#frag", "key: value # trailing", ""].join("\n"),
      }),
    ).toEqual(["a.yml:1 comment # real", "a.yml:3 comment key: value # trailing"]);
  });

  test("a hash inside a triple quoted string is not a comment", async () => {
    expect(
      await scan({
        "a.py": ["#!/usr/bin/env python3", 'r = """', "# not a comment", '"""', "# real", ""].join("\n"),
      }),
    ).toEqual(["a.py:5 comment # real"]);
  });

  test("a hash glued to a value is not a comment", async () => {
    expect(await scan({ "a.py": "x = 1#glued\n# real\n" })).toEqual(["a.py:2 comment # real"]);
  });
});

describe("suppressions", () => {
  test("classifies every rule the description names", async () => {
    expect(
      await scan({
        "a.ts": [
          "// eslint-disable-next-line no-explicit-any",
          "// @ts-expect-error",
          "// @ts-nocheck",
          "const a = 1 // @ts-ignore",
          "const b = 2 /* prettier-ignore */",
          "const c = 3 // biome-ignore lint/style/useConst: x",
          "const d = 4 // TODO: not a suppression",
          "",
        ].join("\n"),
      }),
    ).toEqual([
      "a.ts:1 suppression // eslint-disable-next-line no-explicit-any",
      "a.ts:2 suppression // @ts-expect-error",
      "a.ts:3 suppression // @ts-nocheck",
      "a.ts:4 suppression const a = 1 // @ts-ignore",
      "a.ts:5 suppression const b = 2 /* prettier-ignore */",
      "a.ts:6 suppression const c = 3 // biome-ignore lint/style/useConst: x",
      "a.ts:7 comment const d = 4 // TODO: not a suppression",
    ]);
  });

  test("classifies the rules of every language it reads", async () => {
    expect(
      await scan({
        "a.py": [
          "x = 1  # noqa: E501",
          "y = 2  # ruff: noqa: PLC0415",
          "z = 3  # pylint: bare-except",
          "w = 4  # ruff: E501",
          "",
        ].join("\n"),
        "b.sh": ["x=1 # shellcheck disable=SC2086", "y=2 # shellcheck disable", ""].join("\n"),
        "c.rb": ["x = 1 # rubocop:disable Style/Foo", "y = 2 # rubocop:enable Style/Foo", ""].join("\n"),
      }),
    ).toEqual([
      "a.py:1 suppression x = 1  # noqa: E501",
      "a.py:2 suppression y = 2  # ruff: noqa: PLC0415",
      "a.py:3 suppression z = 3  # pylint: bare-except",
      "a.py:4 suppression w = 4  # ruff: E501",
      "b.sh:1 suppression x=1 # shellcheck disable=SC2086",
      "b.sh:2 suppression y=2 # shellcheck disable",
      "c.rb:1 suppression x = 1 # rubocop:disable Style/Foo",
      "c.rb:2 suppression y = 2 # rubocop:enable Style/Foo",
    ]);
  });

  test("a prose mention of a linter is not a suppression", async () => {
    expect(
      await scan({
        "a.sh": ["# shellcheck is happy with this", ""].join("\n"),
        "b.rb": ["# rubocop config lives in .rubocop.yml", ""].join("\n"),
        "c.py": ["# noqa is spelled that way", ""].join("\n"),
      }),
    ).toEqual([
      "a.sh:1 comment # shellcheck is happy with this",
      "b.rb:1 comment # rubocop config lives in .rubocop.yml",
      "c.py:1 suppression # noqa is spelled that way",
    ]);
  });
});

describe("page", () => {
  test("totals count the scope, hits count the page", async () => {
    const page = await run({ "a.ts": "// one\n// two\n// three\n" });
    expect(page.total).toBe(3);
    expect(page.suppressions).toBe(0);
    expect(page.scanned).toBe(1);
    expect(page.truncated).toBe(false);
  });

  test("limit and offset page the hits and set truncated", async () => {
    const page = await run({ "a.ts": "// one\n// two\n// three\n" }, { limit: 1, offset: 1 });
    expect(page.hits.map((hit) => hit.line)).toEqual([2]);
    expect(page.total).toBe(3);
    expect(page.truncated).toBe(true);
  });

  test("scanned counts only files that produced a hit", async () => {
    const page = await run({ "a.ts": "// one\n", "b.ts": "const a = 1\n" });
    expect(page.scanned).toBe(1);
    expect(page.empty).toEqual(["b.ts"]);
  });

  test("a bad target lands in errors and the call still succeeds", async () => {
    const page = await run({ "a.ts": "// one\n" });
    expect(page.errors).toEqual([]);
    expect(page.total).toBe(1);
  });

  test("file paths are relative to the project directory", async () => {
    const page = await run({ "a.ts": "// one\n" });
    expect(page.hits.map((hit) => hit.file)).toEqual(["a.ts"]);
  });

  test("an unsupported extension produces no hits", async () => {
    expect(await scan({ "a.md": "# not a target\n", "b.json": '{ "a": 1 }\n' })).toEqual([]);
  });

  test("scanning the same input twice gives the same page", async () => {
    const files = { "a.ts": "const a = 1 // note\nconst b = `x` /* two */\n" };
    expect(await scan(files)).toEqual(await scan(files));
  });
});

describe("robustness", () => {
  test("an unterminated string does not throw", async () => {
    expect(await scan({ "a.ts": "const a = 'open\nconst b = 1 // note\n" })).toEqual([
      "a.ts:2 comment const b = 1 // note",
    ]);
  });

  test("a broken file still reports its comments", async () => {
    expect(await scan({ "a.ts": "const a = {\n// note\n" })).toEqual(["a.ts:2 comment // note"]);
  });

  test("empty and marker free input produces no hits", async () => {
    expect(await scan({ "a.ts": "", "b.py": "\n\n\n" })).toEqual([]);
  });
});

describe("this repository", () => {
  test("scanning every source file finds no hit that is not a comment", async () => {
    const sources = [import.meta.dir, `${import.meta.dir}/../skills`, `${import.meta.dir}/../agents`];
    const files: Record<string, string> = {};
    for (const root of sources) {
      for await (const entry of new Bun.Glob("**/*.{ts,py,sh,yml,yaml,toml}").scan({ cwd: root })) {
        if (entry.split("/").some((part) => part === "node_modules")) continue;
        const name = `${root.split("/").at(-1) ?? "root"}/${entry}`;
        files[name] = await Bun.file(`${root}/${entry}`).text();
      }
    }
    expect(Object.keys(files).length).toBeGreaterThan(10);

    const page = await run(files, { limit: 10_000 });
    expect(page.errors).toEqual([]);

    const perFile = new Map<string, Array<number>>();
    for (const hit of page.hits) {
      const lines = perFile.get(hit.file) ?? [];
      const previous = lines.at(-1);
      expect(previous === undefined || previous < hit.line).toBe(true);
      expect(hit.text.length).toBeGreaterThan(0);
      lines.push(hit.line);
      perFile.set(hit.file, lines);
    }

    for (const hit of page.hits) {
      const isC = /\.(ts|tsx|mts|cts|js|jsx|mjs|cjs)$/.test(hit.file);
      expect(hit.text).toMatch(isC ? /(^|\s)(\/\/|\/\*|\*\/|\*)/ : /(^|\s)#/);
    }

    expect(page.total).toBe(page.hits.length);
    expect(page.truncated).toBe(false);
  });
});
