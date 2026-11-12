import { describe, expect, test } from "bun:test";
import { diagram, page, report } from "../../tools/definitions/canvas/compose";
import type { D3Resolver } from "../../tools/definitions/canvas/d3";

const fakeD3 =
  (version = "7.9.2", content = "/* d3 */"): D3Resolver =>
  async () => ({ ok: true, value: { version, content } });

const mustCompose = (result: ReturnType<typeof report>): Extract<typeof result, { ok: true }> => {
  if (!result.ok) throw new Error(result.problem);
  return result;
};

const htmlOf = (files: Readonly<Record<string, string>>): string => {
  const html = files["index.html"];
  if (html === undefined) throw new Error("index.html is missing");
  return html;
};

const complete = (head: string, body: string): string =>
  `<!doctype html><html lang="en"><head><title>Test page</title>${head}</head><body>${body}</body></html>`;

describe("report", () => {
  test("builds a page with a figure and a table of contents", () => {
    const result = mustCompose(
      report({
        kind: "report",
        title: "Checkout latency",
        markdown:
          "## What changed\n\np95 fell.\n\n```mermaid\nflowchart LR\n  A --> B\n```\n\n## Limits\n\nOne region.",
      }),
    );
    const html = htmlOf(result.files);
    expect(result.title).toBe("Checkout latency");
    expect(html).toContain("<svg");
    expect(html).toContain('<figure class="diagram">');
    expect(html).toContain('<a href="#what-changed">What changed</a>');
    expect(html).toContain('<a href="#limits">Limits</a>');
    expect(result.warnings).toEqual([]);
  });

  test("warns when the body starts with its own h1", () => {
    const result = mustCompose(
      report({ kind: "report", title: "T", markdown: "# Own title\n\ntext" }),
    );
    expect(result.warnings.some((one) => one.includes("h1"))).toBe(true);
  });

  test("warns about an outbound link in the prose", () => {
    const result = mustCompose(
      report({ kind: "report", title: "T", markdown: "[site](https://example.test)" }),
    );
    expect(result.warnings).toEqual(["outbound link stays a dependency: https://example.test"]);
  });

  test("refuses a dead anchor instead of shipping one", () => {
    const result = report({ kind: "report", title: "T", markdown: "[x](#missing)" });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("#missing");
  });

  test("refuses a Mermaid error and names the block", () => {
    const result = report({
      kind: "report",
      title: "T",
      markdown: "```mermaid\nflowchart LR\n  A -->\n```",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("Mermaid block 1");
  });
});

describe("diagram", () => {
  test("builds a figure page with the takeaway and caption", () => {
    const result = mustCompose(
      diagram({
        kind: "diagram",
        title: "Publish path",
        takeaway: "Nothing <reaches> the reader until publish returns an id.",
        mermaid: "flowchart LR\n  A[compose] --> B[publish]",
        caption: "Spectre's side of the path.",
      }),
    );
    const html = htmlOf(result.files);
    expect(html).toContain("<svg");
    expect(html).toContain("Nothing &lt;reaches&gt; the reader until publish returns an id.");
    expect(html).not.toContain("<reaches>");
    expect(html).toContain("<figcaption>Spectre&#x27;s side of the path.</figcaption>");
  });

  test("refuses a Mermaid error with Pele's message", () => {
    const result = diagram({
      kind: "diagram",
      title: "T",
      takeaway: "x",
      mermaid: "flowchart LR\n  A -->",
    });
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("Parse error");
  });
});

describe("page", () => {
  test("publishes a complete document verbatim", async () => {
    const source = complete("", "<h1>Tool</h1>");
    const result = await page({ kind: "page", title: "Tool", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.title).toBe("Tool");
    expect(composed.files["index.html"]).toBe(source);
    expect(composed.warnings).toEqual([]);
  });

  test("refuses a fragment that is not one complete document", async () => {
    const result = await page({ kind: "page", title: "T", html: "<p>hi</p>" }, fakeD3());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("one complete HTML document");
  });

  test("attaches the d3 bundle and records its version when the page asks for it", async () => {
    const source = complete("", '<script src="vendor/d3.min.js"></script><div id="chart"></div>');
    const result = await page({ kind: "page", title: "Chart", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.files["vendor/d3.min.js"]).toBe("/* d3 */");
    expect(composed.files["index.html"]).toContain('<meta name="d3-version" content="7.9.2">');
    expect(composed.warnings).toContain("attached the installed d3 7.9.2 at vendor/d3.min.js");
  });

  test("does not call the resolver when the page names no d3", async () => {
    const resolver: D3Resolver = async () => {
      throw new Error("the resolver must not run");
    };
    const result = await page(
      { kind: "page", title: "T", html: complete("", "<p>x</p>") },
      resolver,
    );
    expect(result.ok).toBe(true);
  });

  test("refuses with the resolver's problem when d3 cannot be read", async () => {
    const source = complete("", '<script src="vendor/d3.min.js"></script>');
    const result = await page({ kind: "page", title: "T", html: source }, async () => ({
      ok: false,
      problem: "d3 is not installed",
    }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toBe("d3 is not installed");
  });

  test("warns about a CDN script because the reader can see the dependency", async () => {
    const source = complete('<script src="https://cdn.test/d3.js"></script>', "<p>x</p>");
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.warnings).toContain(
      "external load stays a dependency of the page: https://cdn.test/d3.js",
    );
  });

  test("refuses a relative load the artifact does not hold", async () => {
    const source = complete("", '<img src="logo.png">');
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("logo.png");
  });

  test("warns when the document has no title", async () => {
    const source = "<!doctype html><html><head></head><body></body></html>";
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.warnings.some((one) => one.includes("<title>"))).toBe(true);
  });

  test("warns about a missing doctype but still publishes", async () => {
    const source = "<html><head><title>X</title></head><body></body></html>";
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.warnings.some((one) => one.includes("quirks mode"))).toBe(true);
  });

  test("warns about a dead in-page anchor", async () => {
    const source = complete("", '<a href="#nope">x</a>');
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    const composed = mustCompose(result);
    expect(composed.warnings).toContain("in-page anchor has no target: #nope");
  });

  test("refuses an unsafe link", async () => {
    const source = complete("", '<a href="javascript:alert(1)">x</a>');
    const result = await page({ kind: "page", title: "T", html: source }, fakeD3());
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("javascript:alert(1)");
  });
});
