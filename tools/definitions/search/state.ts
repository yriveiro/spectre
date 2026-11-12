import type { Session } from "@opencode/schema/session";
import type { Tool } from "@opencode/schema/tool";

/**
 * Per-session reroute memory for the `ripgrep` → `spectre_search` guard.
 *
 * `seen` holds one pattern set per session so a rerouted pattern stays on
 * `ripgrep` the second time (rule 4: already-asked). `rerouted` holds the
 * call ids the guard renamed so the tool can prefix the sentinel on the
 * answer. Both are capped and evict the oldest entry, because a session id
 * is never reused and an uncapped map grows with it.
 */

const MAX_SESSIONS = 64;
const MAX_REROUTED = 256;

export const seen: Map<Session.ID, Set<string>> = new Map();

export const rerouted: Set<Tool.CallID> = new Set();

export const sessionSeen = (sessionID: Session.ID): Set<string> => {
  const hit = seen.get(sessionID);
  if (hit !== undefined) return hit;
  if (seen.size >= MAX_SESSIONS) {
    const oldest = seen.keys().next();
    if (!oldest.done) seen.delete(oldest.value);
  }
  const fresh: Set<string> = new Set();
  seen.set(sessionID, fresh);
  return fresh;
};

export const markRerouted = (id: Tool.CallID): void => {
  if (rerouted.has(id)) return;
  if (rerouted.size >= MAX_REROUTED) {
    const oldest = rerouted.values().next();
    if (!oldest.done) rerouted.delete(oldest.value);
  }
  rerouted.add(id);
};
