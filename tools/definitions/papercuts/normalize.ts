export const TARGET_KINDS = ["tool", "skill", "flag", "doc", "agent", "hook"] as const;
export type TargetKind = (typeof TARGET_KINDS)[number];

const GROUP_ID_PATTERN = /^pc_[0-9a-f]{12}$/;
const MAX_SIGNATURE_TOKENS = 16;
const BM25_K1 = 1.2;
const BM25_B = 0.75;

const STOP_WORDS: ReadonlySet<string> = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "be",
  "by",
  "do",
  "for",
  "from",
  "i",
  "if",
  "in",
  "is",
  "it",
  "my",
  "of",
  "on",
  "or",
  "should",
  "that",
  "the",
  "this",
  "to",
  "we",
  "what",
  "when",
  "which",
  "with",
  "you",
  "your",
]);

const PLURAL_RULES: ReadonlyArray<readonly [RegExp, string]> = [
  [/^([a-z0-9]{2,})ies$/, "$1y"],
  [/^([a-z0-9]{2,}(?:ss|sh|ch|x|z))es$/, "$1"],
  [/^([a-z0-9]{2,}[^sui])s$/, "$1"],
];

const normalizeToken = (word: string): string => {
  for (const [pattern, replacement] of PLURAL_RULES) {
    if (pattern.test(word)) return word.replace(pattern, replacement);
  }
  return word;
};

export const extractTokens = (text: string): ReadonlyArray<string> => {
  const expanded = text.replace(/([a-z0-9])([A-Z])/g, "$1 $2").toLowerCase();
  const matches = expanded.match(/[a-z0-9]+/g);
  if (matches === null) return [];
  const stemmed: Array<string> = [];
  for (const part of matches) stemmed.push(normalizeToken(part));
  return stemmed;
};

const contentTokens = (text: string): ReadonlyArray<string> =>
  extractTokens(text).filter((word) => !STOP_WORDS.has(word));

export const isValidGroupId = (value: string): boolean => GROUP_ID_PATTERN.test(value);

