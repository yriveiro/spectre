import { afterAll, describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { ledger, live, type Edge } from "../../tools/definitions/brain/ledger";

const TMP = (Bun.env.TMPDIR ?? "/tmp").replace(/\/+$/, "");
const roots: Array<string> = [];
let seq = 0;

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect);

const git = async (root: string, args: ReadonlyArray<string>): Promise<string> => {
  const done = Bun.spawnSync({
    cmd: ["git", "-C", root, "-c", "user.email=worker@spectre", "-c", "user.name=worker", ...args],
    stdout: "pipe",
    stderr: "pipe",
  });
  if (!done.success) throw new Error(`git ${args.join(" ")}: ${done.stderr.toString()}`);
  return done.stdout.toString().trim();
};

const scratch = async (repository = false): Promise<AbsolutePath> => {
  const root = `${TMP}/spectre-brain-${process.pid}-${seq++}`;
  roots.push(root);
  await Bun.write(`${root}/.gitignore`, "");
  if (repository) await git(root, ["init", "-q"]);
  return AbsolutePath.make(root);
};

const synapses = (root: AbsolutePath) => `${root}/.spectre/brain/synapses.ndjson`;
const notes = (root: AbsolutePath) => `${root}/.spectre/brain/neurons`;

const RELATES: Edge = {
  kind: "relates",
  from: "a",
  to: "b",
  why: "same feature",
  at: "2026-10-02T00:00:00.000Z",
  until: null,
};

const DRAFT = {
  kind: "gotcha" as const,
  claim: "A canvas is never overwritten: save allocates the directory",
  subject: ["tools/definitions/canvas/store.ts"],
};

afterAll(async () => {
  for (const root of roots) await Bun.$`rm -rf ${root}`.quiet();
});

describe("a second identical run", () => {
  test("a second identical append writes nothing", async () => {
    const brain = ledger(await scratch());
    expect(await run(brain.append(RELATES))).toBe(true);
    expect(await run(brain.append(RELATES))).toBe(false);
  });

  test("a second run at a later clock writes nothing either", async () => {
    const root = await scratch();
    const brain = ledger(root);
    expect(await run(brain.append(RELATES))).toBe(true);
    expect(await run(brain.append({ ...RELATES, at: "2027-01-01T00:00:00.000Z" }))).toBe(false);
    expect((await Bun.file(synapses(root)).text()).trimEnd().split("\n")).toHaveLength(1);
  });

  test("the ledger file is byte identical after a second run", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await run(brain.append(RELATES));
    const first = await Bun.file(synapses(root)).text();
    await run(brain.append(RELATES));
    expect(await Bun.file(synapses(root)).text()).toBe(first);
    expect(first).toBe(
      '{"kind":"relates","from":"a","to":"b","why":"same feature",' +
        '"at":"2026-10-02T00:00:00.000Z","until":null}\n',
    );
  });

  test("a second identical run leaves an empty git diff", async () => {
    const root = await scratch(true);
    const brain = ledger(root);
    await run(brain.append(RELATES));
    await run(brain.mint(DRAFT));
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "-m", "seed"]);

    await run(brain.append({ ...RELATES, at: "2027-01-01T00:00:00.000Z" }));
    await git(root, ["add", "-A"]);

    expect(await git(root, ["status", "--porcelain"])).toBe("");
  });

  test("the diff check can see a change, so its empty verdict means something", async () => {
    const root = await scratch(true);
    const brain = ledger(root);
    await run(brain.mint(DRAFT));
    await git(root, ["add", "-A"]);
    await git(root, ["commit", "-q", "-m", "seed"]);

    await run(brain.mint(DRAFT));
    await git(root, ["add", "-A"]);

    expect(await git(root, ["status", "--porcelain"])).not.toBe("");
  });
});

