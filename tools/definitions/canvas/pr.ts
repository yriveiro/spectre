import { basename } from "node:path";
import { deadAnchors, externalLoads, outboundLinks, unsafeLinks } from "./check";
import type { Composed, Group, Point, Review } from "./content";
import type { Evidence } from "./evidence";
import { render as renderMarkdown } from "./markdown";
import type { DiffRow, ParsedFile, ReadFile, RemovedRow } from "./parse";
import { document as pageDocument } from "./shell";

/**
 * The PR composer. It validates every path and line in the review against the
 * parsed evidence, then renders the page. The model supplies the story; this
 * module supplies the diff and the checks.
 *
 * The validation order is the brief's order, because the first refusal is the
 * one the model reads: a group path, then a duplicate, then a point's path, its
 * readability, its line, and finally a requirement's source. Warnings follow:
 * an ungrouped path, a count mismatch, and a head that moved.
 */

type Placement = {
  readonly ordinal: number;
  readonly point: Point;
};

type ResolvedGroup = {
  readonly group: Group;
  readonly paths: ReadonlyArray<{ readonly path: string; readonly file: ParsedFile }>;
};

type ResolvedPoint = {
  readonly point: Point;
  readonly ordinal: number;
  readonly file: ParsedFile;
};

type Validated = {
  readonly groups: ReadonlyArray<ResolvedGroup>;
  readonly ungrouped: ReadonlyArray<{ readonly path: string; readonly file: ParsedFile }>;
  readonly points: ReadonlyArray<ResolvedPoint>;
  readonly warnings: ReadonlyArray<string>;
};

type Validation =
  | { readonly ok: true; readonly value: Validated }
  | { readonly ok: false; readonly problem: string };

type Cell = {
  readonly line: number;
  readonly text: string;
  readonly marker: "-" | "+" | " ";
};

type Pair = {
  readonly base?: Cell;
  readonly head?: Cell;
};

type Line =
  | { readonly kind: "hunk"; readonly header: string }
  | { readonly kind: "pair"; readonly pair: Pair };

const esc = (text: string): string => Bun.escapeHTML(text);

const quote = (value: string): string => `"${value}"`;

const basenameHint = (path: string, paths: ReadonlyArray<string>): string => {
  const near = paths.filter((one) => basename(one) === basename(path)).slice(0, 3);
  return near.length === 0
    ? ""
    : `; inventory paths with the same basename: ${near.map(quote).join(", ")}`;
};

const unknownPath = (where: string, path: string, paths: ReadonlyArray<string>): string =>
  `${where} names ${quote(path)}, which is not in the diff${basenameHint(path, paths)}`;

type SideLines = {
  readonly numbers: ReadonlySet<number>;
  readonly ranges: string;
  readonly count: number;
};

/** `1-3, 10-12`: the lines the file actually has, not the span between its ends. */
const rangesOf = (numbers: ReadonlyArray<number>): string => {
  const sorted = [...new Set(numbers)].toSorted((a, b) => a - b);
  const ranges: Array<string> = [];
  let start: number | undefined;
  let end: number | undefined;
  for (const line of sorted) {
    if (start === undefined || end === undefined) {
      start = line;
      end = line;
      continue;
    }
    if (line === end + 1) {
      end = line;
      continue;
    }
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
    start = line;
    end = line;
  }
  if (start !== undefined && end !== undefined)
    ranges.push(start === end ? `${start}` : `${start}-${end}`);
  return ranges.join(", ");
};

const sideLines = (file: ReadFile, side: "base" | "head"): SideLines => {
  const numbers: Array<number> = [];
  for (const row of file.rows) {
    if (side === "base") {
      if (row.kind === "context") numbers.push(row.old);
      else if (row.kind === "removed") numbers.push(row.old);
    } else {
      if (row.kind === "context") numbers.push(row.new);
      else if (row.kind === "added") numbers.push(row.new);
    }
  }
  return { numbers: new Set(numbers), ranges: rangesOf(numbers), count: numbers.length };
};

const rangeOf = (file: ReadFile, side: "base" | "head"): string => {
  const lines = sideLines(file, side);
  if (lines.count === 0)
    return `that file has no ${side}-side lines (${side === "base" ? "it was added" : "it was removed"})`;
  if (lines.count === 1) return `that file's ${side} side covers only line ${lines.ranges}`;
  return `that file's ${side} side covers lines ${lines.ranges}`;
};

