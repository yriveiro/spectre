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

const STYLE_PALETTE = `:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace;
  --text-sm: 0.8125rem; --text-base: 1rem; --text-lg: 1.25rem; --text-xl: 1.75rem; --space: 0.5rem;
  --bg: #fbfbf9; --surface: #f3f3ef; --surface-alt: #e8e8e2; --fg: #191917; --muted: #55554f;
  --border: #c9c9c1; --accent: #7a4b00; --add-bg: #e6f4ea; --add-fg: #14532d; --del-bg: #fbe9e7; --del-fg: #7a1f1f;
  --hl-k: #8b3400; --hl-s: #14532d; --hl-c: #6b6b63; --hl-n: #0f4c81; --hl-t: #6b21a8; --hl-f: #0b5394; --hl-p: #7a4b00;
  --pele-bg: var(--bg); --pele-fg: var(--fg); --pele-muted: var(--muted); --pele-line: var(--border);
  --pele-surface: var(--surface); --pele-surface-alt: var(--surface-alt); --pele-border: var(--border);
  --pele-accent: var(--accent); --pele-radius: 4px; --pele-font: var(--font); --pele-font-mono: var(--mono);
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #161615; --surface: #1f1f1d; --surface-alt: #292927; --fg: #ecece7; --muted: #a8a8a0;
    --border: #44443f; --accent: #f0b45e; --add-bg: #14301d; --add-fg: #b9f0c8; --del-bg: #3a1919; --del-fg: #ffc9c4;
    --hl-k: #f0b45e; --hl-s: #98e2b1; --hl-c: #8e8e86; --hl-n: #86c5ff; --hl-t: #d4a5ff; --hl-f: #7cc4ff; --hl-p: #f2c97d;
  }
}`;

const STYLE_BASE = `*, *::before, *::after { box-sizing: border-box; }
html { background: var(--bg); }
body { margin: 0; background: var(--bg); color: var(--fg); font: var(--text-base)/1.6 var(--font); text-rendering: optimizeLegibility; }
main { max-width: 1100px; margin: 0 auto; padding: calc(var(--space) * 4) calc(var(--space) * 2.5) calc(var(--space) * 8); }
a { color: var(--fg); text-decoration-color: var(--muted); text-underline-offset: 0.15em; }
a:hover { text-decoration-color: var(--accent); }
a:focus-visible, button:focus-visible, [tabindex]:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
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
pre { position: relative; overflow-x: auto; background: var(--surface-alt); padding: calc(var(--space) * 2); border-radius: 6px; }
pre code { background: none; padding: 0; }
.code-copy { position: absolute; top: 0.4rem; right: 0.4rem; appearance: none; border: 1px solid var(--border); background: var(--bg); color: var(--muted); border-radius: 4px; padding: 0.12rem 0.45rem; font: 500 var(--text-sm)/1.25 var(--font); cursor: pointer; opacity: 0.85; }
.code-copy:hover { border-color: var(--accent); color: var(--fg); opacity: 1; }
.hl-k { color: var(--hl-k); font-weight: 600; } .hl-s { color: var(--hl-s); } .hl-c { color: var(--hl-c); font-style: italic; }
.hl-n { color: var(--hl-n); } .hl-t { color: var(--hl-t); } .hl-f { color: var(--hl-f); } .hl-p { color: var(--hl-p); }`;

const STYLE_COMPONENTS = `.toc { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2) calc(var(--space) * 2.5); margin-bottom: calc(var(--space) * 5); }
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
.point .at, .point .source { color: var(--muted); font-size: var(--text-sm); }
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
tr.annotation td { background: var(--surface); border-left: 3px solid var(--accent); padding: var(--space) calc(var(--space) * 2); font-family: var(--font); font-size: var(--text-base); color: var(--fg); }`;

