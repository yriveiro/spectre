import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import type { CommandDefinition } from "@opencode/plugin/effect/command";
import { Effect } from "effect";
import { babysit } from "../../commands/definitions/babysit";
import { drive } from "../../commands/definitions/drive";

const capture = async (definition: (ctx: never) => CommandDefinition, typed: string) => {
  const seen: Array<{ text: string; sessionID: string }> = [];
  const ctx = {
    session: {
      prompt: (input: { text: string; sessionID: string }) =>
        Effect.sync(() => {
          seen.push({ text: input.text, sessionID: input.sessionID });
        }),
    },
  };

  const built = definition(ctx as never);
  await Effect.runPromise(
    built.execute({
      sessionID: "ses_probe",
      prompt: { text: typed },
      delivery: "async",
    } as never),
  );
  return { seen, definition: built };
};

const command = (name: "drive" | "babysit") => (name === "drive" ? drive : babysit);

describe("the /drive command", () => {
  test("it is named drive, so the palette resolves /drive", async () => {
    const { definition } = await capture(command("drive"), "");
    expect(definition.name).toBe("drive");
    expect(definition.description).not.toBe("");
  });

  test("a bare /drive hands the prompt and nothing else", async () => {
    const { seen } = await capture(command("drive"), "");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sessionID).toBe("ses_probe");
    expect(seen[0]?.text).toBe(
      await Bun.file(
        join(import.meta.dir, "..", "..", "commands", "definitions", "drive", "prompt.md"),
      ).text(),
    );
  });

  test("typed text rides along as the objective", async () => {
    const { seen } = await capture(command("drive"), "make the queue pass");
    expect(seen[0]?.text.endsWith("The user added: make the queue pass")).toBe(true);
  });

  test("it names the playbook and the goal tool", async () => {
    const { seen } = await capture(command("drive"), "");
    expect(seen[0]?.text).toContain("playbook-autonomous-run");
    expect(seen[0]?.text).toContain("tools.spectre.goal");
  });
});

describe("the /babysit command", () => {
  test("it is named babysit, so the palette resolves /babysit", async () => {
    const { definition } = await capture(command("babysit"), "");
    expect(definition.name).toBe("babysit");
    expect(definition.description).not.toBe("");
  });

  test("a bare /babysit hands the prompt and nothing else", async () => {
    const { seen } = await capture(command("babysit"), "");
    expect(seen).toHaveLength(1);
    expect(seen[0]?.text).toBe(
      await Bun.file(
        join(import.meta.dir, "..", "..", "commands", "definitions", "babysit", "prompt.md"),
      ).text(),
    );
  });

  test("typed text rides along as the stack", async () => {
    const { seen } = await capture(command("babysit"), "412 413 414");
    expect(seen[0]?.text.endsWith("The user added: 412 413 414")).toBe(true);
  });

  test("it uses the same goal framework and never merges", async () => {
    const { seen } = await capture(command("babysit"), "");
    expect(seen[0]?.text).toContain("playbook-babysit");
    expect(seen[0]?.text).toContain("tools.spectre.goal");
    expect(seen[0]?.text).toContain("Never merge");
  });
});
