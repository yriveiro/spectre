/** The SVG and page renderers, and the stylesheet both depend on. */

import type { Flat, Point3, Projection, SolidPaths } from "./iso-kit";
import { iso, pathOf, screenRise } from "./iso-kit";

export type Tone = "hi" | "mid" | "lo" | "faint";
export type LineTone = Tone | "lit" | "red" | "green" | "blue";
export type Theme = "dark" | "light";
export type KeyMark =
  | "raised"
  | "flat"
  | "lit"
  | "edge"
  | "dim"
  | "dotted"
  | "dashed"
  | "red"
  | "green"
  | "blue";

const escapeXml = (value: string): string =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

const attrs = (values: Record<string, string | boolean | undefined>): string =>
  Object.entries(values)
    .filter(([, value]) => value !== undefined && value !== false)
    .map(([key, value]) => (value === true ? ` ${key}=""` : ` ${key}="${value}"`))
    .join("");

export interface SolidStyle {
  readonly tone?: Tone;
  readonly crease?: Tone | "none";
  readonly halo?: boolean;
  readonly lit?: boolean;
  readonly flat?: boolean;
  readonly className?: string;
  readonly inner?: string;
}

export const solidSvg = (
  paths: SolidPaths,
  {
    tone = "hi",
    crease = "faint",
    halo = false,
    lit = false,
    flat = false,
    className,
    inner = "",
  }: SolidStyle = {},
): string => {
  const parts: string[] = [];
  if (halo) parts.push(`<path class="iso-halo" d="${paths.fill}"/>`);
  parts.push(`<path class="iso-fill" d="${paths.fill}"/>`);
  if (!flat)
    paths.shades.forEach((shade, index) => {
      if (shade === "") return;
      parts.push(`<path class="iso-shade" data-shade="${index}" d="${shade}"/>`);
    });
  if (!flat && paths.top !== "") parts.push(`<path class="iso-top" d="${paths.top}"/>`);
  if (crease !== "none" && paths.crease !== "")
    parts.push(`<path class="iso-line iso-crease" data-tone="${crease}" d="${paths.crease}"/>`);
  if (crease !== "none" && paths.bevel !== undefined && paths.bevel !== "")
    parts.push(`<path class="iso-line iso-bevel" data-tone="${crease}" d="${paths.bevel}"/>`);
  if (inner !== "") parts.push(inner);
  parts.push(`<path class="iso-line iso-edge" data-tone="${tone}" d="${paths.outline}"/>`);

  return `<g class="iso-solid${className ? ` ${className}` : ""}"${lit ? ' data-lit=""' : ""}${paths.seamless ? ' data-seamless=""' : ""}>${parts.join("")}</g>`;
};

export interface LineStyle {
  readonly tone?: LineTone;
  readonly dotted?: boolean;
  readonly dashed?: boolean;
  readonly flow?: boolean;
  readonly className?: string;
  /** An end allowed to stop on a bare face. Only printed rule lines, a needle tail and a pointer tip may set it. */
  readonly free?: boolean | "start" | "end";
}

export const lineSvg = (
  d: string,
  { tone = "lo", dotted, dashed, flow, className, free }: LineStyle = {},
): string => {
  if (d === "") return "";
  const marks =
    (dotted ? ' data-dotted=""' : "") +
    (dashed ? ' data-dashed=""' : "") +
    (flow ? ' data-flow=""' : "") +
    (free ? ' data-free=""' : "");
  return `<path class="iso-line${className ? ` ${className}` : ""}" data-tone="${tone}"${marks} d="${d}"/>`;
};

export type Dot = Flat | [number, number, number];

export const dotsSvg = (
  points: ReadonlyArray<Dot>,
  {
    size = 0.5,
    tone = "mid",
    pulse = false,
  }: { size?: number; tone?: LineTone; pulse?: boolean } = {},
): string => {
  const circles = points.map((point, index) => {
    const [x, y, alpha] = point;
    const opacity =
      alpha !== undefined && alpha < 1 ? ` fill-opacity="${Math.max(0, alpha).toFixed(2)}"` : "";
    const blink = pulse ? ` data-pulse="" style="--pulse-at:${(index * 137) % 1600}ms"` : "";
    return `<circle cx="${x}" cy="${y}" r="${size}"${opacity}${blink}/>`;
  });
  return `<g class="iso-dots" data-tone="${tone}">${circles.join("")}</g>`;
};

