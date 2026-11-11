import { mkdir } from "node:fs/promises";
import { isAbsolute, resolve, sep } from "node:path";
import { REPO } from "./docker";

const ROOT = resolve(REPO);
const isName = (value: unknown): value is string => typeof value === "string";
const manifest = (await Bun.file(`${ROOT}/package.json`).json()) as { readonly files?: unknown };
if (!Array.isArray(manifest.files) || !manifest.files.every(isName))
  throw new Error(`${ROOT}/package.json: "files" must be an array of strings`);

/** The `files` list is checkout input too, so it gets the same containment rule. */
const source = (name: string): string => {
  if (isAbsolute(name) || name.split("/").some((part) => part === ".."))
    throw new Error(`${ROOT}/package.json: files entry "${name}" leaves the checkout`);
  const path = resolve(ROOT, name);
  if (!path.startsWith(`${ROOT}${sep}`))
    throw new Error(`${ROOT}/package.json: files entry "${name}" leaves the checkout`);
  return path;
};

/**
 * The plugin root the container and the live server load. It is the published
 * surface plus the two things npm adds on its own: `package.json` and the
 * installed `node_modules`. Either copy keeps `.git`, `.env`, `eval/` and every
 * file outside the publish set out of the plugin directory the host can read.
 *
 * Docker mounts this directory read-only, so a hardlink copy is safe and cheap.
 * Live mode runs the plugin from a writable directory, so it gets a real copy:
 * a hardlink would let a write inside the plugin change the checkout too.
 */
const SOURCES: ReadonlyArray<string> = [
  ...new Set([...manifest.files, "package.json", "node_modules"]),
].map(source);

const copy = async (flags: ReadonlyArray<string>, target: string): Promise<string> => {
  const run = Bun.spawn(["cp", ...flags, ...SOURCES, target], {
    stdout: "ignore",
    stderr: "pipe",
  });
  const code = await run.exited;
  return code === 0 ? "" : await new Response(run.stderr).text();
};

export const preparePlugin = async (directory: string, mode: "mock" | "live"): Promise<string> => {
  const target = `${directory}/plugin`;
  await mkdir(target, { recursive: true });

  if (mode === "mock") {
    const failure = await copy(["-al"], target);
    if (failure !== "") throw new Error(`cp -al plugin failed: ${failure}`);
    return target;
  }

  const fast = process.platform === "darwin" ? ["-ac"] : ["-a", "--reflink=auto"];
  const fastFailure = await copy(fast, target);
  if (fastFailure === "") return target;

  // The clone is an optimisation. A filesystem without clone or reflink support
  // gets a full copy, which is slower and still isolated from the checkout.
  await Bun.$`rm -rf ${target}`.quiet();
  await mkdir(target, { recursive: true });
  const failure = await copy(["-a"], target);
  if (failure !== "") throw new Error(`cp -a plugin failed: ${failure}`);
  return target;
};
