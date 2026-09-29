import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of removing shared write targets before coordinating them.
 *
 * Reach for it the moment you are about to add locking, ordering, or retries
 * around state that two writers touch. Ask first whether the target must be
 * shared at all, and serialize structurally only when a single shared writer is
 * a real invariant you can state and defend. The original states no falsifiable
 * test; the moment is the test.
 */
export const principleSeparateBeforeSerializingSharedState: Definition = {
  id: Skill.ID.make("principle-separate-before-serializing-shared-state"),
  name: Skill.Name.make("principle-separate-before-serializing-shared-state"),
  description:
    "Stop reaching for locks and ordering the moment two writers share one target. Load it when you are about to add locking, queuing, retries, or coordination around shared mutable state, and first ask whether the target must be shared at all: give each writer its own copy, partition, or output, merged later by one reader, and serialize structurally only when a single shared writer is a real invariant you can state and defend. Coordination code that was never written has no races. Once writes are separated or serialized, the order they land in is principle-sequence-verifiable-units.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
