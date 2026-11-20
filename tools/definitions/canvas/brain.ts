import type { BrainSnapshot, NeuronNode } from "../brain";
import { generated } from "./compose";
import type { BrainContent, Composed } from "./content";
import type { D3Resolver } from "./d3";
import { render as renderMarkdown } from "./markdown";

type ClientNeuron = Omit<NeuronNode, "body"> & {
  readonly bodyHtml: string | null;
};

type ClientPayload = Omit<BrainSnapshot, "neurons"> & {
  readonly focusId: string | null;
  readonly neurons: ReadonlyArray<ClientNeuron>;
};

const safeJson = (value: unknown): string =>
  JSON.stringify(value)
    .replaceAll("<", "\\u003c")
    .replaceAll(">", "\\u003e")
    .replaceAll("&", "\\u0026")
    .replaceAll("\u2028", "\\u2028")
    .replaceAll("\u2029", "\\u2029");

const resolveFocus = (
  neurons: ReadonlyArray<NeuronNode>,
  asked: string | undefined,
): { readonly ok: true; readonly id: string | null } | { readonly ok: false; readonly problem: string } => {
  const trimmed = asked?.trim() ?? "";
  if (trimmed === "") {
    const firstActive = neurons.find((one) => one.status === "active") ?? neurons[0];
    return { ok: true, id: firstActive?.id ?? null };
  }
  const exact = neurons.find((one) => one.id === trimmed);
  if (exact !== undefined) return { ok: true, id: exact.id };
  const matches = neurons.filter((one) => one.id.startsWith(trimmed));
  if (matches.length === 1) return { ok: true, id: matches[0]?.id ?? null };
  if (matches.length === 0)
    return { ok: false, problem: `focus "${trimmed}" matches no neuron in .spectre/brain` };
  return {
    ok: false,
    problem: `focus "${trimmed}" matches ${matches.length} neurons (${matches.map((m) => m.short).join(", ")}); give a longer prefix`,
  };
};

const renderBodyHtml = (neuron: NeuronNode, warnings: Array<string>): string | null => {
  if (neuron.body === null) return null;
  const built = renderMarkdown(neuron.body);
  if (!built.ok) {
    warnings.push(`neuron ${neuron.short} markdown body fell back to escaped text: ${built.problem}`);
    return `<pre>${Bun.escapeHTML(neuron.body)}</pre>`;
  }
  const checked = generated(built.value.html, {});
  if (!checked.ok) {
    warnings.push(`neuron ${neuron.short} markdown body rendered as plain text: ${checked.problem}`);
    return `<pre>${Bun.escapeHTML(neuron.body)}</pre>`;
  }
  warnings.push(...built.value.warnings, ...checked.warnings);
  return built.value.html;
};

const PALETTE_CSS = `
:root {
  color-scheme: light dark;
  --font: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif;
  --mono: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  --bg: #fbfbf9; --surface: #f3f3ef; --surface-alt: #e8e8e2;
  --fg: #191917; --muted: #5d5d56; --border: #cecec5; --accent: #8a5600;
  --decision: #2563eb; --gotcha: #d97706; --constraint: #dc2626;
  --feature: #059669; --lesson: #7c3aed; --relates: #0891b2;
  --supersedes: #78716c; --contradicts: #dc2626; --derived: #7c3aed;
  --latent: #9ca3af; --alert: #dc2626; --cortex: #ca8a04;
}
@media (prefers-color-scheme: dark) {
  :root {
    --bg: #141413; --surface: #1d1d1b; --surface-alt: #272724;
    --fg: #ecece6; --muted: #9e9e95; --border: #3a3a35; --accent: #f2b45a;
    --decision: #60a5fa; --gotcha: #fbbf24; --constraint: #f87171;
    --feature: #34d399; --lesson: #c084fc; --relates: #22d3ee;
    --supersedes: #9ca3af; --contradicts: #fb7185; --derived: #c084fc;
    --latent: #6b7280; --alert: #fb7185; --cortex: #facc15;
  }
}`;

const SHELL_CSS = `
*, *::before, *::after { box-sizing: border-box; }
html, body { height: 100%; margin: 0; background: var(--bg); color: var(--fg); font: 14px/1.5 var(--font); }
.app { display: grid; grid-template-rows: auto auto 1fr; height: 100vh; overflow: hidden; }
header { display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 12px; padding: 11px 18px; border-bottom: 1px solid var(--border); background: var(--surface); }
.brand h1 { margin: 0; font-size: 16px; font-weight: 650; letter-spacing: -0.01em; }
.brand p { margin: 2px 0 0; font-size: 12px; color: var(--muted); }
.vitals { display: flex; flex-wrap: wrap; gap: 8px; }
.vital { padding: 5px 10px; border: 1px solid var(--border); border-radius: 6px; background: var(--bg); min-width: 108px; }
.vital .v { font: 600 14.5px/1.15 var(--mono); }
.vital .l { font-size: 11px; color: var(--muted); margin-top: 2px; }
.vital.warn { border-color: color-mix(in srgb, var(--alert) 55%, var(--border)); }
.toolbar { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 14px; padding: 8px 18px; border-bottom: 1px solid var(--border); background: var(--bg); font-size: 12px; }
.group { display: inline-flex; align-items: center; gap: 4px; flex-wrap: wrap; }
.group-label { color: var(--muted); font-weight: 600; margin-right: 2px; text-transform: uppercase; font-size: 10px; letter-spacing: 0.06em; }
button, input[type="search"] { font: 12px/1.2 var(--font); color: var(--fg); background: var(--surface); border: 1px solid var(--border); border-radius: 5px; padding: 5px 9px; }
button { cursor: pointer; }
button:hover { border-color: var(--accent); }
button.active { background: color-mix(in srgb, var(--accent) 18%, var(--surface)); border-color: var(--accent); font-weight: 600; }
.dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%; margin-right: 5px; vertical-align: middle; }
input[type="search"] { width: 185px; background: var(--bg); }`;

