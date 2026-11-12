import { PeleError, render as renderPele } from "pele";

/**
 * Markdown in, escaped prose plus static SVG out. The one path a model-authored
 * report reaches the page through: raw HTML is escaped by the renderer, a
 * `mermaid` fence becomes a Pele figure, and a placeholder that survives the
 * renderer is a refusal rather than a guess.
 */

export type Heading = {
  readonly id: string;
  readonly text: string;
  readonly level: 2 | 3;
};

export type Rendered = {
  readonly html: string;
  readonly warnings: ReadonlyArray<string>;
};

export type RenderResult =
  | { readonly ok: true; readonly value: Rendered }
  | { readonly ok: false; readonly problem: string };

export type FigureResult =
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: string; readonly line?: number };

type Block = {
  readonly token: string;
  readonly source: string;
  readonly start: number;
  readonly caption?: string;
};

const NONCE = (): string => Bun.randomUUIDv7().replaceAll("-", "").slice(0, 12);

const FENCE = /^(`{3,}|~{3,})(.*)$/;

const isClose = (line: string, marker: string): boolean => {
  const char = marker.charAt(0);
  const trimmed = line.trim();
  if (trimmed.length < marker.length) return false;
  for (const one of trimmed) if (one !== char) return false;
  return true;
};

const infoOf = (rest: string): { readonly name: string; readonly caption?: string } => {
  const trimmed = rest.trim();
  if (trimmed === "") return { name: "" };
  const name = trimmed.split(/\s+/)[0] ?? "";
  const caption = trimmed.slice(name.length).trim();
  return caption === "" ? { name } : { name, caption };
};

const figureHtml = (svg: string, caption: string | undefined): string => {
  const cap =
    caption === undefined || caption.trim() === ""
      ? ""
      : `<figcaption>${Bun.escapeHTML(caption.trim())}</figcaption>`;
  return `<figure class="diagram">${svg}${cap}</figure>`;
};

const peleProblem = (cause: unknown): { readonly problem: string; readonly line?: number } => {
  if (cause instanceof PeleError) {
    return {
      problem: cause.message,
      ...(Number.isFinite(cause.line) && cause.line > 0 ? { line: cause.line } : {}),
    };
  }
  return { problem: cause instanceof Error ? cause.message : String(cause) };
};

/**
 * One Mermaid source to a figure. Exported because `diagram` is the same render
 * with one block and no surrounding prose, and because a refusal this module
 * returns must carry Pele's own message rather than a summarized one.
 */
export const figure = (source: string, caption?: string): FigureResult => {
  try {
    const rendered = renderPele(source);
    return { ok: true, value: figureHtml(rendered.svg, caption) };
  } catch (cause) {
    return { ok: false, ...peleProblem(cause) };
  }
};

/**
 * Replace each placeholder paragraph with its figure, then prove none survived.
 * The proof is the check that can fail: it runs against the renderer's actual
 * output, so a Bun upgrade that stops wrapping a token in `<p>` refuses here
 * instead of shipping a page with a visible placeholder.
 */
export const placeFigures = (
  html: string,
  figures: ReadonlyArray<{ readonly token: string; readonly html: string }>,
):
  | { readonly ok: true; readonly value: string }
  | { readonly ok: false; readonly problem: string } => {
  let out = html;
  for (const one of figures) {
    const marker = `<p>${one.token}</p>`;
    if (!out.includes(marker))
      return {
        ok: false,
        problem: `the Markdown renderer did not leave ${one.token} as its own paragraph; the token shape is unreadable`,
      };
    out = out.replace(marker, () => one.html);
  }
  const survived = figures.find((one) => out.includes(one.token));
  if (survived !== undefined)
    return {
      ok: false,
      problem: `the Markdown renderer left a placeholder behind: ${survived.token}`,
    };
  return { ok: true, value: out };
};

/**
 * Scan and render. A fence is recognized at column zero only, and the whole
 * fenced region is replaced before the Markdown renderer sees it, so a Mermaid
 * body is never treated as prose. Every other fence is copied through untouched;
 * that is what keeps a `mermaid` line inside a `js` block from opening a block.
 */
export const render = (source: string): RenderResult => {
  const nonce = NONCE();
  const lines = source.split("\n");
  const prose: Array<string> = [];
  const blocks: Array<Block> = [];

  let at = 0;
  while (at < lines.length) {
    const line = lines[at] ?? "";
    const found = FENCE.exec(line);
    if (found === null) {
      prose.push(line);
      at += 1;
      continue;
    }

    const marker = found[1] ?? "```";
    const info = infoOf(found[2] ?? "");
    const mermaid = marker.startsWith("`") && info.name === "mermaid";
    const body: Array<string> = [];
    let end = at + 1;
    let closed = false;
    for (; end < lines.length; end += 1) {
      const next = lines[end] ?? "";
      if (isClose(next, marker)) {
        closed = true;
        break;
      }
      body.push(next);
    }

    if (!mermaid) {
      prose.push(...lines.slice(at, closed ? end + 1 : lines.length));
      at = closed ? end + 1 : lines.length;
      continue;
    }

    if (!closed)
      return {
        ok: false,
        problem: `Mermaid block ${blocks.length + 1} has no closing fence for the one that starts at line ${at + 1}`,
      };

    const token = `SPECTRE_MERMAID_${nonce}_${blocks.length}`;
    blocks.push({
      token,
      source: body.join("\n"),
      start: at + 1,
      ...(info.caption === undefined ? {} : { caption: info.caption }),
    });
    prose.push("", token, "");
    at = end + 1;
  }

  const figures: Array<{ token: string; html: string }> = [];
  for (const [position, block] of blocks.entries()) {
    const built = figure(block.source, block.caption);
    if (!built.ok) {
      const line = block.start + (built.line ?? 1);
      return {
        ok: false,
        problem: `Mermaid block ${position + 1} (line ${line} of the report): ${built.problem}`,
      };
    }
    figures.push({ token: block.token, html: built.value });
  }

  let html: string;
  try {
    html = Bun.markdown.html(prose.join("\n"), {
      headings: { ids: true },
      noHtmlBlocks: true,
      noHtmlSpans: true,
    });
  } catch (cause) {
    return {
      ok: false,
      problem: `the Markdown renderer failed: ${cause instanceof Error ? cause.message : String(cause)}`,
    };
  }

  const placed = placeFigures(html, figures);
  if (!placed.ok) return placed;
  return { ok: true, value: { html: placed.value, warnings: [] } };
};

