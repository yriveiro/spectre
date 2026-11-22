/**
 * Which ripwire binary to call, and whether it is worth calling.
 *
 * `SPECTRE_RIPWIRE` wins over `Bun.which("ripwire")`, so a test or a pinned
 * install can hand the plugin its binary without touching PATH.
 */

import { binaryOf } from "./binary";
import type { Health } from "./policy";

const MIN_VERSION = "0.6.10";

const cache = new Map<string, Health>();

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

export const probe = async (): Promise<Health> => {
  const binary = binaryOf();
  if (binary === null)
    return { kind: "absent", why: "ripwire is not on PATH and SPECTRE_RIPWIRE is unset" };
  const hit = cache.get(binary);
  if (hit !== undefined) return hit;
  const health = await versionOf(binary);
  if (health.kind === "ready") cache.set(binary, health);
  return health;
};
