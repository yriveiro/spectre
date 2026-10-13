import type { Plugin } from "@opencode/plugin/effect";
import { promptCommand } from "../../definition";

/**
 * `/effect-align` is the routine that re-aligns `effect-best-practices/SKILL.md` with the
 * installed Effect.
 *
 * A version bump moves exports and call shapes, and deciding what the body should say about the
 * new ones needs reading the source and judging. That is the session's work, so this hands it
 * the order. The forcing half is mechanical and lives in `test/skills/effect-version.test.ts`
 * and `probe.ts`, neither of which this command can reach.
 */
export const effectAlign = (ctx: Pick<Plugin.Context, "session">) =>
  promptCommand(ctx, import.meta.dir, {
    name: "effect-align",
    description: "re-align effect-best-practices with the installed Effect version",
  });