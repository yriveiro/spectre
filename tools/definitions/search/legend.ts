import { join } from "node:path";

const MAX_SESSIONS = 64;
const HASH_LINE = /^[0-9a-f]{16}$/;
const EXTRACT_TIMEOUT_MS = 2_000;

interface SessionSeen {
  readonly file: string;
  readonly hashes: Set<string>;
}

const sessions = new Map<string, SessionSeen>();

const safeName = (sessionID: string): string => sessionID.replace(/[^a-zA-Z0-9_-]/g, "_");

const seenPathFor = (sessionID: string): string => {
  const base = Bun.env.TMPDIR ?? "/tmp";
  return join(base, "spectre-ripwire-seen", `${safeName(sessionID)}.txt`);
};

const evictIfFull = (): void => {
  if (sessions.size < MAX_SESSIONS) return;
  const oldest = sessions.keys().next().value;
  if (oldest !== undefined) sessions.delete(oldest);
};

export const legendSeenFile = (sessionID: string): string | undefined => {
  const entry = sessions.get(sessionID);
  if (entry === undefined || entry.hashes.size === 0) return undefined;
  return entry.file;
};

const extractHashes = async (
  binary: string,
  xml: string,
): Promise<ReadonlyArray<string> | undefined> => {
  if (!xml.includes("<!--")) return [];
  const signal = AbortSignal.timeout(EXTRACT_TIMEOUT_MS);
  try {
    const proc = Bun.spawn([binary, "--legend-dict=seen"], {
      stdin: new Blob([xml]),
      stdout: "pipe",
      stderr: "pipe",
      signal,
    });
    const [out, code] = await Promise.all([new Response(proc.stdout).text(), proc.exited]);
    if (code !== 0 || signal.aborted) return undefined;
    return out
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => HASH_LINE.test(line));
  } catch {
    return undefined;
  }
};

export const recordLegendSeen = async (
  binary: string,
  sessionID: string,
  xml: string,
): Promise<boolean> => {
  const fresh = await extractHashes(binary, xml);
  if (fresh === undefined || fresh.length === 0) return false;

  const existing = sessions.get(sessionID);
  const file = existing?.file ?? seenPathFor(sessionID);
  const merged = new Set<string>(existing?.hashes ?? []);
  const before = merged.size;
  for (const hash of fresh) merged.add(hash);
  if (merged.size === before) return false;

  try {
    const body = `${[...merged].sort().join("\n")}\n`;
    await Bun.write(file, body);
  } catch {
    return false;
  }

  if (existing === undefined) evictIfFull();
  sessions.set(sessionID, { file, hashes: merged });
  return true;
};

export const clearLegendSeen = (sessionID?: string): void => {
  if (sessionID === undefined) {
    sessions.clear();
    return;
  }
  sessions.delete(sessionID);
};
