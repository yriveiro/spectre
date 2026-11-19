import { afterAll, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { Effect } from "effect";
import { update } from "../../commands";
import { pr } from "../../commands/definitions/pr";

const TMP = Bun.env.TMPDIR ?? "/tmp";
const roots: Array<string> = [];

afterAll(async () => {
  for (const dir of roots) await Bun.$`rm -rf ${dir}`.quiet();
});

const capture = async (typed: string, directory?: string) => {
  const seen: Array<{
    text: string;
    sessionID: string;
    skills?: ReadonlyArray<{ readonly id: string }>;
  }> = [];
  const ctx = {
    command: {
      transform: (callback: (editor: { add: (definition: unknown) => void }) => void) =>
        Effect.sync(() => callback({ add: () => {} })),
    },
    session: {
      ...(directory === undefined
        ? {}
        : {
            get: () => Effect.succeed({ location: { directory } }),
          }),
      prompt: (input: {
        text: string;
        sessionID: string;
        skills?: ReadonlyArray<{ readonly id: string }>;
      }) =>
        Effect.sync(() => {
          seen.push({ text: input.text, sessionID: input.sessionID, skills: input.skills });
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
const playbook = join(
  import.meta.dir,
  "..",
  "..",
  "skills",
  "definitions",
  "playbook-opening-a-pr",
  "SKILL.md",
);

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

  test("the prompt delegates PR work to the playbook", async () => {
    const { seen } = await capture("");
    expect(seen[0]?.text).toContain("playbook-opening-a-pr");
    expect(seen[0]?.skills?.map((s) => s.id)).toEqual(["playbook-opening-a-pr"]);
  });

  test("attaches deterministic git, forge, and signing preflight when session directory resolves", async () => {
    const dir = `${TMP}/spectre-cmd-pr-${process.pid}-${Date.now()}`;
    roots.push(dir);
    await Bun.$`mkdir -p ${dir} && git -C ${dir} init -b main`.quiet();
    await Bun.$`git -C ${dir} config user.email t@example.com && git -C ${dir} config user.name T && git -C ${dir} config commit.gpgsign true`.quiet();
    await Bun.$`git -C ${dir} remote add origin git@gitlab.autodoc.dev:dgt/arch-playground.git`.quiet();
    await Bun.write(`${dir}/app.ts`, "export const a = 1;\n");
    await Bun.$`git -C ${dir} add app.ts && git -C ${dir} commit --no-gpg-sign -m "init"`.quiet();
    await Bun.$`git -C ${dir} switch -c fix-sidecar`.quiet();
    await Bun.write(`${dir}/app.ts`, "export const a = 2;\n");

    const { seen } = await capture("focus on memory", dir);
    const text = seen[0]?.text ?? "";

    expect(text.startsWith("Open a pull request")).toBe(true);
    expect(text).toContain("<pr-preflight>");
    expect(text).toContain("branch: fix-sidecar");
    expect(text).toContain("base: main");
    expect(text).toContain("forge: gitlab");
    expect(text).toContain("gpgsign: true");
    expect(text).toContain("M app.ts");
    expect(text.endsWith("The user added: focus on memory")).toBe(true);
  });

  test("the playbook routes independent prep before PR composition", async () => {
    const text = await Bun.file(playbook).text();
    const firstPhase = text.match(/^## Phase [A-Z]: (.+)$/m)?.[1];
    const prep = text.indexOf("## Phase D: Parallel preparation");
    const fields = text.indexOf("## Phase E: Title and body");

    expect(firstPhase).toBe("Worktree");
    expect(prep).toBeGreaterThanOrEqual(0);
    expect(fields).toBeGreaterThan(prep);
    expect(text.slice(prep, fields)).toContain("tools.spectre.routing");
    expect(text.slice(prep, fields)).toContain("mechanical");
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
    expect(added.map((one) => one.name).toSorted()).toEqual([
      "babysit",
      "drive",
      "effect-align",
      "pr",
      "wt",
    ]);
  });
});
