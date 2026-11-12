import { afterAll, describe, expect, test } from "bun:test";
import { place } from "../../tools/definitions/goal/read";
import { cleanup, layout, normal } from "./fixture";

afterAll(cleanup);

describe("the place a goal may arm", () => {
  test("a linked worktree on a feature branch is the one accepted place", async () => {
    const { feature } = await layout();
    expect(await place(feature)).toEqual({
      kind: "feature",
      directory: feature,
      branch: "feat",
    });
  });

  test("a linked worktree on the trunk is refused", async () => {
    const { main } = await layout();
    expect(await place(main)).toEqual({
      kind: "main-branch",
      directory: main,
      branch: "main",
    });
  });

  test("the main working tree of an ordinary repository is refused", async () => {
    const { root } = await normal();
    expect(await place(root)).toEqual({ kind: "main-worktree", directory: root });
  });

  test("a detached HEAD is refused", async () => {
    const { detached } = await layout();
    expect(await place(detached)).toEqual({ kind: "detached", directory: detached });
  });

  test("a bare repository is not a working tree", async () => {
    const { bare } = await layout();
    const found = await place(bare);
    expect(found.kind).toBe("not-a-repository");
    if (found.kind === "not-a-repository") expect(found.why).not.toBe("");
  });

  test("a directory that does not exist is not a working tree", async () => {
    const { base } = await layout();
    const found = await place(`${base}/missing`);
    expect(found.kind).toBe("not-a-repository");
  });
});
