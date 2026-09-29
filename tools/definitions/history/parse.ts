export type Commit = {
  readonly sha: string;
  readonly short: string;
  readonly date: string;
  readonly author: string;
  readonly subject: string;
  readonly body: string;
  /** A subject opening with `Revert ` is a revert, whatever else it says. */
  readonly reverts: boolean;
};

const FIELD = "\x1f";
const RECORD = "\x1e";

/**
 * The separator is a control character, not a tab or a colon, because a commit
 * subject and body both contain colons and tabs routinely. Splitting on those
 * loses the field boundary on the first commit that quotes a log line.
 */
/**
 * `%b` is the last field and it is empty for a commit with no body, so a
 * trailing separator with nothing after it is the normal shape of most records
 * rather than a truncated read. The reader must not depend on six fields being
 * present to tell a real commit from a broken one.
 */
export const FORMAT = ["%H", "%h", "%aI", "%an", "%s", "%b"].join(FIELD) + RECORD;

/**
 * `git log` separates its own records with a newline as well as the record
 * separator this format adds, so each record arrives with a leading newline and
 * a trailing one. Those two are stripped and the interior is left alone, because
 * a multi-line `%b` is the whole reason the field exists. Trimming the interior
 * would merge the next record's sha into this commit's body.
 */
export const parse = (raw: string): ReadonlyArray<Commit> =>
  raw
    .split(RECORD)
    .map((record) => record.replace(/^\n+/, "").replace(/\n+$/, ""))
    .filter((record) => record.trim() !== "")
    .map((record) => {
      const [sha = "", short = "", date = "", author = "", subject = "", ...bodyLines] =
        record.split(FIELD);
      return {
        sha,
        short,
        date,
        author,
        subject,
        // The body can itself hold the field separator, so it is rejoined rather
        // than read as one field.
        body: bodyLines.join(FIELD).trim(),
        reverts: /^Revert\b/.test(subject),
      };
    })
    // A sha shaped like a sha and a subject that is not empty, so a truncated
    // or shifted record is dropped rather than reported as evidence. Half a
    // commit reads like a finding and names nothing.
    .filter(
      (one) =>
        /^[0-9a-f]{7,40}$/.test(one.sha) &&
        /^[0-9a-f]{7,40}$/.test(one.short) &&
        one.subject !== "",
    );

export type Blame = {
  readonly line: number;
  readonly sha: string;
  readonly author: string;
  readonly date: string;
  readonly summary: string;
};

/**
 * `git blame -s` is `<sha> <line>) <text>`. It carries no author and no date,
 * the sha is caret-prefixed on a boundary commit, and the text is whatever the
 * author wrote, so the only reliable boundary is a parenthesis. The long form
 * is line-oriented key/value instead, which is why `read.ts` asks for that.
 */
export const parseShort = (raw: string, line: number): Blame | null => {
  const head = raw.split("\n")[0]?.trim() ?? "";
  // A leading `^` marks a boundary commit, so the sha field is `\^?[0-9a-f]+`.
  const matched = /^(\^?[0-9a-f]+)\s\d+\)?\s?(.*)$/.exec(head);
  if (matched === null) return null;
  return {
    line,
    sha: matched[1]!,
    author: "",
    date: "",
    summary: matched[2]!,
  };
};

/** One `--line-porcelain` record: a sha header line, then key/value pairs. */
export const parsePorcelain = (raw: string, line: number): Blame | null => {
  const [header, ...rest] = raw.split("\n");
  const matched = /^([0-9a-f]{7,40})\s\d+\s\d+/.exec((header ?? "").trim());
  if (matched === null) return null;

  const fields = new Map<string, string>();
  for (const one of rest) {
    const at = one.indexOf(" ");
    if (at > 0 && !fields.has(one.slice(0, at))) fields.set(one.slice(0, at), one.slice(at + 1));
  }

  const stamp = fields.get("author-time") ?? "";
  return {
    line,
    sha: matched[1]!,
    author: fields.get("author") ?? "",
    date: stamp === "" ? "" : new Date(Number(stamp) * 1000).toISOString().slice(0, 10),
    summary: fields.get("summary") ?? "",
  };
};