const validate = (evidence: Evidence, review: Review): Validation => {
  const byPath = new Map<string, ParsedFile>();
  for (const file of evidence.files) if (!byPath.has(file.path)) byPath.set(file.path, file);
  const paths = [...byPath.keys()];

  const groups: Array<ResolvedGroup> = [];
  for (const group of review.groups) {
    const entries: Array<{ path: string; file: ParsedFile }> = [];
    for (const path of group.paths) {
      const file = byPath.get(path);
      if (file === undefined)
        return { ok: false, problem: unknownPath(`group ${quote(group.heading)}`, path, paths) };
      entries.push({ path, file });
    }
    groups.push({ group, paths: entries });
  }

  const owner = new Map<string, string>();
  for (const group of groups) {
    for (const entry of group.paths) {
      const first = owner.get(entry.path);
      if (first !== undefined)
        return {
          ok: false,
          problem:
            first === group.group.heading
              ? `${quote(entry.path)} is listed twice in group ${quote(first)}`
              : `${quote(entry.path)} is listed in two groups: ${quote(first)} and ${quote(group.group.heading)}`,
        };
      owner.set(entry.path, group.group.heading);
    }
  }

  const points: Array<ResolvedPoint> = [];
  for (const [index, point] of review.points.entries()) {
    const ordinal = index + 1;
    const file = byPath.get(point.at.path);
    if (file === undefined)
      return { ok: false, problem: unknownPath(`point ${ordinal}`, point.at.path, paths) };
    if (file.status === "unreadable")
      return {
        ok: false,
        problem: `point ${ordinal} cites ${quote(point.at.path)}, which could not be read: ${file.reason}`,
      };
    if (!Number.isInteger(point.at.line))
      return {
        ok: false,
        problem: `point ${ordinal} cites ${point.at.line}, which is not a line number`,
      };
    const lines = sideLines(file, point.at.side);
    if (!lines.numbers.has(point.at.line))
      return {
        ok: false,
        problem: `point ${ordinal} cites line ${point.at.line} on the ${point.at.side} side of ${quote(point.at.path)}, but ${rangeOf(file, point.at.side)}`,
      };
    if (point.kind === "requirement" && point.source.trim() === "")
      return {
        ok: false,
        problem: `requirement ${ordinal} has a blank source; a requirement must name where it came from`,
      };
    points.push({ point, ordinal, file });
  }

  const grouped = new Set(groups.flatMap((group) => group.paths.map((entry) => entry.path)));
  const ungrouped = [...byPath.entries()]
    .filter(([path]) => !grouped.has(path))
    .map(([path, file]) => ({ path, file }));

  const warnings: Array<string> = [];
  if (ungrouped.length === 1)
    warnings.push("1 changed path is in no group; the page lists it under Not grouped");
  else if (ungrouped.length > 1)
    warnings.push(
      `${ungrouped.length} changed paths are in no group; the page lists them under Not grouped`,
    );
  if (evidence.cross.kind === "mismatched")
    warnings.push(
      "the parsed counts disagree with the reported counts; the Limits section prints both",
    );
  warnings.push(...evidence.problems);

  return { ok: true, value: { groups, ungrouped, points, warnings } };
};

const cellsOf = (rows: ReadonlyArray<DiffRow>): ReadonlyArray<Line> => {
  const out: Array<Line> = [];
  let removed: Array<RemovedRow> = [];
  const flush = (): void => {
    for (const row of removed)
      out.push({
        kind: "pair",
        pair: { base: { line: row.old, text: row.text, marker: "-" } },
      });
    removed = [];
  };

  for (const row of rows) {
    if (row.kind === "hunk") {
      flush();
      out.push({ kind: "hunk", header: row.header });
      continue;
    }
    if (row.kind === "removed") {
      removed.push(row);
      continue;
    }
    if (row.kind === "added") {
      const left = removed.shift();
      out.push({
        kind: "pair",
        pair: {
          ...(left === undefined ? {} : { base: { line: left.old, text: left.text, marker: "-" } }),
          head: { line: row.new, text: row.text, marker: "+" },
        },
      });
      continue;
    }
    flush();
    out.push({
      kind: "pair",
      pair: {
        base: { line: row.old, text: row.text, marker: " " },
        head: { line: row.new, text: row.text, marker: " " },
      },
    });
  }
  flush();
  return out;
};

const rowClass = (pair: Pair): string => {
  if (pair.base !== undefined && pair.head !== undefined)
    return pair.base.marker === "-" ? "paired" : "context";
  return pair.base !== undefined ? "left" : "right";
};

