import {
  type ModelInfo,
  OpenCode,
  type OpenCodeClient,
  type SessionMessageAssistant,
  type SessionMessageInfo,
} from "@opencode/client";
import {
  OpenCode as OpenCodeEffect,
  type OpenCodeClient as OpenCodeEffectClient,
} from "@opencode/client/effect";
import { Effect } from "effect";
import { FetchHttpClient, HttpClient, HttpClientRequest } from "effect/http";

export type UsageSummary = {
  readonly input: number;
  readonly output: number;
  readonly reasoning: number;
  readonly cacheRead: number;
  readonly cacheWrite: number;
  readonly total: number;
  readonly cost: number;
};

export const summarizeUsage = (
  messages: ReadonlyArray<Pick<SessionMessageAssistant, "tokens" | "cost">>,
): UsageSummary => {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  for (const message of messages) {
    if (message.tokens !== undefined) {
      input += message.tokens.input;
      output += message.tokens.output;
      reasoning += message.tokens.reasoning;
      cacheRead += message.tokens.cache.read;
      cacheWrite += message.tokens.cache.write;
    }
    if (message.cost !== undefined) cost += message.cost;
  }
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cost,
  };
};

export const addUsage = (summaries: ReadonlyArray<UsageSummary>): UsageSummary => {
  let input = 0;
  let output = 0;
  let reasoning = 0;
  let cacheRead = 0;
  let cacheWrite = 0;
  let cost = 0;
  for (const one of summaries) {
    input += one.input;
    output += one.output;
    reasoning += one.reasoning;
    cacheRead += one.cacheRead;
    cacheWrite += one.cacheWrite;
    cost += one.cost;
  }
  return {
    input,
    output,
    reasoning,
    cacheRead,
    cacheWrite,
    total: input + output + reasoning + cacheRead + cacheWrite,
    cost,
  };
};

export type Transcript = {
  readonly activated: ReadonlyArray<string>;
  readonly messages: ReadonlyArray<SessionMessageAssistant>;
  readonly failure?: TurnFailure;
  readonly usage?: UsageSummary;
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
  effect(): Promise<OpenCodeEffectClient>;
};

const connectEffect = (baseUrl: string, authorization: string): Promise<OpenCodeEffectClient> =>
  Effect.runPromise(
    Effect.gen(function* () {
      const http = yield* HttpClient.HttpClient;
      return yield* OpenCodeEffect.make({ baseUrl }).pipe(
        Effect.provideService(
          HttpClient.HttpClient,
          HttpClient.mapRequest(http, (request) =>
            HttpClientRequest.setHeaders(request, { authorization }),
          ),
        ),
      );
    }).pipe(Effect.provide(FetchHttpClient.layer)),
  );

export const connect = (directory: string, baseUrl: string, password: string): Opencode => {
  const authorization = `Basic ${btoa(`opencode:${password}`)}`;
  const client = OpenCode.make({ baseUrl, headers: { authorization } });
  const location = { directory };

  return {
    ...client,
    directory,
    effect: () => connectEffect(baseUrl, authorization),
    models: () =>
      untilNonEmpty(async () => (await client.model.list({ location })).data, "/api/model"),
    transcript: async (sessionID: string): Promise<Transcript> => {
      // `/api/session/:sessionID/message` defaults `order` to `"desc"`, rejects
      // `cursor` combined with `order`, and sets `cursor.next` on every non-empty
      // page (`packages/server/src/handlers/message.ts:38-60` at `v2.4.2`).
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
      const usage = summarizeUsage(messages);
      return { activated, messages, failure, usage };
    },
  };
};