export const canonicalizeTarget = (kind: TargetKind, rawTarget: string): string => {
  const unwrapped = rawTarget
    .trim()
    .replace(/^['"`]+|['"`]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();

  let normalized = unwrapped.toLowerCase();
  if (kind === "tool") {
    normalized = normalized.replace(/^tools\.spectre\./, "").replace(/^spectre\./, "");
    if (normalized !== "spectre_search" && normalized.startsWith("spectre_")) {
      normalized = normalized.slice("spectre_".length);
    }
  } else if (kind === "skill") {
    normalized = normalized
      .replace(/\\/g, "/")
      .replace(/^\.\//, "")
      .replace(/^skills\/definitions\//, "")
      .replace(/\/skill\.md$/, "");
  } else if (kind === "doc") {
    normalized = normalized.replace(/\\/g, "/").replace(/^\.\//, "");
  }

  return `${kind}:${normalized}`;
};

export const targetBody = (canonicalTarget: string): string => {
  const sep = canonicalTarget.indexOf(":");
  return sep < 0 ? canonicalTarget : canonicalTarget.slice(sep + 1);
};

const scrubVolatile = (text: string): string =>
  text
    .replace(/\[REDACTED(?:_[A-Z]+)?\]/g, " ")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, " ")
    .replace(/\b(?:ses|msg|call|proj|prt|ws|art)_[A-Za-z0-9_-]+\b/g, " ")
    .replace(/\/(?:private|tmp|var|etc|opt|usr)\/[^\s"'`]+/g, " ")
    .replace(/[A-Za-z]:\\[^\s"'`]+/g, " ")
    .replace(/\b[0-9a-f]{7,40}\b/gi, " ")
    .replace(/:\d+(?::\d+)?\b/g, " ")
    .replace(/\b\d{4,}\b/g, " ");

export const signatureTokens = (
  redactedActual: string,
  redactedTried = "",
): ReadonlyArray<string> => {
  const scrubbedActual = scrubVolatile(redactedActual);
  let tokens = contentTokens(scrubbedActual);
  if (tokens.length === 0) tokens = extractTokens(scrubbedActual);
  if (tokens.length === 0 && redactedTried.length > 0) {
    const scrubbedTried = scrubVolatile(redactedTried);
    tokens = contentTokens(scrubbedTried);
    if (tokens.length === 0) tokens = extractTokens(scrubbedTried);
  }
  return [...new Set(tokens)]
    .toSorted((left, right) => (left < right ? -1 : left > right ? 1 : 0))
    .slice(0, MAX_SIGNATURE_TOKENS);
};

export const computeGroupId = (
  canonicalTarget: string,
  redactedActual: string,
  redactedTried = "",
): string => {
  const tokens = signatureTokens(redactedActual, redactedTried);
  const digest = new Bun.CryptoHasher("sha256")
    .update(`${canonicalTarget}\0${tokens.join(" ")}`)
    .digest("hex")
    .slice(0, 12);
  return `pc_${digest}`;
};

export interface Bm25Document {
  readonly groupId: string;
  readonly target: string;
  readonly canonicalTarget: string;
  readonly body: string;
}

export interface Bm25Ranked<T> {
  readonly item: T;
  readonly score: number;
}

interface Bm25Index {
  readonly targetById: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly bodyById: ReadonlyMap<string, ReadonlyArray<string>>;
  readonly docFreq: ReadonlyMap<string, number>;
  readonly avgTarget: number;
  readonly avgBody: number;
  readonly totalDocs: number;
}

const buildBm25Index = (items: ReadonlyArray<Bm25Document>): Bm25Index => {
  const targetById = new Map<string, ReadonlyArray<string>>();
  const bodyById = new Map<string, ReadonlyArray<string>>();
  const docFreq = new Map<string, number>();
  let totalTarget = 0;
  let totalBody = 0;

  for (const item of items) {
    const tToks = extractTokens(`${item.target} ${item.canonicalTarget}`);
    const bToks = contentTokens(item.body);
    targetById.set(item.groupId, tToks);
    bodyById.set(item.groupId, bToks);
    totalTarget += tToks.length;
    totalBody += bToks.length;
    for (const token of new Set([...tToks, ...bToks])) {
      docFreq.set(token, (docFreq.get(token) ?? 0) + 1);
    }
  }

  return {
    targetById,
    bodyById,
    docFreq,
    avgTarget: totalTarget / items.length || 1,
    avgBody: totalBody / items.length || 1,
    totalDocs: items.length,
  };
};

const addZoneWeights = (
  weights: Map<string, number>,
  tokens: ReadonlyArray<string>,
  zoneWeight: number,
  avgLen: number,
): void => {
  if (tokens.length === 0) return;
  const norm = zoneWeight / (1 - BM25_B + (BM25_B * tokens.length) / avgLen);
  for (const word of tokens) {
    weights.set(word, (weights.get(word) ?? 0) + norm);
  }
};

const scoreDocument = (
  item: Bm25Document,
  terms: ReadonlyArray<string>,
  index: Bm25Index,
  needle: string,
): number => {
  const weightedTf = new Map<string, number>();
  addZoneWeights(weightedTf, index.targetById.get(item.groupId) ?? [], 3, index.avgTarget);
  addZoneWeights(weightedTf, index.bodyById.get(item.groupId) ?? [], 1, index.avgBody);

  let score = 0;
  for (const term of terms) {
    const tf = weightedTf.get(term);
    if (tf === undefined) continue;
    const df = index.docFreq.get(term) ?? 0;
    const idf = Math.log(1 + (index.totalDocs - df + 0.5) / (df + 0.5));
    score += (idf * tf * (BM25_K1 + 1)) / (tf + BM25_K1);
  }

  const exactHit =
    item.canonicalTarget === needle ||
    targetBody(item.canonicalTarget) === needle ||
    item.groupId === needle;
  if (exactHit) score += 10;
  return score;
};

export const rankByBm25 = <T extends Bm25Document>(
  items: ReadonlyArray<T>,
  query: string,
): Array<Bm25Ranked<T>> => {
  const rawQuery = extractTokens(query);
  const filteredQuery = rawQuery.filter((word) => !STOP_WORDS.has(word));
  const terms = [...new Set(filteredQuery.length > 0 ? filteredQuery : rawQuery)];
  if (terms.length === 0 || items.length === 0) return [];

  const index = buildBm25Index(items);
  const needle = query.trim().toLowerCase();
  const ranked: Array<Bm25Ranked<T>> = [];

  for (const item of items) {
    const score = scoreDocument(item, terms, index, needle);
    if (score > 0) {
      ranked.push({ item, score: Math.round(score * 100) / 100 });
    }
  }

  return ranked;
};