const STYLE_INTERACTIVE = `figure.diagram { position: relative; margin: calc(var(--space) * 3) 0; background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2); }
figure.diagram .pele-stage { position: relative; overflow: hidden; border-radius: 4px; background: var(--bg); min-height: 6rem; display: flex; align-items: center; justify-content: center; }
figure.diagram svg { max-width: 100%; height: auto; display: block; }
.pele-controls { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 0.25rem; margin-bottom: var(--space); }
.pele-btn { appearance: none; border: 1px solid var(--border); background: var(--bg); color: var(--fg); border-radius: 4px; padding: 0.15rem 0.5rem; font: 500 var(--text-sm)/1.3 var(--font); cursor: pointer; }
.pele-btn:hover { border-color: var(--accent); color: var(--accent); }
figure.diagram[data-fullscreen="true"] { position: fixed; inset: 0; z-index: 9999; margin: 0; border-radius: 0; border: 0; display: flex; flex-direction: column; padding: calc(var(--space) * 2.5); background: var(--bg); }
figure.diagram[data-fullscreen="true"] .pele-stage { flex: 1; min-height: 0; border: 1px solid var(--border); }
figure.diagram[data-fullscreen="true"] svg { max-height: 100%; }
figcaption { color: var(--muted); font-size: var(--text-sm); margin-top: var(--space); }
.board-section { margin: calc(var(--space) * 4) 0; }
.kpi-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(12rem, 1fr)); gap: calc(var(--space) * 2); margin: calc(var(--space) * 2) 0; }
.kpi-card { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2) calc(var(--space) * 2.5); display: flex; flex-direction: column; gap: 0.25rem; }
.kpi-card[data-tone="good"] { border-left: 3px solid var(--add-fg); }
.kpi-card[data-tone="warn"] { border-left: 3px solid var(--accent); }
.kpi-card[data-tone="bad"] { border-left: 3px solid var(--del-fg); }
.kpi-label { color: var(--muted); font-size: var(--text-sm); text-transform: uppercase; letter-spacing: 0.04em; }
.kpi-value { font-size: var(--text-xl); font-weight: 650; line-height: 1.2; font-family: var(--mono); }
.kpi-delta { color: var(--muted); font-size: var(--text-sm); font-family: var(--mono); }
.data-table-wrap { overflow-x: auto; border: 1px solid var(--border); border-radius: 6px; margin: calc(var(--space) * 2) 0; }
table.data-table { border-collapse: collapse; width: 100%; font-size: var(--text-sm); }
table.data-table th, table.data-table td { padding: calc(var(--space) * 1.2) calc(var(--space) * 2); text-align: left; border-bottom: 1px solid var(--border); vertical-align: top; }
table.data-table th { background: var(--surface); color: var(--muted); font-weight: 600; cursor: pointer; user-select: none; white-space: nowrap; }
table.data-table th:hover { color: var(--accent); }
table.data-table tbody tr:last-child td { border-bottom: 0; }
table.data-table tbody tr:hover td { background: var(--surface); }
.chart-figure { background: var(--surface); border: 1px solid var(--border); border-radius: 6px; padding: calc(var(--space) * 2.5); margin: calc(var(--space) * 2) 0; }
.chart-figure svg { width: 100%; height: auto; display: block; }
.citation-badge { display: inline-flex; align-items: center; gap: 0.35rem; font-family: var(--mono); font-size: var(--text-sm); color: var(--muted); background: var(--surface-alt); border: 1px solid var(--border); border-radius: 4px; padding: 0.1rem 0.45rem; }
.callout[data-tone="risk"] { border-left-color: var(--del-fg); }
.callout[data-tone="decision"] { border-left-color: var(--add-fg); }
@media (max-width: 720px) {
  main { padding: calc(var(--space) * 2) calc(var(--space) * 1.5) calc(var(--space) * 6); }
  .page-header h1 { font-size: var(--text-lg); }
  .group ul, .file-nav ol { columns: 1; }
  table.diff td.code { min-width: 12rem; }
}
@media print {
  :root {
    color-scheme: light; --bg: #ffffff; --surface: #f6f6f4; --surface-alt: #ebebe7; --fg: #000000;
    --muted: #3a3a36; --border: #9a9a94; --accent: #5a3700; --add-bg: #f0f8f2; --add-fg: #0f3d21; --del-bg: #fbf0ef; --del-fg: #5e1717;
    --hl-k: #5a3700; --hl-s: #0f3d21; --hl-c: #55554f; --hl-n: #0a355c; --hl-t: #4c1778; --hl-f: #083b6a; --hl-p: #5a3700;
  }
  .toc, .file-nav, .skip-link, .page-footer, .pele-controls, .code-copy { display: none; }
  main { max-width: none; padding: 0; }
  a { color: inherit; text-decoration: underline; }
  .diff-scroll { overflow: visible; border-color: var(--border); }
  .file { break-inside: avoid; }
  table.diff { font-size: 9pt; }
}`;