const PANELS_CSS = `
.workspace { display: grid; grid-template-columns: 1fr 400px; min-height: 0; overflow: hidden; }
@media (max-width: 960px) { .workspace { grid-template-columns: 1fr; grid-template-rows: 1fr 45%; } }
.stage { position: relative; min-height: 0; overflow: hidden; background: radial-gradient(circle at 1px 1px, color-mix(in srgb, var(--border) 45%, transparent) 1px, transparent 0) 0 0 / 22px 22px; }
#graphSvg { width: 100%; height: 100%; display: block; cursor: grab; }
#graphSvg:active { cursor: grabbing; }
.cold-banner { position: absolute; inset: 0; display: none; place-items: center; padding: 24px; text-align: center; }
.cold-box { max-width: 440px; padding: 22px; border: 1px solid var(--border); border-radius: 10px; background: var(--surface); }
.legend { position: absolute; left: 12px; bottom: 12px; background: color-mix(in srgb, var(--surface) 92%, transparent); backdrop-filter: blur(6px); border: 1px solid var(--border); border-radius: 7px; padding: 7px 11px; font-size: 11px; display: flex; flex-wrap: wrap; gap: 7px 13px; max-width: calc(100% - 24px); }
.legend-item { display: inline-flex; align-items: center; gap: 5px; color: var(--muted); }
.line-swatch { width: 18px; height: 0; border-top: 2px solid currentColor; display: inline-block; }
.line-swatch.dashed { border-top-style: dashed; }
.line-swatch.dotted { border-top-style: dotted; }
.pane { display: none; height: 100%; overflow-y: auto; padding: 18px 22px 44px; background: var(--bg); }
.pane.visible { display: block; }
.meter { height: 10px; border-radius: 999px; background: var(--surface-alt); overflow: hidden; border: 1px solid var(--border); margin: 8px 0 14px; }
.meter > div { height: 100%; background: var(--cortex); }
.section-card { border: 1px solid var(--border); border-radius: 8px; background: var(--surface); padding: 13px 15px; margin-bottom: 14px; }
.section-card h3 { margin: 0 0 8px; font-size: 13.5px; display: flex; justify-content: space-between; align-items: center; }
.row-item { display: grid; grid-template-columns: 104px 1fr; gap: 8px 12px; padding: 8px 0; border-top: 1px solid var(--border); font-size: 12.5px; }
.row-item:first-of-type { border-top: none; }
.why-note { margin: 4px 0 4px 116px; padding: 6px 10px; border-left: 2px solid var(--accent); background: var(--bg); color: var(--muted); font-size: 12px; border-radius: 0 4px 4px 0; }
table.matrix { width: 100%; border-collapse: collapse; font-size: 12.5px; }
table.matrix th, table.matrix td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--border); vertical-align: top; }
table.matrix th { font-size: 11px; text-transform: uppercase; letter-spacing: 0.05em; color: var(--muted); background: var(--surface); position: sticky; top: 0; }`;

const DOSSIER_CSS = `
aside.dossier { border-left: 1px solid var(--border); background: var(--surface); overflow-y: auto; padding: 15px; display: flex; flex-direction: column; gap: 11px; }
.badge { display: inline-block; padding: 2px 7px; border-radius: 999px; font: 600 10.5px/1.4 var(--mono); text-transform: uppercase; border: 1px solid transparent; }
.badge.st-active { background: color-mix(in srgb, var(--feature) 18%, transparent); color: var(--feature); border-color: color-mix(in srgb, var(--feature) 42%, transparent); }
.badge.st-retired { background: var(--surface-alt); color: var(--muted); border-color: var(--border); }
.badge.st-alert { background: color-mix(in srgb, var(--alert) 18%, transparent); color: var(--alert); border-color: color-mix(in srgb, var(--alert) 45%, transparent); }
.badge.st-cortex { background: color-mix(in srgb, var(--cortex) 20%, transparent); color: var(--cortex); border-color: color-mix(in srgb, var(--cortex) 45%, transparent); }
.card { background: var(--bg); border: 1px solid var(--border); border-radius: 7px; padding: 10px 12px; }
.card h4 { margin: 0 0 6px; font-size: 11px; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.claim-headline { font-size: 13px; line-height: 1.55; margin: 0; }
.prose-body { font-size: 12.5px; line-height: 1.55; }
.prose-body p, .prose-body ul, .prose-body ol { margin: 0 0 8px; }
.prose-body pre { overflow-x: auto; background: var(--surface-alt); padding: 8px; border-radius: 5px; font-family: var(--mono); font-size: 11.5px; }
.mono { font-family: var(--mono); font-size: 11.5px; }
.edge-item { padding: 7px 0; border-top: 1px solid var(--border); font-size: 12px; }
.edge-item:first-child { border-top: none; padding-top: 0; }
.chip { display: inline-block; font: 11px/1.3 var(--mono); padding: 2px 6px; border-radius: 4px; background: var(--surface-alt); border: 1px solid var(--border); cursor: pointer; margin: 2px 3px 2px 0; color: var(--fg); }
.chip:hover { border-color: var(--accent); }
.alert-banner { padding: 8px 10px; border-radius: 6px; border: 1px solid color-mix(in srgb, var(--alert) 55%, var(--border)); background: color-mix(in srgb, var(--alert) 11%, var(--bg)); font-size: 12px; }
.tooltip { position: absolute; pointer-events: none; opacity: 0; background: var(--surface); color: var(--fg); border: 1px solid var(--border); border-radius: 6px; padding: 6px 9px; font-size: 11.5px; max-width: 310px; box-shadow: 0 4px 14px rgba(0,0,0,0.22); z-index: 20; transition: opacity 0.1s; }`;

