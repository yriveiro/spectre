import { describe, expect, test } from "bun:test";
import type { ModelInfo, SessionMessageInfo } from "@opencode/client";
import { connect } from "../opencode";

const modelRow: ModelInfo = {
  id: "minimax-m3.1-flash-free",
  modelID: "minimax-m3.1-flash-free",
  providerID: "opencode-go",
  name: "MiniMax",
  capabilities: { tools: true, input: ["text"], output: ["text"] },
  variants: [{ id: "low" }, { id: "high" }],
  time: { released: 0 },
  cost: [],
  status: "active",
  enabled: true,
  limit: { context: 128_000, output: 8_192 },
};

describe("connect", () => {
  test("models() sends Basic auth and location[directory], and retries an initial empty list", async () => {
    const requests: Array<{ auth: string | null; directory: string | null }> = [];
    let calls = 0;
    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/api/model") return new Response("not found", { status: 404 });
        requests.push({
          auth: req.headers.get("authorization"),
          directory: url.searchParams.get("location[directory]"),
        });
        calls += 1;
        return Response.json({
          location: { directory: "/workspace" },
          data: calls === 1 ? [] : [modelRow],
        });
      },
    });

    const client = connect("/workspace", `http://127.0.0.1:${server.port}`, "secret-pw");
    const models = await client.models();

    expect(calls).toBe(2);
    expect(models.map((one) => `${one.providerID}/${one.id}`)).toEqual([
      "opencode-go/minimax-m3.1-flash-free",
    ]);
    expect(requests).toEqual([
      { auth: `Basic ${btoa("opencode:secret-pw")}`, directory: "/workspace" },
      { auth: `Basic ${btoa("opencode:secret-pw")}`, directory: "/workspace" },
    ]);
  });

  test("transcript() paginates messages in ascending order and collects skills, assistant turns, and failures", async () => {
    const queries: Array<string> = [];
    const firstPage: Array<SessionMessageInfo> = Array.from(
      { length: 200 },
      (_, index): SessionMessageInfo =>
        index === 0
          ? {
              id: "msg_skill",
              type: "skill",
              time: { created: 1 },
              skill: "code-hygiene",
              name: "Code Hygiene",
              text: "body",
            }
          : {
              id: `msg_u_${index}`,
              type: "user",
              time: { created: index + 1 },
              text: "hi",
            },
    );
    const secondPage: Array<SessionMessageInfo> = [
      {
        id: "msg_assistant",
        type: "assistant",
        agent: "spectre",
        model: { providerID: "opencode-go", id: "minimax-m3.1-flash-free" },
        time: { created: 300 },
        content: [{ type: "text", text: "code-hygiene" }],
        finish: "error",
        error: { type: "provider.quota", message: "Too many requests", status: 429 },
      },
    ];

    using server = Bun.serve({
      port: 0,
      fetch(req) {
        const url = new URL(req.url);
        if (url.pathname !== "/api/session/ses_1/message")
          return new Response("not found", { status: 404 });
        queries.push(url.searchParams.toString());
        const cursor = url.searchParams.get("cursor");
        if (cursor !== null && url.searchParams.has("order"))
          return Response.json(
            { message: "Cursor cannot be combined with order" },
            { status: 400 },
          );
        if (cursor === null) return Response.json({ data: firstPage, cursor: { next: "page_2" } });
        return Response.json({ data: secondPage, cursor: { next: "page_3" } });
      },
    });

    const client = connect("/workspace", `http://127.0.0.1:${server.port}`, "secret-pw");
    const transcript = await client.transcript("ses_1");

    expect(queries).toEqual(["limit=200&order=asc", "limit=200&cursor=page_2"]);
    expect(transcript.activated).toEqual(["code-hygiene"]);
    expect(transcript.messages.map((one) => one.id)).toEqual(["msg_assistant"]);
    expect(transcript.failure).toEqual({
      kind: "provider.quota",
      reason: "provider.quota 429: Too many requests",
    });
  });
});
