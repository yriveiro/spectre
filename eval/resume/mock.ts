import type { Scenario } from "./scenario";
import { firstChild, pickStep, resolveInput, type Message } from "./script";

export type Mock = {
  /** The base URL the container reaches, through `host.docker.internal`. */
  readonly baseURL: string;
  readonly port: number;
  /** The path segment every request must carry. Generated per run. */
  readonly token: string;
  readonly stop: () => void;
};

const chunk = (input: {
  readonly id: string;
  readonly created: number;
  readonly delta: unknown;
  readonly finish: string | null;
}): string =>
  `data: ${JSON.stringify({
    id: input.id,
    object: "chat.completion.chunk",
    created: input.created,
    model: "resume",
    choices: [{ index: 0, delta: input.delta, finish_reason: input.finish }],
  })}\n\n`;

const textResponse = (value: string): string => {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  return (
    chunk({ id, created, delta: { role: "assistant", content: value }, finish: null }) +
    chunk({ id, created, delta: {}, finish: "stop" }) +
    "data: [DONE]\n\n"
  );
};

const toolResponse = (name: string, input: unknown): string => {
  const id = `chatcmpl-${crypto.randomUUID()}`;
  const created = Math.floor(Date.now() / 1000);
  return (
    chunk({
      id,
      created,
      delta: {
        role: "assistant",
        tool_calls: [
          {
            index: 0,
            id: `call_${crypto.randomUUID()}`,
            type: "function",
            function: { name, arguments: JSON.stringify(input) },
          },
        ],
      },
      finish: null,
    }) +
    chunk({ id, created, delta: {}, finish: "tool_calls" }) +
    "data: [DONE]\n\n"
  );
};

const completion = (value: string) => ({
  id: `chatcmpl-${crypto.randomUUID()}`,
  object: "chat.completion",
  created: Math.floor(Date.now() / 1000),
  model: "resume",
  choices: [{ index: 0, message: { role: "assistant", content: value }, finish_reason: "stop" }],
});

/**
 * A scripted OpenAI-compatible provider. The fixture decides what each side
 * says, so the scenario runs without a credential and the transcript is stable.
 *
 * The one stateful rule: after a tool result, the model answers "done". That is
 * what ends the turn. The next user prompt reaches `pickStep` and starts the
 * next scripted move.
 */
export const startMock = (scenario: Scenario, port = 0): Mock => {
  const token = crypto.randomUUID();
  const prefix = `/${token}/v1`;
  const server = Bun.serve({
    port,
    hostname: "0.0.0.0",
    async fetch(req) {
      const url = new URL(req.url);
      if (!url.pathname.startsWith(prefix)) return new Response("not found", { status: 404 });
      const route = url.pathname.slice(prefix.length);
      if (route === "/models")
        return Response.json({ object: "list", data: [{ id: "resume", object: "model" }] });
      if (route !== "/chat/completions") return new Response("not found", { status: 404 });

      const body = (await req.json()) as {
        readonly messages?: ReadonlyArray<Message>;
        readonly stream?: boolean;
      };
      const messages = body.messages ?? [];
      const last = messages.at(-1);
      const step = pickStep(scenario, messages);

      let value: string;
      if (last?.role === "tool") value = textResponse("done");
      else if (step?.tool !== undefined)
        value = toolResponse(step.tool, resolveInput(step.input ?? {}, firstChild(messages)));
      else if (step?.text !== undefined) value = textResponse(step.text);
      else value = textResponse("ok");

      if (body.stream === false) {
        // The SDK may ask for a non-streamed completion. A tool call cannot ride
        // this route here, so a step that names a tool asks for the stream.
        return Response.json(completion(step?.text ?? (last?.role === "tool" ? "done" : "ok")));
      }
      return new Response(value, { headers: { "content-type": "text/event-stream" } });
    },
  });

  const assigned = server.port;
  if (assigned === undefined) throw new Error("the mock server bound no TCP port");

  return {
    baseURL: `http://host.docker.internal:${assigned}/${token}`,
    port: assigned,
    token,
    stop: () => server.stop(true),
  };
};
