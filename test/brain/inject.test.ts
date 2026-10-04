import { afterAll, describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { join } from "node:path";
import { attach } from "../../tools/definitions/brain/inject";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

type Captured = (event: {
  sessionID: string;
  agent: string;
  messages: Array<{ role: string; content: Array<{ type: string; text?: string }> }>;
}) => Effect.Effect<void>;

const setup = async (tag: string, parentID?: string): Promise<{ dir: string; handler: Captured }> => {
  const dir = `${TMP}/spectre-brain-${process.pid}-${seq++}`;
  roots.push(dir);
  await Bun.write(`${dir}/.keep`, "");
  let handler: Captured | undefined;
  const ctx = {
    location: { directory: dir },
    session: {
      hook: (_name: string, cb: Captured) => {
        handler = cb;
        return Effect.void;
      },
      get: (_input: unknown) =>
        parentID === undefined ? Effect.succeed({}) : Effect.succeed({ parentID }),
    },
  };
  await Effect.runPromise(attach(ctx as never) as Effect.Effect<void>);
  if (handler === undefined) throw new Error("hook was not registered");
  return { dir, handler };
};

const event = (agent: string) => ({ sessionID: "ses_test", agent, messages: [] as never[] });

const textOf = (messages: Array<{ content: Array<{ text?: string }> }>): string =>
  messages.map((m) => m.content.map((p) => p.text ?? "").join("")).join("\n");

const neuron = (id: string, kind: string, claim: string): string =>
  `---\nkind: ${kind}\nclaim: "${claim}"\nsubject: ["tools/definitions/canvas/store.ts"]\n---\n\nBody for ${id}.\n`;

const seed = async (dir: string, count: number): Promise<void> => {
  for (let i = 0; i < count; i++) {
    const id = `01K${String(i).padStart(24, "0")}`;
    await Bun.write(
      join(dir, ".spectre", "brain", "neurons", `${id}.md`),
      neuron(id, i % 2 === 0 ? "gotcha" : "feature", `Claim number ${i} about canvases never being overwritten at all`),
    );
  }
};

describe("brain injection", () => {
  test("a primary agent on a brain with claims gets exactly one wrapped part", async () => {
    const { dir, handler } = await setup("one");
    await seed(dir, 3);
    const evt = event("build");
    await Effect.runPromise(handler(evt as never));
    expect(evt.messages.length).toBe(1);
    const text = textOf(evt.messages as never as Array<{ content: Array<{ text?: string }> }>);
    expect(text).toContain("<UNTRUSTED_CONTENT>");
    expect(text).toContain("</UNTRUSTED_CONTENT>");
    expect(text).toContain("Claim number 0");
  });

  test("mnemonic itself gets nothing", async () => {
    const { dir, handler } = await setup("mnemonic");
    await seed(dir, 3);
    const evt = event("mnemonic");
    await Effect.runPromise(handler(evt as never));
    expect(evt.messages.length).toBe(0);
  });

  test("a subagent session gets nothing", async () => {
    const { dir, handler } = await setup("subagent", "ses_parent");
    await seed(dir, 3);
    const evt = event("build");
    await Effect.runPromise(handler(evt as never));
    expect(evt.messages.length).toBe(0);
  });

  test("a brain with no claims says cold and carries no index", async () => {
    const { handler } = await setup("cold");
    const evt = event("build");
    await Effect.runPromise(handler(evt as never));
    expect(evt.messages.length).toBe(1);
    const text = textOf(evt.messages as never as Array<{ content: Array<{ text?: string }> }>);
    expect(text).toContain("cold");
    expect(text).not.toContain("brain index");
    const again = event("build");
    await Effect.runPromise(handler(again as never));
    expect(again.messages.length).toBe(0);
  });

  test("an unchanged ledger costs nothing the second time", async () => {
    const { dir, handler } = await setup("mtime");
    await seed(dir, 2);
    const first = event("build");
    await Effect.runPromise(handler(first as never));
    expect(first.messages.length).toBe(1);
    const second = event("build");
    await Effect.runPromise(handler(second as never));
    expect(second.messages.length).toBe(0);
  });

  test("more claims than fit stay under 600 tokens and say they were cut", async () => {
    const { dir, handler } = await setup("cap");
    await seed(dir, 60);
    const evt = event("build");
    await Effect.runPromise(handler(evt as never));
    expect(evt.messages.length).toBe(1);
    const text = textOf(evt.messages as never as Array<{ content: Array<{ text?: string }> }>);
    expect(text.length / 4).toBeLessThanOrEqual(600);
    expect(text).toMatch(/truncat/i);
    expect(text).toContain("600 tokens");
  });
});

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});
