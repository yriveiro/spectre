import { dirname, join } from "node:path";
import { Option, Schema } from "effect";

/**
 * The installed d3 bundle, read from `node_modules` at publish time. d3 is a
 * normal dependency rather than a downloaded pin, so `bun update d3` is the
 * update path and the artifact records the bytes it was built with. The model
 * never sees this string; it reaches the artifact file map only.
 */
export type Bundle = {
  readonly version: string;
  readonly content: string;
};

export type BundleResult =
  | { readonly ok: true; readonly value: Bundle }
  | { readonly ok: false; readonly problem: string };

export type D3Resolver = () => Promise<BundleResult>;

const INSTALL_HINT = "run `bun install` (or `bun update d3` to upgrade the installed copy)";

/**
 * The only fields of a d3 `package.json` this module reads. Decoded at the
 * boundary with `Schema.decodeUnknownOption`, so a foreign shape is a refusal
 * rather than an unchecked read.
 */
const PackageMeta = Schema.Struct({
  name: Schema.optional(Schema.String),
  version: Schema.optional(Schema.String),
});
type PackageMeta = Schema.Schema.Type<typeof PackageMeta>;

/**
 * Resolve the installed d3 package from this module. `Bun.resolveSync` lands
 * on the package's ESM entry (measured at d3 7.9.2:
 * `node_modules/d3/dist/d3.mjs`), so the package root is the entry's parent
 * taken twice with `dirname`. An unresolvable package is `undefined`.
 */
const packageRoot = (): string | undefined => {
  let resolved: string;
  try {
    resolved = Bun.resolveSync("d3", import.meta.dir);
  } catch {
    return undefined;
  }
  return dirname(dirname(resolved));
};

const readMeta = async (root: string): Promise<Option.Option<PackageMeta>> => {
  let raw: unknown;
  try {
    raw = await Bun.file(join(root, "package.json")).json();
  } catch {
    return Option.none();
  }
  return Schema.decodeUnknownOption(PackageMeta)(raw);
};

/**
 * Read a d3 package root: `package.json` for the version, `dist/d3.min.js`
 * for the UMD bundle. A missing package or bundle is a refusal, never a throw,
 * so the page composer can report it without catching.
 */
export const readBundle = async (root: string): Promise<BundleResult> => {
  if (!(await Bun.file(join(root, "package.json")).exists())) {
    return { ok: false, problem: `d3 is not installed at ${root}; ${INSTALL_HINT}.` };
  }
  const meta = await readMeta(root);
  const version = meta._tag === "Some" ? meta.value.version : undefined;
  if (typeof version !== "string" || version.length === 0) {
    return {
      ok: false,
      problem: `d3 at ${root} has no version in its package.json; ${INSTALL_HINT}.`,
    };
  }
  const bundlePath = join(root, "dist", "d3.min.js");
  if (!(await Bun.file(bundlePath).exists())) {
    return {
      ok: false,
      problem: `d3 ${version} at ${root} has no dist/d3.min.js; ${INSTALL_HINT}.`,
    };
  }
  const content = await Bun.file(bundlePath).text();
  if (content.length === 0) {
    return {
      ok: false,
      problem: `d3 ${version} at ${root} has an empty dist/d3.min.js; ${INSTALL_HINT}.`,
    };
  }
  return { ok: true, value: { version, content } };
};

/**
 * Resolve the installed d3 package and read its bundle. The root derivation
 * is verified rather than assumed: the `package.json` at the derived root
 * must belong to d3, and any other layout refuses instead of reading from the
 * wrong directory.
 */
export const bundle: D3Resolver = async () => {
  const root = packageRoot();
  if (root === undefined) {
    return { ok: false, problem: `d3 is not installed; ${INSTALL_HINT}.` };
  }
  const meta = await readMeta(root);
  if (meta._tag === "None" || meta.value.name !== "d3") {
    return {
      ok: false,
      problem:
        `d3 resolved to an unexpected layout (${root}); ` +
        `expected a d3 package two levels up. ${INSTALL_HINT}.`,
    };
  }
  return readBundle(root);
};

export const version = async (): Promise<string | undefined> => {
  const root = packageRoot();
  if (root === undefined) return undefined;
  const meta = await readMeta(root);
  if (meta._tag === "None") return undefined;
  const value = meta.value.version;
  return typeof value === "string" && value.length > 0 ? value : undefined;
};
