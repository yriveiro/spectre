import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Tool } from "@opencode/plugin/effect";
import { Effect, Exit } from "effect";
import {
  attachRoutingGuard,
  DELEGATION_KEY,
  ESCALATION_SENTINEL,
  SUBAGENT_MODEL_DESCRIPTION,
} from "../../tools/definitions/routing";
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

  test("context hook decorates STATUS: ESCALATE messages for spectre without mutating system", async () => {
    const dir = temp();
    const { contextHandler } = await setupGuard(dir);
    const system = [{ type: "text", text: "Static system prompt" }];
    const makeMessages = () => [
      {
        role: "user",
        metadata: { source: "subagent" },
        content: [
          {
            type: "text",
            text: `<subagent sessionID="ses_child" state="completed" description="Work">
STATUS: ESCALATE
REASON: AMBIGUITY
BLOCKER: Two options exist.
</subagent>`,
          },
        ],
      },
    ];

    const operatorMessages = makeMessages();
    await Effect.runPromise(
      contextHandler({
        agent: "operator",
        tools: {},
        system,
        messages: operatorMessages,
      } as never),
    );
    expect(operatorMessages[0]?.content[0]?.text).not.toContain(ESCALATION_SENTINEL);

    const spectreMessages = makeMessages();
    await Effect.runPromise(
      contextHandler({
        agent: "spectre",
        tools: {},
        system,
        messages: spectreMessages,
      } as never),
    );
    expect(spectreMessages[0]?.content[0]?.text).toContain(ESCALATION_SENTINEL);
    expect(system).toEqual([{ type: "text", text: "Static system prompt" }]);
  });

  test("execute.after and prompt hooks sync DELEGATION_KEY for root spectre sessions only", async () => {
    const dir = temp();
    const puts: Array<{ sessionID: string; key: string; value: string }> = [];
    const removes: Array<{ sessionID: string; key: string }> = [];
    let promptHandler: ((event: { sessionID: string }) => Effect.Effect<void>) | undefined;
    let afterHandler:
      | ((event: {
          tool: string;
          sessionID: string;
          agent: string;
          messageID: string;
          id: string;
          input: unknown;
          status: "completed" | "error";
        }) => Effect.Effect<void>)
      | undefined;

    const ctx = {
      location: { directory: dir },
      session: {
        hook: (name: string, cb: (event: never) => Effect.Effect<void>) => {
          if (name === "prompt") promptHandler = cb as typeof promptHandler;
          return Effect.void;
        },
        get: ({ sessionID }: { sessionID: string }) =>
          Effect.succeed({
            id: sessionID,
            parentID: sessionID === "ses_child" ? "ses_root" : undefined,
            location: { directory: dir },
          }),
        instructions: {
          entry: {
            put: (args: { sessionID: string; key: string; value: string }) => {
              puts.push(args);
              return Effect.void;
            },
            remove: (args: { sessionID: string; key: string }) => {
              removes.push(args);
              return Effect.void;
            },
          },
        },
      },
      tool: {
        hook: (name: string, cb: (event: never) => Effect.Effect<void>) => {
          if (name === "execute.after") afterHandler = cb as typeof afterHandler;
          return Effect.void;
        },
      },
    };

    await Effect.runPromise(Effect.scoped(attachRoutingGuard(ctx as never)));
    if (promptHandler === undefined || afterHandler === undefined) {
      throw new Error("expected prompt and execute.after hooks");
    }

    for (let i = 1; i <= 4; i += 1) {
      await Effect.runPromise(
        afterHandler({
          tool: "read",
          sessionID: "ses_child",
          agent: "spectre",
          messageID: "m1",
          id: `c${i}`,
          input: { path: `child_${i}.ts` },
          status: "completed",
        }),
      );
    }
    expect(puts).toHaveLength(0);

    await Effect.runPromise(
      afterHandler({
        tool: "shell",
        sessionID: "ses_root",
        agent: "spectre",
        messageID: "m2",
        id: "s1",
        input: { command: "bun test" },
        status: "completed",
      }),
    );
    expect(puts).toHaveLength(0);

    await Effect.runPromise(
      afterHandler({
        tool: "shell",
        sessionID: "ses_root",
        agent: "spectre",
        messageID: "m3",
        id: "s2",
        input: { command: "bun run typecheck" },
        status: "completed",
      }),
    );
    expect(puts).toHaveLength(1);
    expect(puts[0]?.sessionID).toBe("ses_root");
    expect(puts[0]?.key).toBe(DELEGATION_KEY);

    await Effect.runPromise(promptHandler({ sessionID: "ses_root" }));
    expect(removes).toEqual([{ sessionID: "ses_root", key: DELEGATION_KEY }]);

    const declinedDir = temp();
    await Bun.write(join(declinedDir, "spectre.json"), JSON.stringify({ setup: "declined" }));
    const declinedPuts: Array<unknown> = [];
    let declinedAfter: typeof afterHandler | undefined;
    await Effect.runPromise(
      Effect.scoped(
        attachRoutingGuard({
          location: { directory: declinedDir },
          session: {
            hook: () => Effect.void,
            get: () => Effect.succeed({ id: "ses_dec", location: { directory: declinedDir } }),
            instructions: {
              entry: {
                put: (args: unknown) => {
                  declinedPuts.push(args);
                  return Effect.void;
                },
                remove: () => Effect.void,
              },
            },
          },
          tool: {
            hook: (name: string, cb: (event: never) => Effect.Effect<void>) => {
              if (name === "execute.after") declinedAfter = cb as NonNullable<typeof afterHandler>;
              return Effect.void;
            },
          },
        } as never),
      ),
    );
    if (declinedAfter === undefined) {
      throw new Error("expected execute.after hook");
    }
    for (let i = 1; i <= 2; i += 1) {
      await Effect.runPromise(
        declinedAfter({
          tool: "shell",
          sessionID: "ses_dec",
          agent: "spectre",
          messageID: "m4",
          id: `d${i}`,
          input: { command: "bun test" },
          status: "completed",
        }),
      );
    }
    expect(declinedPuts).toHaveLength(0);
  });
});