const cellHtml = (value: Cell | undefined): string => {
  if (value === undefined) return '<td class="ln"></td><td class="code"></td>';
  const kind = value.marker === "-" ? "removed" : value.marker === "+" ? "added" : "context";
  return `<td class="ln">${value.line}</td><td class="code ${kind}"><span class="marker">${value.marker}</span>${esc(value.text)}</td>`;
};

const KIND_LABEL: Record<Point["kind"], string> = {
  requirement: "Requirement",
  change: "Change",
  question: "Question",
};

const annotationHtml = ({ ordinal, point }: Placement): string => {
  const label = KIND_LABEL[point.kind];
  const source =
    point.kind === "requirement" ? `<p class="source">Source: ${esc(point.source)}</p>` : "";
  const note =
    point.note === undefined || point.note.trim() === ""
      ? ""
      : `<p class="note">${esc(point.note)}</p>`;
  return `<tr class="annotation" id="p-${ordinal}"><td colspan="4"><p class="point point-${point.kind}"><span class="badge">${label}</span> ${esc(point.text)}</p>${source}${note}</td></tr>`;
};

const placementsFor = (
  points: ReadonlyArray<ResolvedPoint>,
): Map<number, Map<string, Array<Placement>>> => {
  const byFile = new Map<number, Map<string, Array<Placement>>>();
  for (const resolved of points) {
    const key = `${resolved.point.at.side}:${resolved.point.at.line}`;
    const forFile = byFile.get(resolved.file.index) ?? new Map<string, Array<Placement>>();
    const list = forFile.get(key) ?? [];
    list.push({ ordinal: resolved.ordinal, point: resolved.point });
    forFile.set(key, list);
    byFile.set(resolved.file.index, forFile);
  }
  return byFile;
};

const annotationsAt = (
  placements: Map<number, Map<string, Array<Placement>>>,
  file: ReadFile,
  side: "base" | "head",
  line: number | undefined,
): ReadonlyArray<Placement> => {
  if (line === undefined) return [];
  return placements.get(file.index)?.get(`${side}:${line}`) ?? [];
};

const fileSection = (
  file: ReadFile,
  placements: Map<number, Map<string, Array<Placement>>>,
): string => {
  const rows = cellsOf(file.rows).map((line) => {
    if (line.kind === "hunk")
      return `<tr class="hunk"><td colspan="4"><code>${esc(line.header)}</code></td></tr>`;
    const notes = [
      ...annotationsAt(placements, file, "base", line.pair.base?.line),
      ...annotationsAt(placements, file, "head", line.pair.head?.line),
    ];
    return [
      `<tr class="row ${rowClass(line.pair)}">${cellHtml(line.pair.base)}${cellHtml(line.pair.head)}</tr>`,
      ...notes.map(annotationHtml),
    ].join("\n");
  });

  return `<section class="file" id="f-${file.index}">
<h3>${esc(file.path)} <span class="badge">+${file.additions} -${file.deletions}</span></h3>
<div class="diff-scroll">
<table class="diff">
<thead><tr><th colspan="2">Base</th><th colspan="2">Head</th></tr></thead>
<tbody>
${rows.join("\n")}
</tbody>
</table>
</div>
</section>`;
};

const unreadableSection = (file: Extract<ParsedFile, { status: "unreadable" }>): string =>
  `<section class="file" id="f-${file.index}">
<h3>${esc(file.path)}</h3>
<p class="unreadable">Not rendered: ${esc(file.reason)}</p>
</section>`;

const navigator = (files: ReadonlyArray<ParsedFile>): string =>
  `<nav class="file-nav" aria-label="Changed files">
<h2 id="files">Files</h2>
<ol>
${files
  .map((file) =>
    file.status === "read"
      ? `<li><a href="#f-${file.index}">${esc(file.path)}</a> <span class="counts">+${file.additions} -${file.deletions}</span></li>`
      : `<li><a href="#f-${file.index}">${esc(file.path)}</a> <span class="reason">${esc(file.reason)}</span></li>`,
  )
  .join("\n")}
</ol>
</nav>`;

const KIND_TITLE: Record<Point["kind"], string> = {
  requirement: "Requirements",
  change: "Changes",
  question: "Questions",
};

