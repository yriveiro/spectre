import { describe, expect, test } from "bun:test";
import { Worktree } from "@opencode/plugin/effect";
import { hostRefusal } from "../../tools/definitions/worktrees/read";

describe("the host's worktree refusal", () => {
  test("a dirty removal carries the host's own forceRequired flag", () => {
    const refusal = new Worktree.OperationError({
      message: "contains modified or untracked files",
      forceRequired: true,
    });
    expect(hostRefusal(refusal)).toEqual({
      message: "contains modified or untracked files",
      forceRequired: true,
    });
  });

  test("a refusal without the flag does not need force", () => {
    expect(hostRefusal(new Worktree.OperationError({ message: "no such worktree" }))).toEqual({
      message: "no such worktree",
      forceRequired: false,
    });
  });

  test("a failure that is not the host's shape is reported as text", () => {
    expect(hostRefusal("boom")).toEqual({ message: "boom", forceRequired: false });
  });
});
