import { describe, expect, test } from "bun:test";
import { headings, placeFigures, render } from "../../tools/definitions/canvas/markdown";

const fence = (source: string, info = "mermaid"): string => `\`\`\`${info}\n${source}\n\`\`\``;

const htmlOf = (result: ReturnType<typeof render>): string => {
  if (!result.ok) throw new Error(result.problem);
  return result.value.html;
};

describe("a Mermaid fence", () => {
  test("becomes a static svg inside a figure, and the page carries no script", () => {
    const html = htmlOf(render(`## Path\n\n${fence("flowchart LR\n  A --> B")}`));
    expect(html).toContain("<svg");
    expect(html).toContain('<figure class="diagram">');
    expect(html).not.toContain("<script");
    expect(html).not.toContain("SPECTRE_MERMAID_");
  });

  test("takes its caption from the fence's info string", () => {
    const html = htmlOf(render(fence("flowchart LR\n  A --> B", "mermaid Publish path")));
    expect(html).toContain("<figcaption>Publish path</figcaption>");
    expect(htmlOf(render(fence("flowchart LR\n  A --> B")))).not.toContain("<figcaption>");
  });

  test("does not open inside another language's fence", () => {
    const html = htmlOf(render("```js\n```mermaid\n```"));
    expect(html).not.toContain("<svg");
    expect(html).toContain("language-js");
  });
});

describe("raw HTML in prose", () => {
  test("is escaped, never passed through as markup", () => {
    const html = htmlOf(render('<script>alert(1)</script>\n\n<span onclick="x()">hi</span>'));
    expect(html).toContain("&lt;script&gt;alert(1)&lt;/script&gt;");
    expect(html).not.toContain("<script>alert");
    expect(html).not.toContain("<span");
    expect(html).toContain("&lt;span onclick=&quot;x()&quot;&gt;hi&lt;/span&gt;");
  });
});

describe("headings", () => {
  test("two headings with the same text get distinct ids", () => {
    const html = htmlOf(render("## Same\n\n## Same"));
    const found = headings(html);
    expect(found.map((one) => one.id)).toEqual(["same", "same-1"]);
    expect(html).toContain('id="same"');
    expect(html).toContain('id="same-1"');
  });

  test("returns the visible text with entities decoded", () => {
    const found = headings(htmlOf(render("## Hi & <there>")));
    expect(found).toEqual([{ id: "hi-there", text: "Hi & <there>", level: 2 }]);
  });
});

describe("refusals", () => {
  test("a Pele error names the block that failed", () => {
    const result = render(`intro\n\n${fence("flowchart LR\n  A -->")}`);
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("Mermaid block 1");
    expect(result.problem).toContain("Parse error");
  });

  test("a placeholder that never became a paragraph refuses", () => {
    const placed = placeFigures("<p>something else</p>", [
      { token: "SPECTRE_MERMAID_deadbeef_0", html: "<figure></figure>" },
    ]);
    expect(placed.ok).toBe(false);
    if (placed.ok) throw new Error("expected a refusal");
    expect(placed.problem).toContain("SPECTRE_MERMAID_deadbeef_0");
  });

  test("a placeholder that survives the substitution refuses", () => {
    const token = "SPECTRE_MERMAID_deadbeef_1";
    const placed = placeFigures(`<p>${token}</p><p>${token}</p>`, [
      { token, html: "<figure></figure>" },
    ]);
    expect(placed.ok).toBe(false);
    if (placed.ok) throw new Error("expected a refusal");
    expect(placed.problem).toContain("left a placeholder behind");
  });

  test("a Mermaid block with no closing fence refuses", () => {
    const result = render("```mermaid\nflowchart LR\n  A --> B");
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("no closing fence");
  });
});