const STYLE = `\n${STYLE_PALETTE}\n${STYLE_BASE}\n${STYLE_COMPONENTS}\n${STYLE_INTERACTIVE}\n`;

const PELE_STAGE_INIT = `const clamp=(v,lo,hi)=>Math.min(Math.max(v,lo),hi);
for(const fig of document.querySelectorAll("figure.diagram[data-pele-diagram]")){
  const stage=fig.querySelector(".pele-stage"),svg=stage&&stage.querySelector("svg");
  if(!stage||!svg)continue;
  const vb=(svg.getAttribute("viewBox")||"").trim().split(/[\\s,]+/).map(Number);
  const natW=vb[2]||Number(svg.getAttribute("width"))||800,natH=vb[3]||Number(svg.getAttribute("height"))||600;
  const origX=vb[0]||0,origY=vb[1]||0;
  let scale=1,vx=origX,vy=origY,drag=null;
  const apply=()=>{
    if(scale<=1.001){scale=1;vx=origX;vy=origY;svg.setAttribute("viewBox",origX+" "+origY+" "+natW+" "+natH);stage.style.cursor="";return;}
    const w=natW/scale,h=natH/scale;
    vx=clamp(vx,origX,origX+natW-w);vy=clamp(vy,origY,origY+natH-h);
    svg.setAttribute("viewBox",vx+" "+vy+" "+w+" "+h);stage.style.cursor=drag?"grabbing":"grab";
  };
  const zoomTo=(next,cx,cy)=>{
    const target=clamp(next,1,6),rect=svg.getBoundingClientRect();
    const rx=rect.width>0&&cx!==undefined?clamp((cx-rect.left)/rect.width,0,1):0.5;
    const ry=rect.height>0&&cy!==undefined?clamp((cy-rect.top)/rect.height,0,1):0.5;
    vx+=(natW/scale-natW/target)*rx;vy+=(natH/scale-natH/target)*ry;scale=target;apply();
  };
  const toggleFs=()=>{
    const next=fig.getAttribute("data-fullscreen")!=="true";
    if(next)fig.setAttribute("data-fullscreen","true");else fig.removeAttribute("data-fullscreen");
    const btn=fig.querySelector('[data-pele-action="fullscreen"]');
    if(btn)btn.textContent=next?"Exit fullscreen":"Fullscreen";
  };`;

