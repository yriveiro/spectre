import { rm } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import { Schema } from "effect";
import type { FileRow as FileRowType } from "./content";
import {
  Cross as CrossSchema,
  FileRow as FileRowSchema,
  Subject as SubjectSchema,
} from "./content";
import type { ParsedFile } from "./parse";
import type { CrossCheck, Read, Subject as SubjectType } from "./read";

const dataRoot = `${Bun.env.HOME ?? Bun.env.USERPROFILE}/.local/share/spectre`;
export const CACHE_ROOT = join(dataRoot, "cache", "diff");

const projectDigest = (projectDirectory: string): string =>
  Bun.hash(projectDirectory).toString(16).slice(0, 8);

const validToken = (token: string): boolean => {
  if (token === "") return false;
  if (token.includes("/")) return false;
  if (token.includes("..")) return false;
  return /^[A-Za-z0-9_-]+$/.test(token);
};

// Schemas for the stored parsed file.
const HunkRowSchema = Schema.Struct({ kind: Schema.Literals(["hunk"]), header: Schema.String });
const ContextRowSchema = Schema.Struct({
  kind: Schema.Literals(["context"]),
  old: Schema.Number,
  new: Schema.Number,
  text: Schema.String,
});
const RemovedRowSchema = Schema.Struct({
  kind: Schema.Literals(["removed"]),
  old: Schema.Number,
  text: Schema.String,
});
const AddedRowSchema = Schema.Struct({
  kind: Schema.Literals(["added"]),
  new: Schema.Number,
  text: Schema.String,
});
const DiffRowSchema = Schema.Union([
  HunkRowSchema,
  ContextRowSchema,
  RemovedRowSchema,
  AddedRowSchema,
]);

const ReadFileSchema = Schema.Struct({
  status: Schema.Literals(["read"]),
  index: Schema.Number,
  path: Schema.String,
  rows: Schema.Array(DiffRowSchema),
  additions: Schema.Number,
  deletions: Schema.Number,
});
const UnreadableFileSchema = Schema.Struct({
  status: Schema.Literals(["unreadable"]),
  index: Schema.Number,
  path: Schema.String,
  reason: Schema.String,
});
const ParsedFileSchema = Schema.Union([ReadFileSchema, UnreadableFileSchema]);

const ManifestSchema = Schema.Struct({
  token: Schema.String,
  subject: SubjectSchema,
  cross: CrossSchema,
  problems: Schema.Array(Schema.String),
  rows: Schema.Array(FileRowSchema),
});

export type Evidence = {
  readonly token: string;
  readonly directory: string;
  readonly subject: SubjectType;
  readonly files: ReadonlyArray<ParsedFile>;
  readonly cross: CrossCheck;
  readonly problems: ReadonlyArray<string>;
  readonly rows: ReadonlyArray<FileRowType>;
};

const deriveToken = (read: Extract<Read, { status: "read" }>): string => {
  const digest6 = Bun.hash(
    JSON.stringify({
      subject: read.subject,
      files: read.files,
      cross: read.cross,
      problems: read.problems,
    }),
  )
    .toString(16)
    .slice(0, 6);
  if (read.subject.kind === "pull-request") {
    return `pr-${read.subject.number}-${read.subject.headSha.slice(0, 7)}-${digest6}`;
  }
  return `local-${read.subject.headSha.slice(0, 7)}-${digest6}`;
};

export const write = async (
  projectDirectory: string,
  read: Extract<Read, { status: "read" }>,
  now: number = Date.now(),
): Promise<Evidence> => {
  const token = deriveToken(read);
  const digest = projectDigest(projectDirectory);
  const directory = join(CACHE_ROOT, digest, token);

  const existing = await load(projectDirectory, token);
  if (existing !== undefined) return existing;

  const filesDir = join(directory, "files");
  const rows: Array<FileRowType> = [];
  for (const file of read.files) {
    const filePath = join(filesDir, `${String(file.index).padStart(4, "0")}.json`);
    await Bun.write(filePath, `${JSON.stringify(file, null, 2)}\n`);
    if (file.status === "read") {
      rows.push({
        status: "read",
        index: file.index,
        path: file.path,
        additions: file.additions,
        deletions: file.deletions,
        rows: filePath,
      });
    } else {
      rows.push({
        status: "unreadable",
        index: file.index,
        path: file.path,
        reason: file.reason,
        rows: filePath,
      });
    }
  }

  const manifest = {
    token,
    subject: read.subject,
    cross: read.cross,
    problems: read.problems,
    rows,
  };
  await Bun.write(join(directory, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  // prune old token dirs under this project's digest
  const projectDir = join(CACHE_ROOT, digest);
  try {
    const glob = new Bun.Glob("*");
    for await (const name of glob.scan({ cwd: projectDir, onlyFiles: false })) {
      const full = join(projectDir, name);
      const stat = await Bun.file(full)
        .stat()
        .catch(() => null);
      if (stat === null || !stat.isDirectory()) continue;
      if (name === token) continue;
      const age = now - stat.mtimeMs;
      if (age > 7 * 24 * 60 * 60 * 1000) {
        await rm(full, { recursive: true, force: true });
      }
    }
  } catch {
    // project dir may not exist; nothing to prune
  }

  return {
    token,
    directory,
    subject: read.subject,
    files: read.files,
    cross: read.cross,
    problems: read.problems,
    rows,
  };
};

export const load = async (
  projectDirectory: string,
  token: string,
): Promise<Evidence | undefined> => {
  if (!validToken(token)) return undefined;
  const digest = projectDigest(projectDirectory);
  const directory = join(CACHE_ROOT, digest, token);
  const manifestPath = join(directory, "manifest.json");

  let manifestText: string;
  try {
    manifestText = await Bun.file(manifestPath).text();
  } catch {
    return undefined;
  }
  let raw: unknown;
  try {
    raw = JSON.parse(manifestText);
  } catch {
    return undefined;
  }
  const decodedManifest = Schema.decodeUnknownOption(ManifestSchema)(raw);
  if (decodedManifest._tag === "None") return undefined;
  const manifest = decodedManifest.value;

  if (manifest.token !== token) return undefined;

  const files: Array<ParsedFile> = [];
  const rows: Array<FileRowType> = [];
  for (const row of manifest.rows) {
    const resolved = resolve(row.rows);
    const rel = relative(directory, resolved);
    if (rel === "" || rel.startsWith("..") || isAbsolute(rel)) return undefined;

    let content: string;
    try {
      content = await Bun.file(row.rows).text();
    } catch {
      return undefined;
    }
    let rawFile: unknown;
    try {
      rawFile = JSON.parse(content);
    } catch {
      return undefined;
    }
    const decodedFile = Schema.decodeUnknownOption(ParsedFileSchema)(rawFile);
    if (decodedFile._tag === "None") return undefined;
    files.push(decodedFile.value);
    rows.push(row);
  }

  return {
    token,
    directory,
    subject: manifest.subject,
    files,
    cross: manifest.cross,
    problems: manifest.problems,
    rows,
  };
};
