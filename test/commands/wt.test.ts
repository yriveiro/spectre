import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Schema } from "effect";
import { update } from "../../commands";
import { wt } from "../../commands/definitions/wt";
import { worktrees } from "../../tools/definitions/worktrees";

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

  const definition = wt(ctx as never);
  await Effect.runPromise(
    definition.execute({
      sessionID: "ses_probe",
      prompt: { text: typed },
      delivery: "async",
    } as never),
  );
  return { seen, definition };
};

const body = join(import.meta.dir, "..", "..", "commands", "definitions", "wt", "prompt.md");
const factory = join(import.meta.dir, "..", "..", "commands", "definition.ts");

/**
 * The marker `promptCommand` writes in front of whatever the user typed.
 *
 * Read out of the factory rather than written here, because the two sides are edited in
 * different files and nothing connects them. Rename the prefix in the factory and a prompt
 * still quoting the old one tells the session to look for a line that never arrives, which is a
 * command that opens a worktree under a name the session made up.
 */
const hostPrefix = async () => {
  const source = await Bun.file(factory).text();
  const found = /\\n\\n([^$`]+)\$\{said\}`/.exec(source);
  if (found === null) throw new Error("commands/definition.ts appends no readable prefix");
  return found[1]!;
};

/**
 * The call the prompt tells the session to make, read back out of the prose.
 *
 * A prompt is the only place a command names the tool it drives, and nothing else checks it.
 * Renaming `start`, or `name`, or the field the session fills in, leaves the prose looking
 * correct and the session calling a shape the schema refuses. So the object literal is lifted
 * out of the markdown and decoded against the tool's own input schema, which is the same
 * decode the host applies.
 *
 * `<the token>` becomes a name that passes the tool's own kebab-case rule, so this asserts the
 * shape of the call and not the spelling of the placeholder.
 */
const callInPrompt = async () => {
  const text = await Bun.file(body).text();
  const found = /tools\.spectre\.worktrees\((\{[^}]*\})\)/.exec(text);
  if (found === null) throw new Error("the prompt names no tools.spectre.worktrees call");
  const filled = found[1]!.replace("<the token>", "feature-001");
  // `Function` rather than `eval` on a body this test controls, and it is how a prompt's
  // example becomes a real value without the test re-typing what the prompt says.
  return (new Function(`return ${filled}`) as () => unknown)();
};

const accepts = (value: unknown) =>
  Schema.decodeUnknownOption(worktrees({} as never).input)(value)._tag === "Some";

describe("the /wt command", () => {
  test("it is named wt, so the palette resolves /wt", async () => {
    const { definition } = await capture("");
    expect(definition.name).toBe("wt");
    expect(definition.description).not.toBe("");
  });

  test("the typed name rides along, so the prompt can read it", async () => {
    const { seen } = await capture("feature-001");
    expect(seen[0]?.text.endsWith("The user added: feature-001")).toBe(true);
    expect(seen[0]?.text.startsWith("Open a worktree")).toBe(true);
  });

  test("a bare /wt adds nothing, so the prompt sees no name to invent", async () => {
    const { seen } = await capture("");
    expect(seen[0]?.text).toBe(await Bun.file(body).text());
  });
});

describe("the call the /wt prompt tells the session to make", () => {
  test("the tool accepts it, so the prompt and the schema agree", async () => {
    // The whole point. Rename `start` or `name` in the prompt and this goes red, which is the
    // moment a reader would otherwise discover it in a session.
    expect(accepts(await callInPrompt())).toBe(true);
  });

  test("and the check can fail, because the tool refuses a renamed field", async () => {
    // Without this the test above would also pass against a schema that accepted anything, and
    // the fixture would be a flag rather than a check.
    expect(accepts({ action: "begin", name: "feature-001" })).toBe(false);
    expect(accepts({ action: "start", worktreeName: "feature-001" })).toBe(false);
    expect(accepts({ action: "start", name: "feature-001" })).toBe(true);
  });

  test("the prompt quotes the marker the factory actually writes", async () => {
    // The prompt tells the session to read its last line, so it has to name the prefix that
    // makes that line identifiable. Two files, two edits, and no other check.
    const prefix = await hostPrefix();
    expect(prefix).not.toBe("");
    expect(await Bun.file(body).text()).toContain(prefix);
  });

  test("and the composed prompt ends with what the session must read", async () => {
    // Both sides read at once, so the claim is about the text a session really receives rather
    // than about either file on its own.
    const { seen } = await capture("feature-001");
    const prefix = await hostPrefix();
    expect(seen[0]?.text.endsWith(`${prefix}feature-001`)).toBe(true);
  });
});

describe("every registered command can answer when a session types it", () => {
  test("each one ships a prompt.md that reads back", async () => {
    // `promptCommand` reads its body on execute and dies when it is missing, so a command
    // folder without a `prompt.md` is a command that fails on the first use with no build-time
    // signal. The folder rule in AGENTS.md says every command definition is a folder with two
    // files in it, and this is what that rule costs when it is broken.
    const added: Array<{ name: string }> = [];
    const ctx = {
      command: {
        transform: (callback: (editor: { add: (definition: { name: string }) => void }) => void) =>
          Effect.sync(() => callback({ add: (definition) => added.push(definition) })),
      },
      session: { prompt: () => Effect.void },
    };
    await Effect.runPromise(Effect.scoped(update(ctx as never)));

    const unreadable: Array<string> = [];
    for (const one of added) {
      const at = join(
        import.meta.dir,
        "..",
        "..",
        "commands",
        "definitions",
        one.name,
        "prompt.md",
      );
      if (!(await Bun.file(at).exists()) || (await Bun.file(at).text()).length === 0)
        unreadable.push(one.name);
    }
    expect(unreadable.toSorted()).toEqual([]);
    // Paired with the list above, so an empty `added` cannot pass as success.
    expect(added.map((one) => one.name)).toContain("wt");
  });
});
