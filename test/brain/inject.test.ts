import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect, Exit } from "effect";
import { DESCRIPTION } from "../../tools/definitions/brain";
import { attach, COLD } from "../../tools/definitions/brain/inject";

const ACTIONS: ReadonlyArray<string> = [
  "recall",
  "assert",
  "relate",
  "supersede",
  "demote",
  "status",
];

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];
let seq = 0;

interface PromptEvent {
  readonly sessionID: string;
  readonly messageID: string;
  prompt: {
    text: string;
    agents?: Array<{ readonly name: string }>;
    files?: Array<{ readonly uri: string; readonly name?: string }>;
  };
  delivery: "steer" | "queue";
}

interface EntryPut {
  readonly sessionID: string;
  readonly key: string;
  readonly value: unknown;
}

type Captured = (event: PromptEvent) => Effect.Effect<void>;

interface SessionInfoStub {
  readonly parentID?: string;
  readonly agent?: string;
}

const makeEntryStore = () => {
  const puts: Array<EntryPut> = [];
  const stored = new Map<string, Map<string, unknown>>();
  const instructions = {
    entry: {
      put: (input: EntryPut) =>
        Effect.sync(() => {
          puts.push(input);
          const byKey = stored.get(input.sessionID) ?? new Map<string, unknown>();
          byKey.set(input.key, input.value);
          stored.set(input.sessionID, byKey);
        }),
    },
  };
  return { puts, stored, instructions };
};

const setup = async (tag: string, info: SessionInfoStub = {}, withInstructions: boolean = true) => {
  const dir = `${TMP}/spectre-brain-${process.pid}-${seq++}`;
  roots.push(dir);
  await Bun.write(`${dir}/.keep`, "");
  let hookName: string | undefined;
  let handler: Captured | undefined;
  const { puts, stored, instructions } = makeEntryStore();
  const ctx = {
    location: { directory: dir },
    session: {
      hook: (name: string, cb: Captured) => {
        hookName = name;
        handler = cb;
        return Effect.void;
      },
      get: (_input: unknown) => Effect.succeed(info),
      ...(withInstructions ? { instructions } : {}),
    },
  };
  await Effect.runPromise(attach(ctx as never) as Effect.Effect<void>);
  if (handler === undefined || hookName === undefined) throw new Error("hook was not registered");
  return { dir, sessionID: `ses_${tag}_${seq}`, hookName, handler, puts, stored };
};

const promptEvent = (
  sessionID: string,
  agents?: Array<{ readonly name: string }>,
  text: string = "help",
  files?: Array<{ readonly uri: string; readonly name?: string }>,
): PromptEvent => {
  const prompt: PromptEvent["prompt"] = { text };
  if (agents !== undefined) prompt.agents = agents;
  if (files !== undefined) prompt.files = files;
  return {
    sessionID,
    messageID: "msg_prompt",
    prompt,
    delivery: "steer",
  };
};

const neuron = (id: string, kind: string, claim: string): string =>
  `---\nkind: ${kind}\nclaim: "${claim}"\nsubject: ["tools/definitions/canvas/content.ts"]\n---\n\nBody for ${id}.\n`;

const seed = async (dir: string, count: number, start: number = 0): Promise<void> => {
  for (let i = start; i < start + count; i++) {
    const id = `01K${String(i).padStart(24, "0")}`;
    await Bun.write(
      join(dir, ".spectre", "brain", "neurons", `${id}.md`),
      neuron(
        id,
        i % 2 === 0 ? "gotcha" : "feature",
        `Claim number ${i} about canvases never being overwritten at all`,
      ),
    );
  }
};

