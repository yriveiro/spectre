import { basename } from "node:path";
import { Effect } from "effect";
import type { AbsolutePath } from "@opencode/schema/schema";

export type Claim = {
  readonly id: string;
  readonly kind: "feature" | "gotcha" | "decision" | "constraint" | "lesson";
  readonly claim: string;
  readonly subject: ReadonlyArray<string>;
  readonly at: string;
  readonly path: string;
};

type NoteFrontmatter = {
  readonly id?: string;
  readonly schema_version?: number;
  readonly kind?: string;
  readonly claim?: string;
  readonly subject?: ReadonlyArray<string>;
  readonly at?: string;
};

const SCHEMA_VERSION = 1;

const KINDS: ReadonlySet<string> = new Set([
  "feature",
  "gotcha",
  "decision",
  "constraint",
  "lesson",
]);

const BLOCK = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/;

const refuse = (note: AbsolutePath, why: string): Error =>
  new Error(`${basename(note)}: ${why}`);

const words = (value: unknown): string | undefined =>
  typeof value === "string" ? value : undefined;

const paths = (value: unknown): ReadonlyArray<string> | undefined =>
  Array.isArray(value) && value.every((path) => typeof path === "string")
    ? (value as ReadonlyArray<string>)
    : undefined;

export const parse = (text: string, note: AbsolutePath): Effect.Effect<Claim, Error> => {
  const block = text.match(BLOCK)?.[1];
  if (block === undefined) return Effect.fail(refuse(note, "no frontmatter block"));

  let frontmatter: unknown;
  try {
    frontmatter = Bun.YAML.parse(block);
  } catch (cause) {
    return Effect.fail(refuse(note, `frontmatter is not readable: ${cause}`));
  }

  if (typeof frontmatter !== "object" || frontmatter === null || Array.isArray(frontmatter))
    return Effect.fail(refuse(note, "frontmatter is not a mapping"));

  const fm = frontmatter as NoteFrontmatter;
  const kind: unknown = fm.kind;
  const claim: unknown = fm.claim;
  const subject: unknown = fm.subject;

  if (typeof kind !== "string" || !KINDS.has(kind))
    return Effect.fail(refuse(note, `kind is not one this version knows: ${JSON.stringify(kind)}`));
  if (typeof claim !== "string")
    return Effect.fail(refuse(note, `claim is missing or is ${JSON.stringify(claim)}`));

  const subjects = subject === undefined ? [] : paths(subject);
  if (subjects === undefined)
    return Effect.fail(refuse(note, `subject is not a list of paths: ${JSON.stringify(subject)}`));

  const id = words(fm.id);

  return Effect.succeed({
    id: id === undefined || id.length === 0 ? basename(note, ".md") : id,
    kind: kind as Claim["kind"],
    claim,
    subject: subjects,
    at: words(fm.at) ?? "",
    path: note,
  });
};

export const render = (claim: Claim): string =>
  [
    "---",
    Bun.YAML.stringify(
      {
        id: claim.id,
        schema_version: SCHEMA_VERSION,
        kind: claim.kind,
        claim: claim.claim,
        subject: claim.subject,
        at: claim.at,
      },
      null,
      2,
    ).replace(/[ \t]+$/gm, ""),
    "---",
    "",
    claim.claim,
    "",
  ].join("\n");