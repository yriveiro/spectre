import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of not spending attention that is not yours to spend.
 *
 * Two moments of the same question. Before the code exists: deletion before
 * addition, and a signal you were told to thread as a design question. After
 * the code exists: the reader is not a role but a position, which the agent
 * occupies as much as any human does. The first moment is cheaper because it
 * answers the second before there is anything to read.
 *
 * This leaf carries two tests, "what would a deletion have avoided" and
 * "where does this value come from". See `principle-laziness-protocol/SKILL.md`,
 * which names the other owners: `principle-hygiene` for upkeep and
 * `principle-boundary-discipline` for where a check belongs.
 */
export const principleLazinessProtocol: Definition = {
  id: Skill.ID.make("principle-laziness-protocol"),
  name: Skill.Name.make("principle-laziness-protocol"),
  description:
    "Make the code easy to follow, and refuse to add to it. Load it when something is hard to follow, impossible to trace, or a pain to understand, when you are asked where a value comes from or what can change it, when a class, helper, or wrapper has one caller and only forwards and you wonder whether to collapse, flatten, or inline it, when you are tempted to extract a service class or add an abstraction for a single call site, and before you accept a task that says thread a flag through five layers. Reader load has two independent axes, hops to trace and state to hold, so ask both: cut the layer that hides nothing, keep state as narrow as a local, derive a value rather than synchronize it, and name the invariant once. Then the moment before: a refactor starts by looking for what to remove, and a signal you were told to thread is a design question. A boundary that hides a real decision stays, because that boundary is load reduction. Where a check belongs is principle-boundary-discipline, and accumulated concessions are principle-hygiene.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
