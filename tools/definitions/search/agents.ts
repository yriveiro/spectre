import type { Plugin } from "@opencode/plugin/effect";
import type { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { agentIds } from "../../../agents";

export const isSpectre = (agent: string): boolean => agentIds.some((one) => one === agent);

export interface Facts {
  readonly parentID: boolean;
  readonly agent: string | undefined;
}

/**
 * A session holds the agent that was switched in, and that field is empty until
 * one is. An empty selection runs as the host default, and `agent.list` answers
 * the default first (`packages/core/src/agent.ts` at v2.2.7, `list`), so the
 * head of that list settles it. A failed read is no child and no agent: the
 * session is left alone rather than guessed at.
 */
export const factsOf = (ctx: Plugin.Context, sessionID: Session.ID): Effect.Effect<Facts> =>
  ctx.session.get({ sessionID }).pipe(
    Effect.flatMap((info) => {
      const parentID = info.parentID !== undefined;
      if (info.agent !== undefined) return Effect.succeed({ parentID, agent: info.agent });
      return ctx.agent.list().pipe(
        Effect.map((listing) => ({ parentID, agent: listing.data.at(0)?.id })),
        Effect.catchCause(() => Effect.succeed({ parentID, agent: undefined })),
      );
    }),
    Effect.catchCause(() => Effect.succeed({ parentID: false, agent: undefined })),
  );