const BOOT_JS = `
const KIND_ORDER = ["constraint", "gotcha", "decision", "feature", "lesson"];
const KIND_COLOR = { constraint: "var(--constraint)", gotcha: "var(--gotcha)", decision: "var(--decision)", feature: "var(--feature)", lesson: "var(--lesson)" };
const EDGE_COLOR = { relates: "var(--relates)", "derived-from": "var(--derived)", contradicts: "var(--contradicts)", supersedes: "var(--supersedes)" };
const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const byId = new Map(SNAP.neurons.map((n) => [n.id, n]));
const anomalyByNeuron = new Map();
for (const a of SNAP.anomalies) {
  for (const id of a.neuronIds) {
    const list = anomalyByNeuron.get(id) || [];
    list.push(a);
    anomalyByNeuron.set(id, list);
  }
}
const connectedActive = SNAP.totals.active === 0 ? 0 : Math.round(((SNAP.totals.active - SNAP.totals.isolatedActive) / SNAP.totals.active) * 100);
const vitals = [
  { v: SNAP.totals.active + " / " + SNAP.totals.total, l: "Active / Total neurons", warn: false },
  { v: SNAP.totals.edges + " (" + connectedActive + "%)", l: "Synapses (connected active)", warn: SNAP.totals.isolatedActive > SNAP.totals.active / 2 },
  { v: SNAP.cortex.shownCount + " (" + SNAP.cortex.usedTokens + "/" + SNAP.cortex.budget + "t)", l: "Prompt Cortex window", warn: false },
  { v: String(SNAP.latentBridges.length), l: "Latent file bridges", warn: false },
  { v: SNAP.totals.subjects + (SNAP.totals.missingSubjects ? " (" + SNAP.totals.missingSubjects + " miss)" : ""), l: "Grounded subject paths", warn: SNAP.totals.missingSubjects > 0 },
  { v: String(SNAP.anomalies.length), l: "Curation alerts", warn: SNAP.anomalies.length > 0 }
];
document.getElementById("vitalsBar").innerHTML = vitals.map((k) =>
  '<div class="vital' + (k.warn ? " warn" : "") + '"><div class="v">' + esc(k.v) + '</div><div class="l">' + esc(k.l) + '</div></div>'
).join("");
const ui = { tab: "connectome", layout: "force", standing: "all", kinds: new Set(KIND_ORDER), showLatent: true, query: "", selectedId: SNAP.focusId };
const kindCounts = {};
for (const n of SNAP.neurons) kindCounts[n.kind] = (kindCounts[n.kind] || 0) + 1;
const kindBox = document.getElementById("kindButtons");
for (const k of KIND_ORDER) {
  const b = document.createElement("button");
  b.type = "button"; b.className = "active";
  b.innerHTML = '<span class="dot" style="background:' + KIND_COLOR[k] + '"></span>' + k + " (" + (kindCounts[k] || 0) + ")";
  b.addEventListener("click", () => {
    if (ui.kinds.has(k) && ui.kinds.size > 1) { ui.kinds.delete(k); b.classList.remove("active"); }
    else { ui.kinds.add(k); b.classList.add("active"); }
    refreshGraph();
  });
  kindBox.appendChild(b);
}`;

const GRAPH_DOM_JS = `
function visibleNeuron(n) {
  if (!ui.kinds.has(n.kind)) return false;
  if (ui.standing === "active" && n.status !== "active") return false;
  if (ui.standing === "cortex" && !n.inCortex) return false;
  if (ui.standing === "retired" && n.status === "active") return false;
  if (ui.standing === "isolated" && !(n.status === "active" && n.degree === 0)) return false;
  if (ui.standing === "alerts" && !anomalyByNeuron.has(n.id)) return false;
  if (ui.query) {
    const hay = (n.id + " " + n.kind + " " + n.claim + " " + n.subjects.map((s) => s.path).join(" ")).toLowerCase();
    if (!hay.includes(ui.query.toLowerCase())) return false;
  }
  return true;
}
const svg = d3.select("#graphSvg");
const defs = svg.append("defs");
Object.entries(EDGE_COLOR).forEach(([kind, color]) => {
  defs.append("marker").attr("id", "mk-" + kind).attr("viewBox", "0 -5 10 10").attr("refX", 22).attr("refY", 0)
    .attr("markerWidth", 6).attr("markerHeight", 6).attr("orient", "auto")
    .append("path").attr("d", "M0,-4L10,0L0,4").attr("fill", color);
});
const gRoot = svg.append("g");
const zoom = d3.zoom().scaleExtent([0.25, 3.8]).on("zoom", (ev) => gRoot.attr("transform", ev.transform));
svg.call(zoom);
const laneG = gRoot.append("g"), latentG = gRoot.append("g"), edgeG = gRoot.append("g"), nodeG = gRoot.append("g");
const tip = document.getElementById("tooltip");
function showTip(ev, content) {
  tip.innerHTML = content; tip.style.opacity = "1";
  const box = document.querySelector(".stage").getBoundingClientRect();
  tip.style.left = Math.min(box.width - 315, ev.clientX - box.left + 12) + "px";
  tip.style.top = Math.max(8, ev.clientY - box.top + 12) + "px";
}
function hideTip() { tip.style.opacity = "0"; }`;

