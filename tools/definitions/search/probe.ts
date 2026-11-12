/**
 * Which ripwire binary to call, and whether it is worth calling.
 *
 * `SPECTRE_RIPWIRE` wins over `Bun.which("ripwire")`, so a test or a pinned
 * install can hand the plugin its binary without touching PATH.
 */

/**
 * The health of the ripwire instrument. This mirrors `Health` in
 * `./policy.ts` (worker 2's slice) field for field, so this file typechecks
 * on a branch that does not hold it yet. The wave 2 integration collapses
 * this to `import type { Health } from "./policy.ts"` and deletes the local
 * definition; the two are structurally identical, so nothing else changes.
 */
export type Health =
  | { readonly kind: "ready"; readonly binary: string; readonly version: string }
  | { readonly kind: "absent"; readonly why: string }
  | { readonly kind: "stale"; readonly binary: string; readonly version: string };

const MIN_VERSION = "0.6.10";

/** One fact per binary path: a version answer does not move under a process. */
const cache = new Map<string, Health>();

const binaryOf = (): string | null => {
  const env = Bun.env.SPECTRE_RIPWIRE;
  if (env !== undefined && env !== "") return env;
  return Bun.which("ripwire");
};

const versionOf = async (binary: string): Promise<Health> => {
  let out: string;
  try {
    const proc = Bun.spawn([binary, "--version"], { stdout: "pipe", stderr: "pipe" });
    const [text, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0) return { kind: "absent", why: `${binary} --version exited ${code}` };
    out = text;
  } catch {
    return { kind: "absent", why: `${binary} could not be started` };
  }
  const match = /ripwire\s+(\d+\.\d+\.\d+)/.exec(out);
  if (match?.[1] === undefined)
    return { kind: "absent", why: `${binary} --version did not print a version` };
  const version = match[1];
  if (Bun.semver.order(version, MIN_VERSION) >= 0) return { kind: "ready", binary, version };
  return { kind: "stale", binary, version };
};

/**
 * Resolve the binary once and remember what it said. No binary at all is
 * `absent`, a spawn failure is `absent`, and a version below 0.6.10 is
 * `stale` — the caller never reroutes on either.
 */
export const probe = async (): Promise<Health> => {
  const binary = binaryOf();
  if (binary === null)
    return { kind: "absent", why: "ripwire is not on PATH and SPECTRE_RIPWIRE is unset" };
  const hit = cache.get(binary);
  if (hit !== undefined) return hit;
  const health = await versionOf(binary);
  cache.set(binary, health);
  return health;
};