const decodeEntities = (text: string): string =>
  text.replace(/&(#x[0-9a-f]+|#[0-9]+|[a-z][a-z0-9]*);/gi, (match, body: string) => {
    const lower = body.toLowerCase();
    if (lower.startsWith("#x")) {
      const point = Number.parseInt(lower.slice(2), 16);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    if (lower.startsWith("#")) {
      const point = Number.parseInt(lower.slice(1), 10);
      return Number.isFinite(point) ? String.fromCodePoint(point) : match;
    }
    switch (lower) {
      case "amp":
        return "&";
      case "lt":
        return "<";
      case "gt":
        return ">";
      case "quot":
        return '"';
      case "apos":
        return "'";
      case "nbsp":
        return " ";
      default:
        return match;
    }
  });

const HEADING = /<h([23])(\s[^>]*)?>([\s\S]*?)<\/h\1>/gi;

const ID = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/i;

const textOf = (html: string): string =>
  decodeEntities(html.replace(/<[^>]*>/g, ""))
    .replace(/\s+/g, " ")
    .trim();

/**
 * The `h2`/`h3` entries a table of contents links. A heading without an id is
 * skipped: a link to it could not resolve, and the composer refuses on a dead
 * anchor rather than shipping one.
 */
export const headings = (html: string): ReadonlyArray<Heading> => {
  const found: Array<Heading> = [];
  for (const match of html.matchAll(HEADING)) {
    const level = Number(match[1]);
    const attrs = match[2] ?? "";
    const id = ID.exec(attrs);
    const value = id?.[1] ?? id?.[2] ?? id?.[3];
    if (value === undefined || value === "") continue;
    const text = textOf(match[3] ?? "");
    if (text === "") continue;
    found.push({ id: value, text, level: level === 3 ? 3 : 2 });
  }
  return found;
};