export type Faded = { d: string; alpha: number } | [string, number];

export const fadedSvg = (list: ReadonlyArray<Faded>, style: LineStyle = {}): string => {
  const buckets = new Map<number, string[]>();
  for (const entry of list) {
    const d = Array.isArray(entry) ? entry[0] : entry.d;
    const alpha = Array.isArray(entry) ? entry[1] : entry.alpha;
    if (d === "" || alpha <= 0.02) continue;
    const level = Math.round(Math.min(1, alpha) * 20) / 20;
    const bucket = buckets.get(level) ?? [];
    bucket.push(d);
    buckets.set(level, bucket);
  }
  return [...buckets.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(([alpha, parts]) =>
      alpha >= 1
        ? lineSvg(parts.join(""), style)
        : `<g opacity="${alpha.toFixed(2)}">${lineSvg(parts.join(""), style)}</g>`,
    )
    .join("");
};

const smoothstep = (t: number): number => t * t * (3 - 2 * t);

const hash = (value: string): string => {
  let h = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    h ^= value.charCodeAt(index);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(36);
};

/**
 * A polyline whose alpha ramps at one or both ends, so a mark fades instead of
 * stopping in the middle of a surface. The gradient id is derived from the
 * rounded path, which is what keeps two figures from sharing one.
 */
export const fadeLineSvg = (
  points: ReadonlyArray<Flat>,
  {
    fade = [0, 0] as readonly [number, number],
    tone = "lo",
    className,
    stops = 6,
  }: Omit<LineStyle, "dotted" | "dashed" | "flow" | "free"> & {
    fade?: readonly [number, number];
    stops?: number;
  } = {},
): string => {
  if (points.length < 2) return "";

  const cumulative: number[] = [0];
  for (const [index, point] of points.entries())
    if (index > 0) {
      const previous = points[index - 1] as Flat;
      cumulative.push(
        (cumulative[index - 1] as number) +
          Math.hypot(point[0] - previous[0], point[1] - previous[1]),
      );
    }
  const total = cumulative[cumulative.length - 1] as number;
  if (total < 0.05) return "";

  let [head, tail] = fade;
  if (head + tail > total) {
    const share = total / (head + tail);
    head *= share;
    tail *= share;
  }

  const id = `iso-fade-${hash(pathOf(points))}`;
  const alphaAt = (along: number): number => {
    let value = 1;
    if (head > 0) value *= smoothstep(Math.min(1, along / head));
    if (tail > 0) value *= smoothstep(Math.min(1, (total - along) / tail));
    return value;
  };

  const stopsFor = (from: number, to: number): string => {
    let out = "";
    for (let step = 0; step <= stops; step += 1) {
      const share = step / stops;
      const at = from + (to - from) * share;
      out += `<stop offset="${share.toFixed(3)}" stop-color="currentColor" stop-opacity="${alphaAt(at).toFixed(3)}"/>`;
    }
    return out;
  };

  /** The last vertex at or before a distance along the line. */
  const reach = (along: number): number => {
    for (let index = 0; index < cumulative.length; index += 1)
      if ((cumulative[index] as number) >= along) return Math.max(1, index);
    return points.length - 1;
  };

  const middleStart = head > 0 ? head : 0;
  const middleEnd = tail > 0 ? total - tail : total;
  const headStops =
    head > 0
      ? `<linearGradient id="${id}-a" x1="0" x2="1">${stopsFor(0, head)}</linearGradient>`
      : "";
  const tailStops =
    tail > 0
      ? `<linearGradient id="${id}-b" x1="0" x2="1">${stopsFor(total - tail, total)}</linearGradient>`
      : "";

  const parts: string[] = [];
  if (head > 0)
    parts.push(
      `<path class="iso-line" data-tone="${tone}" data-free="start" stroke="url(#${id}-a)" d="${pathOf(points.slice(0, reach(head) + 1))}"/>`,
    );
  parts.push(
    `<path class="iso-line" data-tone="${tone}" d="${pathOf(points.slice(reach(middleStart), reach(middleEnd) + 1))}"/>`,
  );
  if (tail > 0)
    parts.push(
      `<path class="iso-line" data-tone="${tone}" data-free="end" stroke="url(#${id}-b)" d="${pathOf(points.slice(reach(middleEnd)))}"/>`,
    );

  return `<g class="iso-fade"${className ? ` ${className}` : ""}><defs>${headStops}${tailStops}</defs>${parts.join("")}</g>`;
};

export const wireSvg = (
  from: Point3,
  to: Point3,
  {
    via = [] as ReadonlyArray<Point3>,
    tone = "lo",
    dotted,
    dashed,
    flow,
    ends = "both",
    size = 1.2,
    projection,
  }: {
    via?: ReadonlyArray<Point3>;
    tone?: LineTone;
    dotted?: boolean;
    dashed?: boolean;
    flow?: boolean;
    ends?: "both" | "from" | "to" | "none";
    size?: number;
    projection: Projection;
  },
): string => {
  const line = lineSvg(pathOf([from, ...via, to].map((point) => iso(point, projection))), {
    tone,
    dotted,
    dashed,
    flow,
  });
  const terminals: string[] = [];
  const mark = (point: Point3) => {
    const [x, y] = iso(point, projection);
    return `<circle class="iso-wire-end" cx="${x}" cy="${y}" r="${size / 2}"/>`;
  };
  if (ends === "both" || ends === "from") terminals.push(mark(from));
  if (ends === "both" || ends === "to") terminals.push(mark(to));
  return `<g class="iso-wire" data-tone="${tone}">${line}${terminals.join("")}</g>`;
};

export const faceTextSvg = (
  transform: string,
  text: string,
  {
    size = 3,
    tone = "mid",
    anchor = "start",
  }: { size?: number; tone?: LineTone; anchor?: "start" | "middle" | "end" } = {},
): string =>
  `<text class="iso-face-text" data-tone="${tone}" transform="${transform}" font-size="${size}" text-anchor="${anchor}">${escapeXml(text)}</text>`;

export const groupSvg = (
  children: string | ReadonlyArray<string>,
  extra: Record<string, string | boolean | undefined> = {},
): string => `<g${attrs(extra)}>${typeof children === "string" ? children : children.join("")}</g>`;

export interface FigureOptions {
  readonly width: number;
  readonly height: number;
  readonly label: string;
  readonly body: string | ReadonlyArray<string>;
  readonly standalone?: Theme | false;
  readonly className?: string;
}

export const figureSvg = ({
  width,
  height,
  label,
  body,
  standalone = false,
  className,
}: FigureOptions): string => {
  const style = standalone ? `<style>${ISO_CSS}</style>` : "";
  const theme = standalone ? ` data-theme="${standalone}"` : "";
  const iso = standalone ? " iso" : "";
  return `<svg xmlns="http://www.w3.org/2000/svg" class="iso-svg${iso}${className ? ` ${className}` : ""}"${theme} viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeXml(label)}">${style}${typeof body === "string" ? body : body.join("")}</svg>`;
};

const swatchSvg = (mark: KeyMark): string => {
  if (mark === "raised" || mark === "flat" || mark === "lit") {
    const diamond = "M4 1 L7 2.6 L4 4.2 L1 2.6 Z";
    if (mark === "flat")
      return `<svg class="iso-swatch" viewBox="0 0 8 8" aria-hidden="true"><path class="iso-swatch-fill" d="${diamond}"/></svg>`;
    return `<svg class="iso-swatch" viewBox="0 0 8 8" aria-hidden="true"><path class="iso-swatch-fill" d="${diamond}"/><path class="iso-swatch-side" d="${diamond} L4 6.4 L7 4.2"/><path class="iso-swatch-crease" d="M1 2.6 L4 4.2 L7 2.6"/></svg>`;
  }
  return `<svg class="iso-swatch" viewBox="0 0 8 8" aria-hidden="true"><path class="iso-key-line" data-mark="${mark}" d="M0.5 4 L7.5 4"/></svg>`;
};

export interface PlateOptions {
  readonly fig: number | string;
  readonly title?: string;
  readonly hint?: string;
  readonly readout?: string;
  readonly keys?: ReadonlyArray<{ mark: KeyMark; label: string }>;
  readonly caption?: string;
  readonly body: string;
}

export const plateHtml = ({
  fig,
  title,
  hint,
  readout = "",
  keys = [],
  caption,
  body,
}: PlateOptions): string => {
  const corners: string[] = [
    `<span class="iso-plate-corner" data-corner="fig">Fig ${escapeXml(String(fig))}</span>`,
  ];
  if (title)
    corners.push(`<span class="iso-plate-corner" data-corner="title">${escapeXml(title)}</span>`);
  if (hint)
    corners.push(`<span class="iso-plate-corner" data-corner="hint">${escapeXml(hint)}</span>`);
  corners.push(
    `<span class="iso-plate-corner" data-corner="readout" data-readout>${escapeXml(readout)}</span>`,
  );

  const legend =
    keys.length === 0 && caption === undefined
      ? ""
      : `<figcaption class="iso-legend">${
          keys.length === 0
            ? ""
            : `<span class="iso-keys">${keys
                .map(
                  (key) =>
                    `<span class="iso-key">${swatchSvg(key.mark)}${escapeXml(key.label)}</span>`,
                )
                .join("")}</span>`
        }${caption === undefined ? "" : `<span class="iso-caption">${escapeXml(caption)}</span>`}</figcaption>`;

  return `<figure class="iso-figure"><div class="iso-plate"><div class="iso-plate-corners" aria-hidden="true">${corners.join("")}</div>${body}</div>${legend}</figure>`;
};

export interface PageOptions {
  readonly title: string;
  readonly theme?: Theme;
  readonly body: string;
  readonly script?: string;
  readonly width?: number;
}

export const pageHtml = ({
  title,
  theme = "dark",
  body,
  script = "",
  width = 650,
}: PageOptions): string => {
  const pageCss = `*{box-sizing:border-box}html{color-scheme:dark}html[data-theme="light"],.iso[data-theme="light"]~*{color-scheme:light}body{margin:0;font:15px/1.55 ui-sans-serif,-apple-system,Segoe UI,Roboto,sans-serif;-webkit-font-smoothing:antialiased}.iso-page{width:min(${width}px,100% - 32px);margin:64px auto 96px}`;
  const safe = script.replace(/<\/(script)/gi, "<\\/$1");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeXml(title)}</title><style>${ISO_CSS}${pageCss}</style></head><body class="iso" data-theme="${theme}"><main class="iso-page">${body}</main>${safe === "" ? "" : `<script type="module">${safe}</script>`}</body></html>`;
};

export const labelHeight = (size: number, projection: Projection): number =>
  screenRise(size, projection);

export const ISO_CSS = `
.iso{--anatomy-page:#0b0b0b;--anatomy-card:#131313;--anatomy-text:#a3a3a3;--anatomy-strong:#e6e6e6;--anatomy-muted:#6e6e6e;--anatomy-paper:#131313;--anatomy-face:#1b1b1b;--anatomy-top:#1c1c1c;--anatomy-shade-0:#0f0f0f;--anatomy-shade-1:#121212;--anatomy-shade-2:#151515;--anatomy-shade-3:#181818;--anatomy-lit-top:#262626;--anatomy-lit-shade:#1d1d1d;--anatomy-hi:#d4d4d4;--anatomy-mid:#6a6a6a;--anatomy-lo:#3e3e3e;--anatomy-faint:#2a2a2a;--anatomy-lit:#ffffff;--anatomy-halo:#050505;--anatomy-halo-opacity:.9;--anatomy-dot:#e6e6e6;--anatomy-red:#ff6b6b;--anatomy-green:#6be0a0;--anatomy-blue:#6b9bff;--anatomy-weight:.6px;--anatomy-ease:cubic-bezier(.32,.72,0,1);--anatomy-mono:ui-monospace,"SF Mono",Menlo,Consolas,monospace;--anatomy-lift:0 1px 0 #000,0 8px 24px rgba(0,0,0,.5);color:var(--anatomy-text);background:var(--anatomy-page)}
.iso[data-theme="light"]{--anatomy-page:#f2f2ef;--anatomy-card:#fbfbfa;--anatomy-text:#57575a;--anatomy-strong:#18181a;--anatomy-muted:#8c8c90;--anatomy-paper:#fbfbfa;--anatomy-face:#ffffff;--anatomy-top:#ffffff;--anatomy-shade-0:#dcdcd9;--anatomy-shade-1:#e5e5e2;--anatomy-shade-2:#ededea;--anatomy-shade-3:#f4f4f1;--anatomy-lit-top:#ffffff;--anatomy-lit-shade:#eeeeeb;--anatomy-hi:#26262a;--anatomy-mid:#8a8a8f;--anatomy-lo:#b4b4b8;--anatomy-faint:#d4d4d6;--anatomy-lit:#000000;--anatomy-halo:#8a8a80;--anatomy-halo-opacity:.32;--anatomy-dot:#3a3a3e;--anatomy-red:#e5484d;--anatomy-green:#30a46c;--anatomy-blue:#3e63dd;--anatomy-lift:0 1px 0 #fff,0 8px 24px rgba(0,0,0,.08)}
.iso-svg{display:block;width:100%;height:auto;overflow:visible}
.iso-svg path,.iso-svg circle{vector-effect:non-scaling-stroke}
.iso-fill{fill:var(--anatomy-paper);stroke:none}
.iso-solid[data-lit] .iso-fill{fill:var(--anatomy-face)}
.iso-solid[data-lit] .iso-top{fill:var(--anatomy-lit-top)}
.iso-solid[data-lit] .iso-shade{fill:var(--anatomy-lit-shade)}
.iso-shade{fill:var(--anatomy-shade-0);stroke:none}
.iso-shade[data-shade="1"]{fill:var(--anatomy-shade-1)}
.iso-shade[data-shade="2"]{fill:var(--anatomy-shade-2)}
.iso-shade[data-shade="3"]{fill:var(--anatomy-shade-3)}
.iso-top{fill:var(--anatomy-top);stroke:none}
.iso-solid[data-seamless] .iso-fill,.iso-solid[data-seamless] .iso-shade,.iso-solid[data-seamless] .iso-top{stroke:currentColor;stroke-width:.35px;stroke-opacity:.5}
.iso-halo{fill:var(--anatomy-halo);opacity:var(--anatomy-halo-opacity);filter:blur(9px);transform:translateY(3px);stroke:none}
.iso-line{fill:none;stroke-width:var(--anatomy-weight);stroke-linecap:round;stroke-linejoin:round}
.iso-line[data-tone="hi"],.iso-key-line[data-mark="edge"]{stroke:var(--anatomy-hi)}
.iso-line[data-tone="mid"],.iso-key-line[data-mark="dim"]{stroke:var(--anatomy-mid)}
.iso-line[data-tone="lo"]{stroke:var(--anatomy-lo)}
.iso-line[data-tone="faint"]{stroke:var(--anatomy-faint)}
.iso-line[data-tone="lit"],.iso-key-line[data-mark="lit"]{stroke:var(--anatomy-lit)}
.iso-line[data-tone="red"],.iso-key-line[data-mark="red"]{stroke:var(--anatomy-red)}
.iso-line[data-tone="green"],.iso-key-line[data-mark="green"]{stroke:var(--anatomy-green)}
.iso-line[data-tone="blue"],.iso-key-line[data-mark="blue"]{stroke:var(--anatomy-blue)}
.iso-crease,.iso-bevel{stroke:var(--anatomy-faint)}
.iso-line[data-dotted]{stroke-dasharray:.01 3.5;stroke-width:1px}
.iso-line[data-dashed]{stroke-dasharray:3 3}
.iso-line[data-flow]{stroke-dasharray:2 6;animation:iso-flow 1600ms linear infinite}
@keyframes iso-flow{to{stroke-dashoffset:-32}}
.iso-dots{fill:var(--anatomy-dot)}
.iso-dots[data-tone="hi"]{opacity:.85}
.iso-dots[data-tone="mid"]{opacity:.45}
.iso-dots[data-tone="lo"]{opacity:.22}
.iso-dots[data-tone="faint"]{opacity:.12}
.iso-dots circle[data-pulse]{animation:iso-pulse 1600ms steps(1,end) infinite;animation-delay:var(--pulse-at,0ms)}
@keyframes iso-pulse{50%{opacity:.15}}
.iso-wire-end{fill:currentColor;stroke:none}
.iso-wire[data-tone]{color:var(--anatomy-lo)}
.iso-wire[data-tone="hi"]{color:var(--anatomy-hi)}
.iso-wire[data-tone="mid"]{color:var(--anatomy-mid)}
.iso-wire[data-tone="faint"]{color:var(--anatomy-faint)}
.iso-wire[data-tone="lit"]{color:var(--anatomy-lit)}
.iso-face-text{font-family:var(--anatomy-mono);letter-spacing:.06em}
.iso-face-text[data-tone="hi"]{fill:var(--anatomy-hi)}
.iso-face-text[data-tone="mid"]{fill:var(--anatomy-mid)}
.iso-face-text[data-tone="lo"]{fill:var(--anatomy-lo)}
.iso-face-text[data-tone="faint"]{fill:var(--anatomy-faint)}
.iso-face-text[data-tone="lit"]{fill:var(--anatomy-lit)}
.iso-fade .iso-line{stroke:currentColor}
.iso-figure{margin:0 0 44px}
.iso-plate{position:relative;padding:52px 24px;background:var(--anatomy-card);outline:1px solid var(--anatomy-mid);outline-offset:-1px;box-shadow:var(--anatomy-lift)}
.iso-plate-corners{position:absolute;inset:0;pointer-events:none}
.iso-plate-corner{position:absolute;font-family:var(--anatomy-mono);font-size:10px;letter-spacing:.1em}
.iso-plate-corner[data-corner="fig"]{top:16px;left:24px;color:var(--anatomy-text)}
.iso-plate-corner[data-corner="title"]{top:16px;right:24px;text-transform:uppercase;color:var(--anatomy-muted)}
.iso-plate-corner[data-corner="hint"]{bottom:16px;left:24px;text-transform:uppercase;color:var(--anatomy-muted)}
.iso-plate-corner[data-corner="readout"]{bottom:16px;right:24px;color:var(--anatomy-text);font-variant-numeric:tabular-nums}
.iso-legend{display:flex;flex-wrap:wrap;gap:6px 20px;margin-top:14px;font-size:12px;color:var(--anatomy-muted)}
.iso-keys{display:flex;flex-wrap:wrap;gap:6px 16px}
.iso-key{display:inline-flex;align-items:center;gap:6px}
.iso-swatch{width:14px;height:14px;flex:none;overflow:visible}
.iso-swatch-fill{fill:var(--anatomy-paper);stroke:var(--anatomy-hi);stroke-width:.6px}
.iso-swatch-side{fill:var(--anatomy-shade-2);stroke:none}
.iso-swatch-crease{fill:none;stroke:var(--anatomy-faint);stroke-width:.6px}
.iso-key-line{fill:none;stroke-width:1px}
.iso-key-line[data-mark="dotted"]{stroke-dasharray:.01 3.5;stroke-width:1.4px}
.iso-key-line[data-mark="dashed"]{stroke-dasharray:3 3}
.iso-key-line[data-mark="lit"],.iso-key-line[data-mark="edge"],.iso-key-line[data-mark="dim"]{stroke:var(--anatomy-hi)}
.iso-key-line[data-mark="dotted"],.iso-key-line[data-mark="dashed"]{stroke:var(--anatomy-mid)}
.iso-key-line[data-mark="red"]{stroke:var(--anatomy-red)}
.iso-key-line[data-mark="green"]{stroke:var(--anatomy-green)}
.iso-key-line[data-mark="blue"]{stroke:var(--anatomy-blue)}
.iso-caption{flex:1 1 100%}
.tb-body{fill:var(--anatomy-paper)}
.tb-shine{fill:var(--anatomy-shade-3)}
.tb-shade{fill:var(--anatomy-shade-1)}
.tb-ring{fill:none;stroke:var(--anatomy-lo);stroke-width:.5px}
@media (max-width:560px){.iso-plate{padding:44px 16px}.iso-plate-corner[data-corner="fig"],.iso-plate-corner[data-corner="title"],.iso-plate-corner[data-corner="hint"],.iso-plate-corner[data-corner="readout"]{font-size:9px}}
@media (prefers-reduced-motion:reduce){.iso-line[data-flow],.iso-dots circle[data-pulse]{animation:none}}
`.trim();
