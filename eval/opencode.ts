import {
  type ModelInfo,
  OpenCode,
  type OpenCodeClient,
  type SessionMessageAssistant,
  type SessionMessageInfo,
} from "@opencode/client";

export type Transcript = {
  readonly activated: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<SessionMessageAssistant>;
  readonly failure?: TurnFailure;
};

/**
 * Measured on the pinned model under load: an upstream failure answers HTTP 200,
 * idles the session with `outcome: "failed"`, and records `finish: "error"` with
 * `error.status` on the assistant message instead of failing the request.
 */
export type TurnFailure = { readonly reason: string; readonly kind: string };

export const failureOf = (
  message: Pick<SessionMessageAssistant, "finish" | "error">,
): TurnFailure | undefined => {
  if (message.finish !== "error") return undefined;
  const kind = message.error?.type ?? "error";
  const why = message.error?.message;
  if (why === undefined || why === "") return { kind, reason: kind };
  const status = message.error?.status;
  return { kind, reason: status === undefined ? `${kind}: ${why}` : `${kind} ${status}: ${why}` };
};

/**
 * A fresh server initialises the project lazily: the first `/api/model` call
 * answers 200 with an empty `data` array and the next carries the catalogue
 * (measured: 0, then 209).
 */
const untilNonEmpty = async <T>(
  read: () => Promise<ReadonlyArray<T>>,
  what: string,
): Promise<ReadonlyArray<T>> => {
  for (let attempt = 0; attempt < 30; attempt++) {
    const value = await read();
    if (value.length > 0) return value;
    await Bun.sleep(300);
  }
  throw new Error(`${what} stayed empty after 30 attempts`);
};

export type Opencode = OpenCodeClient & {
  readonly directory: string;
  models(): Promise<ReadonlyArray<ModelInfo>>;
  transcript(sessionID: string): Promise<Transcript>;
};

export const connect = (directory: string, baseUrl: string, password: string): Opencode => {
  const client = OpenCode.make({
    baseUrl,
    headers: { authorization: `Basic ${btoa(`opencode:${password}`)}` },
  });
  const location = { directory };

  return {
    ...client,
    directory,
    models: () =>
      untilNonEmpty(async () => (await client.model.list({ location })).data, "/api/model"),
    transcript: async (sessionID: string): Promise<Transcript> => {
      // `/api/session/:sessionID/message` defaults `order` to `"desc"`, rejects
      // `cursor` combined with `order`, and sets `cursor.next` on every non-empty
      // page (`packages/server/src/handlers/message.ts:38-60` at `v2.3.0`).
      const all: Array<SessionMessageInfo> = [];
      let cursor: string | undefined;
      for (;;) {
        const page = await client.message.list(
          cursor === undefined
            ? { sessionID, order: "asc", limit: 200 }
            : { sessionID, cursor, limit: 200 },
        );
        all.push(...page.data);
        if (page.data.length < 200 || page.cursor.next === undefined || page.cursor.next === null)
          break;
        cursor = page.cursor.next;
      }
      const activated = all
        .filter((one) => one.type === "skill")
        .map((one) => one.skill)
        .filter((one) => one !== "");
      const messages = all.filter((one) => one.type === "assistant");
      const failure = messages.map(failureOf).find((one) => one !== undefined);
      return { activated, messages, failure };
    },
  };
};