describe("brain injection", () => {
  test("a primary root session puts one durable spectre.brain entry on prompt that persists across steps", async () => {
    const { dir, sessionID, hookName, handler, puts, stored } = await setup("one", {
      agent: "spectre",
    });
    expect(hookName).toBe("prompt");
    await seed(dir, 3);
    await Effect.runPromise(handler(promptEvent(sessionID)));

    expect(puts.length).toBe(1);
    expect(puts[0]?.key).toBe("spectre.brain");
    const text = String(puts[0]?.value ?? "");
    expect(text).toContain("<UNTRUSTED_CONTENT>");
    expect(text).toContain("</UNTRUSTED_CONTENT>");
    expect(text).toContain("Claim number 0");

    expect(stored.get(sessionID)?.get("spectre.brain")).toBe(text);
    expect(stored.get(sessionID)?.get("spectre.brain")).toBe(text);
  });

  test("mnemonic itself gets nothing on session agent or prompt mention", async () => {
    const bySession = await setup("mnemonic_agent", { agent: "mnemonic" });
    await seed(bySession.dir, 3);
    await Effect.runPromise(bySession.handler(promptEvent(bySession.sessionID)));
    expect(bySession.puts).toEqual([]);

    const byMention = await setup("mnemonic_mention", { agent: "spectre" });
    await seed(byMention.dir, 3);
    await Effect.runPromise(
      byMention.handler(promptEvent(byMention.sessionID, [{ name: "mnemonic" }])),
    );
    expect(byMention.puts).toEqual([]);
  });

  test("child sessions inject a <=250-token gotcha/constraint slice unless excluded or empty", async () => {
    const nocturnaChild = await setup("subagent_nocturna", {
      agent: "nocturna",
      parentID: "ses_parent",
    });
    await seed(nocturnaChild.dir, 3);
    await Effect.runPromise(nocturnaChild.handler(promptEvent(nocturnaChild.sessionID)));
    expect(nocturnaChild.puts).toEqual([]);

    const emptyChild = await setup("subagent_no_gotchas", {
      agent: "operator",
      parentID: "ses_parent",
    });
    await Bun.write(
      join(emptyChild.dir, ".spectre", "brain", "neurons", "01K000000000000000000000099.md"),
      neuron("01K000000000000000000000099", "feature", "Only a feature claim exists"),
    );
    await Effect.runPromise(emptyChild.handler(promptEvent(emptyChild.sessionID)));
    expect(emptyChild.puts).toEqual([]);

    const workerChild = await setup("subagent_worker", {
      agent: "operator",
      parentID: "ses_parent",
    });
    await seed(workerChild.dir, 30);
    await Effect.runPromise(workerChild.handler(promptEvent(workerChild.sessionID)));
    expect(workerChild.puts.length).toBe(1);
    const text = String(workerChild.puts[0]?.value ?? "");
    expect(text.length / 4).toBeLessThanOrEqual(250);
    expect(text).toContain("250 tokens");
    expect(text).toContain("[gotcha]");
    expect(text).not.toContain("[feature]");
  });

  test("root sessions rank claims by prompt text and attached file paths ahead of newer unrelated claims", async () => {
    const { dir, sessionID, handler, puts } = await setup("ranked_root", { agent: "spectre" });
    await seed(dir, 40);
    const targetedId = "01K000000000000000000000000";
    await Bun.write(
      join(dir, ".spectre", "brain", "neurons", `${targetedId}.md`),
      `---\nkind: feature\nclaim: "Routing guard enforces model tier"\nsubject: ["tools/definitions/routing/guard.ts"]\n---\n\nTargeted.\n`,
    );

    await Effect.runPromise(
      handler(
        promptEvent(sessionID, undefined, "check routing guard", [
          { uri: "file:///repo/tools/definitions/routing/guard.ts" },
        ]),
      ),
    );
    expect(puts.length).toBe(1);
    const text = String(puts[0]?.value ?? "");
    expect(text).toContain(targetedId);
  });

  test("a brain with no claims puts cold once and carries no index", async () => {
    const { sessionID, handler, puts, stored } = await setup("cold", { agent: "build" });
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);
    expect(puts[0]?.key).toBe("spectre.brain");
    const text = String(puts[0]?.value ?? "");
    expect(text).toContain("cold");
    expect(text).not.toContain("brain index");

    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);
    expect(stored.get(sessionID)?.get("spectre.brain")).toBe(text);
  });

  // The cold line is the one piece of text the first session in a fresh project
  // ever reads, and it shipped naming `action=seed`, which is not one of the five.
  // A test asserting the line says "cold" cannot catch that, so this one reads
  // every action the tool names out of its own text and checks it against the
  // schema. Both the cold line and the description are covered.
  test("every action this tool names in its own text is an action it has", async () => {
    const named = new Set<string>();
    for (const source of [COLD, DESCRIPTION])
      for (const found of source.matchAll(/action=([a-z-]+)/g))
        if (found[1] !== undefined) named.add(found[1]);

    expect(named.size).toBeGreaterThan(0);
    for (const action of named) expect(ACTIONS).toContain(action);
  });

  test("the cold line names recall, which is the action that answers nothing yet", () => {
    expect(COLD).toContain("action=recall");
    expect(COLD).not.toContain("action=seed");
  });

  test("an unchanged ledger skips re-put while a newly minted neuron updates spectre.brain", async () => {
    const { dir, sessionID, handler, puts, stored } = await setup("mtime", { agent: "spectre" });
    await seed(dir, 2);
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);

    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);

    await Bun.sleep(15);
    await seed(dir, 1, 2);
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(2);
    expect(String(stored.get(sessionID)?.get("spectre.brain") ?? "")).toContain("Claim number 2");
  });

  test("a second root session in the same project gets the index too", async () => {
    const { dir, handler, puts } = await setup("second", { agent: "spectre" });
    await seed(dir, 2);
    await Effect.runPromise(handler(promptEvent("ses_first_root")));
    await Effect.runPromise(handler(promptEvent("ses_second_root")));
    expect(puts.map((one) => one.sessionID)).toEqual(["ses_first_root", "ses_second_root"]);
    expect(String(puts[1]?.value ?? "")).toContain("Claim number 0");
  });

  test("more claims than fit stay under 600 tokens and say they were cut", async () => {
    const { dir, sessionID, handler, puts } = await setup("cap", { agent: "spectre" });
    await seed(dir, 60);
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);
    const text = String(puts[0]?.value ?? "");
    expect(text.length / 4).toBeLessThanOrEqual(600);
    expect(text).toMatch(/truncat/i);
    expect(text).toContain("600 tokens");
  });

  test("superseded and demoted claims stay out of the injected index and newer active claims rank first", async () => {
    const { dir, sessionID, handler, puts } = await setup("filtered", { agent: "spectre" });
    await seed(dir, 60);
    const idOf = (i: number) => `01K${String(i).padStart(24, "0")}`;
    const ledgerLines = [
      JSON.stringify({
        kind: "supersedes",
        from: idOf(39),
        to: idOf(38),
        why: "updated",
        at: "2026-10-10T00:00:00.000Z",
        until: null,
      }),
      JSON.stringify({
        kind: "demoted",
        from: idOf(37),
        to: null,
        why: "disproven",
        at: "2026-10-10T00:00:00.000Z",
        until: null,
      }),
    ].join("\n");
    await Bun.write(join(dir, ".spectre", "brain", "synapses.ndjson"), `${ledgerLines}\n`);

    await Effect.runPromise(handler(promptEvent(sessionID)));
    const text = String(puts[0]?.value ?? "");
    expect(text).not.toContain(idOf(39));
    expect(text).not.toContain(idOf(37));
    expect(text).toContain(idOf(38));
    expect(text).toContain(idOf(36));
    expect(text).not.toContain(idOf(0));
  });

  test("demoting the sole active claim updates spectre.brain without claiming the brain is unseeded", async () => {
    const { dir, sessionID, handler, puts, stored } = await setup("all_retired", {
      agent: "spectre",
    });
    await seed(dir, 1);
    const sole = `01K${String(0).padStart(24, "0")}`;
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(String(stored.get(sessionID)?.get("spectre.brain") ?? "")).toContain(sole);

    await Bun.sleep(15);
    await Bun.write(
      join(dir, ".spectre", "brain", "synapses.ndjson"),
      `${JSON.stringify({
        kind: "demoted",
        from: sole,
        to: null,
        why: "wrong",
        at: "2026-10-10T00:00:00.000Z",
        until: null,
      })}\n`,
    );
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(2);
    const updated = String(stored.get(sessionID)?.get("spectre.brain") ?? "");
    expect(updated).not.toContain(sole);
    expect(updated).not.toContain(COLD);
  });

  test("re-puts spectre.brain when a timed demotion expires without any file mtime change", async () => {
    const { dir, sessionID, handler, puts, stored } = await setup("clock_expiry", {
      agent: "spectre",
    });
    await seed(dir, 1);
    const sole = `01K${String(0).padStart(24, "0")}`;
    const until = new Date(Date.now() + 80).toISOString();
    await Bun.write(
      join(dir, ".spectre", "brain", "synapses.ndjson"),
      `${JSON.stringify({
        kind: "demoted",
        from: sole,
        to: null,
        why: "briefly muted",
        at: "2026-10-10T00:00:00.000Z",
        until,
      })}\n`,
    );

    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(1);
    expect(String(stored.get(sessionID)?.get("spectre.brain") ?? "")).not.toContain(sole);

    await Bun.sleep(110);
    await Effect.runPromise(handler(promptEvent(sessionID)));
    expect(puts.length).toBe(2);
    expect(String(stored.get(sessionID)?.get("spectre.brain") ?? "")).toContain(sole);
  });

  test("a host mock without session.instructions degrades gracefully", async () => {
    const { dir, sessionID, handler } = await setup("no_instructions", { agent: "spectre" }, false);
    await seed(dir, 2);
    const exit = await Effect.runPromiseExit(handler(promptEvent(sessionID)));
    expect(Exit.isSuccess(exit)).toBe(true);
  });

  test("seen map evicts the oldest session key FIFO once it reaches 256 entries", async () => {
    const { dir, handler, puts } = await setup("fifo_cap", { agent: "spectre" });
    await seed(dir, 1);

    for (let i = 0; i < 257; i++) {
      await Effect.runPromise(handler(promptEvent(`ses_fifo_${process.pid}_${i}`)));
    }
    expect(puts.length).toBe(257);

    await Effect.runPromise(handler(promptEvent(`ses_fifo_${process.pid}_1`)));
    expect(puts.length).toBe(257);

    await Effect.runPromise(handler(promptEvent(`ses_fifo_${process.pid}_0`)));
    expect(puts.length).toBe(258);
  });
});

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});
