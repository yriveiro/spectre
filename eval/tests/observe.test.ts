import { describe, expect, test } from "bun:test";
import { fromText, observe, type Transcript } from "../observe";
import { NONE } from "../score";
import type { Message } from "../opencode";

const catalogue = ["code-hygiene", "principle-evidence", "principle-hygiene"];

const text = (body: string): Message => ({
  type: "assistant",
  content: [{ type: "text", text: body }],
});

const tool = (name: string, input: Record<string, unknown>): Message => ({
  type: "assistant",
  content: [{ type: "tool", name, state: { status: "completed", input } }],
});

const turn = (
  parts: Transcript["messages"],
  activated: ReadonlyArray<string> = [],
): Transcript => ({
  messages: parts,
  activated,
});

describe("fromText", () => {
  test("a bare id is the answer", () => {
    expect(fromText("code-hygiene", catalogue)).toBe("code-hygiene");
  });

  test("an explained reply still scores on the id it names", () => {
    expect(fromText("I would load code-hygiene, because the diff is the question.", catalogue)).toBe(
      "code-hygiene",
    );
  });

  test("a catalogue id beats a stray none in the same reply", () => {
    expect(fromText("none of these except code-hygiene", catalogue)).toBe("code-hygiene");
  });

  test("none is none when no id is named", () => {
    expect(fromText("None of them apply.", catalogue)).toBe(NONE);
  });

  test("an id we do not register is kept verbatim", () => {
    expect(fromText("ripwire-before-you-build", catalogue)).toBe("ripwire-before-you-build");
  });

  test("an empty reply is empty, not none", () => {
    expect(fromText("   ", catalogue)).toBe("");
  });
});

describe("observe", () => {
  test("an activation is the decision, and beats any prose around it", () => {
    const got = observe(turn([text("I will load principle-hygiene.")], ["code-hygiene"]), catalogue);
    expect(got).toEqual({ got: "code-hygiene", via: "skill" });
  });

  test("the first activation wins when there are two", () => {
    const got = observe(turn([], ["code-hygiene", "principle-hygiene"]), catalogue);
    expect(got.got).toBe("code-hygiene");
  });

  test("a skill tool call is the next best evidence", () => {
    expect(observe(turn([tool("skill", { id: "code-hygiene" })]), catalogue)).toEqual({
      got: "code-hygiene",
      via: "tool",
    });
  });

  test("the id key is read, and so are skill and name", () => {
    expect(observe(turn([tool("skill", { skill: "principle-evidence" })]), catalogue).got).toBe(
      "principle-evidence",
    );
    expect(observe(turn([tool("skills", { name: "code-hygiene" })]), catalogue).got).toBe(
      "code-hygiene",
    );
  });

  test("another tool is not a skill decision", () => {
    expect(
      observe(turn([tool("read", { id: "code-hygiene" }), text("code-hygiene")]), catalogue).via,
    ).toBe("text");
  });

  test("a tool call with no usable input falls through to the prose", () => {
    expect(observe(turn([tool("skill", {}), text("code-hygiene")]), catalogue)).toEqual({
      got: "code-hygiene",
      via: "text",
    });
  });

  test("prose alone is reported as text, so it is never counted as an activation", () => {
    expect(observe(turn([text("code-hygiene")]), catalogue).via).toBe("text");
  });

  test("a turn with nothing in it is silent", () => {
    expect(observe(turn([{ type: "assistant", content: [] }]), catalogue).via).toBe("silent");
  });

  test("a turn with no content at all is silent, not a crash", () => {
    expect(observe(turn([{ id: "msg_1", type: "assistant" }]), catalogue)).toEqual({
      got: "",
      via: "silent",
    });
  });

  test("no turn at all is silent, and is scored as a miss", () => {
    expect(observe(turn([]), catalogue)).toEqual({ got: "", via: "silent" });
  });

  test("reasoning parts are not mistaken for an answer", () => {
    const reasoning: Message = {
      type: "assistant",
      content: [{ type: "reasoning", text: "code-hygiene seems right" }],
    };
    expect(observe(turn([reasoning]), catalogue).via).toBe("silent");
  });
});
