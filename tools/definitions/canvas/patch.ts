import { Schema } from "effect";
import { Content, type Content as ContentType, type PatchOp } from "./content";

export const CANVAS_STATE_FILE = ".spectre-canvas.json";

export type PatchResult =
  | { readonly ok: true; readonly content: ContentType }
  | { readonly ok: false; readonly problem: string };

export const encodeCanvasState = (content: ContentType): string =>
  `${JSON.stringify(content, null, 2)}\n`;

export const decodeCanvasState = (
  files: Readonly<Record<string, string>>,
): PatchResult => {
  const rawText = files[CANVAS_STATE_FILE];
  if (rawText === undefined) {
    return {
      ok: false,
      problem: `artifact has no ${CANVAS_STATE_FILE} state file; re-publish with \`update\` once before using \`patch\``,
    };
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, problem: `${CANVAS_STATE_FILE} is not valid JSON` };
  }
  const decoded = Schema.decodeUnknownOption(Content)(parsed);
  if (decoded._tag === "None") {
    return { ok: false, problem: `${CANVAS_STATE_FILE} does not match the Canvas Content schema` };
  }
  return { ok: true, content: decoded.value };
};

const replaceMarkdownSection = (
  source: string,
  targetHeading: string,
  replacementBody: string,
): { readonly ok: true; readonly markdown: string } | { readonly ok: false; readonly problem: string } => {
  const normalizedTarget = targetHeading.trim().replace(/^#+\s*/, "").toLowerCase();
  const lines = source.split("\n");
  let startLine = -1;
  let targetLevel = 0;

  for (let idx = 0; idx < lines.length; idx += 1) {
    const line = lines[idx] ?? "";
    const match = /^(#{1,6})\s+(.*)$/.exec(line);
    if (match === null) continue;
    const level = (match[1] ?? "").length;
    const text = (match[2] ?? "").trim().toLowerCase();
    if (startLine === -1) {
      if (text === normalizedTarget) {
        startLine = idx;
        targetLevel = level;
      }
      continue;
    }
    if (level <= targetLevel) {
      const before = lines.slice(0, startLine + 1);
      const after = lines.slice(idx);
      const body = replacementBody.trim();
      return {
        ok: true,
        markdown: [...before, "", body, "", ...after].join("\n"),
      };
    }
  }

  if (startLine === -1) {
    return {
      ok: false,
      problem: `heading "${targetHeading}" was not found in the report markdown`,
    };
  }
  const before = lines.slice(0, startLine + 1);
  return {
    ok: true,
    markdown: [...before, "", replacementBody.trim(), ""].join("\n"),
  };
};

const applyTitleOp = (current: ContentType, title: string): PatchResult => {
  if (title.trim() === "") return { ok: false, problem: "set-title requires a non-empty title" };
  if (current.kind === "pr" || current.kind === "brain") {
    return {
      ok: false,
      problem: `a "${current.kind}" canvas derives its title automatically and cannot be renamed with set-title`,
    };
  }
  return { ok: true, content: { ...current, title } };
};

const applySummaryOp = (current: ContentType, summary: string): PatchResult => {
  if (current.kind === "pr") {
    return { ok: true, content: { ...current, review: { ...current.review, summary } } };
  }
  if (current.kind === "board") {
    return { ok: true, content: { ...current, summary } };
  }
  return { ok: false, problem: `set-summary applies to "pr" or "board" canvases, not "${current.kind}"` };
};

const applyMarkdownOp = (
  current: ContentType,
  op: Extract<PatchOp, { op: "replace-section" | "append-markdown" }>,
): PatchResult => {
  if (current.kind !== "report") {
    return { ok: false, problem: `${op.op} applies to "report" canvases, not "${current.kind}"` };
  }
  if (op.op === "append-markdown") {
    const next = `${current.markdown.trimEnd()}\n\n${op.markdown.trim()}\n`;
    return { ok: true, content: { ...current, markdown: next } };
  }
  const replaced = replaceMarkdownSection(current.markdown, op.heading, op.markdown);
  if (!replaced.ok) return replaced;
  return { ok: true, content: { ...current, markdown: replaced.markdown } };
};

const applyDiagramOp = (
  current: ContentType,
  op: Extract<PatchOp, { op: "set-diagram" }>,
): PatchResult => {
  if (current.kind !== "diagram") {
    return { ok: false, problem: `set-diagram applies to "diagram" canvases, not "${current.kind}"` };
  }
  return {
    ok: true,
    content: {
      ...current,
      mermaid: op.mermaid,
      takeaway: op.takeaway ?? current.takeaway,
      ...(op.caption !== undefined ? { caption: op.caption } : {}),
    },
  };
};

const upsertPrPoint = (
  current: Extract<ContentType, { kind: "pr" }>,
  op: Extract<PatchOp, { op: "upsert-point" }>,
): PatchResult => {
  const points = [...current.review.points];
  if (op.index === undefined) {
    points.push(op.point);
    return { ok: true, content: { ...current, review: { ...current.review, points } } };
  }
  const idx = op.index - 1;
  if (!Number.isInteger(op.index) || idx < 0 || idx > points.length) {
    return { ok: false, problem: `upsert-point index ${op.index} is out of range (1..${points.length + 1})` };
  }
  if (idx === points.length) points.push(op.point);
  else points[idx] = op.point;
  return { ok: true, content: { ...current, review: { ...current.review, points } } };
};

const applyPrOp = (
  current: ContentType,
  op: Extract<PatchOp, { op: "upsert-point" | "remove-point" | "upsert-group" }>,
): PatchResult => {
  if (current.kind !== "pr") {
    return { ok: false, problem: `${op.op} applies to "pr" canvases, not "${current.kind}"` };
  }
  if (op.op === "upsert-point") return upsertPrPoint(current, op);
  if (op.op === "remove-point") {
    const idx = op.index - 1;
    if (!Number.isInteger(op.index) || idx < 0 || idx >= current.review.points.length) {
      return { ok: false, problem: `remove-point index ${op.index} is out of range (1..${current.review.points.length})` };
    }
    const points = current.review.points.filter((_, i) => i !== idx);
    return { ok: true, content: { ...current, review: { ...current.review, points } } };
  }
  const groups = [...current.review.groups];
  const existing = groups.findIndex((g) => g.heading === op.group.heading);
  if (existing === -1) groups.push(op.group);
  else groups[existing] = op.group;
  return { ok: true, content: { ...current, review: { ...current.review, groups } } };
};

const applyBoardOp = (
  current: ContentType,
  op: Extract<PatchOp, { op: "upsert-board-section" | "remove-board-section" }>,
): PatchResult => {
  if (current.kind !== "board") {
    return { ok: false, problem: `${op.op} applies to "board" canvases, not "${current.kind}"` };
  }
  if (op.op === "upsert-board-section") {
    const sections = [...current.sections];
    const matchIndex = sections.findIndex(
      (s) =>
        (op.section.id !== undefined && s.id === op.section.id) ||
        s.heading.toLowerCase() === op.section.heading.toLowerCase(),
    );
    if (matchIndex === -1) sections.push(op.section);
    else sections[matchIndex] = op.section;
    return { ok: true, content: { ...current, sections } };
  }
  const target = op.target.trim().toLowerCase();
  const next = current.sections.filter(
    (s) => (s.id ?? "").toLowerCase() !== target && s.heading.toLowerCase() !== target,
  );
  if (next.length === current.sections.length) {
    return { ok: false, problem: `board section "${op.target}" was not found` };
  }
  if (next.length === 0) {
    return { ok: false, problem: "removing that section would leave the board empty" };
  }
  return { ok: true, content: { ...current, sections: next } };
};

const applyOne = (current: ContentType, op: PatchOp): PatchResult => {
  switch (op.op) {
    case "set-title":
      return applyTitleOp(current, op.title);
    case "set-summary":
      return applySummaryOp(current, op.summary);
    case "replace-section":
    case "append-markdown":
      return applyMarkdownOp(current, op);
    case "set-diagram":
      return applyDiagramOp(current, op);
    case "upsert-point":
    case "remove-point":
    case "upsert-group":
      return applyPrOp(current, op);
    case "upsert-board-section":
    case "remove-board-section":
      return applyBoardOp(current, op);
    default: {
      const _exhaustive: never = op;
      return _exhaustive;
    }
  }
};

export const applyPatchOps = (
  initial: ContentType,
  ops: ReadonlyArray<PatchOp>,
): PatchResult => {
  if (ops.length === 0) {
    return { ok: false, problem: "patch requires at least one operation in `ops`" };
  }
  let current = initial;
  for (const op of ops) {
    const next = applyOne(current, op);
    if (!next.ok) return next;
    current = next.content;
  }
  return { ok: true, content: current };
};
