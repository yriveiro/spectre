export type ExternalLoad = {
  readonly target: string;
  readonly kind: "remote" | "missing";
};

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const DOCTYPE = /^\s*<!doctype\b/i;

const SCHEME = /^[a-z][a-z0-9+.-]*:/i;

const ID = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+))/gi;

const STYLE_BLOCK = /<style\b[^>]*>([\s\S]*?)<\/style>/gi;

const CSS_URL = /url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi;

/**
 * The attribute body of one tag. A quoted value may contain `>` — an `href` with
 * `data:text/html,<script>` is the case that found this — so the walk accepts a
 * whole quoted run before it treats `>` as the end of the tag.
 */
const ATTRS = "((?:\"[^\"]*\"|'[^']*'|[^>\"'])*)";

const START_TAG = new RegExp(`<[a-z][a-z0-9:-]*\\b${ATTRS}>`, "gi");

const ATTR_PAIR = /([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s>]+)))?/g;

const tags = (html: string, name: string): ReadonlyArray<string> => {
  const found: Array<string> = [];
  for (const match of html.matchAll(new RegExp(`<${name}\\b${ATTRS}>`, "gi")))
    found.push(match[1] ?? "");
  return found;
};

const attrValues = (attrs: string, name: string): ReadonlyArray<string> => {
  const target = name.toLowerCase();
  const found: Array<string> = [];
  for (const match of attrs.matchAll(ATTR_PAIR)) {
    if ((match[1] ?? "").toLowerCase() !== target) continue;
    const value = match[2] ?? match[3] ?? match[4];
    if (value !== undefined) found.push(value);
  }
  return found;
};

const attr = (attrs: string, name: string): string | undefined => attrValues(attrs, name)[0];

const decode = (text: string): string =>
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

const clean = (raw: string): string => decode(raw).trim();

const unique = (values: ReadonlyArray<string>): ReadonlyArray<string> => [...new Set(values)];

/** A scheme check reads the value the way a browser strips it: no C0 controls or spaces. */
const stripped = (text: string): string => {
  let out = "";
  for (const char of text) {
    const point = char.codePointAt(0) ?? 0;
    if (point > 0x20) out += char;
  }
  return out;
};

const hrefs = (html: string): ReadonlyArray<string> => {
  const found: Array<string> = [];
  for (const attrs of tags(html, "a")) {
    const value = attr(attrs, "href");
    if (value !== undefined) found.push(clean(value));
  }
  return found;
};

const cssTexts = (html: string): ReadonlyArray<string> => {
  const found: Array<string> = [];
  for (const match of html.matchAll(STYLE_BLOCK)) found.push(match[1] ?? "");
  for (const match of html.matchAll(START_TAG)) {
    for (const value of attrValues(match[1] ?? "", "style")) found.push(decode(value));
  }
  return found;
};

const classify = (
  raw: string,
  files: Readonly<Record<string, string>>,
  decoded = false,
): ExternalLoad | undefined => {
  const value = decoded ? raw.trim() : clean(raw);
  if (value === "" || value.startsWith("#")) return undefined;
  if (value.toLowerCase().startsWith("data:")) return undefined;
  if (value.startsWith("//") || SCHEME.test(value) || value.startsWith("/"))
    return { target: value, kind: "remote" };
  const path = (value.replace(/^\.\//, "").split(/[?#]/)[0] ?? "").trim();
  if (path === "") return undefined;
  if (Object.hasOwn(files, path)) return undefined;
  return { target: value, kind: "missing" };
};

const metadataOnly = new Set(["canonical", "alternate", "author", "license", "me", "prev", "next"]);

export const titleOf = (html: string): string | undefined => {
  const found = TITLE.exec(html);
  const text = (found?.[1] ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
};

export const hasDoctype = (html: string): boolean => DOCTYPE.test(html);

export const bytesOf = (files: Readonly<Record<string, string>>): number => {
  const encoder = new TextEncoder();
  let total = 0;
  for (const file of Object.values(files)) total += encoder.encode(file).byteLength;
  return total;
};

export const deadAnchors = (html: string): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const match of html.matchAll(ID)) {
    const value = match[1] ?? match[2] ?? match[3];
    if (value !== undefined) ids.add(decode(value));
  }
  const dead = new Set<string>();
  for (const href of hrefs(html)) {
    if (!href.startsWith("#")) continue;
    const anchor = decode(href.slice(1));
    if (anchor === "" || anchor === "top") continue;
    if (!ids.has(anchor)) dead.add(anchor);
  }
  return [...dead].toSorted();
};

export const externalLoads = (
  html: string,
  files: Readonly<Record<string, string>>,
): ReadonlyArray<ExternalLoad> => {
  const found: Array<ExternalLoad> = [];
  const add = (raw: string | undefined, decoded = false): void => {
    if (raw === undefined) return;
    const one = classify(raw, files, decoded);
    if (one !== undefined) found.push(one);
  };

  for (const attrs of tags(html, "script")) add(attr(attrs, "src"));
  for (const attrs of tags(html, "img")) add(attr(attrs, "src"));
  for (const attrs of tags(html, "iframe")) add(attr(attrs, "src"));
  for (const attrs of tags(html, "source")) add(attr(attrs, "src"));
  for (const attrs of tags(html, "link")) {
    const rel = (attr(attrs, "rel") ?? "").toLowerCase().split(/\s+/);
    if (rel.some((one) => metadataOnly.has(one))) continue;
    add(attr(attrs, "href"));
  }
  for (const css of cssTexts(html))
    for (const match of css.matchAll(CSS_URL)) add(match[1] ?? match[2] ?? match[3], true);

  const seen = new Set<string>();
  return found.filter((one) => {
    const key = `${one.kind}:${one.target}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

export const unsafeLinks = (html: string): ReadonlyArray<string> =>
  unique(
    hrefs(html).filter((href) => {
      const value = stripped(href).toLowerCase();
      return (
        value.startsWith("javascript:") ||
        value.startsWith("vbscript:") ||
        value.startsWith("data:text/html")
      );
    }),
  );

export const outboundLinks = (html: string): ReadonlyArray<string> =>
  unique(
    hrefs(html).filter((href) => {
      const value = stripped(href);
      if (value === "" || value.startsWith("#")) return false;
      const lower = value.toLowerCase();
      if (
        lower.startsWith("data:") ||
        lower.startsWith("javascript:") ||
        lower.startsWith("vbscript:")
      )
        return false;
      return SCHEME.test(value) || value.startsWith("//") || value.startsWith("/");
    }),
  );
