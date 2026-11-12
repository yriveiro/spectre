import type { Heading } from "./markdown";

/**
 * The one document shell every generated page is wrapped in. It owns the type
 * scale, the light/dark palette, the diff table, the navigator and the print
 * rules; a composer fills slots and never writes a stylesheet. Every value that
 * reaches an attribute or a text node passes `Bun.escapeHTML`, and the CSS names
 * no external asset, so a generated page is one self-contained file.
 */

export type TocEntry = Heading;

export type DocumentInput = {
  readonly title: string;
  readonly body: string;
  readonly toc?: ReadonlyArray<TocEntry>;
};

const tocHtml = (toc: ReadonlyArray<TocEntry>): string => {
  if (toc.length === 0) return "";
  const items = toc
    .map(
      (entry) =>
        `<li class="toc-${entry.level}"><a href="#${Bun.escapeHTML(entry.id)}">${Bun.escapeHTML(entry.text)}</a></li>`,
    )
    .join("\n");
  return `<nav class="toc" aria-label="Contents">
<h2>Contents</h2>
<ol>
${items}
</ol>
</nav>`;
};

const STYLE = `
:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --text-sm: 0.8125rem;
  --text-base: 1rem;
  --text-lg: 1.25rem;
  --text-xl: 1.75rem;
  --space: 0.5rem;
  --bg: #fbfbf9;
  --surface: #f3f3ef;
  --surface-alt: #e8e8e2;
  --fg: #191917;
  --muted: #55554f;
  --border: #c9c9c1;
  --accent: #7a4b00;
  --add-bg: #e6f4ea;
  --add-fg: #14532d;
  --del-bg: #fbe9e7;
  --del-fg: #7a1f1f;
  --pele-bg: var(--bg);
  --pele-fg: var(--fg);
  --pele-muted: var(--muted);
  --pele-line: var(--border);
  --pele-surface: var(--surface);
  --pele-surface-alt: var(--surface-alt);
  --pele-border: var(--border);
  --pele-accent: var(--accent);
  --pele-radius: 4px;
  --pele-font: var(--font);
  --pele-font-mono: var(--mono);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615;
    --surface: #1f1f1d;
    --surface-alt: #292927;
    --fg: #ecece7;
    --muted: #a8a8a0;
    --border: #44443f;
    --accent: #f0b45e;
    --add-bg: #14301d;
    --add-fg: #b9f0c8;
    --del-bg: #3a1919;
    --del-fg: #ffc9c4;
  }
}
*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bg); }
body {
  margin: 0;
  background: var(--bg);
  color: var(--fg);
  font: var(--text-base)/1.6 var(--font);
  text-rendering: optimizeLegibility;
}
main {
  max-width: 1100px;
  margin: 0 auto;
  padding: calc(var(--space) * 4) calc(var(--space) * 2.5) calc(var(--space) * 8);
}
a { color: var(--fg); text-decoration-color: var(--muted); text-underline-offset: 0.15em; }
a:hover { text-decoration-color: var(--accent); }
a:focus-visible, button:focus-visible, [tabindex]:focus-visible {
  outline: 2px solid var(--accent);
  outline-offset: 2px;
}
.skip-link { position: absolute; left: -9999px; top: 0; background: var(--surface); color: var(--fg); padding: var(--space) calc(var(--space) * 1.5); }
.skip-link:focus { left: var(--space); top: var(--space); z-index: 10; }
.page-header { border-bottom: 1px solid var(--border); margin-bottom: calc(var(--space) * 4); padding-bottom: calc(var(--space) * 2); }
.page-header h1 { margin: 0; font-size: var(--text-xl); line-height: 1.2; overflow-wrap: anywhere; text-wrap: balance; }
.kicker { margin: 0 0 var(--space); color: var(--muted); font-size: var(--text-sm); letter-spacing: 0.08em; text-transform: uppercase; }
.page-footer { max-width: 1100px; margin: 0 auto; padding: 0 calc(var(--space) * 2.5) calc(var(--space) * 6); color: var(--muted); font-size: var(--text-sm); }
h2 { font-size: var(--text-lg); line-height: 1.3; margin: calc(var(--space) * 5) 0 calc(var(--space) * 2); }
h3 { font-size: var(--text-base); line-height: 1.4; margin: calc(var(--space) * 3) 0 var(--space); }
p, ul, ol { margin: 0 0 calc(var(--space) * 2); }
code { font-family: var(--mono); font-size: 0.9em; background: var(--surface-alt); padding: 0.1em 0.3em; border-radius: 3px; overflow-wrap: anywhere; }
pre { overflow-x: auto; background: var(--surface-alt); padding: calc(var(--space) * 2); border-radius: 6px; }
pre code { background: none; padding: 0; }
.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2) calc(var(--space) * 2.5); margin-bottom: calc(var(--space) * 5); }
.toc h2 { margin: 0 0 var(--space); font-size: var(--text-base); }
.toc ol { margin: 0; padding-left: calc(var(--space) * 2.5); }
.toc-3 { margin-left: calc(var(--space) * 2); }
.summary { max-width: 72ch; }
.meta { display: grid; grid-template-columns: repeat(auto-fit, minmax(11rem, 1fr)); gap: calc(var(--space) * 2) calc(var(--space) * 3); margin: 0 0 calc(var(--space) * 4); }
.meta div { display: flex; flex-direction: column; gap: 0.15rem; }
.meta dt { color: var(--muted); font-size: var(--text-sm); letter-spacing: 0.04em; text-transform: uppercase; }
.meta dd { margin: 0; overflow-wrap: anywhere; }
.callout, .limits { background: var(--surface); border: 1px solid var(--border); border-left: 3px solid var(--accent); border-radius: 6px; padding: calc(var(--space) * 2) calc(var(--space) * 2.5); margin: calc(var(--space) * 4) 0; }
.callout h2, .limits h2 { margin-top: 0; }
.group { border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2) calc(var(--space) * 2.5); margin-bottom: calc(var(--space) * 2); }
.group h3 { margin-top: 0; }
.group ul { margin-bottom: 0; columns: 2; column-gap: calc(var(--space) * 4); }
.group li { break-inside: avoid; }
.file-nav { margin: calc(var(--space) * 4) 0; }
.file-nav ol { columns: 2; column-gap: calc(var(--space) * 4); padding-left: calc(var(--space) * 2.5); }
.file-nav li { break-inside: avoid; margin-bottom: var(--space); overflow-wrap: anywhere; }
.file-nav .counts, .file-nav .reason { color: var(--muted); font-size: var(--text-sm); }
.review-path { max-width: 80ch; }
.points { padding-left: calc(var(--space) * 2.5); }
.point { margin-bottom: calc(var(--space) * 2); }
.point .at { color: var(--muted); font-size: var(--text-sm); }
.point .source { color: var(--muted); font-size: var(--text-sm); }
.point .note { color: var(--muted); }
.badge { display: inline-block; border: 1px solid var(--border); border-radius: 999px; padding: 0 0.55em; font: 600 var(--text-sm)/1.5 var(--font); color: var(--muted); }
.point-requirement .badge { color: var(--accent); border-color: var(--accent); }
.file { margin: calc(var(--space) * 4) 0; }
.file h3 { font-family: var(--mono); font-size: var(--text-base); overflow-wrap: anywhere; }
.unreadable { background: var(--surface); border-left: 3px solid var(--border); padding: var(--space) calc(var(--space) * 2); color: var(--muted); }
.diff-scroll { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; }
table.diff { border-collapse: collapse; width: max-content; min-width: 100%; font-family: var(--mono); font-size: var(--text-sm); line-height: 1.5; }
table.diff th { position: sticky; top: 0; background: var(--surface-alt); color: var(--muted); font: 600 var(--text-sm)/1.4 var(--font); text-align: left; padding: calc(var(--space) * 0.5) var(--space); border-bottom: 1px solid var(--border); }
table.diff td { padding: 0 var(--space); vertical-align: top; }
table.diff td.ln { color: var(--muted); text-align: right; white-space: nowrap; user-select: none; width: 1%; }
table.diff td.code { white-space: pre-wrap; overflow-wrap: anywhere; min-width: 14rem; }
table.diff .marker { display: inline-block; width: 1ch; color: var(--muted); }
td.removed { background: var(--del-bg); color: var(--del-fg); }
td.added { background: var(--add-bg); color: var(--add-fg); }
tr.hunk td { background: var(--surface-alt); color: var(--muted); padding: calc(var(--space) * 0.5) var(--space); }
tr.annotation td { background: var(--surface); border-left: 3px solid var(--accent); padding: var(--space) calc(var(--space) * 2); font-family: var(--font); font-size: var(--text-base); color: var(--fg); }
figure.diagram { margin: calc(var(--space) * 3) 0; }
figure.diagram svg { max-width: 100%; height: auto; }
figcaption { color: var(--muted); font-size: var(--text-sm); margin-top: var(--space); }
@media (max-width: 720px) {
  main { padding: calc(var(--space) * 2) calc(var(--space) * 1.5) calc(var(--space) * 6); }
  .page-header h1 { font-size: var(--text-lg); }
  .group ul, .file-nav ol { columns: 1; }
  table.diff td.code { min-width: 12rem; }
}
@media print {
  :root {
    color-scheme: light;
    --bg: #ffffff;
    --surface: #f6f6f4;
    --surface-alt: #ebebe7;
    --fg: #000000;
    --muted: #3a3a36;
    --border: #9a9a94;
    --accent: #5a3700;
    --add-bg: #f0f8f2;
    --add-fg: #0f3d21;
    --del-bg: #fbf0ef;
    --del-fg: #5e1717;
  }
  .toc, .file-nav, .skip-link, .page-footer { display: none; }
  main { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: underline; }
  .diff-scroll { overflow: visible; border-color: var(--border); }
  .file { break-inside: avoid; }
  table.diff { font-size: 9pt; }
}
`;

export const document = ({ title, body, toc = [] }: DocumentInput): string => `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${Bun.escapeHTML(title)}</title>
<style>${STYLE}</style>
</head>
<body>
<a class="skip-link" href="#main">Skip to content</a>
<header class="page-header">
<p class="kicker">Spectre canvas</p>
<h1>${Bun.escapeHTML(title)}</h1>
</header>
<main id="main">
${tocHtml(toc)}
${body}
</main>
<footer class="page-footer"><p>Built by Spectre. This page loads no external asset.</p></footer>
</body>
</html>
`;
