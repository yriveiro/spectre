import type { LoadedSkill, PullCategory, PushGroup } from "../../../skills/definitions";

export type RankedHit = {
  readonly skill: LoadedSkill;
  readonly score: number;
};

const K1 = 1.2;
const B = 0.75;
const SKILL_MD_SUFFIX = "/SKILL.md";

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

const stem = (word: string): string => {
  if (word.length > 4 && word.endsWith("ies")) return `${word.slice(0, -3)}y`;
  if (word.length > 4 && /(?:ss|sh|ch|x|z|us)es$/.test(word)) return word.slice(0, -2);
  if (word.length > 2 && word.endsWith("s") && !/(?:ss|us|is)$/.test(word)) return word.slice(0, -1);
  return word;
};

const rawTokens = (text: string): ReadonlyArray<string> =>
  text
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((word) => word.length > 0)
    .map(stem);

const contentTokens = (text: string): ReadonlyArray<string> =>
  rawTokens(text).filter((word) => !STOP_WORDS.has(word));

const queryTokensOf = (query: string): ReadonlyArray<string> => {
  const raw = rawTokens(query);
  const filtered = raw.filter((word) => !STOP_WORDS.has(word));
  return [...new Set(filtered.length > 0 ? filtered : raw)];
};

export const summaryOf = (skill: LoadedSkill): string => {
  switch (skill.catalog.tier) {
    case "push":
      return skill.catalog.trigger;
    case "hub":
    case "pull":
      return skill.catalog.summary;
  }
};

export const bodyTokensOf = (skill: LoadedSkill): number =>
  Math.max(1, Math.ceil(skill.content.length / 4));

