import type { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { agentIds } from "../../../agents";

export const isSpectre = (agent: string): boolean => agentIds.some((one) => one === agent);

export interface Facts {
  readonly isChild: boolean;
  readonly agent: string | undefined;
}

/**
 * A session holds the agent that was switched in, and that field is empty until
 * one is. An empty selection runs as the host default, and `agent.list` answers
 * the default first (`packages/core/src/agent.ts` at v2.3.0, `list`), so the
 * head of that list settles it.
 */
export const factsOf = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<Facts> =>
  ctx.session.get({ sessionID }).pipe(
    Effect.flatMap((info) => {
      const isChild = info.parentID !== undefined;
      if (info.agent !== undefined) return Effect.succeed({ isChild, agent: info.agent });
      return ctx.agent.list().pipe(
        Effect.map((listing) => ({ isChild, agent: listing.data.at(0)?.id })),
        Effect.catchCause(() => Effect.succeed({ isChild, agent: undefined })),
      );
    }),
    Effect.catchCause(() => Effect.succeed({ isChild: false, agent: undefined })),
  );
