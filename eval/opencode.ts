export type Skill = { id: string; name: string; description: string };

/**
 * A part of an assistant turn. The field is `content`, not `parts`: measured, the
 * per-message route returns `id, time, type, agent, model, content, finish,
 * rawFinish, cost, tokens`, and no `parts` key exists anywhere in the response.
 */
export type Part = {
  type: string;
  name?: string;
  state?: { status?: string; input?: Record<string, unknown> };
  text?: string;
};

/** One item of the message list: a summary, not the message. */
export type MessageSummary = { id: string; type: string; skill?: string };

/** What `transcript` assembles: activations plus the assistant turns. */
export type Transcript = {
  activated: ReadonlyArray<string>;
  messages: ReadonlyArray<Message>;
  /** Set when a turn failed upstream, so the caller counts it rather than scoring silence. */
  failure?: TurnFailure;
};

/**
 * A skill activation is its own message, `Session.Message.Skill`, carrying the
 * `skill` id. That is the first-class record of a routing decision, better than
 * scraping a tool call out of an assistant turn.
 */
export type SkillMessage = { id: string; type: "skill"; skill: string; name?: string };

/** What `session.generate` answers with. */
export type GenerateResult = { text?: string; content?: string; data?: string } & Record<string, unknown>;

/** A full message, from the per-message route. */
export type Message = {
  id?: string;
  type?: string;
  role?: string;
  /** The parts of the turn. There is no `parts` field in the response. */
  content?: ReadonlyArray<Part>;
  /** "stop", "tool-calls", or "error". Measured: a rate limited turn is "error". */
  finish?: string;
  error?: { type?: string; message?: string; status?: number };
};

/**
 * A turn that failed upstream. Measured on the pinned model under load: every
 * request answers 200, the session goes idle with `outcome: "failed"`, and the
 * assistant turn carries `finish: "error"` with
 * `error.type: "provider.quota", status: 429` and no content. Nothing throws, so
 * a run of those reports zero failures and looks like a clean sweep of nothing.
 */
export type TurnFailure = { readonly reason: string; readonly kind: string };

export const failureOf = (message: Message): TurnFailure | undefined => {
  if (message.finish !== "error") return undefined;
  const kind = message.error?.type ?? "error";
  const why = message.error?.message;
  if (why === undefined) return { kind, reason: kind };
  const status = message.error?.status;
  return { kind, reason: status === undefined ? `${kind}: ${why}` : `${kind} ${status}: ${why}` };
};

export type Session = { id: string };

export type Model = { providerID: string; id: string; variant?: string };

export type ModelInfo = {
  providerID: string;
  id: string;
  variants?: ReadonlyArray<{ id: string }>;
};

type Envelope<T> = { data: T };

export class Opencode {
  readonly #url: URL;
  readonly #auth: string;

  constructor(
    private readonly directory: string,
    url: string,
    private readonly auth: string,
  ) {
    this.#url = new URL(url);
    this.#auth = auth.startsWith("Basic ") ? auth : `Basic ${btoa(`opencode:${auth}`)}`;
  }

  /**
   * `wait` and `remove` answer 204 with no body, so a JSON parse on every
   * response turns a completed request into "Unexpected end of JSON input" and
   * every row into a miss. An empty body is a result, not a failure.
   */
  async #call<T>(path: string, init?: RequestInit): Promise<T> {
    const url = new URL(path, this.#url);
    url.searchParams.set("directory", this.directory);
    const res = await fetch(url, {
      ...init,
      headers: { authorization: this.#auth, "content-type": "application/json", ...init?.headers },
    });
    if (!res.ok)
      throw new Error(`${init?.method ?? "GET"} ${path} -> ${res.status} ${await res.text()}`);
    const body = await res.text();
    if (body === "") return undefined as T;
    return (JSON.parse(body) as Envelope<T>).data;
  }

  /**
   * The project initialises lazily, so the first call for a fresh server answers
   * 200 with an empty array and the second has the catalogue. Measured: 0, then
   * 209. Treating one call as the truth reads as "no models exist" and skips the
   * sweep without saying why.
   */
  async #until<T>(read: () => Promise<ReadonlyArray<T>>, what: string): Promise<ReadonlyArray<T>> {
    for (let attempt = 0; attempt < 30; attempt++) {
      const value = await read();
      if (value.length > 0) return value;
      await Bun.sleep(300);
    }
    throw new Error(`${what} stayed empty after 30 attempts`);
  }

