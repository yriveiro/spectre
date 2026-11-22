import { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { ledger as brainLedger } from "../brain/ledger";
import { deadAnchors, externalLoads, outboundLinks, unsafeLinks } from "./check";
import type {
  BoardContent,
  BoardSection,
  CalloutSection,
  ChartSection,
  Citation,
  CodeSection,
  Composed,
  DiagramSection,
  EvidenceSection,
  KpiSection,
  TableSection,
} from "./content";
import { highlightBlock, languageForPath } from "./highlight";
import { figure, headings, render as renderMarkdown } from "./markdown";
import { document as pageDocument } from "./shell";

const esc = (value: string): string => Bun.escapeHTML(value);

const slugOf = (heading: string, index: number): string => {
  const base = heading
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return base === "" ? `section-${index + 1}` : `${base}-${index + 1}`;
};

type SectionOutcome =
  | { readonly ok: true; readonly html: string; readonly warnings: ReadonlyArray<string> }
  | { readonly ok: false; readonly problem: string };

const verifyCitation = async (
  project: string,
  at: Citation | undefined,
  where: string,
): Promise<{ readonly ok: true; readonly html: string } | { readonly ok: false; readonly problem: string }> => {
  if (at === undefined) return { ok: true, html: "" };
  const clean = at.path.trim().replace(/^\.\//, "");
  if (clean === "" || clean.startsWith("/") || clean.includes("..")) {
    return {
      ok: false,
      problem: `${where} cites "${at.path}", which must be a relative path inside the project`,
    };
  }
  const file = Bun.file(`${project}/${clean}`);
  if (!(await file.exists())) {
    return {
      ok: false,
      problem: `${where} cites "${clean}", which does not exist in ${project}`,
    };
  }
  const text = await file.text();
  const lines = text.split("\n");
  if (at.line !== undefined) {
    if (!Number.isInteger(at.line) || at.line < 1 || at.line > lines.length) {
      return {
        ok: false,
        problem: `${where} cites ${clean}:${at.line}, which is outside the file's 1-${lines.length} line range`,
      };
    }
  }
  if (at.symbol !== undefined && at.symbol.trim() !== "") {
    if (!text.includes(at.symbol.trim())) {
      return {
        ok: false,
        problem: `${where} cites symbol "${at.symbol.trim()}" in ${clean}, which was not found in that file`,
      };
    }
  }
  const linePart = at.line === undefined ? "" : `:${at.line}`;
  const symPart = at.symbol === undefined || at.symbol.trim() === "" ? "" : ` · ${at.symbol.trim()}`;
  return {
    ok: true,
    html: `<p><span class="citation-badge">${esc(clean)}${linePart}${esc(symPart)}</span></p>`,
  };
};

const renderKpiSection = (section: KpiSection, id: string): SectionOutcome => {
  if (section.items.length === 0) {
    return { ok: false, problem: `KPI section "${section.heading}" has no items` };
  }
  const cards = section.items
    .map((item) => {
      const tone = item.tone ?? "neutral";
      const delta =
        item.delta === undefined || item.delta.trim() === ""
          ? ""
          : `<span class="kpi-delta">${esc(item.delta)}</span>`;
      return `<div class="kpi-card" data-tone="${esc(tone)}">
<span class="kpi-label">${esc(item.label)}</span>
<span class="kpi-value">${esc(item.value)}</span>
${delta}
</div>`;
    })
    .join("\n");
  return {
    ok: true,
    html: `<section class="board-section" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
<div class="kpi-grid">${cards}</div>
</section>`,
    warnings: [],
  };
};

const renderHorizontalChart = (section: ChartSection, maxVal: number, unit: string): string => {
  const rowH = 34;
  const height = section.data.length * rowH + 24;
  const rows = section.data
    .map((datum, idx) => {
      const y = idx * rowH + 14;
      const w = Math.max(4, Math.round((Math.abs(datum.value) / maxVal) * 380));
      return `<g transform="translate(0,${y})"><text x="160" y="16" text-anchor="end" font-size="12" fill="var(--fg)">${esc(datum.label)}</text><rect x="172" y="2" width="${w}" height="20" rx="3" fill="var(--accent)"/><text x="${180 + w}" y="16" font-size="12" font-family="var(--mono)" fill="var(--muted)">${datum.value}${esc(unit)}</text></g>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 680 ${height}" role="img" aria-label="${esc(section.heading)}">${rows}</svg>`;
};

const renderLineChart = (section: ChartSection, maxVal: number, unit: string): string => {
  const plotW = 580;
  const plotH = 160;
  const pts = section.data.map((datum, idx) => ({
    x: Math.round(60 + idx * (plotW / Math.max(1, section.data.length - 1))),
    y: Math.round(30 + plotH - (datum.value / maxVal) * plotH),
    datum,
  }));
  const poly = pts.map((p) => `${p.x},${p.y}`).join(" ");
  const dots = pts
    .map(
      (p) =>
        `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent)"/><text x="${p.x}" y="${p.y - 10}" text-anchor="middle" font-size="11" font-family="var(--mono)" fill="var(--fg)">${p.datum.value}${esc(unit)}</text><text x="${p.x}" y="${30 + plotH + 22}" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(p.datum.label)}</text>`,
    )
    .join("\n");
  return `<svg viewBox="0 0 680 240" role="img" aria-label="${esc(section.heading)}"><line x1="50" y1="190" x2="640" y2="190" stroke="var(--border)"/><polyline fill="none" stroke="var(--accent)" stroke-width="2.5" points="${poly}"/>${dots}</svg>`;
};

const renderChartSvg = (section: ChartSection): string => {
  const maxVal = Math.max(1, ...section.data.map((d) => Math.abs(d.value)));
  const unit = section.unit === undefined ? "" : ` ${section.unit}`;
  if (section.chart === "horizontal-bar") return renderHorizontalChart(section, maxVal, unit);
  if (section.chart === "line") return renderLineChart(section, maxVal, unit);
  const plotW = 580;
  const plotH = 160;
  const step = plotW / Math.max(1, section.data.length);
  const barW = Math.max(14, Math.min(64, Math.round(step * 0.62)));
  const bars = section.data
    .map((datum, idx) => {
      const h = Math.max(4, Math.round((Math.abs(datum.value) / maxVal) * plotH));
      const x = Math.round(60 + idx * step + (step - barW) / 2);
      const y = 30 + plotH - h;
      const cx = x + Math.round(barW / 2);
      return `<rect x="${x}" y="${y}" width="${barW}" height="${h}" rx="3" fill="var(--accent)"/><text x="${cx}" y="${y - 6}" text-anchor="middle" font-size="11" font-family="var(--mono)" fill="var(--fg)">${datum.value}${esc(unit)}</text><text x="${cx}" y="210" text-anchor="middle" font-size="11" fill="var(--muted)">${esc(datum.label)}</text>`;
    })
    .join("\n");
  return `<svg viewBox="0 0 680 240" role="img" aria-label="${esc(section.heading)}"><line x1="50" y1="190" x2="640" y2="190" stroke="var(--border)"/>${bars}</svg>`;
};

const renderChartSection = (section: ChartSection, id: string): SectionOutcome => {
  if (section.data.length === 0) {
    return { ok: false, problem: `Chart section "${section.heading}" has no data points` };
  }
  const note =
    section.note === undefined || section.note.trim() === ""
      ? ""
      : `<figcaption>${esc(section.note)}</figcaption>`;
  return {
    ok: true,
    html: `<section class="board-section" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
<figure class="chart-figure">${renderChartSvg(section)}${note}</figure>
</section>`,
    warnings: [],
  };
};

const renderTableHtml = (
  heading: string,
  id: string,
  columns: ReadonlyArray<string>,
  rows: ReadonlyArray<ReadonlyArray<string>>,
  note?: string,
): string => {
  const ths = columns
    .map((col, idx) => `<th scope="col" data-col="${idx}" title="Sort by ${esc(col)}">${esc(col)}</th>`)
    .join("");
  const trs = rows
    .map(
      (row) =>
        `<tr>${columns.map((_, idx) => `<td>${esc(row[idx] ?? "")}</td>`).join("")}</tr>`,
    )
    .join("\n");
  const noteHtml = note === undefined || note.trim() === "" ? "" : `<p class="note">${esc(note)}</p>`;
  return `<section class="board-section" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(heading)}</h2>
${noteHtml}
<div class="data-table-wrap">
<table class="data-table" data-table>
<thead><tr>${ths}</tr></thead>
<tbody>
${trs}
</tbody>
</table>
</div>
</section>`;
};

const renderTableSection = (section: TableSection, id: string): SectionOutcome => {
  if (section.columns.length === 0) {
    return { ok: false, problem: `Table section "${section.heading}" has no columns` };
  }
  return {
    ok: true,
    html: renderTableHtml(section.heading, id, section.columns, section.rows, section.note),
    warnings: [],
  };
};

const renderDiagramSection = (section: DiagramSection, id: string): SectionOutcome => {
  const built = figure(section.mermaid, section.caption);
  if (!built.ok) {
    return {
      ok: false,
      problem: `Diagram section "${section.heading}" failed: ${built.problem}`,
    };
  }
  return {
    ok: true,
    html: `<section class="board-section" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
${built.value}
</section>`,
    warnings: [],
  };
};

const renderCodeSection = async (
  project: string,
  section: CodeSection,
  id: string,
): Promise<SectionOutcome> => {
  const cited = await verifyCitation(project, section.at, `Code section "${section.heading}"`);
  if (!cited.ok) return cited;
  const lang =
    section.language ?? (section.at !== undefined ? languageForPath(section.at.path) : "plain");
  const copyBtn = `<button type="button" class="code-copy" data-code-copy aria-label="Copy code">Copy</button>`;
  return {
    ok: true,
    html: `<section class="board-section" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
${cited.html}
<pre>${copyBtn}<code class="language-${esc(lang)}" data-language="${esc(lang)}">${highlightBlock(section.code, lang)}</code></pre>
</section>`,
    warnings: [],
  };
};

const renderCalloutSection = async (
  project: string,
  section: CalloutSection,
  id: string,
): Promise<SectionOutcome> => {
  const cited = await verifyCitation(project, section.at, `Callout section "${section.heading}"`);
  if (!cited.ok) return cited;
  const rendered = renderMarkdown(section.markdown);
  if (!rendered.ok) {
    return {
      ok: false,
      problem: `Callout section "${section.heading}" could not render Markdown: ${rendered.problem}`,
    };
  }
  const tone = section.tone ?? "info";
  return {
    ok: true,
    html: `<section class="board-section callout" id="${esc(id)}" data-tone="${esc(tone)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
${cited.html}
${rendered.value.html}
</section>`,
    warnings: rendered.value.warnings,
  };
};

const runRipwireXml = async (project: string, args: ReadonlyArray<string>): Promise<string | undefined> => {
  const bin = Bun.env.SPECTRE_RIPWIRE ?? Bun.which("ripwire");
  if (!bin) return undefined;
  try {
    const proc = Bun.spawn([bin, project, ...args, "--legend=compact"], {
      cwd: project,
      stdout: "pipe",
      stderr: "pipe",
      signal: AbortSignal.timeout(15_000),
    });
    const [stdout, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0 && code !== 2) return undefined;
    return stdout;
  } catch {
    return undefined;
  }
};

const attrOf = (tag: string, name: string): string =>
  new RegExp(`\\b${name}="([^"]*)"`).exec(tag)?.[1] ?? "";

const collectBrainEvidence = async (
  project: string,
  section: EvidenceSection,
  id: string,
): Promise<SectionOutcome> => {
  const loaded = await Effect.runPromise(brainLedger(AbsolutePath.make(project)).read());
  const limit = section.limit ?? 25;
  const rows = loaded.claims.slice(0, limit).map((claim) => [
    claim.kind,
    claim.claim,
    claim.subject.join(", "),
    claim.id.slice(0, 8),
  ]);
  const note =
    section.note ??
    `${loaded.claims.length} active claims and ${loaded.edges.length} live synapses in .spectre/brain`;
  return {
    ok: true,
    html: renderTableHtml(
      section.heading,
      id,
      ["Kind", "Claim", "Subjects", "ID"],
      rows,
      note,
    ),
    warnings: [],
  };
};

const collectGoalEvidence = async (
  project: string,
  section: EvidenceSection,
  id: string,
): Promise<SectionOutcome> => {
  const file = Bun.file(`${project}/.spectre/run.md`);
  const text = (await file.exists())
    ? await file.text()
    : "No `.spectre/run.md` ledger found in this worktree.";
  const rendered = renderMarkdown(text);
  if (!rendered.ok) return { ok: false, problem: rendered.problem };
  return {
    ok: true,
    html: `<section class="board-section callout" id="${esc(id)}">
<h2 id="${esc(id)}-h">${esc(section.heading)}</h2>
${rendered.value.html}
</section>`,
    warnings: rendered.value.warnings,
  };
};

const collectHotspotsEvidence = async (
  project: string,
  section: EvidenceSection,
  id: string,
  limit: number,
): Promise<SectionOutcome> => {
  const xml = await runRipwireXml(project, ["--hotspots", `--limit=${limit}`]);
  if (xml === undefined) {
    return { ok: false, problem: `Evidence section "${section.heading}" could not run ripwire --hotspots` };
  }
  const rows = [...xml.matchAll(/<f\b[^>]*>/g)].map((m) => [
    attrOf(m[0], "p"),
    attrOf(m[0], "churn"),
    attrOf(m[0], "ccx"),
    attrOf(m[0], "score"),
    attrOf(m[0], "top"),
  ]);
  return {
    ok: true,
    html: renderTableHtml(
      section.heading,
      id,
      ["File", "Churn", "Cognitive Cx", "Score", "Top Symbol"],
      rows,
      section.note ?? "Measured locally by ripwire --hotspots (churn × cognitive complexity)",
    ),
    warnings: [],
  };
};

const collectImpactEvidence = async (
  project: string,
  section: EvidenceSection,
  id: string,
  limit: number,
): Promise<SectionOutcome> => {
  const target = (section.target ?? "").trim();
  if (target === "") {
    return {
      ok: false,
      problem: `Evidence section "${section.heading}" uses source "ripwire-impact" and requires a symbol name in \`target\``,
    };
  }
  const xml = await runRipwireXml(project, [`--impact=${target}`, `--limit=${limit}`]);
  if (xml === undefined) {
    return {
      ok: false,
      problem: `Evidence section "${section.heading}" could not run ripwire --impact=${target}`,
    };
  }
  const rows = [...xml.matchAll(/<s\b[^>]*>/g)].map((m) => [
    attrOf(m[0], "n"),
    attrOf(m[0], "t"),
    attrOf(m[0], "p"),
    attrOf(m[0], "d") || "1",
  ]);
  return {
    ok: true,
    html: renderTableHtml(
      section.heading,
      id,
      ["Caller Symbol", "Kind", "Location", "Depth"],
      rows,
      section.note ?? `Transitive blast radius of ${target} measured by ripwire --impact`,
    ),
    warnings: [],
  };
};

const collectRipwireEvidence = async (
  project: string,
  section: EvidenceSection,
  id: string,
): Promise<SectionOutcome> => {
  const limit = Math.max(1, Math.min(50, section.limit ?? 10));
  if (section.source === "ripwire-hotspots") return collectHotspotsEvidence(project, section, id, limit);
  if (section.source === "ripwire-impact") return collectImpactEvidence(project, section, id, limit);
  const xml = await runRipwireXml(project, ["--quality-delta"]);
  if (xml === undefined) {
    return { ok: false, problem: `Evidence section "${section.heading}" could not run ripwire --quality-delta` };
  }
  const rows = [...xml.matchAll(/<r\b[^>]*>/g)].slice(0, limit).map((m) => [
    attrOf(m[0], "kind"),
    attrOf(m[0], "sym") || attrOf(m[0], "members"),
    attrOf(m[0], "was"),
    attrOf(m[0], "now"),
    attrOf(m[0], "origin"),
    attrOf(m[0], "p"),
  ]);
  return {
    ok: true,
    html: renderTableHtml(
      section.heading,
      id,
      ["Kind", "Symbol", "Was", "Now", "Origin", "Location"],
      rows,
      section.note ?? "Measured locally by ripwire --quality-delta",
    ),
    warnings: [],
  };
};

const renderSection = async (
  project: string,
  section: BoardSection,
  index: number,
): Promise<SectionOutcome> => {
  const id = section.id !== undefined && section.id.trim() !== "" ? section.id.trim() : slugOf(section.heading, index);
  switch (section.kind) {
    case "kpi":
      return renderKpiSection(section, id);
    case "chart":
      return renderChartSection(section, id);
    case "table":
      return renderTableSection(section, id);
    case "diagram":
      return renderDiagramSection(section, id);
    case "code":
      return renderCodeSection(project, section, id);
    case "callout":
      return renderCalloutSection(project, section, id);
    case "evidence":
      if (section.source === "brain") return collectBrainEvidence(project, section, id);
      if (section.source === "goal") return collectGoalEvidence(project, section, id);
      return collectRipwireEvidence(project, section, id);
    default: {
      const _exhaustive: never = section;
      return _exhaustive;
    }
  }
};

export const board = async (project: string, content: BoardContent): Promise<Composed> => {
  if (content.title.trim() === "") {
    return { ok: false, problem: "the board title must not be empty" };
  }
  if (content.sections.length === 0) {
    return { ok: false, problem: "the board must contain at least one section" };
  }

  const warnings: Array<string> = [];
  const blocks: Array<string> = [];

  if (content.summary !== undefined && content.summary.trim() !== "") {
    const rendered = renderMarkdown(content.summary);
    if (!rendered.ok) {
      return { ok: false, problem: `the board summary could not be rendered: ${rendered.problem}` };
    }
    blocks.push(`<section class="summary">${rendered.value.html}</section>`);
    warnings.push(...rendered.value.warnings);
  }

  for (const [index, section] of content.sections.entries()) {
    const built = await renderSection(project, section, index);
    if (!built.ok) return built;
    blocks.push(built.html);
    warnings.push(...built.warnings);
  }

  const body = blocks.join("\n");
  const html = pageDocument({ title: content.title, body, toc: headings(body) });
  const files: Readonly<Record<string, string>> = { "index.html": html };

  const external = externalLoads(html, files);
  if (external.length > 0) {
    return {
      ok: false,
      problem: `the generated board page loads an external asset: ${external.map((one) => one.target).join(", ")}`,
    };
  }
  const unsafe = unsafeLinks(html);
  if (unsafe.length > 0) {
    return { ok: false, problem: `the generated board page has an unsafe link: ${unsafe.join(", ")}` };
  }
  const dead = deadAnchors(html);
  if (dead.length > 0) {
    return {
      ok: false,
      problem: `the generated board page has a dead in-page anchor: ${dead.map((one) => `#${one}`).join(", ")}`,
    };
  }

  return {
    ok: true,
    title: content.title,
    files,
    warnings: [
      ...warnings,
      ...outboundLinks(html).map((link) => `outbound link stays a dependency: ${link}`),
    ],
  };
};
