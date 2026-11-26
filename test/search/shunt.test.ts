import { describe, expect, test } from "bun:test";
import type { Health } from "../../tools/definitions/search/policy";
import { probe } from "../../tools/definitions/search/probe";
import {
  DEFAULT_SHUNT_CONFIG,
  classifyFormat,
  countLines,
  formatShuntEnvelope,
  readShuntConfig,
  summarizeFile,
  utf8Bytes,
} from "../../tools/definitions/search/shunt";

const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.7.0" };
const absent: Health = { kind: "absent", why: "missing" };

describe("readShuntConfig", () => {
  test("returns defaults when env is empty", () => {
    expect(readShuntConfig({})).toEqual(DEFAULT_SHUNT_CONFIG);
  });

  test("parses valid positive integer SPECTRE_SHUNT_MIN_LINES", () => {
    expect(readShuntConfig({ SPECTRE_SHUNT_MIN_LINES: "500" })).toEqual({
      ...DEFAULT_SHUNT_CONFIG,
      minLines: 500,
    });
    expect(readShuntConfig({ SPECTRE_SHUNT_MIN_LINES: " 200 " }).minLines).toBe(200);
  });

  test("falls back to default for invalid SPECTRE_SHUNT_MIN_LINES", () => {
    for (const bad of ["0", "-10", "3.14", "10abc", "", "   "]) {
      expect(readShuntConfig({ SPECTRE_SHUNT_MIN_LINES: bad }).minLines).toBe(350);
    }
  });
});

describe("utf8Bytes and countLines", () => {
  test("counts UTF-8 bytes rather than string length", () => {
    const text = "hello 🚀 日本語";
    expect(utf8Bytes(text)).toBeGreaterThan(text.length);
    expect(utf8Bytes(text)).toBe(new TextEncoder().encode(text).byteLength);
  });

  test("counts lines consistently with trailing newlines", () => {
    expect(countLines("")).toBe(0);
    expect(countLines("one")).toBe(1);
    expect(countLines("one\n")).toBe(1);
    expect(countLines("one\ntwo")).toBe(2);
    expect(countLines("one\ntwo\n")).toBe(2);
    expect(countLines("a\n\nb\n")).toBe(3);
  });
});

describe("classifyFormat", () => {
  test("classifies markdown, structured, tabular, code, and plain", () => {
    expect(classifyFormat("docs/guide.md", 400, 5000)).toEqual({ kind: "markdown", huge: false });
    expect(classifyFormat("docs/guide.MDX", 1600, 5000)).toEqual({ kind: "markdown", huge: true });
    expect(classifyFormat("README.markdown", 400, 70_000)).toEqual({ kind: "markdown", huge: true });

    expect(classifyFormat("package.json", 400, 5000)).toEqual({ kind: "structured", flavor: "json" });
    expect(classifyFormat("opencode.jsonc", 400, 5000)).toEqual({ kind: "structured", flavor: "jsonc" });
    expect(classifyFormat("Cargo.toml", 400, 5000)).toEqual({ kind: "structured", flavor: "toml" });

    expect(classifyFormat("data.csv", 400, 5000)).toEqual({ kind: "tabular", delimiter: "," });
    expect(classifyFormat("data.tsv", 400, 5000)).toEqual({ kind: "tabular", delimiter: "\t" });

    expect(classifyFormat("src/index.ts", 400, 5000)).toEqual({ kind: "code", huge: false });
    expect(classifyFormat("src/big.py", 2000, 5000)).toEqual({ kind: "code", huge: true });
    expect(classifyFormat("src/big.rs", 400, 70_000)).toEqual({ kind: "code", huge: true });

    expect(classifyFormat("logs/app.log", 400, 5000)).toEqual({ kind: "plain" });
    expect(classifyFormat("notes.txt", 400, 5000)).toEqual({ kind: "plain" });
  });
});