const GRAPH_BIND_JS = `
const nodes = SNAP.neurons.map((n, idx) => ({ ...n, orderIdx: idx, commitsSum: n.subjects.reduce((acc, s) => acc + s.commits, 0) }));
const graphEdges = SNAP.edges.filter((e) => e.kind !== "demoted" && e.to !== null && byId.has(e.from) && byId.has(e.to)).map((e) => ({ ...e, source: e.from, target: e.to }));
const latentLinks = SNAP.latentBridges.map((b) => ({ ...b, source: b.from, target: b.to }));
const radius = (d) => 10 + Math.min(8, d.degree * 2 + Math.floor(d.commitsSum / 25));
const latentSel = latentG.selectAll("path").data(latentLinks).join("path").attr("fill", "none").attr("stroke", "var(--latent)")
  .attr("stroke-width", (d) => Math.min(2.3, 0.9 + d.shared.length * 0.45)).attr("stroke-dasharray", "2,4")
  .on("mousemove", (ev, d) => showTip(ev, "<strong>Latent file bridge</strong><br>" + esc(d.shared.join(", ")))).on("mouseleave", hideTip);
const edgeSel = edgeG.selectAll("path").data(graphEdges).join("path").attr("fill", "none")
  .attr("stroke", (d) => EDGE_COLOR[d.kind] || "var(--supersedes)").attr("stroke-width", (d) => d.kind === "supersedes" ? 1.8 : 2.3)
  .attr("stroke-dasharray", (d) => d.kind === "supersedes" ? "5,3" : d.kind === "contradicts" ? "3,2" : null)
  .attr("marker-end", (d) => "url(#mk-" + d.kind + ")").on("mousemove", (ev, d) => showTip(ev, "<strong>" + esc(d.kind) + "</strong><br>" + esc(d.why))).on("mouseleave", hideTip);
const nodeSel = nodeG.selectAll("g").data(nodes).join("g").style("cursor", "pointer")
  .on("click", (ev, d) => { ev.stopPropagation(); pickNeuron(d.id); })
  .on("mousemove", (ev, d) => showTip(ev, "<strong>[" + esc(d.kind) + "] " + esc(d.short) + "</strong> (" + esc(d.status) + ")<br>" + esc(d.claim.slice(0, 145)) + (d.claim.length > 145 ? "..." : "")))
  .on("mouseleave", hideTip)
  .call(d3.drag()
    .on("start", (ev, d) => { if (!ev.active && sim) sim.alphaTarget(0.25).restart(); d.fx = d.x; d.fy = d.y; })
    .on("drag", (ev, d) => { d.fx = ev.x; d.fy = ev.y; })
    .on("end", (ev, d) => { if (!ev.active && sim) sim.alphaTarget(0); d.fx = null; d.fy = null; }));
nodeSel.append("circle").attr("class", "cortex-ring").attr("r", (d) => radius(d) + 6).attr("fill", "none").attr("stroke", "var(--cortex)").attr("stroke-width", 2.1);
nodeSel.append("circle").attr("class", "alert-ring").attr("r", (d) => radius(d) + 3.5).attr("fill", "none").attr("stroke", "var(--alert)").attr("stroke-width", 2).attr("opacity", (d) => anomalyByNeuron.has(d.id) ? 1 : 0);
nodeSel.append("circle").attr("class", "core").attr("r", radius).attr("fill", (d) => d.status === "active" ? KIND_COLOR[d.kind] : "var(--surface-alt)")
  .attr("stroke", (d) => KIND_COLOR[d.kind]).attr("stroke-dasharray", (d) => d.status === "active" ? null : "3,2").attr("fill-opacity", (d) => d.status === "active" ? 0.88 : 0.42);
nodeSel.append("text").attr("dy", (d) => radius(d) + 12).attr("text-anchor", "middle").attr("font-family", "var(--mono)").attr("font-size", 10).attr("fill", "var(--fg)")
  .text((d) => d.short.slice(4, 8) + " · " + (d.subjects[0] ? d.subjects[0].path.split("/").slice(-2).join("/") : d.short).slice(0, 18));`;

