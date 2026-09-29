import { Skill } from "@opencode/plugin/effect";
import { anchor, type Definition } from "../definition";

/**
 * The discipline of measuring readability on its two real axes.
 *
 * Applies to code already on the page that is hard to follow: a value you
 * cannot trace, a change you cannot scope, a layer with one caller that only
 * forwards. Every future reader pays twice, once in hops tracing where a
 * value comes from and once in state holding what can change it, and the two
 * are independent. Cutting one while growing the other is a transfer, not an
 * improvement.
 *
 * The test is timed: a new reader answers where X comes from and what can
 * change X in under thirty seconds. Narrow the state to a local, derive the
 * value rather than synchronizing it, and collapse the layer that hides
 * nothing.
 */
export const principleMinimizeReaderLoad: Definition = {
  id: Skill.ID.make("principle-minimize-reader-load"),
  name: Skill.Name.make("principle-minimize-reader-load"),
  description:
    "Maintainability is reader load on two independent axes: hops to trace and state to hold. Cut both. Load it when code is hard to follow, when you cannot answer where a value comes from or what can change it, or when a helper with one caller only forwards and you wonder whether to collapse it. The test is timed: a new reader answers both questions in under thirty seconds. Laziness is about the work and this is about the reading, so refusing the addition before it exists is principle-laziness-protocol, and where a check belongs is principle-boundary-discipline.",
  autoinvoke: false,
  path: anchor(import.meta.dir),
};