describe("formatShuntEnvelope", () => {
  test("formats header, body, and escape footer", () => {
    const out = formatShuntEnvelope({
      displayPath: "src/app.ts",
      lines: 420,
      rawBytes: 12_288,
      kind: "code",
      body: "export function main(): void",
    });
    expect(out).toContain("[spectre:read-summary] src/app.ts (420 lines, 12.0 KB, kind=code)");
    expect(out).toContain("export function main(): void");
    expect(out).toContain(
      '[escape] Summary only (do not edit from this). Read a slice with read({ path: "src/app.ts", offset: <line>, limit: <n> }) or repeat read({ path: "src/app.ts" }) for the verbatim file.',
    );
  });
});

describe("summarizeFile", () => {
  test("code: invokes ripwire --pack-signatures with --legend-seen when ready", async () => {
    const calls: Array<{ root: string; argv: readonly string[] }> = [];
    const rawText = "export function foo() {}\n".repeat(400);
    const rawBytes = utf8Bytes(rawText);
    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/src/foo.ts",
      displayPath: "src/foo.ts",
      format: { kind: "code", huge: false },
      rawText,
      rawBytes,
      lines: 400,
      health: ready,
      legendSeenFile: "/tmp/seen.txt",
      runRipwire: async (root, argv) => {
        calls.push({ root, argv });
        return {
          status: "answered",
          command: "ripwire",
          answer: "<legend>L1</legend>\nfn foo()",
        };
      },
    });

    expect(calls).toEqual([
      {
        root: "/repo",
        argv: ["/repo/src/foo.ts", "--pack-signatures", "--max-tokens=2000", "--legend-seen=/tmp/seen.txt"],
      },
    ]);
    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.legendXml).toBe("<legend>L1</legend>\nfn foo()");
      expect(res.servedBytes).toBeLessThan(res.rawBytes);
      expect(res.text).toContain("kind=code");
    }
  });

  test("code huge: invokes --pack-signatures --max-tokens=1200 with --legend-seen", async () => {
    const calls: Array<readonly string[]> = [];
    const rawText = "export function bar() {}\n".repeat(1600);
    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/src/bar.ts",
      displayPath: "src/bar.ts",
      format: { kind: "code", huge: true },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: 1600,
      health: ready,
      legendSeenFile: "/tmp/seen-huge.txt",
      runRipwire: async (_root, argv) => {
        calls.push(argv);
        return { status: "answered", command: "ripwire", answer: "<legend>L2</legend>\nfn bar()" };
      },
    });

    expect(calls).toEqual([
      [
        "/repo/src/bar.ts",
        "--pack-signatures",
        "--max-tokens=1200",
        "--legend-seen=/tmp/seen-huge.txt",
      ],
    ]);
    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.legendXml).toBe("<legend>L2</legend>\nfn bar()");
      expect(res.text).toContain("fn bar()");
    }
  });

  test("code: fails open when ripwire is not ready or fails", async () => {
    const rawText = "const x = 1;\n".repeat(400);
    const notReady = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/src/x.ts",
      displayPath: "src/x.ts",
      format: { kind: "code", huge: false },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: 400,
      health: absent,
    });
    expect(notReady).toEqual({ kind: "fail-open", reason: "ripwire-not-ready" });

    const failed = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/src/x.ts",
      displayPath: "src/x.ts",
      format: { kind: "code", huge: false },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: 400,
      health: ready,
      runRipwire: async () => ({ status: "refused", command: "ripwire", answer: "", note: "err" }),
    });
    expect(failed).toEqual({ kind: "fail-open", reason: "ripwire-refused" });
  });

  test("markdown: falls back to deterministic heading extractor with section spans", async () => {
    const lines = [
      "# Introduction",
      ...Array.from({ length: 150 }, (_, i) => `Body line ${i}`),
      "```bash",
      "# not a heading inside fence",
      "```",
      "## Architecture",
      ...Array.from({ length: 250 }, (_, i) => `Arch line ${i}`),
    ];
    const rawText = lines.join("\n") + "\n";
    const total = countLines(rawText);

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/README.md",
      displayPath: "README.md",
      format: { kind: "markdown", huge: false },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: total,
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("L1-L154: # Introduction");
      expect(res.text).toContain(`L155-L${total}: ## Architecture`);
      expect(res.text).not.toContain("not a heading inside fence");
    }
  });

  test("structured: extracts JSONC and TOML schemas with 1-based line numbers", async () => {
    const padding = Array.from({ length: 200 }, (_, i) => `"item_${i}": ${i}`).join(",\n    ");
    const jsoncText = [
      "{",
      "  // comment",
      '  "name": "spectre",',
      '  "tags": ["a", "b", "c"],',
      '  "items": {',
      `    ${padding}`,
      "  },",
      "}",
    ].join("\n");

    const jsonRes = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/config.jsonc",
      displayPath: "config.jsonc",
      format: { kind: "structured", flavor: "jsonc" },
      rawText: jsoncText,
      rawBytes: utf8Bytes(jsoncText),
      lines: countLines(jsoncText),
      health: absent,
    });

    expect(jsonRes.kind).toBe("summarized");
    if (jsonRes.kind === "summarized") {
      expect(jsonRes.text).toContain("name @L3: string");
      expect(jsonRes.text).toContain("tags @L4: array<string>[3]");
      expect(jsonRes.text).toContain("items @L5: object(200)");
      expect(jsonRes.text).toContain("truncated at 120 schema lines");
    }

    const tomlLines = [
      'title = "Spectre"',
      "",
      "[server]",
      'host = "localhost"',
      "port = 8080",
      ...Array.from({ length: 400 }, (_, i) => `extra_${i} = ${i}`),
    ];
    const tomlText = tomlLines.join("\n");
    const tomlRes = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/cfg.toml",
      displayPath: "cfg.toml",
      format: { kind: "structured", flavor: "toml" },
      rawText: tomlText,
      rawBytes: utf8Bytes(tomlText),
      lines: countLines(tomlText),
      health: absent,
    });

    expect(tomlRes.kind).toBe("summarized");
    if (tomlRes.kind === "summarized") {
      expect(tomlRes.text).toContain("title @L1: string");
      expect(tomlRes.text).toContain("server @L3: object(402)");
    }

    const badJson = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/bad.json",
      displayPath: "bad.json",
      format: { kind: "structured", flavor: "json" },
      rawText: "{ broken",
      rawBytes: 8,
      lines: 1,
      health: absent,
    });
    expect(badJson).toEqual({ kind: "fail-open", reason: "parse-error" });
  });

  test("tabular: summarizes CSV with row count, headers, head 15, and tail 10", async () => {
    const rows = [
      'id,"full, name",role',
      ...Array.from({ length: 400 }, (_, i) => `${i + 1},User ${i + 1},member`),
    ];
    const rawText = rows.join("\n") + "\n";

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/users.csv",
      displayPath: "users.csv",
      format: { kind: "tabular", delimiter: "," },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: countLines(rawText),
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("rows: 401");
      expect(res.text).toContain("columns (3): id, full, name, role");
      expect(res.text).toContain("--- head (L1-L15) ---");
      expect(res.text).toContain("--- tail (L392-L401) ---");
      expect(res.text).toContain("L401: 400,User 400,member");
    }
  });

  test("plain: summarizes logs with head 20, up to 15 error/warn lines, and tail 20", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i >= 50 && i < 70) return `2026-01-01 ERROR failed job ${i}`;
      return `2026-01-01 INFO heartbeat ${i} payload=ok`;
    });
    const rawText = lines.join("\n") + "\n";

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/app.log",
      displayPath: "app.log",
      format: { kind: "plain" },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: countLines(rawText),
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("lines: 400");
      expect(res.text).toContain("--- head (L1-L20) ---");
      expect(res.text).toContain("--- error/warn (15) ---");
      expect(res.text).toContain("L51: 2026-01-01 ERROR failed job 50");
      expect(res.text).toContain("--- tail (L381-L400) ---");
    }
  });

  test("guard: fails open with no-savings when summary is not smaller than rawText", async () => {
    const tinyLog = "line 1\nline 2\nline 3\n";
    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/tiny.log",
      displayPath: "tiny.log",
      format: { kind: "plain" },
      rawText: tinyLog,
      rawBytes: utf8Bytes(tinyLog),
      lines: countLines(tinyLog),
      health: absent,
    });

    expect(res).toEqual({ kind: "fail-open", reason: "no-savings" });
  });

  test("guard: checks pageBytes for no-savings and telemetry while envelope prints full rawBytes", async () => {
    const rawText = Array.from({ length: 400 }, (_, i) => `row ${i} payload`).join("\n") + "\n";
    const rawBytes = utf8Bytes(rawText);
    const lines = countLines(rawText);

    const noSavings = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/big.log",
      displayPath: "big.log",
      format: { kind: "plain" },
      rawText,
      rawBytes,
      pageBytes: 200,
      lines,
      health: absent,
    });
    expect(noSavings).toEqual({ kind: "fail-open", reason: "no-savings" });

    const saved = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/big.log",
      displayPath: "big.log",
      format: { kind: "plain" },
      rawText,
      rawBytes: 100 * 1024,
      pageBytes: 4096,
      lines: 2000,
      health: absent,
    });
    expect(saved.kind).toBe("summarized");
    if (saved.kind === "summarized") {
      expect(saved.rawBytes).toBe(4096);
      expect(saved.servedBytes).toBeLessThan(4096);
      expect(saved.text).toContain("(2000 lines, 100.0 KB, kind=plain)");
    }
  });

  test("markdown: 4-backtick outer fence preserves nested 3-backtick fence and ignores info-string closers", async () => {
    const lines = [
      "# Top",
      "````markdown",
      "```ts",
      "# fake heading inside inner fence",
      "```",
      "# fake heading after inner 3-backtick close",
      "````not-a-close",
      "# still inside 4-backtick fence",
      "````   ",
      "## After Fence",
      ...Array.from({ length: 200 }, (_, i) => `Body ${i}`),
    ];
    const rawText = lines.join("\n") + "\n";
    const total = countLines(rawText);

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/fences.md",
      displayPath: "fences.md",
      format: { kind: "markdown", huge: false },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: total,
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("L1-L9: # Top");
      expect(res.text).toContain(`L10-L${total}: ## After Fence`);
      expect(res.text).not.toContain("fake heading");
      expect(res.text).not.toContain("still inside");
    }
  });

  test("structured TOML: nested keys, multiline strings, quoted tables, and dotted top-level keys", async () => {
    const lines = [
      "dotted.nested = 1",
      'notes = """',
      "[fake_table]",
      "project = 999",
      '"""',
      "literal = '''",
      "[other_fake]",
      "'''",
      "[other]",
      'project = "nested-value-must-not-override"',
      '["my table"]',
      "x = 1",
      "['single table']",
      "y = 2",
      "[project]",
      'name = "spectre"',
      ...Array.from({ length: 300 }, (_, i) => `k_${i} = ${i}`),
    ];
    const rawText = lines.join("\n") + "\n";

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/pyproject.toml",
      displayPath: "pyproject.toml",
      format: { kind: "structured", flavor: "toml" },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: countLines(rawText),
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("dotted @L1: object(1)");
      expect(res.text).toContain("notes @L2: string");
      expect(res.text).toContain("literal @L6: string");
      expect(res.text).toContain("other @L9: object(1)");
      expect(res.text).toContain("my table @L11: object(1)");
      expect(res.text).toContain("single table @L13: object(1)");
      expect(res.text).toContain("project @L15: object(301)");
    }
  });

  test("structured JSON: collects multiple depth-1 keys per line and decodes escaped keys", async () => {
    const filler = Array.from({ length: 200 }, (_, i) => `"pad_${i}": ${i}`).join(", ");
    const rawText = [
      `{"alpha": 1, "beta": {"inner": 2}, "a\\"b": 3, "u\\u0041": 4, ${filler}}`,
    ].join("\n");

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/compact.json",
      displayPath: "compact.json",
      format: { kind: "structured", flavor: "json" },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: countLines(rawText),
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("alpha @L1: number");
      expect(res.text).toContain("beta @L1: object(1)");
      expect(res.text).toContain('a"b @L1: number');
      expect(res.text).toContain("uA @L1: number");
    }
  });

  test("plain: matches WARNING/FAILED/FAILURE only outside head and tail ranges", async () => {
    const lines = Array.from({ length: 400 }, (_, i) => {
      if (i === 5) return "2026-01-01 ERROR inside head";
      if (i === 50) return "2026-01-01 WARNING disk space low";
      if (i === 51) return "2026-01-01 job FAILED with code 1";
      if (i === 52) return "2026-01-01 connection FAILURE retry";
      if (i === 395) return "2026-01-01 FATAL inside tail";
      return `2026-01-01 INFO tick ${i} status=healthy`;
    });
    const rawText = lines.join("\n") + "\n";

    const res = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/service.log",
      displayPath: "service.log",
      format: { kind: "plain" },
      rawText,
      rawBytes: utf8Bytes(rawText),
      lines: countLines(rawText),
      health: absent,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.text).toContain("--- error/warn (3) ---");
      expect(res.text).toContain("L51: 2026-01-01 WARNING disk space low");
      expect(res.text).toContain("L52: 2026-01-01 job FAILED with code 1");
      expect(res.text).toContain("L53: 2026-01-01 connection FAILURE retry");
      const alertSection = res.text.split("--- error/warn (3) ---")[1]?.split("--- tail")[0] ?? "";
      expect(alertSection).not.toContain("inside head");
      expect(alertSection).not.toContain("inside tail");
    }
  });

  test("CRLF: strips trailing CR from CSV headers and plain log lines", async () => {
    const csvRows = [
      "id,name,role",
      ...Array.from({ length: 400 }, (_, i) => `${i + 1},User${i + 1},member`),
    ];
    const csvRaw = csvRows.join("\r\n") + "\r\n";
    const csvRes = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/crlf.csv",
      displayPath: "crlf.csv",
      format: { kind: "tabular", delimiter: "," },
      rawText: csvRaw,
      rawBytes: utf8Bytes(csvRaw),
      lines: countLines(csvRaw),
      health: absent,
    });

    expect(csvRes.kind).toBe("summarized");
    if (csvRes.kind === "summarized") {
      expect(csvRes.text).not.toContain("\r");
      expect(csvRes.text).toContain("columns (3): id, name, role");
    }

    const logLines = Array.from({ length: 400 }, (_, i) =>
      i === 60 ? "2026-01-01 WARNING crlf line" : `2026-01-01 INFO ok ${i}`,
    );
    const logRaw = logLines.join("\r\n") + "\r\n";
    const logRes = await summarizeFile({
      root: "/repo",
      resolvedPath: "/repo/crlf.log",
      displayPath: "crlf.log",
      format: { kind: "plain" },
      rawText: logRaw,
      rawBytes: utf8Bytes(logRaw),
      lines: countLines(logRaw),
      health: absent,
    });

    expect(logRes.kind).toBe("summarized");
    if (logRes.kind === "summarized") {
      expect(logRes.text).not.toContain("\r");
      expect(logRes.text).toContain("L61: 2026-01-01 WARNING crlf line");
    }
  });

  test("integration: summarizes a real repo .ts file with ripwire when ready", async () => {
    const health = await probe();
    if (health.kind !== "ready") return;

    const root = Bun.fileURLToPath(new URL("../..", import.meta.url)).replace(/\/$/, "");
    const resolvedPath = Bun.fileURLToPath(
      new URL("../../tools/definitions/search/policy.ts", import.meta.url),
    );
    const rawText = await Bun.file(resolvedPath).text();
    const rawBytes = utf8Bytes(rawText);
    const lines = countLines(rawText);

    const res = await summarizeFile({
      root,
      resolvedPath,
      displayPath: "tools/definitions/search/policy.ts",
      format: classifyFormat(resolvedPath, lines, rawBytes),
      rawText,
      rawBytes,
      lines,
      health,
    });

    expect(res.kind).toBe("summarized");
    if (res.kind === "summarized") {
      expect(res.servedBytes).toBeLessThan(rawBytes);
      expect(res.text).toContain("[spectre:read-summary] tools/definitions/search/policy.ts");
      expect(res.text).toContain('schema="ripwire.pack-signatures/v1"');
      expect(res.text).toContain("<sigs>");
      expect(res.legendXml).toBeDefined();
    }
  });
});
