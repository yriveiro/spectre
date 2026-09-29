import { describe, expect, test } from "bun:test";
import { failureOf } from "../opencode";

/**
 * Captured from a real run against the pinned model under load. Every request
 * answered 200 and the session went idle with `outcome: "failed"`, so nothing
 * threw and the sweep reported zero failures over 54 rows that never happened.
 */
const RATE_LIMITED = {
  id: "msg_1",
  type: "assistant",
  finish: "error",
  error: {
    type: "provider.quota",
    message: "Rate limit exceeded. Please try again later.",
    status: 429,
  },
  content: [],
};

describe("failureOf", () => {
  test("a rate limited turn is a failure, not silence", () => {
    expect(failureOf(RATE_LIMITED)?.kind).toBe("provider.quota");
    expect(failureOf(RATE_LIMITED)?.reason).toContain("Rate limit exceeded");
  });

  test("the status is in the reason, so a quota run is not read as a routing result", () => {
    expect(failureOf(RATE_LIMITED)?.reason).toContain("429");
  });

  test("a turn that finished is not a failure, whatever its content", () => {
    expect(failureOf({ type: "assistant", finish: "stop", content: [] })).toBeUndefined();
    expect(failureOf({ type: "assistant", finish: "tool-calls", content: [] })).toBeUndefined();
  });

  test("a turn with no finish at all is not a failure", () => {
    expect(failureOf({ type: "assistant", content: [] })).toBeUndefined();
  });

  test("an error with no message still names its kind", () => {
    const failure = failureOf({ finish: "error", error: { type: "provider.overloaded" } });
    expect(failure?.kind).toBe("provider.overloaded");
    expect(failure?.reason).toBe("provider.overloaded");
  });

  test("an error with neither message nor type is still reported", () => {
    expect(failureOf({ finish: "error" })?.kind).toBe("error");
  });
});