const reviewPath = (points: ReadonlyArray<ResolvedPoint>): string => {
  const sections = (["requirement", "change", "question"] as const)
    .map((kind) => {
      const entries = points.filter((one) => one.point.kind === kind);
      if (entries.length === 0) return "";
      const items = entries
        .map(({ point, ordinal }) => {
          const source =
            point.kind === "requirement"
              ? `<p class="source">Source: ${esc(point.source)}</p>`
              : "";
          const note =
            point.note === undefined || point.note.trim() === ""
              ? ""
              : `<p class="note">${esc(point.note)}</p>`;
          return `<li class="point point-${point.kind}">
<p>${esc(point.text)}</p>
${source}${note}
<p class="at"><a href="#p-${ordinal}">${esc(point.at.path)}:${point.at.line} (${point.at.side})</a></p>
</li>`;
        })
        .join("\n");
      return `<h3>${KIND_TITLE[kind]}</h3>
<ol class="points">
${items}
</ol>`;
    })
    .filter((one) => one !== "")
    .join("\n");

  if (sections === "") return "";
  return `<section class="review-path">
<h2 id="review">Review path</h2>
${sections}
</section>`;
};

const changeMap = (validated: Validated): string => {
  const blocks = validated.groups.map(({ group, paths }) => {
    const items = paths
      .map(({ path, file }) => `<li><a href="#f-${file.index}">${esc(path)}</a></li>`)
      .join("\n");
    const note =
      group.note === undefined || group.note.trim() === ""
        ? ""
        : `<p class="note">${esc(group.note)}</p>`;
    return `<div class="group">
<h3>${esc(group.heading)}</h3>
${note}
<ul>
${items}
</ul>
</div>`;
  });

  if (validated.ungrouped.length > 0) {
    const items = validated.ungrouped
      .map(({ path, file }) => `<li><a href="#f-${file.index}">${esc(path)}</a></li>`)
      .join("\n");
    blocks.push(`<div class="group group-ungrouped">
<h3>Not grouped</h3>
<p class="note">These changed paths are in no review group; the navigator and the diff still render every one.</p>
<ul>
${items}
</ul>
</div>`);
  }

  if (blocks.length === 0) return "";
  return `<section class="change-map">
<h2 id="change-map">Change map</h2>
${blocks.join("\n")}
</section>`;
};

const crossVerdict = (evidence: Evidence): string => {
  const cross = evidence.cross;
  switch (cross.kind) {
    case "matched":
      return `parsed counts agree with gh (${cross.parsed.files} files, +${cross.parsed.additions}, -${cross.parsed.deletions})`;
    case "mismatched":
      return "parsed counts disagree with gh; see Limits";
    case "no-oracle":
      return "no oracle: this is a local diff, so the counts are the parser's own";
    default: {
      const _exhaustive: never = cross;
      return _exhaustive;
    }
  }
};

const metadata = (evidence: Evidence): string => {
  const subject = evidence.subject;
  const cross = evidence.cross;

  switch (subject.kind) {
    case "pull-request": {
      const size = `${subject.changedFiles} files, +${subject.additions}, -${subject.deletions} (reported by gh)`;
      return `<section class="metadata">
<h2 id="metadata">Metadata</h2>
<dl class="meta">
<div><dt>Pull request</dt><dd>#${subject.number} · ${esc(subject.repository)}</dd></div>
<div><dt>URL</dt><dd><code>${esc(subject.url)}</code></dd></div>
<div><dt>Author</dt><dd>${esc(subject.author)}</dd></div>
<div><dt>State</dt><dd>${subject.state}${subject.isDraft ? " (draft)" : ""}</dd></div>
<div><dt>Base</dt><dd><code>${esc(subject.baseRef)}</code></dd></div>
<div><dt>Head</dt><dd><code>${esc(subject.headRef)}</code></dd></div>
<div><dt>Analysed commit</dt><dd><code>${esc(subject.headSha)}</code></dd></div>
<div><dt>Change size</dt><dd>${size}</dd></div>
<div><dt>Count check</dt><dd>${crossVerdict(evidence)}</dd></div>
</dl>
</section>`;
    }
    case "local-diff": {
      const size = `${cross.parsed.files} files, +${cross.parsed.additions}, -${cross.parsed.deletions} (parsed from the local diff)`;
      return `<section class="metadata">
<h2 id="metadata">Metadata</h2>
<dl class="meta">
<div><dt>Local diff</dt><dd><code>${esc(subject.base)}...${esc(subject.head)}</code></dd></div>
<div><dt>Analysed commit</dt><dd><code>${esc(subject.headSha)}</code></dd></div>
<div><dt>Change size</dt><dd>${size}</dd></div>
<div><dt>Count check</dt><dd>${crossVerdict(evidence)}</dd></div>
</dl>
</section>`;
    }
    default: {
      const _exhaustive: never = subject;
      return _exhaustive;
    }
  }
};