const LAYOUT_JS = `
const stageW = () => document.getElementById("graphSvg").clientWidth || 820;
const stageH = () => document.getElementById("graphSvg").clientHeight || 580;
let sim = null;
if (nodes.length === 0) {
  document.getElementById("coldBanner").style.display = "grid";
} else {
  sim = d3.forceSimulation(nodes).force("collide", d3.forceCollide().radius((d) => radius(d) + 21)).on("tick", () => {
    edgeSel.attr("d", (d) => {
      const dr = Math.hypot(d.target.x - d.source.x, d.target.y - d.source.y) * 1.45;
      return "M" + d.source.x + "," + d.source.y + "A" + dr + "," + dr + " 0 0,1 " + d.target.x + "," + d.target.y;
    });
    latentSel.attr("d", (d) => "M" + d.source.x + "," + d.source.y + "L" + d.target.x + "," + d.target.y);
    nodeSel.attr("transform", (d) => "translate(" + d.x + "," + d.y + ")");
  });
  applyLayout();
}
function applyLayout() {
  if (!sim) return;
  const w = stageW(), h = stageH();
  laneG.selectAll("*").remove();
  if (ui.layout === "timeline") {
    const padX = 90, padY = 65, spanW = Math.max(320, w - padX * 2), laneH = Math.max(64, (h - padY * 2) / Math.max(1, KIND_ORDER.length - 1));
    KIND_ORDER.forEach((k, idx) => {
      const y = padY + idx * laneH;
      laneG.append("line").attr("x1", padX - 40).attr("x2", w - padX + 40).attr("y1", y).attr("y2", y).attr("stroke", "var(--border)").attr("stroke-dasharray", "3,4");
      laneG.append("text").attr("x", padX - 46).attr("y", y + 4).attr("text-anchor", "end").attr("font-family", "var(--mono)").attr("font-size", 10).attr("fill", KIND_COLOR[k]).text(k);
    });
    const denom = Math.max(1, nodes.length - 1);
    sim.force("link", d3.forceLink(graphEdges).id((d) => d.id).strength(0.08)).force("latent", null).force("charge", d3.forceManyBody().strength(-55)).force("center", null)
      .force("x", d3.forceX((d) => padX + (d.orderIdx / denom) * spanW).strength(0.85))
      .force("y", d3.forceY((d) => padY + KIND_ORDER.indexOf(d.kind) * laneH).strength(0.88)).alpha(0.9).restart();
  } else {
    sim.force("link", d3.forceLink(graphEdges).id((d) => d.id).distance(92).strength(0.85)).force("latent", d3.forceLink(latentLinks).id((d) => d.id).distance(138).strength(0.15))
      .force("charge", d3.forceManyBody().strength(-310)).force("center", d3.forceCenter(w / 2, h / 2))
      .force("x", d3.forceX(w / 2).strength(0.06)).force("y", d3.forceY(h / 2).strength(0.06)).alpha(0.85).restart();
  }
}
function fitStage() { svg.transition().duration(300).call(zoom.transform, d3.zoomIdentity.translate(stageW() * 0.05, stageH() * 0.05).scale(0.9)); }
function refreshGraph() {
  const vis = new Set(nodes.filter(visibleNeuron).map((n) => n.id));
  nodeSel.attr("opacity", (d) => vis.has(d.id) ? 1 : 0.1);
  nodeSel.select(".cortex-ring").attr("opacity", (d) => d.inCortex ? 0.95 : 0);
  nodeSel.select(".core").attr("stroke-width", (d) => d.id === ui.selectedId ? 3.6 : 2);
  edgeSel.attr("opacity", (d) => (vis.has(d.source.id) && vis.has(d.target.id)) ? 0.9 : 0.06);
  latentSel.style("display", ui.showLatent ? null : "none").attr("opacity", (d) => (vis.has(d.source.id) && vis.has(d.target.id)) ? 0.42 : 0.04);
}`;

const DOSSIER_JS = `
function wireJumps(el) { el.querySelectorAll("[data-jump]").forEach((btn) => btn.addEventListener("click", () => pickNeuron(btn.getAttribute("data-jump")))); }
function pickNeuron(id) { ui.selectedId = id; refreshGraph(); renderDossier(); }
function renderDossier() {
  const box = document.getElementById("dossierPane"), n = byId.get(ui.selectedId) || SNAP.neurons[0];
  if (!n) { box.innerHTML = '<div class="card"><h4>Neuron Dossier</h4><p style="margin:0;color:var(--muted)">Brain is cold (0 neurons on disk).</p></div>'; return; }
  const outEdges = SNAP.edges.filter((e) => e.from === n.id), inEdges = SNAP.edges.filter((e) => e.to === n.id), alerts = anomalyByNeuron.get(n.id) || [];
  const peers = SNAP.latentBridges.filter((b) => b.from === n.id || b.to === n.id).map((b) => ({ peer: byId.get(b.from === n.id ? b.to : b.from), shared: b.shared })).filter((p) => p.peer);
  const statusLabel = n.status === "demoted" ? "demoted" + (n.demotedUntil ? " until " + n.demotedUntil.slice(0, 10) : "") : n.status;
  let out = '<div><div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:7px">' +
    '<span class="badge" style="background:color-mix(in srgb,' + KIND_COLOR[n.kind] + ' 18%,transparent);color:' + KIND_COLOR[n.kind] + ';border-color:' + KIND_COLOR[n.kind] + '">' + esc(n.kind) + '</span>' +
    '<span class="badge ' + (n.status === "active" ? "st-active" : "st-retired") + '">' + esc(statusLabel) + '</span>' +
    (n.inCortex ? '<span class="badge st-cortex">Cortex #' + n.cortexRank + ' (' + n.tokenCost + 't)</span>' : '<span class="badge st-retired">' + n.tokenCost + 't</span>') +
    '</div><div class="mono" style="color:var(--muted)">' + esc(n.id) + '<br>' + esc((n.at || "undated").replace("T", " ").slice(0, 19)) + '</div></div>';
  for (const a of alerts) out += '<div class="alert-banner"><strong>' + esc(a.kind) + ':</strong> ' + esc(a.summary) + '</div>';
  out += '<div class="card"><h4>Claim Headline</h4><p class="claim-headline">' + esc(n.claim) + '</p></div>';
  if (n.bodyHtml) out += '<div class="card"><h4>Note Body</h4><div class="prose-body">' + n.bodyHtml + '</div></div>';
  if (n.status !== "active" && n.terminals.length > 0) {
    out += '<div class="card"><h4>Live Terminal Replacement(s)</h4><div>' + n.terminals.map((tid) => '<button type="button" class="chip" data-jump="' + esc(tid) + '">→ ' + esc((byId.get(tid)?.short || tid.slice(0, 8))) + '</button>').join("") + '</div></div>';
  }
  out += '<div class="card"><h4>Synapses (' + (outEdges.length + inEdges.length) + ')</h4>' +
    (outEdges.length + inEdges.length === 0 ? '<div style="font-size:12px;color:var(--muted)">0 explicit synapses in <code>synapses.ndjson</code>.</div>' :
      outEdges.map((e) => '<div class="edge-item"><div><strong>' + esc(e.kind) + '</strong>' + (e.to && byId.get(e.to) ? ' → <button type="button" class="chip" data-jump="' + esc(e.to) + '">' + esc(byId.get(e.to).short) + '</button>' : '') + '</div><div style="color:var(--muted);margin-top:3px">' + esc(e.why) + '</div></div>').join("") +
      inEdges.map((e) => '<div class="edge-item"><div>' + (byId.get(e.from) ? '<button type="button" class="chip" data-jump="' + esc(e.from) + '">' + esc(byId.get(e.from).short) + '</button> → ' : '') + '<strong>' + esc(e.kind) + ' (this)</strong></div><div style="color:var(--muted);margin-top:3px">' + esc(e.why) + '</div></div>').join("")) + '</div>';
  out += '<div class="card"><h4>Grounded Subjects (' + n.subjects.length + ')</h4>' +
    (n.subjects.length === 0 ? '<div style="font-size:12px;color:var(--muted)">No subject paths declared.</div>' : n.subjects.map((s) => '<div class="edge-item"><div class="mono">' + esc(s.path) + (s.missing ? ' <span class="badge st-alert">missing</span>' : '') + '</div><div style="color:var(--muted);margin-top:2px">' + s.commits + ' commits · ' + s.coChange + ' co-change partners' + (s.lastTouched ? ' · last ' + esc(s.lastTouched.slice(0, 10)) : '') + '</div></div>').join("")) + '</div>';
  out += '<div class="card"><h4>Latent Shared-Subject Peers (' + peers.length + ')</h4>' +
    (peers.length === 0 ? '<div style="font-size:12px;color:var(--muted)">No unwired active peers sharing specific paths.</div>' : peers.map((p) => '<div class="edge-item"><button type="button" class="chip" data-jump="' + esc(p.peer.id) + '">' + esc(p.peer.short + " [" + p.peer.kind + "]") + '</button><span style="color:var(--muted)"> via <code>' + esc(p.shared.join(", ")) + '</code></span></div>').join("")) + '</div>';
  box.innerHTML = out;
  wireJumps(box);
}`;

