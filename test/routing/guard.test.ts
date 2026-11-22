import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Tool } from "@opencode/plugin/effect";
import { Effect, Exit } from "effect";
import { attachRoutingGuard, SUBAGENT_MODEL_DESCRIPTION } from "../../tools/definitions/routing";
import { useTempDirs } from "../fixture";

const temp = useTempDirs("routing-guard");

interface ContextEvent {
  readonly agent: string;
  tools: Record<string, { description: string; input: unknown }>;
}

interface BeforeEvent {
  tool: string;
  readonly sessionID: string;
  readonly agent: string;
  readonly messageID: string;
  readonly id: string;
  input: unknown;
}

const setupGuard = async (
  directory: string,
  sessionDirectory?: string,
  models?: ReadonlyArray<unknown>,
) => {
  let contextHandler: ((event: ContextEvent) => Effect.Effect<void>) | undefined;
  let beforeHandler: ((event: BeforeEvent) => Effect.Effect<void, Tool.Error>) | undefined;

  const ctx = {
    location: { directory },
    ...(models === undefined ? {} : { model: { list: () => Effect.succeed({ data: models }) } }),
    session: {
      hook: (name: string, cb: (event: ContextEvent) => Effect.Effect<void>) => {
        if (name === "context") contextHandler = cb;
        return Effect.void;
      },
      get: () =>
        Effect.succeed(
          sessionDirectory === undefined
            ? undefined
            : { location: { directory: sessionDirectory } },
        ),
    },
    tool: {
      hook: (name: string, cb: (event: BeforeEvent) => Effect.Effect<void, Tool.Error>) => {
        if (name === "execute.before") beforeHandler = cb;
        return Effect.void;
      },
    },
  };

  await Effect.runPromise(Effect.scoped(attachRoutingGuard(ctx as never)));
  if (contextHandler === undefined || beforeHandler === undefined) {
    throw new Error("routing guard hooks did not register");
  }
  return { contextHandler, beforeHandler };
};

const runContextFor = async (
  contextHandler: (event: ContextEvent) => Effect.Effect<void>,
  agent: string,
) => {
  const model = { type: "string", description: "Original model description" };
  const event: ContextEvent = {
    agent,
    tools: {
      subagent: {
        description: "Original subagent description",
        input: { type: "object", properties: { model } },
      },
    },
  };
  await Effect.runPromise(contextHandler(event));
  return model.description;
};

const beforeEvent = (overrides: Partial<BeforeEvent> = {}): BeforeEvent => ({
  tool: "subagent",
  sessionID: "ses_guard",
  agent: "spectre",
  messageID: "msg_guard",
  id: "call_guard",
  input: {
    agent: "operator",
    description: "Run task",
    prompt: "Do work",
  },
  ...overrides,
});

