import { describe, expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin/effect";
import { Tool } from "@opencode/schema/tool";
import { Effect } from "effect";
import { create, update } from "../../tools/definitions/canvas/publish";

const context = {
  sessionID: "ses_test",
  agent: "build",
  messageID: "msg_test",
  id: "call_test",
  progress: () => Effect.void,
} as unknown as Tool.Context;

type Fake = Record<string, unknown>;

const registryCtx = (tools: ReadonlyArray<Fake>): Plugin.Context =>
  ({ tool: { list: () => Effect.succeed(tools) } }) as unknown as Plugin.Context;

const info = {
  id: "art_01K8Z6test",
  provider: "local",
  title: "Stored title",
  entry: "index.html",
  url: "/api/experimental/artifacts/art_01K8Z6test/view/",
  time: { created: 1, updated: 1 },
};

const files = { "index.html": "<h1>ok</h1>" };

describe("create", () => {
  test("passes the exact input and the current context, and publishes the decoded info", async () => {
    let seenInput: unknown;
    let seenContext: unknown;
    const fake: Fake = {
      name: "artifact_create",
      description: "fake",
      input: {},
      options: { namespace: "opencode" },
      execute: (input: unknown, ctx: unknown) => {
        seenInput = input;
        seenContext = ctx;
        return Effect.succeed({ output: info });
      },
    };
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([fake]), context, title: "Draft title", files }),
    );
    expect(seenInput).toEqual({
      title: "Draft title",
      files,
      entry: "index.html",
      provider: "local",
    });
    expect(seenContext).toBe(context);
    expect(result).toEqual({
      status: "published",
      id: info.id,
      url: info.url,
      provider: "local",
      title: "Stored title",
    });
  });

  test("a tool under another namespace is not the artifact tool", async () => {
    const fake: Fake = {
      name: "artifact_create",
      description: "fake",
      input: {},
      options: { namespace: "other" },
      execute: () => Effect.succeed({ output: info }),
    };
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([fake]), context, title: "T", files }),
    );
    expect(result.status).toBe("unavailable");
  });

  test("a missing tool is unavailable and names the flag", async () => {
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([]), context, title: "T", files }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.problem).toContain("experimental.artifacts");
    expect(result.problem).toContain("opencode.json");
    expect(result.problem).toContain("OPENCODE_FLAGS=artifacts");
    expect(result.problem).toContain("diff");
  });

  test("a thrown error is failed with its message", async () => {
    const fake: Fake = {
      name: "artifact_create",
      description: "fake",
      input: {},
      options: { namespace: "opencode" },
      execute: () => Effect.fail(new Tool.Error({ message: "provider blew up" })),
    };
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([fake]), context, title: "T", files }),
    );
    expect(result).toEqual({ status: "failed", problem: "provider blew up" });
  });

  test("an output that is not an Artifact.Info is failed", async () => {
    const fake: Fake = {
      name: "artifact_create",
      description: "fake",
      input: {},
      options: { namespace: "opencode" },
      execute: () => Effect.succeed({ output: { nope: true } }),
    };
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([fake]), context, title: "T", files }),
    );
    expect(result.status).toBe("failed");
  });

  test("an empty url is failed", async () => {
    const fake: Fake = {
      name: "artifact_create",
      description: "fake",
      input: {},
      options: { namespace: "opencode" },
      execute: () => Effect.succeed({ output: { ...info, url: "" } }),
    };
    const result = await Effect.runPromise(
      create({ ctx: registryCtx([fake]), context, title: "T", files }),
    );
    expect(result.status).toBe("failed");
  });
});

describe("update", () => {
  test("passes the id and no provider", async () => {
    let seenInput: unknown;
    const fake: Fake = {
      name: "artifact_update",
      description: "fake",
      input: {},
      options: { namespace: "opencode" },
      execute: (input: unknown) => {
        seenInput = input;
        return Effect.succeed({ output: info });
      },
    };
    const result = await Effect.runPromise(
      update({ ctx: registryCtx([fake]), context, id: "art_abc", title: "T", files }),
    );
    expect(seenInput).toEqual({ id: "art_abc", title: "T", files, entry: "index.html" });
    expect(seenInput).not.toHaveProperty("provider");
    expect(result.status).toBe("published");
  });

  test("a missing tool is unavailable and names the flag", async () => {
    const result = await Effect.runPromise(
      update({ ctx: registryCtx([]), context, id: "art_abc", title: "T", files }),
    );
    expect(result.status).toBe("unavailable");
    if (result.status !== "unavailable") return;
    expect(result.problem).toContain("experimental.artifacts");
  });
});