const limits = (evidence: Evidence, validated: Validated, review: Review): string => {
  const readable = evidence.files.filter((file) => file.status === "read").length;
  const unreadable = evidence.files.length - readable;
  const items: Array<string> = [
    `Rendered all ${evidence.files.length} changed paths: ${readable} row by row and ${unreadable} by reason. No path is omitted or truncated.`,
    `Rendered paths: ${evidence.files.map((file) => `<code>${esc(file.path)}</code>`).join(", ")}.`,
  ];

  for (const unknown of review.unknowns ?? [])
    items.push(`<strong>Unknown.</strong> ${esc(unknown)}`);

  if (evidence.cross.kind === "mismatched") {
    const cross = evidence.cross;
    items.push(
      `<strong>Counts disagree.</strong> The parser read ${cross.parsed.files} files, +${cross.parsed.additions}, -${cross.parsed.deletions}; gh reported ${cross.reported.files} files, +${cross.reported.additions}, -${cross.reported.deletions}. ${esc(cross.why)}`,
    );
  }
  if (evidence.cross.kind === "no-oracle")
    items.push("This is a local diff, so there is no reported count to check the parser against.");

  for (const problem of evidence.problems) items.push(esc(problem));

  if (validated.ungrouped.length > 0)
    items.push(
      `In no group: ${validated.ungrouped.map(({ path }) => `<code>${esc(path)}</code>`).join(", ")}. They appear under Not grouped, in the navigator, and in the diff.`,
    );

  return `<section class="limits callout">
<h2 id="limits">Limits</h2>
<ul>
${items.map((item) => `<li>${item}</li>`).join("\n")}
</ul>
</section>`;
};

const titleOfSubject = (evidence: Evidence): string => {
  const subject = evidence.subject;
  switch (subject.kind) {
    case "pull-request":
      return `PR #${subject.number} · ${subject.title}`;
    case "local-diff":
      return `Local diff ${subject.base}...${subject.head}`;
    default: {
      const _exhaustive: never = subject;
      return _exhaustive;
    }
  }
};

export const pr = (evidence: Evidence, review: Review): Composed => {
  const validated = validate(evidence, review);
  if (!validated.ok) return validated;

  const summary = renderMarkdown(review.summary);
  if (!summary.ok)
    return { ok: false, problem: `the review summary could not be rendered: ${summary.problem}` };

  const placements = placementsFor(validated.value.points);
  const sections: Array<string> = [];
  for (const file of evidence.files) {
    sections.push(file.status === "read" ? fileSection(file, placements) : unreadableSection(file));
  }

  const body = [
    metadata(evidence),
    `<section class="summary">
<h2 id="summary">Summary</h2>
${summary.value.html}
</section>`,
    reviewPath(validated.value.points),
    changeMap(validated.value),
    navigator(evidence.files),
    `<section class="diff">
<h2 id="diff">Diff</h2>
${sections.join("\n")}
</section>`,
    limits(evidence, validated.value, review),
  ]
    .filter((one) => one !== "")
    .join("\n");

  const title = titleOfSubject(evidence);
  const html = pageDocument({ title, body });

  const missing = validated.value.points.filter((one) => !html.includes(`id="p-${one.ordinal}"`));
  if (missing.length > 0)
    return {
      ok: false,
      problem: `the page did not render point ${missing[0]?.ordinal ?? "?"}; this is a composer bug, not a review problem`,
    };

  const files: Readonly<Record<string, string>> = { "index.html": html };
  const external = externalLoads(html, files);
  if (external.length > 0)
    return {
      ok: false,
      problem: `the generated PR page loads an external asset: ${external.map((one) => one.target).join(", ")}`,
    };
  const unsafe = unsafeLinks(html);
  if (unsafe.length > 0)
    return { ok: false, problem: `the generated PR page has an unsafe link: ${unsafe.join(", ")}` };
  const dead = deadAnchors(html);
  if (dead.length > 0)
    return {
      ok: false,
      problem: `the generated PR page has a dead in-page anchor: ${dead.map((one) => `#${one}`).join(", ")}`,
    };

  return {
    ok: true,
    title,
    files,
    warnings: [
      ...validated.value.warnings,
      ...summary.value.warnings,
      ...outboundLinks(html).map((link) => `outbound link stays a dependency: ${link}`),
    ],
  };
};
