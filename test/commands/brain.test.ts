import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { brain as brainCommand } from "../../commands/definitions/brain";
import { canvases } from "../../tools/definitions/canvas";

const body = join(import.meta.dir, "..", "..", "commands", "definitions", "brain", "prompt.md");

const capture = async (typed: string) => {
  const seen: Array<{ text: string; sessionID: string }> = [];
  const ctx = {
    session: {
      prompt: (input: { text: string; sessionID: string }) =>
        Effect.sync(() => {
          seen.push({ text: input.text, sessionID: input.sessionID });
        }),
    },
  };
  const definition = brainCommand(ctx as never);
  await Effect.runPromise(
    definition.execute({
      sessionID: "ses_probe",
      prompt: { text: typed },
      delivery: "async",
    } as never),
  );
  return { seen, definition };
};

const accepts = (value: unknown) =>
  Schema.decodeUnknownOption(canvases({} as never).input)(value)._tag === "Some";

describe("the /brain command", () => {
  test("resolves /brain and forwards optional focus argument", async () => {
    const { definition, seen } = await capture("01a1e50e");
    expect(definition.name).toBe("brain");
    expect(definition.description).not.toBe("");
    expect(seen[0]?.text.endsWith("The user added: 01a1e50e")).toBe(true);
    expect(await Bun.file(body).exists()).toBe(true);
  });

  test("the canvas schema accepts the kind='brain' publish and update payloads named in prompt.md", async () => {
    const text = await Bun.file(body).text();
    expect(text).toContain("tools.spectre.canvas");
    expect(accepts({ action: "publish", content: { kind: "brain" } })).toBe(true);
    expect(accepts({ action: "publish", content: { kind: "brain", focus: "01a1e50e" } })).toBe(true);
    expect(accepts({ action: "update", id: "art_123", content: { kind: "brain" } })).toBe(true);
    expect(accepts({ action: "publish", content: { kind: "unknown-arm" } })).toBe(false);
  });
});