const CORTEX_MAP_JS = `
function renderCortexPane() {
  const pane = document.getElementById("cortexPane");
  const active = SNAP.neurons.filter((n) => n.status === "active").sort((a, b) => (a.cortexRank ?? 9999) - (b.cortexRank ?? 9999) || (a.at < b.at ? 1 : -1));
  const inWin = active.filter((n) => n.inCortex), outWin = active.filter((n) => !n.inCortex);
  const pct = Math.min(100, Math.round((SNAP.cortex.usedTokens / SNAP.cortex.budget) * 100));
  pane.innerHTML = '<div class="section-card"><h3><span>Prompt Cortex Working Memory</span><span class="mono">' + SNAP.cortex.usedTokens + ' / ' + SNAP.cortex.budget + ' tokens (' + pct + '%)</span></h3><div class="meter"><div style="width:' + pct + '%"></div></div>' +
    '<p style="margin:0 0 10px;font-size:12.5px;color:var(--muted)">Active claims ordered newest first inside <code>&lt;context key="spectre.brain"&gt;</code> on root non-mnemonic sessions.</p>' +
    (inWin.length === 0 ? '<div style="color:var(--muted);font-size:12.5px">0 active claims in Prompt Cortex.</div>' : inWin.map((n) => '<div class="row-item"><div><span class="badge st-cortex">#' + n.cortexRank + ' · ' + n.tokenCost + 't</span><br><button type="button" class="chip" data-jump="' + esc(n.id) + '">' + esc(n.short) + '</button></div><div><strong>[' + esc(n.kind) + ']</strong> ' + esc(n.claim) + '</div></div>').join("")) + '</div>' +
    '<div class="section-card"><h3><span>Archival Recall Queue (Below 600-Token Cap)</span><span class="mono">' + outWin.length + ' active</span></h3>' +
    (outWin.length === 0 ? '<div style="color:var(--muted);font-size:12.5px">Every active claim fits inside the Prompt Cortex window.</div>' : outWin.map((n) => '<div class="row-item"><div><button type="button" class="chip" data-jump="' + esc(n.id) + '">' + esc(n.short) + '</button><br><span class="mono" style="color:var(--muted)">' + n.tokenCost + 't</span></div><div><strong>[' + esc(n.kind) + ']</strong> ' + esc(n.claim) + '</div></div>').join("")) + '</div>';
  wireJumps(pane);
}
function renderMapPane() {
  const pane = document.getElementById("mapPane"), rowsMap = new Map();
  for (const n of SNAP.neurons) for (const s of n.subjects) {
    const row = rowsMap.get(s.path) || { path: s.path, commits: s.commits, coChange: s.coChange, missing: s.missing, active: [], retired: [] };
    if (n.status === "active") row.active.push(n); else row.retired.push(n);
    rowsMap.set(s.path, row);
  }
  const rows = [...rowsMap.values()].sort((a, b) => b.active.length - a.active.length || b.commits - a.commits);
  pane.innerHTML = '<div class="section-card"><h3><span>Codebase Subject Coverage</span><span class="mono">' + rows.length + ' paths</span></h3>' +
    (rows.length === 0 ? '<div style="color:var(--muted);font-size:12.5px">No subject paths recorded in .spectre/brain.</div>' :
      '<table class="matrix"><thead><tr><th>Subject Path</th><th>Commits</th><th>Co-Change</th><th>Active Neurons</th><th>Retired</th></tr></thead><tbody>' +
      rows.map((r) => '<tr><td class="mono">' + esc(r.path) + (r.missing ? ' <span class="badge st-alert">missing</span>' : '') + '</td><td class="mono">' + r.commits + '</td><td class="mono">' + r.coChange + '</td><td>' + (r.active.map((n) => '<button type="button" class="chip" data-jump="' + esc(n.id) + '">' + esc(n.short + " [" + n.kind + "]") + '</button>').join("") || "—") + '</td><td>' + (r.retired.map((n) => '<button type="button" class="chip" data-jump="' + esc(n.id) + '">' + esc(n.short) + '</button>').join("") || "—") + '</td></tr>').join("") + '</tbody></table>') + '</div>';
  wireJumps(pane);
}`;