describe("routing guard", () => {
  test("context hook rewrites subagent.input.properties.model.description for spectre only", async () => {
    const dir = temp();
    const { contextHandler } = await setupGuard(dir);

    expect(await runContextFor(contextHandler, "build")).toBe("Original model description");
    expect(await runContextFor(contextHandler, "operator")).toBe("Original model description");
    expect(await runContextFor(contextHandler, "spectre")).toBe(SUBAGENT_MODEL_DESCRIPTION);
  });

  test("execute.before allows an allowed provider/model#variant on new spawn", async () => {
    const dir = temp();
    await Bun.write(
      join(dir, "spectre.json"),
      JSON.stringify({
        models: {
          sonnet: "github-copilot/claude-sonnet-4.6",
        },
      }),
    );

    const { beforeHandler } = await setupGuard(dir);
    const exit = await Effect.runPromiseExit(
      beforeHandler(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "github-copilot/claude-sonnet-4.6#medium",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("execute.before rejects an unallowed provider/unapproved-model with Tool.Error", async () => {
    const dir = temp();
    await Bun.write(
      join(dir, "spectre.json"),
      JSON.stringify({
        models: {
          sonnet: "github-copilot/claude-sonnet-4.6",
        },
      }),
    );

    const { beforeHandler } = await setupGuard(dir);
    const exit = await Effect.runPromiseExit(
      beforeHandler(
        beforeEvent({
          input: {
            agent: "spectre",
            description: "Run task",
            prompt: "Do work",
            model: "provider/unapproved-model",
          },
        }),
      ),
    );
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) {
      const failReason = exit.cause.reasons.find((r) => r._tag === "Fail");
      if (failReason === undefined) throw new Error("expected Fail reason");
      expect(failReason.error).toBeInstanceOf(Tool.Error);
      expect((failReason.error as Tool.Error).message).toContain(
        'Model "provider/unapproved-model" is not in spectre.json models allowlist (github-copilot/claude-sonnet-4.6).',
      );
    }
  });

  test("execute.before allows sessionID follow-up calls and declined or unconfigured directories", async () => {
    const configuredDir = temp();
    await Bun.write(
      join(configuredDir, "spectre.json"),
      JSON.stringify({
        models: {
          sonnet: "github-copilot/claude-sonnet-4.6",
        },
      }),
    );
    const { beforeHandler: configuredBefore } = await setupGuard(configuredDir);
    const resumeExit = await Effect.runPromiseExit(
      configuredBefore(
        beforeEvent({
          input: {
            sessionID: "ses_existing",
            prompt: "Continue",
            model: "provider/unapproved-model",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(resumeExit)).toBe(true);

    const declinedDir = temp();
    await Bun.write(join(declinedDir, "spectre.json"), JSON.stringify({ setup: "declined" }));
    const { beforeHandler: declinedBefore } = await setupGuard(declinedDir);
    const declinedExit = await Effect.runPromiseExit(
      declinedBefore(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "provider/unapproved-model",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(declinedExit)).toBe(true);

    const emptyDir = temp();
    const { beforeHandler: emptyBefore } = await setupGuard(emptyDir);
    const emptyExit = await Effect.runPromiseExit(
      emptyBefore(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "provider/unapproved-model",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(emptyExit)).toBe(true);
  });

  test("attachRoutingGuard enforces pinned #variant entries, rejects empty sessionID bypasses, and allows fallback when zero allowlist models are spendable", async () => {
    const dir = temp();
    await Bun.write(
      join(dir, "spectre.json"),
      JSON.stringify({ models: { pinned: "github-copilot/claude-sonnet-4.6#low" } }),
    );
    const { beforeHandler } = await setupGuard(dir);

    const exactExit = await Effect.runPromiseExit(
      beforeHandler(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "github-copilot/claude-sonnet-4.6#low",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(exactExit)).toBe(true);

    const wrongVariantExit = await Effect.runPromiseExit(
      beforeHandler(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "github-copilot/claude-sonnet-4.6#max",
          },
        }),
      ),
    );
    expect(Exit.isFailure(wrongVariantExit)).toBe(true);

    const emptySessionExit = await Effect.runPromiseExit(
      beforeHandler(
        beforeEvent({
          input: {
            sessionID: "   ",
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "provider/unapproved-model",
          },
        }),
      ),
    );
    expect(Exit.isFailure(emptySessionExit)).toBe(true);

    const { beforeHandler: fallbackBefore } = await setupGuard(dir, undefined, [
      {
        providerID: "other-provider",
        id: "fallback-model",
        name: "Fallback",
        family: "other",
        variants: [{ id: "high" }],
        cost: [{ input: 1, output: 2 }],
        enabled: true,
        status: "active",
        capabilities: { tools: true },
      },
    ]);
    const fallbackExit = await Effect.runPromiseExit(
      fallbackBefore(
        beforeEvent({
          input: {
            agent: "operator",
            description: "Run task",
            prompt: "Do work",
            model: "other-provider/fallback-model#high",
          },
        }),
      ),
    );
    expect(Exit.isSuccess(fallbackExit)).toBe(true);
  });

  test("attachRoutingGuard degrades gracefully on partial ctx mocks", async () => {
    const dir = temp();
    const exit = await Effect.runPromiseExit(
      Effect.scoped(attachRoutingGuard({ location: { directory: dir } } as never)),
    );
    expect(Exit.isSuccess(exit)).toBe(true);
  });
});
