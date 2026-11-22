import { describe, expect, test } from "bun:test";
import {
  highlightBlock,
  highlightLine,
  highlightLines,
  languageForPath,
  resolveLanguage,
} from "../../tools/definitions/canvas/highlight";
import { render } from "../../tools/definitions/canvas/markdown";

describe("language detection with @pierre/highlights", () => {
  test("maps file paths and language tags to @pierre/highlights languages", () => {
    expect(languageForPath("src/tools/canvas/index.ts")).toBe("ts");
    expect(languageForPath("Dockerfile.prod")).toBe("dockerfile");
    expect(languageForPath("README")).toBe("text");
    expect(resolveLanguage("language-typescript")).toBe("typescript");
    expect(resolveLanguage("jsonc")).toBe("json");
    expect(resolveLanguage("sql")).toBe("sql");
    expect(resolveLanguage("unknown-xyz")).toBe("text");
  });
});

describe("highlightLine, highlightLines, and highlightBlock via @pierre/highlights", () => {
  test("highlights keywords, types, functions, numbers, strings, and comments in TypeScript", () => {
    const html = highlightLine(
      'export const run = (count: Result): number => call("hi", 42); // note',
      "ts",
    );
    expect(html).toContain('<span class="hl-k">export</span>');
    expect(html).toContain('<span class="hl-k">const</span>');
    expect(html).toContain('<span class="hl-t">Result</span>');
    expect(html).toContain('<span class="hl-f">call</span>');
    expect(html).toContain('<span class="hl-s">&quot;hi&quot;</span>');
    expect(html).toContain('<span class="hl-n">42</span>');
    expect(html).toContain('<span class="hl-c">// note</span>');
  });

  test("escapes raw HTML inside code tokens so no tag can break out", () => {
    const html = highlightLine('const x = "<script>alert(1)</script>";', "ts");
    expect(html).not.toContain("<script>");
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  test("preserves multi-line comment and template state across lines", () => {
    const lines = highlightLines(["/* start comment", "still inside comment */", "const x = 1;"], "ts");
    expect(lines[0]).toContain('class="hl-c"');
    expect(lines[1]).toContain('class="hl-c"');
    expect(lines[2]).toContain('<span class="hl-k">const</span>');
  });

  test("highlights JSON, shell, YAML, CSS, SQL, and HTML through @pierre/highlights grammars", () => {
    expect(highlightLine('  "status": "published", "ok": true, "count": 3', "json")).toContain(
      '<span class="hl-n">3</span>',
    );
    expect(highlightLine('export PATH="$HOME/bin" # comment', "sh")).toContain(
      '<span class="hl-k">export</span>',
    );
    expect(highlightLine("timeout: 120 # seconds", "yaml")).toContain(
      '<span class="hl-n">120</span>',
    );
    expect(highlightLine("  color: #7a4b00;", "css")).toContain("color");
    expect(highlightLine("SELECT count(id) FROM items WHERE active = true", "sql")).toContain(
      '<span class="hl-k">SELECT</span>',
    );
    expect(highlightLine('<div class="box">hi</div>', "html")).toContain("div");
  });

  test("highlights fenced code blocks inside rendered markdown reports", () => {
    const rendered = render("```ts\nconst answer: NumberBox = compute(7);\n```");
    expect(rendered.ok).toBe(true);
    if (!rendered.ok) throw new Error(rendered.problem);
    expect(rendered.value.html).toContain('class="language-ts"');
    expect(rendered.value.html).toContain('<span class="hl-k">const</span>');
    expect(rendered.value.html).toContain('<span class="hl-t">NumberBox</span>');
    expect(rendered.value.html).toContain('<span class="hl-f">compute</span>');
    expect(rendered.value.html).toContain('<span class="hl-n">7</span>');
  });

  test("highlightBlock preserves multi-line boundaries", () => {
    const out = highlightBlock("const a = 1;\nconst b = 2;", "ts");
    expect(out.split("\n")).toHaveLength(2);
  });
});