const LINEAGE_CONTROLS_JS = `
function buildComponents() {
  const adj = new Map(), link = (a, b) => { if (!adj.has(a)) adj.set(a, new Set()); adj.get(a).add(b); };
  for (const e of SNAP.edges) if (e.to && byId.has(e.from) && byId.has(e.to)) { link(e.from, e.to); link(e.to, e.from); }
  const visited = new Set(), groups = [];
  for (const id of adj.keys()) {
    if (visited.has(id)) continue;
    const comp = [], q = [id]; visited.add(id);
    while (q.length > 0) { const cur = q.shift(); comp.push(cur); for (const nxt of adj.get(cur) || []) if (!visited.has(nxt)) { visited.add(nxt); q.push(nxt); } }
    comp.sort((a, b) => ((byId.get(a)?.at || "") < (byId.get(b)?.at || "") ? -1 : 1));
    groups.push(comp);
  }
  return groups.sort((a, b) => b.length - a.length);
}
function renderLineagePane() {
  const pane = document.getElementById("lineagePane"), comps = buildComponents();
  let html = '<div class="section-card"><h3><span>Mnemonic Curation Queue</span><span class="mono">' + SNAP.anomalies.length + ' alerts</span></h3>' +
    (SNAP.anomalies.length === 0 ? '<div style="color:var(--muted);font-size:12.5px">Zero structural anomalies, missing paths, or unreconciled forks detected.</div>' :
      SNAP.anomalies.map((a) => '<div class="row-item"><div><span class="badge st-alert">' + esc(a.kind) + '</span></div><div>' + esc(a.summary) + '<div>' + a.neuronIds.map((id) => '<button type="button" class="chip" data-jump="' + esc(id) + '">' + esc(id.slice(0, 8)) + '</button>').join("") + '</div></div></div>').join("")) + '</div>';
  if (comps.length === 0) html += '<div class="section-card"><h3>Synapse Lineages</h3><div style="color:var(--muted);font-size:12.5px">No multi-neuron synapse chains recorded yet.</div></div>';
  else comps.forEach((ids, idx) => {
    const set = new Set(ids), local = SNAP.edges.filter((e) => e.to && set.has(e.from) && set.has(e.to));
    html += '<div class="section-card"><h3><span>Synapse Component #' + (idx + 1) + '</span><span class="mono">' + ids.length + ' neurons · ' + local.length + ' synapses</span></h3>' +
      ids.map((id) => {
        const n = byId.get(id), inc = local.filter((e) => e.to === id);
        return inc.map((e) => '<div class="why-note"><strong>' + esc(byId.get(e.from)?.short || e.from.slice(0, 8)) + ' —[' + esc(e.kind) + ']→ ' + esc(n.short) + ':</strong> ' + esc(e.why) + '</div>').join("") +
          '<div class="row-item"><div><button type="button" class="chip" data-jump="' + esc(n.id) + '">' + esc(n.short) + '</button><br><span class="badge ' + (n.status === "active" ? "st-active" : "st-retired") + '">' + esc(n.status) + '</span></div><div><strong>[' + esc(n.kind) + ']</strong> ' + esc(n.claim) + '</div></div>';
      }).join("") + '</div>';
  });
  pane.innerHTML = html;
  wireJumps(pane);
}
document.querySelectorAll("#tabButtons button").forEach((btn) => btn.addEventListener("click", () => {
  document.querySelectorAll("#tabButtons button").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); ui.tab = btn.dataset.tab;
  const onGraph = ui.tab === "connectome";
  document.getElementById("graphSvg").style.display = onGraph ? "block" : "none";
  document.getElementById("graphLegend").style.display = onGraph ? "flex" : "none";
  document.getElementById("coldBanner").style.display = onGraph && nodes.length === 0 ? "grid" : "none";
  document.getElementById("cortexPane").classList.toggle("visible", ui.tab === "cortex");
  document.getElementById("lineagePane").classList.toggle("visible", ui.tab === "lineage");
  document.getElementById("mapPane").classList.toggle("visible", ui.tab === "map");
}));
document.querySelectorAll("#layoutButtons button").forEach((btn) => btn.addEventListener("click", () => { document.querySelectorAll("#layoutButtons button").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); ui.layout = btn.dataset.layout; applyLayout(); }));
document.querySelectorAll("#standingButtons button").forEach((btn) => btn.addEventListener("click", () => { document.querySelectorAll("#standingButtons button").forEach((b) => b.classList.remove("active")); btn.classList.add("active"); ui.standing = btn.dataset.standing; refreshGraph(); }));
document.getElementById("latentBtn").addEventListener("click", (ev) => { ui.showLatent = !ui.showLatent; ev.currentTarget.classList.toggle("active", ui.showLatent); refreshGraph(); });
document.getElementById("searchBox").addEventListener("input", (ev) => { ui.query = ev.target.value.trim(); refreshGraph(); });
document.getElementById("fitBtn").addEventListener("click", fitStage);
renderCortexPane(); renderLineagePane(); renderMapPane(); pickNeuron(ui.selectedId);
if (nodes.length > 0) setTimeout(fitStage, 420);`;

