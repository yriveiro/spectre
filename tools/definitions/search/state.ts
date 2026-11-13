import type { Session } from "@opencode/schema/session";
import type { Tool } from "@opencode/schema/tool";
import type { Memory } from "./policy";

/**
 * Per-session decision memory and the reroute record.
 *
 * `memories` holds one `Memory` per session, `remember` is its only writer, and
 * `rerouted` holds the call ids the guard renamed so the tool can prefix the
 * sentinel on the answer. Both are capped and evict the oldest entry, because a
 * session id is never reused and an uncapped map grows with it.
 */

const MAX_SESSIONS = 64;
const MAX_REROUTED = 256;

export const memories: Map<Session.ID, Memory> = new Map();

export const rerouted: Map<Tool.CallID, "grep" | "shell"> = new Map();

const evictOldest = <Key, Value>(map: Map<Key, Value>, cap: number): void => {
  if (map.size < cap) return;
  const oldest = map.keys().next();
  if (!oldest.done) map.delete(oldest.value);
};

const fresh = (): Memory => ({
  attached: false,
  subagent: false,
  // A session that has run no request snapshot has not been shown to lack the
  // tool, and a reroute that cannot resolve fails at the host in the same step.
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  editedCode: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
});

/** The session's `Memory`, created on first use, evicting the oldest at the cap. */
export const memoryOf = (sessionID: Session.ID): Memory => {
  const hit = memories.get(sessionID);
  if (hit !== undefined) return hit;
  evictOldest(memories, MAX_SESSIONS);
  const created = fresh();
  memories.set(sessionID, created);
  return created;
};

export const remember = (sessionID: Session.ID, next: Memory): void => {
  if (!memories.has(sessionID)) memoryOf(sessionID);
  memories.set(sessionID, next);
};

export const markRerouted = (id: Tool.CallID, origin: "grep" | "shell"): void => {
  if (rerouted.has(id)) return;
  evictOldest(rerouted, MAX_REROUTED);
  rerouted.set(id, origin);
};
