import { realpath } from "node:fs/promises";
import { resolve, sep } from "node:path";
import type { WorkspacePath } from "./scenario";

const gone = (error: unknown): boolean =>
  typeof error === "object" &&
  error !== null &&
  "code" in error &&
  (error as { readonly code?: unknown }).code === "ENOENT";

/**
 * Resolve a fixture path against the run's workspace. The parser already proved
 * the path is relative and stays inside. This check belongs at the sink too,
 * because a cast can carry a value the parser never saw.
 */
export const resolveIn = (workspace: string, path: WorkspacePath): string => {
  const base = resolve(workspace);
  const target = resolve(base, path);
  if (!target.startsWith(`${base}${sep}`))
    throw new Error(`${path}: escapes the workspace ${base}`);
  return target;
};

/**
 * Read a file the fixture names. `realpath` resolves a symlink the model may
 * have left in the workspace, so the read cannot leave the workspace through
 * one. A missing file is an empty result; an escape is a failure.
 */
export const readIn = async (workspace: string, path: WorkspacePath): Promise<string> => {
  const base = await realpath(workspace).catch((error: unknown) => {
    if (gone(error)) return undefined;
    throw error;
  });
  if (base === undefined) return "";

  const target = resolveIn(base, path);
  const real = await realpath(target).catch((error: unknown) => {
    if (gone(error)) return undefined;
    throw error;
  });
  if (real === undefined) return "";
  if (!real.startsWith(`${base}${sep}`))
    throw new Error(`${path}: resolves outside the workspace ${base}`);
  return (await Bun.file(real).text()).trimEnd();
};
