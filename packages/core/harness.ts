import type { Plugin } from "@opencode/plugin/effect";
import type { AgentEditor } from "@opencode/plugin/effect/agent";
import type { CommandEditor } from "@opencode/plugin/effect/command";
import type { Registration } from "@opencode/plugin/effect/registration";
import type { SkillEditor } from "@opencode/plugin/effect/skill";
import type { ToolEditor } from "@opencode/plugin/effect/tool";
import { Effect, Scope } from "effect";
import type { Block, HookName } from "./block";
import { effectiveToolName, type RecordedSurfaces } from "./surface";

export interface TestContext {
  readonly ctx: Plugin.Context;
  readonly surfaces: RecordedSurfaces;
  /** Registration kinds in the order they were disposed. */
  readonly disposed: readonly string[];
}

const unsupported = (domain: string, method: string) => {
  throw new Error(`block touched ctx.${domain}.${method} in a test`);
};

/**
 * A `Plugin.Context` with the four registration domains backed by in-memory
 * editors. A transform attaches its disposal to the ambient scope, as the host
 * does, so `Scope.close` is the rollback path under test.
 */
export const testContext = (): TestContext => {
  const tools = new Set<string>();
  const skills = new Set<string>();
  const commands = new Set<string>();
  const agents = new Set<string>();
  const hooks = new Set<HookName>();
  const disposed: string[] = [];

  const registration = (kind: string): Registration => {
    let done = false;
    return {
      dispose: Effect.suspend(() => {
        if (done) return Effect.void;
        done = true;
        disposed.push(kind);
        return Effect.void;
      }),
    };
  };

  const transform =
    <Editor>(kind: string, editor: Editor) =>
    (callback: (editor: Editor) => void): Effect.Effect<Registration, never, Scope.Scope> =>
      Effect.gen(function* () {
        const scope = yield* Scope.Scope;
        callback(editor);
        const handle = registration(kind);
        yield* Scope.addFinalizer(scope, handle.dispose);
        return handle;
      });

  const toolEditor: ToolEditor = {
    list: () => [],
    get: () => undefined,
    namespace: () => {},
    add: (definition) => {
      tools.add(effectiveToolName(definition));
    },
    update: (id) => {
      tools.add(id);
    },
    remove: (id) => {
      tools.delete(id);
    },
  };

  const skillEditor: SkillEditor = {
    list: () => [],
    get: () => undefined,
    add: (skill) => {
      skills.add(skill.id);
    },
    update: (id) => {
      skills.add(id);
    },
    remove: (id) => {
      skills.delete(id);
    },
  };

  const commandEditor: CommandEditor = {
    add: (definition) => {
      commands.add(definition.name);
    },
  };

  const agentEditor: AgentEditor = {
    list: () => [],
    get: () => undefined,
    default: () => {},
    update: (id) => {
      agents.add(id);
    },
    remove: (id) => {
      agents.delete(id);
    },
  };

  const tool = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === "transform") return transform("tool", toolEditor);
      if (prop === "hook") {
        return (name: HookName) =>
          Effect.gen(function* () {
            const scope = yield* Scope.Scope;
            hooks.add(name);
            const handle = registration(`hook:${name}`);
            yield* Scope.addFinalizer(scope, handle.dispose);
            return handle;
          });
      }
      return unsupported("tool", String(prop));
    },
  }) as unknown as Plugin.Context["tool"];

  const skill = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === "transform") return transform("skill", skillEditor);
      return unsupported("skill", String(prop));
    },
  }) as unknown as Plugin.Context["skill"];

  const command = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === "transform") return transform("command", commandEditor);
      return unsupported("command", String(prop));
    },
  }) as unknown as Plugin.Context["command"];

  const agent = new Proxy({} as Record<string, unknown>, {
    get: (_, prop) => {
      if (prop === "transform") return transform("agent", agentEditor);
      return unsupported("agent", String(prop));
    },
  }) as unknown as Plugin.Context["agent"];

  const ctx = new Proxy({} as Plugin.Context, {
    get: (_, prop) => {
      switch (prop) {
        case "tool":
          return tool;
        case "skill":
          return skill;
        case "command":
          return command;
        case "agent":
          return agent;
        default:
          throw new Error(`block touched ctx.${String(prop)} in a test`);
      }
    },
  });

  return {
    ctx,
    surfaces: {
      get tools() {
        return [...tools];
      },
      get skills() {
        return [...skills];
      },
      get commands() {
        return [...commands];
      },
      get agents() {
        return [...agents];
      },
      get hooks() {
        return [...hooks];
      },
    },
    get disposed() {
      return [...disposed];
    },
  };
};

/** Runs a block the way the bundle does, against a test context by default. */
export const runBlock = (
  block: Block,
  context: TestContext = testContext(),
): Effect.Effect<RecordedSurfaces, unknown, Scope.Scope> =>
  Effect.gen(function* () {
    yield* block.effect(context.ctx);
    return context.surfaces;
  });