export const extractHeadings = (markdown: string): ReadonlyArray<string> => {
  const headings: Array<string> = [];
  let inFence = false;
  for (const rawLine of markdown.split("\n")) {
    if (/^```/.test(rawLine)) {
      inFence = !inFence;
      continue;
    }
    if (!inFence && /^#{1,3}\s+\S/.test(rawLine)) headings.push(rawLine.trim());
  }
  return headings;
};

export const previewBody = (markdown: string, lines: number): string => {
  const clamped = Math.max(0, Math.min(80, Math.trunc(lines)));
  if (clamped === 0) return "";
  return markdown.split("\n").slice(0, clamped).join("\n").trimEnd();
};

const isReferenceFile = (entry: string): boolean => {
  if (entry === "SKILL.md") return false;
  if (!entry.includes("/") && entry.endsWith(".ts")) return false;
  return true;
};

export const siblingReferences = async (skill: LoadedSkill): Promise<ReadonlyArray<string>> => {
  if (!skill.path.endsWith(SKILL_MD_SUFFIX)) return [];
  const directory = skill.path.slice(0, -SKILL_MD_SUFFIX.length);
  const found: Array<string> = [];
  try {
    const glob = new Bun.Glob("**/*").scan({ cwd: directory, onlyFiles: true });
    for await (const entry of glob) {
      if (isReferenceFile(entry)) found.push(entry);
    }
  } catch {
    return [];
  }
  return found.toSorted();
};

type Zone = "id" | "meta" | "description";
type ZoneTokens = Readonly<Record<Zone, ReadonlyArray<string>>>;

const ZONE_WEIGHTS: Readonly<Record<Zone, number>> = { id: 3, meta: 2, description: 1 };
const ZONES: ReadonlyArray<Zone> = ["id", "meta", "description"];

const skillZones = (skill: LoadedSkill): ZoneTokens => {
  const metaParts: Array<string> = [summaryOf(skill), skill.catalog.tier];
  if (skill.catalog.tier === "push") metaParts.push(skill.catalog.group);
  if (skill.catalog.tier === "pull") metaParts.push(skill.catalog.category);
  return {
    id: rawTokens(skill.id),
    meta: contentTokens(metaParts.join(" ")),
    description: contentTokens(skill.description),
  };
};

interface CorpusStats {
  readonly docs: ReadonlyMap<string, ZoneTokens>;
  readonly avgLengths: Readonly<Record<Zone, number>>;
  readonly docFreq: ReadonlyMap<string, number>;
  readonly totalDocs: number;
}

const statsCache = new WeakMap<ReadonlyArray<LoadedSkill>, CorpusStats>();

const meanZoneLength = (docs: ReadonlyArray<ZoneTokens>, zone: Zone): number =>
  docs.reduce((sum, doc) => sum + doc[zone].length, 0) / Math.max(1, docs.length) || 1;

const corpusStatsOf = (skills: ReadonlyArray<LoadedSkill>): CorpusStats => {
  const cached = statsCache.get(skills);
  if (cached !== undefined) return cached;

  const byId = new Map<string, ZoneTokens>();
  const docList: Array<ZoneTokens> = [];
  const docFreq = new Map<string, number>();

  for (const skill of skills) {
    const doc = skillZones(skill);
    byId.set(skill.id, doc);
    docList.push(doc);
    for (const word of new Set([...doc.id, ...doc.meta, ...doc.description])) {
      docFreq.set(word, (docFreq.get(word) ?? 0) + 1);
    }
  }

  const built: CorpusStats = {
    docs: byId,
    avgLengths: {
      id: meanZoneLength(docList, "id"),
      meta: meanZoneLength(docList, "meta"),
      description: meanZoneLength(docList, "description"),
    },
    docFreq,
    totalDocs: docList.length,
  };
  statsCache.set(skills, built);
  return built;
};

const weightedFrequencies = (
  doc: ZoneTokens,
  avgLengths: Readonly<Record<Zone, number>>,
): ReadonlyMap<string, number> => {
  const weights = new Map<string, number>();
  for (const zone of ZONES) {
    const tokens = doc[zone];
    if (tokens.length === 0) continue;
    const norm = ZONE_WEIGHTS[zone] / (1 - B + (B * tokens.length) / Math.max(1, avgLengths[zone]));
    for (const word of tokens) weights.set(word, (weights.get(word) ?? 0) + norm);
  }
  return weights;
};

const bestTermContribution = (
  term: string,
  weightedTf: ReadonlyMap<string, number>,
  stats: CorpusStats,
): number => {
  let best = 0;
  for (const [word, tf] of weightedTf) {
    const factor = word === term ? 1 : term.length >= 4 && word.startsWith(term) ? 0.35 : 0;
    if (factor === 0) continue;
    const df = stats.docFreq.get(word) ?? 0;
    const idf = Math.log(1 + (stats.totalDocs - df + 0.5) / (df + 0.5));
    const candidate = (factor * idf * tf * (K1 + 1)) / (tf + K1);
    if (candidate > best) best = candidate;
  }
  return best;
};

export const matchesSkillFilter = (
  skill: LoadedSkill,
  filter: {
    readonly tier?: "push" | "hub" | "pull" | "all" | undefined;
    readonly group?: PushGroup | undefined;
    readonly category?: PullCategory | undefined;
  },
): boolean => {
  if (filter.tier !== undefined && filter.tier !== "all" && skill.catalog.tier !== filter.tier) {
    return false;
  }
  if (filter.group !== undefined) {
    if (skill.catalog.tier !== "push" || skill.catalog.group !== filter.group) return false;
  }
  if (filter.category !== undefined) {
    if (skill.catalog.tier !== "pull" || skill.catalog.category !== filter.category) return false;
  }
  return true;
};

export const rankSkills = (
  skills: ReadonlyArray<LoadedSkill>,
  input: {
    readonly query: string;
    readonly tier?: "push" | "hub" | "pull" | undefined;
    readonly group?: PushGroup | undefined;
    readonly category?: PullCategory | undefined;
    readonly limit: number;
  },
): { readonly total: number; readonly hits: ReadonlyArray<RankedHit> } => {
  const scoped = skills.filter((skill) => matchesSkillFilter(skill, input));
  const queryTerms = queryTokensOf(input.query);
  if (queryTerms.length === 0 || scoped.length === 0) return { total: 0, hits: [] };

  const stats = corpusStatsOf(skills);
  const trimmedQuery = input.query.trim().toLowerCase();
  const scored: Array<RankedHit> = [];

  for (const skill of scoped) {
    const doc = stats.docs.get(skill.id);
    if (doc === undefined) continue;
    const tf = weightedFrequencies(doc, stats.avgLengths);
    let score = queryTerms.reduce((sum, term) => sum + bestTermContribution(term, tf, stats), 0);
    if (skill.id === trimmedQuery) score += 20;
    if (score > 0) scored.push({ skill, score: Math.round(score * 100) / 100 });
  }

  scored.sort(
    (left, right) => right.score - left.score || left.skill.id.localeCompare(right.skill.id),
  );

  return {
    total: scored.length,
    hits: scored.slice(0, Math.max(1, Math.min(25, Math.trunc(input.limit)))),
  };
};

const bigrams = (text: string): ReadonlySet<string> => {
  const set = new Set<string>();
  for (let i = 0; i < text.length - 1; i++) set.add(text.slice(i, i + 2));
  return set;
};

const diceSimilarity = (left: ReadonlySet<string>, right: ReadonlySet<string>): number => {
  if (left.size === 0 || right.size === 0) return 0;
  let shared = 0;
  for (const gram of left) {
    if (right.has(gram)) shared += 1;
  }
  return (2 * shared) / (left.size + right.size);
};

export const suggestIds = (
  skills: ReadonlyArray<LoadedSkill>,
  unknownId: string,
  limit = 5,
): ReadonlyArray<string> => {
  const needle = unknownId.trim().toLowerCase();
  const needleTokens = new Set(rawTokens(needle));
  const needleGrams = bigrams(needle);

  return skills
    .map((skill) => {
      const id = skill.id as string;
      const overlap = rawTokens(id).filter((token) => needleTokens.has(token)).length * 2;
      const substring = id.includes(needle) || needle.includes(id) ? 3 : 0;
      const dice = diceSimilarity(needleGrams, bigrams(id));
      const typoBonus = dice >= 0.35 ? dice * 3 : 0;
      return { id, score: overlap + substring + typoBonus };
    })
    .filter((entry) => entry.score > 0)
    .toSorted((left, right) => right.score - left.score || left.id.localeCompare(right.id))
    .slice(0, limit)
    .map((entry) => entry.id);
};