describe("append", () => {
  test("refuses an edge with an empty why", async () => {
    const root = await scratch();
    const brain = ledger(root);
    const exit = await Effect.runPromiseExit(brain.append({ ...RELATES, why: "" }));
    expect(Exit.isFailure(exit)).toBe(true);
    if (Exit.isFailure(exit)) expect(String(Cause.squash(exit.cause))).toContain("why");
    expect(await Bun.file(synapses(root)).exists()).toBe(false);
  });

  test("refuses an edge whose why is only whitespace", async () => {
    const exit = await Effect.runPromiseExit(
      ledger(await scratch()).append({ ...RELATES, why: "   \t " }),
    );
    expect(Exit.isFailure(exit)).toBe(true);
  });

  test("a different why is a different line", async () => {
    const root = await scratch();
    const brain = ledger(root);
    expect(await run(brain.append(RELATES))).toBe(true);
    expect(await run(brain.append({ ...RELATES, why: "a different reason" }))).toBe(true);
    const rows = (await Bun.file(synapses(root)).text()).trimEnd().split("\n");
    expect(rows).toHaveLength(2);
    expect((await run(brain.read())).edges.map((edge) => edge.why)).toEqual([
      "same feature",
      "a different reason",
    ]);
  });

  test("a duplicate anywhere in the file is a duplicate", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await run(brain.append(RELATES));
    await run(brain.append({ ...RELATES, from: "b", to: "c", why: "other" }));
    expect(await run(brain.append(RELATES))).toBe(false);
  });

  test("a row written by another version is never rewritten", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await Bun.write(
      synapses(root),
      `${JSON.stringify({ ...RELATES, a_field_from_the_future: "kept" })}\n`,
    );

    expect(await run(brain.append(RELATES))).toBe(false);
    expect(await run(brain.append({ ...RELATES, why: "new reason" }))).toBe(true);

    const lines = (await Bun.file(synapses(root)).text()).trimEnd().split("\n");
    expect(lines[0]).toContain('"a_field_from_the_future":"kept"');
    expect(JSON.parse(lines[0]!)).toMatchObject({ a_field_from_the_future: "kept" });
    expect(JSON.parse(lines[1]!)).toMatchObject({ why: "new reason" });
  });

  test("a mutation that cannot land leaves no temporary file behind", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await Bun.write(`${synapses(root)}/occupied`, "");

    const exit = await Effect.runPromiseExit(brain.append(RELATES));
    expect(Exit.isFailure(exit)).toBe(true);

    const left: Array<string> = [];
    for await (const entry of new Bun.Glob("*.tmp").scan({ cwd: `${root}/.spectre/brain` }))
      left.push(entry);
    expect(left).toEqual([]);
  });

  test("a demoted edge has no to", async () => {
    const root = await scratch();
    const brain = ledger(root);
    expect(
      await run(
        brain.append({
          kind: "demoted",
          from: "a",
          to: null,
          why: "the claim was wrong",
          at: "2026-10-02T00:00:00.000Z",
          until: null,
        }),
      ),
    ).toBe(true);
    expect((await run(brain.read())).edges[0]).toEqual({
      kind: "demoted",
      from: "a",
      to: null,
      why: "the claim was wrong",
      at: "2026-10-02T00:00:00.000Z",
      until: null,
    });
  });
});

describe("mint", () => {
  test("two mints of one draft are two claims", async () => {
    const root = await scratch();
    const brain = ledger(root);
    const first = await run(brain.mint(DRAFT));
    const second = await run(brain.mint(DRAFT));

    expect(first.id).not.toBe(second.id);
    expect(first.claim).toBe(second.claim);
    expect(await Bun.file(first.path).exists()).toBe(true);
    expect(await Bun.file(second.path).exists()).toBe(true);
    expect((await run(brain.read())).claims).toHaveLength(2);
  });

  test("a minted id is a uuidv7 and names its own note", async () => {
    const root = await scratch();
    const claim = await run(ledger(root).mint(DRAFT));
    expect(claim.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[0-9a-f]{4}-[0-9a-f]{12}$/);
    expect(claim.path).toBe(`${notes(root)}/${claim.id}.md`);
  });

  test("the note on disk carries the claim, not a slug", async () => {
    const root = await scratch();
    const claim = await run(ledger(root).mint(DRAFT));
    const text = await Bun.file(claim.path).text();
    expect(text).toContain("kind: gotcha");
    expect(text).toContain("subject:\n  - tools/definitions/canvas/store.ts");
    expect(text).toContain(
      'claim: "A canvas is never overwritten: save allocates the directory"',
    );
    expect(text.endsWith("\n")).toBe(true);
    expect(/[ \t]+$/m.test(text)).toBe(false);
  });

  test("read hands back what mint wrote", async () => {
    const root = await scratch();
    const brain = ledger(root);
    const minted = await run(brain.mint(DRAFT));
    const { claims, problems } = await run(brain.read());
    expect(problems).toEqual([]);
    expect(claims).toHaveLength(1);
    expect(claims[0]).toEqual({ ...minted, at: claims[0]!.at });
    expect(claims[0]!.id).toBe(minted.id);
    expect(claims[0]!.path).toBe(minted.path);
  });

  test("claims come back oldest first", async () => {
    const root = await scratch();
    const brain = ledger(root);
    const first = await run(brain.mint(DRAFT));
    const second = await run(brain.mint(DRAFT));
    const ids = (await run(brain.read())).claims.map((claim) => claim.id);
    expect(ids).toEqual([first.id, second.id].toSorted());
  });
});

