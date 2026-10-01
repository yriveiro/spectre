import { mkdir } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import type { ParsedFile } from "./parse";
import { refOf, run } from "./read";

/**
 * The artifact store on disk: where a canvas lives, how one is allocated, how the
 * saved ones are found again, and how a page is opened. Pure decisions sit in
 * `read.ts`; this module is the only one that writes.
 *
 * Two rules make the shapes here what they are. **The directory is the
 * identity**, never the filename, so `save` is idempotent on a slug and a second
 * call reports `taken` with the path that already exists rather than a second
 * artifact differing only by a second. And **nothing here overwrites a canvas**:
 * a page is written by the model with the `write` tool, and the only file this
 * module creates is evidence.
 */

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

const SLUG_MAX = 40;

const TITLE = /<title[^>]*>([\s\S]*?)<\/title>/i;

const ID = /\sid="([^"]+)"/g;

const ANCHOR = /href="#([^"]+)"/g;

/**
 * Kebab-case, because a slug is a directory name a person reads in a path and a
 * prose title is not one. This is the same rule `worktrees` applies to a worktree
 * name, spelled again rather than imported: a definition folder reaches only its
 * own internals, and `read.ts` already records that for the `gh` state
 * normalisation it shares with `stack/read.ts`.
 */
export const slugProblem = (raw: string): string | undefined => {
  if (raw === "") return "slug is empty";
  if (raw.length > SLUG_MAX) return `slug is longer than ${SLUG_MAX} characters`;
  if (!SLUG.test(raw))
    return "slug must be lowercase kebab-case: letters and digits, single hyphens between them";
  return undefined;
};

export const dataRoot = `${Bun.env.HOME ?? Bun.env.USERPROFILE}/.local/share/spectre`;

/**
 * `refOf` is the repo's one path-segment allowlist: it refuses `.`, `..`, and a
 * leading `-`, which is the set a name has to clear before it is joined onto a
 * root. A worktree name is a branch name by another route, so this is the same
 * check rather than a second one.
 */
export const treeOf = (
  projectDirectory: string,
  toplevel: string | undefined,
): string | undefined =>
  refOf(basename(projectDirectory)) ??
  (toplevel === undefined ? undefined : refOf(basename(toplevel)));

export const canvasesRoot = (tree: string): string => join(dataRoot, tree, "canvases");

export const canvasDirectory = (tree: string, slug: string): string =>
  join(canvasesRoot(tree), slug);

export const canvasFile = (directory: string): string => join(directory, "canvas.html");

export type Stored =
  | { readonly status: "saved"; readonly directory: string }
  | { readonly status: "taken"; readonly directory: string }
  | { readonly status: "refused"; readonly why: string };

/**
 * Allocate `<canvases>/<slug>/`, and refuse a slug already on disk rather than
 * reusing it. Two `mkdir` calls because `recursive: true` succeeds on an
 * existing directory, which is exactly the `taken` case this has to detect, and
 * the second call is what raises `EEXIST` on the one path that must not be
 * silently shared.
 */
export const save = async (tree: string, slug: string): Promise<Stored> => {
  const root = canvasesRoot(tree);
  const directory = canvasDirectory(tree, slug);
  try {
    await mkdir(root, { recursive: true });
    await mkdir(directory);
    return { status: "saved", directory };
  } catch (cause) {
    const code = (cause as { code?: string }).code;
    if (code === "EEXIST") return { status: "taken", directory };
    const why = cause instanceof Error ? cause.message : String(cause);
    return { status: "refused", why: `${directory}: ${why}` };
  }
};

export const exists = async (path: string): Promise<boolean> =>
  await Bun.file(path)
    .stat()
    .then(
      (one) => one.isFile(),
      () => false,
    );

export const titleOf = (html: string): string | undefined => {
  const found = TITLE.exec(html);
  const text = (found?.[1] ?? "").replace(/\s+/g, " ").trim();
  return text === "" ? undefined : text;
};

export type Row = {
  readonly id: string;
  readonly canvas: string;
  readonly title?: string;
};

/**
 * Every canvas saved under this tree, by glob rather than by directory listing so
 * a directory that holds something else is not a row. A slug whose page was
 * allocated but never written is not listed: there is nothing to reopen, and
 * `taken` on a second `save` is how that state is reported.
 */
