import { describe, expect, test } from "bun:test";
import {
  familyForLanguage,
  highlightBlock,
  highlightLine,
  languageForPath,
} from "../../tools/definitions/canvas/highlight";
import { render } from "../../tools/definitions/canvas/markdown";

describe("language detection", () => {
  test("maps file paths and language tags to families", () => {
    expect(languageForPath("src/tools/canvas/index.ts")).toBe("ts");
    expect(languageForPath("Dockerfile.prod")).toBe("sh");
    expect(languageForPath(".env.local")).toBe("yaml");
    expect(languageForPath("README")).toBe("plain");
    expect(familyForLanguage("language-typescript")).toBe("code");
    expect(familyForLanguage("jsonc")).toBe("json");
    expect(familyForLanguage("sql")).toBe("sql");
    expect(familyForLanguage("unknown")).toBe("plain");
  });
});

describe("highlightLine and highlightBlock", () => {
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

  test("distinguishes JSON property keys from string values", () => {
    const html = highlightLine('  "status": "published", "ok": true, "count": 3', "json");
    expect(html).toContain('<span class="hl-p">&quot;status&quot;</span>');
    expect(html).toContain('<span class="hl-s">&quot;published&quot;</span>');
    expect(html).toContain('<span class="hl-k">true</span>');
    expect(html).toContain('<span class="hl-n">3</span>');
  });

  test("highlights shell, YAML, CSS, SQL, and markup families", () => {
    expect(highlightLine('export PATH="$HOME/bin" # comment', "sh")).toContain(
      '<span class="hl-k">export</span>',
    );
    expect(highlightLine("timeout: 120 # seconds", "yaml")).toContain(
      '<span class="hl-p">timeout</span>',
    );
    expect(highlightLine("  --accent: #7a4b00;", "css")).toContain(
      '<span class="hl-p">--accent</span>',
    );
    expect(highlightLine("SELECT count(id) FROM items WHERE active = true -- query", "sql")).toContain(
      '<span class="hl-k">SELECT</span>',
    );
    expect(highlightLine('<div class="box"><!-- note -->hi</div>', "html")).toContain(
      '<span class="hl-t">div</span>',
    );
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
