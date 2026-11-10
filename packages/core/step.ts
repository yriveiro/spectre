import { Effect } from "effect";

/**
 * Names one node of a block's internal graph. Compose steps with `Effect.gen`
 * or `Effect.all`, and each `step` shows up as a named span in the trace.
 */
export const step = <A, E, R>(id: string, effect: Effect.Effect<A, E, R>) =>
  effect.pipe(Effect.withSpan(`block.step.${id}`));