export const list = async (tree: string): Promise<ReadonlyArray<Row>> => {
  const root = canvasesRoot(tree);
  const found: Array<Row> = [];
  const glob = new Bun.Glob("*/canvas.html");
  // A tree with no canvases yet has no root directory, and a glob over a missing
  // cwd throws ENOENT. No canvases is the state every first call is in, so it is
  // an empty list rather than a failed call.
  if (
    !(await Bun.file(root)
      .stat()
      .then(
        (one) => one.isDirectory(),
        () => false,
      ))
  )
    return found;

  for await (const canvas of glob.scan({ cwd: root, absolute: true, dot: false })) {
    const directory = canvas.slice(0, canvas.lastIndexOf("/"));
    const title = titleOf(await Bun.file(canvas).text());
    found.push({
      id: directory.slice(directory.lastIndexOf("/") + 1),
      canvas,
      ...(title === undefined ? {} : { title }),
    });
  }
  return found.toSorted((a, b) => (a.id < b.id ? -1 : 1));
};

export const launcherFor = (platform: string): string | undefined =>
  platform === "darwin"
    ? "open"
    : platform === "linux"
      ? "xdg-open"
      : platform === "win32"
        ? "start"
        : undefined;

/**
 * In-page anchors that resolve to no `id`. Lexical, and it is the only anchor
 * check worth its lines: it needs no scheme and no second file, so it can fail on
 * any page. The cross-check of `#f<n>-l<line>` against the evidence files stays
 * out until a renderer emits that scheme, at which point an unresolvable one is a
 * real link into a real row rather than a convention.
 */
export const deadLinks = (html: string): ReadonlyArray<string> => {
  const ids = new Set<string>();
  for (const found of html.matchAll(ID)) {
    const one = found[1];
    if (one !== undefined) ids.add(one);
  }
  const dead = new Set<string>();
  for (const found of html.matchAll(ANCHOR)) {
    const one = found[1];
    if (one !== undefined && one !== "" && !ids.has(one)) dead.add(one);
  }
  return [...dead].toSorted();
};

export type Presented =
  | {
      readonly status: "opened";
      readonly canvas: string;
      readonly deadLinks: ReadonlyArray<string>;
    }
  | { readonly status: "not-opened"; readonly canvas: string; readonly why: string };

/**
 * The OS launcher, and nothing else. There is no browser-tool fallback, so
 * `not-opened` is a real answer the caller reports with the path in hand rather
 * than a hole another tool fills.
 */
export const present = async (canvas: string, platform: string): Promise<Presented> => {
  const html = await Bun.file(canvas)
    .text()
    .catch(() => undefined);
  if (html === undefined) return { status: "not-opened", canvas, why: `${canvas} does not exist` };

  const launcher = launcherFor(platform);
  if (launcher === undefined)
    return {
      status: "not-opened",
      canvas,
      why: `no launcher is known for ${platform}, and guessing is a refusal`,
    };
  if (Bun.which(launcher) === null)
    return {
      status: "not-opened",
      canvas,
      why: `${launcher} is not on PATH, so nothing was opened`,
    };

  const launched = await run(dirname(canvas), [launcher, canvas]);
  if (!launched.ran) return { status: "not-opened", canvas, why: launched.err };

  return { status: "opened", canvas, deadLinks: deadLinks(html) };
};

export type EvidenceRow =
  | {
      readonly status: "read";
      readonly index: number;
      readonly path: string;
      readonly additions: number;
      readonly deletions: number;
      readonly evidence: string;
    }
  | {
      readonly status: "unreadable";
      readonly index: number;
      readonly path: string;
      readonly reason: string;
      readonly evidence: string;
    };

const evidenceName = (index: number): string => `${String(index).padStart(4, "0")}.json`;

const evidencePath = (directory: string, index: number): string =>
  join(directory, "evidence", "files", evidenceName(index));

/**
 * Write the whole diff to disk and return an inventory that points at it. The rows
 * never come back in the tool result: a 164-file pull request is a megabyte, and
 * the reader reads the files it needs with the `read` tool. **The tool does not
 * truncate** — a file is written whole, and which paths the page leaves out is the
 * page's to confess.
 */
export const writeEvidence = async (
  directory: string,
  manifest: unknown,
  files: ReadonlyArray<ParsedFile>,
): Promise<ReadonlyArray<EvidenceRow>> => {
  const rows: Array<EvidenceRow> = [];
  for (const file of files) {
    const evidence = evidencePath(directory, file.index);
    await Bun.write(evidence, `${JSON.stringify(file, null, 2)}\n`);
    rows.push(
      file.status === "read"
        ? {
            status: "read",
            index: file.index,
            path: file.path,
            additions: file.additions,
            deletions: file.deletions,
            evidence,
          }
        : {
            status: "unreadable",
            index: file.index,
            path: file.path,
            reason: file.reason,
            evidence,
          },
    );
  }
  await Bun.write(
    join(directory, "evidence", "index.json"),
    `${JSON.stringify(manifest, null, 2)}\n`,
  );
  return rows;
};
