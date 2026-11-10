import type { Plugin } from "@opencode/plugin/effect";
import type { ToolHooks } from "@opencode/plugin/effect/tool";
import type { Effect, Scope } from "effect";

/** The two tool hooks a block may register. */
export type HookName = keyof ToolHooks;

/**
 * What a block says it registers. `surfaceProblems` compares the declaration
 * against what a block registered, so a forgotten surface fails a test rather
 * than a session. The bundle cannot make that comparison at registration time:
 * the host runs transform callbacks lazily, after the plugin effect returns.
 */
export interface Surfaces {
  /** Effective tool names, as the host builds them: `spectre_routing`. */
  readonly tools: readonly string[];
  readonly skills: readonly string[];
  /** Command names without the leading slash. */
  readonly commands: readonly string[];
  readonly agents: readonly string[];
  readonly hooks: readonly HookName[];
}

/**
 * One capability, one level below a plugin.
 *
 * `effect` has the same shape as `Plugin.effect`: it receives the real
 * `Plugin.Context` and registers through the SDK's own transform and hook
 * methods. There is no block-specific registration API to learn.
 *
 * A block may return a typed failure. The bundle keeps that failure local to
 * the block; defects and interrupts are rethrown, so the plugin effect the host
 * sees stays `never`.
 */
export interface Block {
  /** Stable identity of the capability, e.g. `spectre.routing`. */
  readonly id: string;
  readonly surfaces: Surfaces;
  readonly effect: (ctx: Plugin.Context) => Effect.Effect<void, unknown, Scope.Scope>;
}

export const defineBlock = <B extends Block>(block: B): B => block;
