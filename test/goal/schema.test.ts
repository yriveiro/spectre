import { describe, expect, test } from "bun:test";
import { Option, Schema } from "effect";
import { Input } from "../../tools/definitions/goal";

const decode = Schema.decodeUnknownOption(Input);

describe("the goal tool's input schema", () => {
  test("a complete arm call decodes", () => {
    const decoded = decode({
      action: "arm",
      objective: "Make the queue pass",
      predicate: "bun test returns zero failures",
      check: "bun test",
    });
    expect(Option.isSome(decoded)).toBe(true);
  });

  test("an arm call without a check is refused before execute", () => {
    const decoded = decode({
      action: "arm",
      objective: "Make the queue pass",
      predicate: "bun test returns zero failures",
    });
    expect(Option.isNone(decoded)).toBe(true);
  });

  test("an arm call without a predicate is refused before execute", () => {
    const decoded = decode({
      action: "arm",
      objective: "Make the queue pass",
      check: "bun test",
    });
    expect(Option.isNone(decoded)).toBe(true);
  });

  test("a status call carries no arm fields", () => {
    expect(Option.isSome(decode({ action: "status" }))).toBe(true);
    expect(Option.isSome(decode({ action: "status", check: "bun test" }))).toBe(true);
  });

  test("an unknown action is refused", () => {
    expect(Option.isNone(decode({ action: "pause" }))).toBe(true);
  });
});
