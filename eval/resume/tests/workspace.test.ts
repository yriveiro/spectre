import { describe, expect, test } from "bun:test";
import type { WorkspacePath } from "../scenario";
import { readIn, resolveIn } from "../workspace";

const path = (value: string): WorkspacePath => value as WorkspacePath;

describe("a fixture path stays in the workspace", () => {
  test("a relative path resolves under the workspace", () => {
    expect(resolveIn("/tmp/run/workspace", path("notes.txt"))).toBe("/tmp/run/workspace/notes.txt");
  });

  test("a climb out is refused at the sink too", () => {
    expect(() => resolveIn("/tmp/run/workspace", path("../secret.txt"))).toThrow(
      "escapes the workspace",
    );
  });
});

describe("a read cannot leave the workspace through a symlink", () => {
  test("a normal file is read, a missing file is empty, a symlink out is refused", async () => {
    const dir = (await Bun.$`mktemp -d`.text()).trim();
    const workspace = `${dir}/workspace`;
    try {
      await Bun.write(`${workspace}/notes.txt`, "alpha\n");
      await Bun.write(`${dir}/secret.txt`, "TOP-SECRET\n");
      await Bun.$`ln -s ${dir}/secret.txt ${workspace}/link`.quiet();

      expect(await readIn(workspace, path("notes.txt"))).toBe("alpha");
      expect(await readIn(workspace, path("missing.txt"))).toBe("");
      await expect(readIn(workspace, path("link"))).rejects.toThrow("resolves outside the workspace");
    } finally {
      await Bun.$`rm -rf ${dir}`.quiet();
    }
  });
});
