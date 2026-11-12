import {
  deadAnchors,
  externalLoads,
  hasDoctype,
  outboundLinks,
  titleOf,
  unsafeLinks,
} from "./check";
import type { Composed, DiagramContent, PageContent, ReportContent } from "./content";
import type { D3Resolver } from "./d3";
import { figure, headings, render as renderMarkdown } from "./markdown";
import { document as pageDocument } from "./shell";

/**
 * The non-PR page composers. Report and diagram are code-owned, so the model
 * never writes a tag. Page is the designed arm: the model supplies one complete
 * document, and this module validates it and attaches the d3 bundle when the
 * document asks for it.
 *
 * Every composer runs the generated-page checks on its own output. External
 * loads and dead anchors are refusals here because this code wrote the markup:
 * a dead anchor is a composer bug, and a generated page has no second file for
 * a load to resolve against.
 */

type Guarded =
  | { readonly ok: true; readonly warnings: ReadonlyArray<string> }
  | { readonly ok: false; readonly problem: string };

const generated = (html: string, files: Readonly<Record<string, string>>): Guarded => {
  const external = externalLoads(html, files);
  if (external.length > 0)
    return {
      ok: false,
      problem: `the generated page loads an external asset: ${external.map((one) => one.target).join(", ")}`,
    };
  const unsafe = unsafeLinks(html);
  if (unsafe.length > 0)
    return {
      ok: false,
      problem: `the generated page has an unsafe link: ${unsafe.join(", ")}`,
    };
  const dead = deadAnchors(html);
  if (dead.length > 0)
    return {
      ok: false,
      problem: `the generated page has a dead in-page anchor: ${dead.map((one) => `#${one}`).join(", ")}`,
    };
  return {
    ok: true,
    warnings: outboundLinks(html).map((link) => `outbound link stays a dependency: ${link}`),
  };
};

export const report = (content: ReportContent): Composed => {
  const rendered = renderMarkdown(content.markdown);
  if (!rendered.ok) return rendered;

  const body = rendered.value.html;
  const warnings: Array<string> = [...rendered.value.warnings];
  if (/^\s*<h1\b/i.test(body))
    warnings.push(
      "the report body starts with its own h1, so the page prints the title above another title",
    );

  const html = pageDocument({ title: content.title, body, toc: headings(body) });
  const files: Readonly<Record<string, string>> = { "index.html": html };
  const guarded = generated(html, files);
  if (!guarded.ok) return guarded;

  return { ok: true, title: content.title, files, warnings: [...warnings, ...guarded.warnings] };
};

export const diagram = (content: DiagramContent): Composed => {
  const built = figure(content.mermaid, content.caption);
  if (!built.ok) {
    const at = built.line === undefined ? "" : ` at line ${built.line} of the source`;
    return {
      ok: false,
      problem: `the diagram could not be rendered${at}: ${built.problem}`,
    };
  }

  const body = `<section class="summary">
<p>${Bun.escapeHTML(content.takeaway)}</p>
${built.value}
</section>`;
  const html = pageDocument({ title: content.title, body });
  const files: Readonly<Record<string, string>> = { "index.html": html };
  const guarded = generated(html, files);
  if (!guarded.ok) return guarded;

  return { ok: true, title: content.title, files, warnings: guarded.warnings };
};

const D3_SRC = /<script\b[^>]*\bsrc\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>/gi;

const referencesD3 = (html: string): boolean => {
  for (const match of html.matchAll(D3_SRC)) {
    const src = (match[1] ?? match[2] ?? match[3] ?? "")
      .trim()
      .replace(/^\.\//, "")
      .split(/[?#]/)[0];
    if (src === "vendor/d3.min.js") return true;
  }
  return false;
};

const withD3Version = (html: string, version: string): string =>
  html.replace(
    /<head(\s[^>]*)?>/i,
    (head) => `${head}\n<meta name="d3-version" content="${Bun.escapeHTML(version)}">`,
  );

/**
 * The designed arm. The document is published as the model wrote it, except for
 * one optional `<meta>` that records the d3 build; validation never rewrites it.
 * A CDN reference is a warning because the reader can see the dependency, and a
 * relative file the artifact does not hold is a refusal because it cannot work.
 */
export const page = async (content: PageContent, d3: D3Resolver): Promise<Composed> => {
  if (content.html.trim() === "")
    return { ok: false, problem: "the page is empty; it must be one complete HTML document" };
  if (!hasDoctype(content.html) && !/<html[\s>]/i.test(content.html))
    return {
      ok: false,
      problem: "the page must be one complete HTML document: add <!doctype html> or an <html> root",
    };

  const warnings: Array<string> = [];
  if (!hasDoctype(content.html))
    warnings.push("the page has no <!doctype>, so the browser may render it in quirks mode");
  if (titleOf(content.html) === undefined)
    warnings.push(
      "the page has no <title>; the artifact title is separate, but the document itself has no title",
    );

  const unsafe = unsafeLinks(content.html);
  if (unsafe.length > 0)
    return { ok: false, problem: `the page has an unsafe link: ${unsafe.join(", ")}` };

  let html = content.html;
  const files: Record<string, string> = { "index.html": html };

  if (referencesD3(html)) {
    const resolved = await d3();
    if (!resolved.ok) return { ok: false, problem: resolved.problem };
    files["vendor/d3.min.js"] = resolved.value.content;
    html = withD3Version(html, resolved.value.version);
    files["index.html"] = html;
    warnings.push(`attached the installed d3 ${resolved.value.version} at vendor/d3.min.js`);
  }

  const loads = externalLoads(html, files);
  const missing = loads.filter((one) => one.kind === "missing");
  if (missing.length > 0)
    return {
      ok: false,
      problem: `the page loads a file that is not in the artifact: ${missing.map((one) => one.target).join(", ")}`,
    };
  for (const one of loads)
    if (one.kind === "remote")
      warnings.push(`external load stays a dependency of the page: ${one.target}`);
  for (const anchor of deadAnchors(html)) warnings.push(`in-page anchor has no target: #${anchor}`);
  for (const link of outboundLinks(html))
    warnings.push(`outbound link navigates the artifact frame: ${link}`);

  return { ok: true, title: content.title, files, warnings };
};