describe("read", () => {
  test("a cold brain reads as empty", async () => {
    const brain = ledger(await scratch());
    expect(await run(brain.read())).toEqual({ claims: [], edges: [], problems: [] });
  });

  test("an unreadable note is a problem, not a lost brain", async () => {
    const root = await scratch();
    const brain = ledger(root);
    const good = await run(brain.mint(DRAFT));
    await Bun.write(`${notes(root)}/broken.md`, "not: [valid\n");

    const { claims, problems } = await run(brain.read());
    expect(claims.map((claim) => claim.id)).toEqual([good.id]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("broken.md");
  });

  test("a temporary file is not a claim", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await run(brain.mint(DRAFT));
    const tmp = `${notes(root)}/0199b600000000000000000001.md.0199.tmp`;
    await Bun.write(tmp, "half a note");

    const { claims, problems } = await run(brain.read());
    expect(claims).toHaveLength(1);
    expect(problems).toEqual([]);
  });

  test("an edge whose until has passed is not handed back", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await run(
      brain.append({
        kind: "relates",
        from: "a",
        to: "b",
        why: "expired",
        at: "2020-01-01T00:00:00.000Z",
        until: "2020-06-01T00:00:00.000Z",
      }),
    );
    await run(brain.append({ ...RELATES, why: "still good" }));

    const { edges } = await run(brain.read());
    expect(edges.map((edge) => edge.why)).toEqual(["still good"]);
    const onDisk = (await Bun.file(synapses(root)).text()).trimEnd().split("\n");
    expect(onDisk).toHaveLength(2);
  });

  test("an unreadable ledger line is a problem and the rest still reads", async () => {
    const root = await scratch();
    const brain = ledger(root);
    await run(brain.append(RELATES));
    await Bun.write(synapses(root), "not json\n");

    const { edges, problems } = await run(brain.read());
    expect(edges).toEqual([]);
    expect(problems).toHaveLength(1);
    expect(problems[0]).toContain("synapses.ndjson");
  });
});

describe("live", () => {
  const edge = (until: string | null): Edge => ({ ...RELATES, until });

  test("drops an edge whose until has passed", () => {
    expect(live([edge("2020-06-01T00:00:00.000Z")])).toEqual([]);
  });

  test("gives an open relation an end without rewriting the line", async () => {
    const root = await scratch();
    const book = ledger(root);
    expect(await run(book.append(RELATES))).toBe(true);
    expect(await run(book.append({ ...RELATES, until: "2999-01-01T00:00:00.000Z" }))).toBe(true);
    const onDisk = await Bun.file(synapses(root)).text();
    expect(onDisk.split("\n").filter((line) => line.length > 0)).toHaveLength(2);
  });

  test("a re-run that reproduces the window writes nothing", async () => {
    const root = await scratch();
    const book = ledger(root);
    const dated = { ...RELATES, until: "2999-01-01T00:00:00.000Z" };
    expect(await run(book.append(dated))).toBe(true);
    expect(await run(book.append(dated))).toBe(false);
  });

  test("keeps an edge whose until is null or in the future", () => {
    const forever = edge(null);
    const tomorrow = edge("2999-01-01T00:00:00.000Z");
    expect(live([forever, tomorrow])).toEqual([forever, tomorrow]);
  });

  test("an until that is not a date does not silently forget the edge", () => {
    const unreadable = edge("whenever");
    expect(live([unreadable])).toEqual([unreadable]);
  });

  test("an until exactly now has passed", () => {
    expect(live([edge(new Date().toISOString())])).toEqual([]);
  });
});