const BODY_SHELL_HTML = `
  <div class="toolbar">
    <div class="group" id="tabButtons">
      <span class="group-label">Perspective</span>
      <button type="button" data-tab="connectome" class="active">Connectome</button>
      <button type="button" data-tab="cortex">Prompt Cortex</button>
      <button type="button" data-tab="lineage">Lineage &amp; Curation</button>
      <button type="button" data-tab="map">Codebase Map</button>
    </div>
    <div class="group" id="layoutButtons">
      <span class="group-label">Layout</span>
      <button type="button" data-layout="force" class="active">Clusters</button>
      <button type="button" data-layout="timeline">Chronology</button>
    </div>
    <div class="group" id="standingButtons">
      <span class="group-label">Standing</span>
      <button type="button" data-standing="all" class="active">All</button>
      <button type="button" data-standing="active">Active</button>
      <button type="button" data-standing="cortex">In Cortex</button>
      <button type="button" data-standing="retired">Retired</button>
      <button type="button" data-standing="isolated">Isolated</button>
      <button type="button" data-standing="alerts">Alerts</button>
    </div>
    <div class="group" id="kindButtons"><span class="group-label">Kind</span></div>
    <div class="group">
      <button type="button" id="latentBtn" class="active">Latent bridges</button>
      <input type="search" id="searchBox" placeholder="Filter claim, id, or path...">
      <button type="button" id="fitBtn">Fit</button>
    </div>
  </div>
  <div class="workspace">
    <div class="stage">
      <svg id="graphSvg" aria-label="Brain connectome"></svg>
      <div class="cold-banner" id="coldBanner"><div class="cold-box"><h2 style="margin:0 0 8px;font-size:16px">Brain is cold (0 neurons)</h2><p style="margin:0;color:var(--muted);font-size:13px">Mint a claim with <code>tools.spectre.brain({ action: "assert" })</code> or spawn <code>mnemonic</code> to seed <code>.spectre/brain/</code>.</p></div></div>
      <div class="tooltip" id="tooltip"></div>
      <div class="legend" id="graphLegend">
        <span class="legend-item"><span class="dot" style="background:var(--constraint)"></span>constraint</span>
        <span class="legend-item"><span class="dot" style="background:var(--gotcha)"></span>gotcha</span>
        <span class="legend-item"><span class="dot" style="background:var(--decision)"></span>decision</span>
        <span class="legend-item"><span class="dot" style="background:var(--feature)"></span>feature</span>
        <span class="legend-item"><span class="dot" style="background:var(--lesson)"></span>lesson</span>
        <span class="legend-item"><span class="line-swatch" style="color:var(--relates)"></span>relates</span>
        <span class="legend-item"><span class="line-swatch" style="color:var(--derived)"></span>derived-from</span>
        <span class="legend-item"><span class="line-swatch dashed" style="color:var(--contradicts)"></span>contradicts</span>
        <span class="legend-item"><span class="line-swatch dashed" style="color:var(--supersedes)"></span>supersedes</span>
        <span class="legend-item"><span class="line-swatch dotted" style="color:var(--latent)"></span>latent file bridge</span>
      </div>
      <div class="pane" id="cortexPane"></div>
      <div class="pane" id="lineagePane"></div>
      <div class="pane" id="mapPane"></div>
    </div>
    <aside class="dossier" id="dossierPane"></aside>
  </div>`;

const buildBrainDocument = (title: string, version: string, payload: ClientPayload): string => {
  const styles = [PALETTE_CSS, SHELL_CSS, PANELS_CSS, DOSSIER_CSS].join("\n");
  const script = [
    `const SNAP = ${safeJson(payload)};`,
    BOOT_JS,
    GRAPH_DOM_JS,
    GRAPH_BIND_JS,
    LAYOUT_JS,
    DOSSIER_JS,
    CORTEX_MAP_JS,
    LINEAGE_CONTROLS_JS,
  ].join("\n");
  return [
    "<!doctype html>",
    '<html lang="en">',
    "<head>",
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<meta name="d3-version" content="${Bun.escapeHTML(version)}">`,
    `<title>${Bun.escapeHTML(title)}</title>`,
    '<script src="vendor/d3.min.js"></script>',
    `<style>${styles}</style>`,
    "</head>",
    "<body>",
    '<div class="app">',
    `<header><div class="brand"><h1>${Bun.escapeHTML(title)}</h1><p>Canonical Spectre Brain inspector over <code>.spectre/brain/</code></p></div><div class="vitals" id="vitalsBar"></div></header>`,
    BODY_SHELL_HTML,
    "</div>",
    `<script>${script}</script>`,
    "</body>",
    "</html>",
  ].join("\n");
};

export const composeBrain = async (
  snap: BrainSnapshot,
  content: BrainContent,
  d3: D3Resolver,
): Promise<Composed> => {
  const focus = resolveFocus(snap.neurons, content.focus);
  if (!focus.ok) return focus;

  const resolvedD3 = await d3();
  if (!resolvedD3.ok) return { ok: false, problem: resolvedD3.problem };

  const warnings: Array<string> = [
    `attached the installed d3 ${resolvedD3.value.version} at vendor/d3.min.js`,
  ];
  const neurons: Array<ClientNeuron> = snap.neurons.map(({ body: _rawBody, ...rest }, idx) => ({
    ...rest,
    bodyHtml: renderBodyHtml(snap.neurons[idx]!, warnings),
  }));

  const title = `${snap.projectName} · Brain`;
  const html = buildBrainDocument(title, resolvedD3.value.version, {
    projectName: snap.projectName,
    directory: snap.directory,
    totals: snap.totals,
    cortex: snap.cortex,
    edges: snap.edges,
    latentBridges: snap.latentBridges,
    anomalies: snap.anomalies,
    focusId: focus.id,
    neurons,
  });
  const files: Readonly<Record<string, string>> = {
    "index.html": html,
    "vendor/d3.min.js": resolvedD3.value.content,
  };

  const guarded = generated(html, files);
  if (!guarded.ok) return guarded;

  return {
    ok: true,
    title,
    files,
    warnings: [...warnings, ...guarded.warnings],
  };
};