const PELE_STAGE_EVENTS = `  fig.addEventListener("click",(e)=>{
    const btn=e.target.closest("[data-pele-action]");if(!btn)return;
    const act=btn.getAttribute("data-pele-action");
    if(act==="zoom-in")zoomTo(scale*1.25);
    else if(act==="zoom-out")zoomTo(scale/1.25);
    else if(act==="reset")zoomTo(1);
    else if(act==="fullscreen")toggleFs();
    else if(act==="copy-source"){
      const src=fig.getAttribute("data-mermaid-source")||"";
      if(navigator.clipboard)navigator.clipboard.writeText(src).then(()=>{const p=btn.textContent;btn.textContent="Copied";setTimeout(()=>{btn.textContent=p;},900);});
    }else if(act==="download-svg"){
      const clone=svg.cloneNode(true);clone.setAttribute("viewBox",origX+" "+origY+" "+natW+" "+natH);
      const url=URL.createObjectURL(new Blob([clone.outerHTML],{type:"image/svg+xml;charset=utf-8"}));
      const a=document.createElement("a");a.href=url;a.download=(document.title||"diagram").replace(/[^a-z0-9_-]+/gi,"-").toLowerCase()+".svg";
      a.click();URL.revokeObjectURL(url);
    }
  });
  stage.addEventListener("wheel",(e)=>{if(!(e.ctrlKey||e.metaKey||fig.getAttribute("data-fullscreen")==="true"))return;e.preventDefault();zoomTo(scale*(e.deltaY<0?1.15:1/1.15),e.clientX,e.clientY);},{passive:false});
  stage.addEventListener("dblclick",(e)=>{e.preventDefault();zoomTo(scale>1.01?1:2,e.clientX,e.clientY);});
  stage.addEventListener("pointerdown",(e)=>{if(scale<=1.001||e.button!==0)return;drag={id:e.pointerId,x:e.clientX,y:e.clientY};stage.setPointerCapture?.(e.pointerId);stage.style.cursor="grabbing";});
  stage.addEventListener("pointermove",(e)=>{
    if(!drag||drag.id!==e.pointerId)return;
    const r=svg.getBoundingClientRect();
    if(r.width>0&&r.height>0){vx-=((e.clientX-drag.x)/r.width)*(natW/scale);vy-=((e.clientY-drag.y)/r.height)*(natH/scale);drag={id:e.pointerId,x:e.clientX,y:e.clientY};apply();}
  });
  const endDrag=(e)=>{if(drag&&drag.id===e.pointerId){drag=null;apply();}};
  stage.addEventListener("pointerup",endDrag);stage.addEventListener("pointercancel",endDrag);
  stage.addEventListener("keydown",(e)=>{
    if(e.key==="+"||e.key==="="){e.preventDefault();zoomTo(scale*1.25);}
    else if(e.key==="-"){e.preventDefault();zoomTo(scale/1.25);}
    else if(e.key==="0"){e.preventDefault();zoomTo(1);}
    else if(e.key==="f"&&!e.metaKey&&!e.ctrlKey){e.preventDefault();toggleFs();}
    else if(e.key==="Escape"&&fig.getAttribute("data-fullscreen")==="true"){e.preventDefault();toggleFs();}
  });
}`;

const PAGE_GLOBAL_EVENTS = `document.addEventListener("click",(e)=>{
  const copy=e.target.closest("[data-code-copy]");
  if(copy){
    const code=copy.parentElement&&copy.parentElement.querySelector("code");
    if(code&&navigator.clipboard)navigator.clipboard.writeText(code.textContent||"").then(()=>{const p=copy.textContent;copy.textContent="Copied";setTimeout(()=>{copy.textContent=p;},900);});
    return;
  }
  const th=e.target.closest("table.data-table th[data-col]");
  if(th){
    const table=th.closest("table.data-table"),tbody=table&&table.querySelector("tbody");
    if(!tbody)return;
    const col=Number(th.getAttribute("data-col")||0),asc=th.getAttribute("data-sort")!=="asc";
    for(const other of table.querySelectorAll("th[data-col]"))other.removeAttribute("data-sort");
    th.setAttribute("data-sort",asc?"asc":"desc");
    const rows=[...tbody.querySelectorAll("tr")];
    rows.sort((a,b)=>{
      const av=(a.children[col]?.textContent||"").trim(),bv=(b.children[col]?.textContent||"").trim();
      const an=Number(av.replace(/[^0-9.+-]/g,"")),bn=Number(bv.replace(/[^0-9.+-]/g,""));
      const cmp=av!==""&&bv!==""&&!Number.isNaN(an)&&!Number.isNaN(bn)?an-bn:av.localeCompare(bv);
      return asc?cmp:-cmp;
    });
    tbody.replaceChildren(...rows);
  }
});
document.addEventListener("keydown",(e)=>{
  if(e.key!=="Escape")return;
  const open=document.querySelector('figure.diagram[data-fullscreen="true"]');
  if(open){open.removeAttribute("data-fullscreen");const btn=open.querySelector('[data-pele-action="fullscreen"]');if(btn)btn.textContent="Fullscreen";}
});`;

const PELE_RUNTIME = `<script>(() => {\n${PELE_STAGE_INIT}\n${PELE_STAGE_EVENTS}\n${PAGE_GLOBAL_EVENTS}\n})();</script>`;

export const document = ({ title, body, toc = [] }: DocumentInput): string => {
  const needsRuntime =
    body.includes("data-pele-diagram") ||
    body.includes("data-code-copy") ||
    body.includes("data-table");
  const runtime = needsRuntime ? `\n${PELE_RUNTIME}` : "";
  return `<!doctype html>
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
<footer class="page-footer"><p>Built by Spectre. This page loads no external asset.</p></footer>${runtime}
</body>
</html>
`;
};
