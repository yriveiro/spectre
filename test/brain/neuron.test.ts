import { describe, expect, test } from "bun:test";
import { Cause, Effect, Exit } from "effect";
import { AbsolutePath } from "@opencode/schema/schema";
import { parse, render, type Claim } from "../../tools/definitions/brain/neuron";

const run = <A>(effect: Effect.Effect<A, Error>): Promise<A> => Effect.runPromise(effect);

const NOTE = AbsolutePath.make("/brain/neurons/0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b.md");

const CLAIM: Claim = {
  id: "0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b",
  kind: "gotcha",
  claim: "A canvas is never overwritten: save allocates the directory",
  subject: ["tools/definitions/canvas/store.ts"],
  at: "2026-10-02T00:00:00.000Z",
  path: NOTE,
};

const NOTE_TEXT = [
  "---",
  "id: 0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b",
  "schema_version: 1",
  "kind: gotcha",
  'claim: "A canvas is never overwritten: save allocates the directory"',
  "subject:",
  "  - tools/definitions/canvas/store.ts",
  "at: 2026-10-02T00:00:00.000Z",
  "---",
  "",
  "A canvas is never overwritten: save allocates the directory",
  "",
].join("\n");

const refuse = async (text: string, note: AbsolutePath = NOTE): Promise<string> => {
  const exit = await Effect.runPromiseExit(parse(text, note));
  expect(Exit.isFailure(exit)).toBe(true);
  return Exit.isFailure(exit) ? String(Cause.squash(exit.cause)) : "";
};

describe("render", () => {
  test("one concrete claim renders to one concrete note", () => {
    expect(render(CLAIM)).toBe(NOTE_TEXT);
  });

  test("rendering is a pure function of its claim", () => {
    expect(render(CLAIM)).toBe(render({ ...CLAIM }));
  });

  test("a claim with no subjects still declares the field", () => {
    expect(render({ ...CLAIM, subject: [] })).toContain("\nsubject:\n  []\n");
  });

  test("every kind renders and reads back", () => {
    for (const kind of ["feature", "gotcha", "decision", "constraint", "lesson"] as const) {
      expect(render({ ...CLAIM, kind })).toContain(`kind: ${kind}`);
    }
  });
});

describe("parse", () => {
  test("a rendered claim round trips", async () => {
    expect(await run(parse(render(CLAIM), NOTE))).toEqual(CLAIM);
  });

  test("the literal note above parses to the literal claim", async () => {
    expect(await run(parse(NOTE_TEXT, NOTE))).toEqual(CLAIM);
  });

  test("a note with no body parses", async () => {
    const bodyless = "---\nid: \"x\"\nkind: \"lesson\"\nclaim: \"c\"\n---\n";
    expect(await run(parse(bodyless, NOTE))).toEqual({
      id: "x",
      kind: "lesson",
      claim: "c",
      subject: [],
      at: "",
      path: NOTE,
    });
  });

  test("an unknown frontmatter field is kept out of the claim, not a failure", async () => {
    const withExtra = NOTE_TEXT.replace(
      "schema_version: 1",
      'schema_version: 1\nconfidence: 0.4\nfuture_field: "kept on disk only"',
    );
    expect(await run(parse(withExtra, NOTE))).toEqual(CLAIM);
  });

  test("an older schema_version is not a reason to refuse a note", async () => {
    const older = NOTE_TEXT.replace("schema_version: 1", "schema_version: 0");
    expect(await run(parse(older, NOTE))).toEqual(CLAIM);
  });

  test("a missing schema_version is not a reason to refuse a note", async () => {
    const none = NOTE_TEXT.replace("schema_version: 1\n", "");
    expect(await run(parse(none, NOTE))).toEqual(CLAIM);
  });

  test("a note with no id takes the id its filename already names", async () => {
    const none = NOTE_TEXT.replace('id: "0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b"\n', "");
    expect((await run(parse(none, NOTE))).id).toBe("0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b");
  });

  test("a body under the frontmatter is the note's prose, not part of the claim", async () => {
    const withBody = `${NOTE_TEXT}\nTwo more lines of detail a reader can Read for.\n`;
    expect(await run(parse(withBody, NOTE))).toEqual(CLAIM);
  });

  test("crlf frontmatter parses", async () => {
    const crlf = NOTE_TEXT.replace(/\n/g, "\r\n");
    expect(await run(parse(crlf, NOTE))).toEqual(CLAIM);
  });

  test("a claim holding a colon, a quote and a newline round trips", async () => {
    const awkward: Claim = {
      ...CLAIM,
      claim: 'he said "no": then\nhe left, and left "a tab\tand a #hash"',
    };
    expect(await run(parse(render(awkward), NOTE))).toEqual(awkward);
  });

  test("a subject holding a quote or a dash round trips", async () => {
    const awkward: Claim = { ...CLAIM, subject: ['a "quoted" path', "-a-leading-dash"] };
    expect(await run(parse(render(awkward), NOTE))).toEqual(awkward);
  });

  test("a claim that is not a note says so", async () => {
    expect(await refuse("just prose, no frontmatter at all\n")).toContain(
      "0199b6a2-1c3d-7e5f-8a9b-0c1d2e3f4a5b.md",
    );
  });

  test("broken frontmatter names the note it came from", async () => {
    const message = await refuse(
      "---\nkind: gotcha\nclaim: [1, 2\n---\n",
      AbsolutePath.make("/brain/neurons/broken.md"),
    );
    expect(message).toContain("broken.md");
  });

  test("a kind this version does not know is refused, not guessed", async () => {
    expect(await refuse(NOTE_TEXT.replace("kind: gotcha", "kind: vibe"))).toContain("vibe");
  });

  test("a missing claim is refused", async () => {
    expect(await refuse(NOTE_TEXT.replace(/\nclaim: [^\n]*\n/, "\n"))).toContain("claim");
  });
});