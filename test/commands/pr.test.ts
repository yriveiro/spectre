import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { update } from "../../commands";
import { pr } from "../../commands/definitions/pr";
import { join } from "node:path";

/**
 * The prompt as the definition built it, and the text it would hand the session. One fake
 * `session.prompt` captures the call, so the assertions are on the literal text rather
 * than on anything the definition computes twice.
 */
const capture = async (typed: string) => {
  const seen: Array<{ text: string; sessionID: string }> = [];
  const ctx = {
    command: {
      transform: (callback: (editor: { add: (definition: unknown) => void }) => void) =>
        Effect.sync(() => callback({ add: () => {} })),
    },
    session: {
      prompt: (input: { text: string; sessionID: string }) =>
        Effect.sync(() => {
          seen.push({ text: input.text, sessionID: input.sessionID });
        }),
    },
  };

  const definition = pr(ctx as never);
  await Effect.runPromise(
    definition.execute({
      sessionID: "ses_probe",
      prompt: { text: typed },
      delivery: "async",
    } as never),
  );
  return { seen, definition };
};

const body = join(import.meta.dir, "..", "..", "commands", "definitions", "pr", "prompt.md");

describe("the /pr command", () => {
  test("it is named pr, so the palette resolves /pr", async () => {
    const { definition } = await capture("");
    expect(definition.name).toBe("pr");
    expect(definition.description).not.toBe("");
  });

  test("a bare /pr hands the prompt and nothing else", async () => {
    const { seen } = await capture("");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sessionID).toBe("ses_probe");
    expect(seen[0]?.text).toBe(await Bun.file(body).text());
  });

  test("typed text rides along rather than being dropped", async () => {
    const { seen } = await capture("keep the sharding change out");
    expect(seen[0]?.text.endsWith("The user added: keep the sharding change out")).toBe(true);
    expect(seen[0]?.text.startsWith("Open a pull request")).toBe(true);
  });

  test("whitespace alone is not a user instruction", async () => {
    const { seen } = await capture("   \n  ");
    expect(seen[0]?.text).not.toContain("The user added:");
  });

  test("the prompt drives the tool, and never the forge directly", async () => {
    const text = await Bun.file(body).text();
    expect(text).toContain("tools.spectre.pr");
    // The command's whole reason to exist is that the model routes through the tool, so
    // an instruction to shell out to `gh` would undo it.
    expect(text).toContain("never call `gh pr create` yourself");
  });

  test("the prompt is not empty and is a real file on disk", async () => {
    const text = await Bun.file(body).text();
    expect(text.length).toBeGreaterThan(500);
  });
});

describe("registration", () => {
  test("update adds every definition to the command editor", async () => {
    const added: Array<{ name: string }> = [];
    const ctx = {
      command: {
        transform: (callback: (editor: { add: (definition: { name: string }) => void }) => void) =>
          Effect.sync(() => callback({ add: (definition) => added.push(definition) })),
      },
      session: { prompt: () => Effect.void },
    };

    await Effect.runPromise(Effect.scoped(update(ctx as never)));
    expect(added.map((one) => one.name)).toEqual(["pr"]);
  });
});