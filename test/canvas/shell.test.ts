import { describe, expect, test } from "bun:test";
import { deadAnchors, externalLoads } from "../../tools/definitions/canvas/check";
import { headings, render } from "../../tools/definitions/canvas/markdown";
import { document } from "../../tools/definitions/canvas/shell";

describe("the document shell", () => {
  test("escapes the title against quotes and angle brackets", () => {
    const html = document({ title: 'A "quote" <tag>', body: "<p>body</p>" });
    expect(html).toContain("<title>A &quot;quote&quot; &lt;tag&gt;</title>");
    expect(html).toContain("<h1>A &quot;quote&quot; &lt;tag&gt;</h1>");
    expect(html).not.toContain("<tag>");
  });

  test("links every h2 the body rendered, and no anchor is dead", () => {
    const rendered = render("## One\n\ntext\n\n## Two");
    if (!rendered.ok) throw new Error(rendered.problem);
    const body = rendered.value.html;
    const toc = headings(body);
    const html = document({ title: "T", body, toc });

    expect(html).toContain('<a href="#one">One</a>');
    expect(html).toContain('<a href="#two">Two</a>');
    expect(deadAnchors(html)).toEqual([]);
  });

  test("escapes a toc label as well as the title", () => {
    const html = document({
      title: "T",
      body: '<h2 id="x">a < b</h2>',
      toc: [{ id: "x", text: "a < b", level: 2 }],
    });
    expect(html).toContain('<a href="#x">a &lt; b</a>');
    expect(html).not.toContain('<a href="#x">a < b</a>');
  });

  test("a shell with no toc has no navigation", () => {
    const html = document({ title: "T", body: '<p id="only">x</p>' });
    expect(html).not.toContain('<nav class="toc"');
    expect(deadAnchors(html)).toEqual([]);
  });

  test("loads no external asset of any kind", () => {
    const html = document({ title: "T", body: "<p>x</p>" });
    expect(externalLoads(html, { "index.html": html })).toEqual([]);
    expect(html).toContain("<style>");
    expect(html).not.toContain("<script");
    expect(html).not.toContain("<link");
  });

  test("is one complete document", () => {
    const html = document({ title: "T", body: "" });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html).toContain('<html lang="en">');
    expect(html).toContain("</html>");
  });
});