  /**
   * One read, deliberately not retried. The project initialises lazily, so a
   * fresh server answers with the global catalogue, which is never empty: a
   * "wait until non-empty" loop here returns the wrong set immediately and the
   * caller concludes every leaf is missing. What counts as ready is the presence
   * of one of our ids, and that is the caller's test because only the caller
   * knows the ids.
   */
  skills(): Promise<ReadonlyArray<Skill>> {
    return this.#call<ReadonlyArray<Skill>>("/api/skill");
  }

  /**
   * Every model this session can see, with its variants. The eval needs the
   * variant list because the pinned model carries five, and they are the only
   * axis that yields more than one arm from a single model.
   *
   * `/api/model` is the one route where empty genuinely means not ready: a fresh
   * server answers with an empty array and the second call has the catalogue.
   * Measured: 0, then 209.
   */
  models(): Promise<ReadonlyArray<ModelInfo>> {
    return this.#until(() => this.#call<ReadonlyArray<ModelInfo>>("/api/model"), "/api/model") as Promise<
      ReadonlyArray<ModelInfo>
    >;
  }

  session(model: Model, location?: Record<string, string>): Promise<Session> {
    return this.#call<Session>("/api/session", {
      method: "POST",
      body: JSON.stringify({ title: "skill-eval", model, ...(location === undefined ? {} : { location }) }),
    });
  }

  prompt(id: string, text: string): Promise<unknown> {
    return this.#call(`/api/session/${id}/prompt`, { method: "POST", body: JSON.stringify({ text }) });
  }

  /**
   * Blocking completion. Polling the message list races: a slow model leaves the
   * last message still a user turn, and the eval scores an empty reply as a miss.
   */
  wait(id: string): Promise<unknown> {
    return this.#call(`/api/experimental/session/${id}/wait`, { method: "POST" });
  }

  /**
   * A skill activation is its own message type, `Session.Message.Skill`, and the
   * list already carries its `skill` id, so activations cost no extra request.
   * Assistant turns arrive as summaries, so their `content` is fetched by id.
   */
  async transcript(id: string): Promise<Transcript> {
    const list = await this.#call<ReadonlyArray<MessageSummary>>(`/api/session/${id}/message`);
    const activated = list
      .filter((one) => one.type === "skill")
      .map((one) => one.skill)
      .filter((one): one is string => typeof one === "string" && one !== "");
    const messages = await Promise.all(
      list
        .filter((one) => one.type === "assistant")
        .map((one) => this.#call<Message>(`/api/session/${id}/message/${one.id}`)),
    );
    const failure = messages.map(failureOf).find((one) => one !== undefined);
    return { activated, messages, failure };
  }

  /**
   * A text completion against the session's own context, with no agent loop and
   * no tool execution. This is the instrument for the routing question: a full
   * prompt makes the model do the task, which it does by reading files and asking
   * a human for details, and it never reaches a routing decision. Measured on one
   * row: 120s of file reads and a `question` tool call, no skill ever loaded.
   */
  generate(id: string, prompt: string): Promise<GenerateResult> {
    return this.#call<GenerateResult>(`/api/session/${id}/generate`, {
      method: "POST",
      body: JSON.stringify({ prompt }),
    });
  }

  /** Escape hatch, for a route whose shape is not settled yet. */
  raw<T>(path: string, init?: RequestInit): Promise<T> {
    return this.#call<T>(path, init);
  }

  instructions(id: string): Promise<ReadonlyArray<{ key: string; value: string }>> {
    return this.#call<ReadonlyArray<{ key: string; value: string }>>(
      `/api/experimental/session/${id}/instructions/entries`,
    );
  }

  remove(id: string): Promise<unknown> {
    return this.#call(`/api/session/${id}`, { method: "DELETE" });
  }
}
