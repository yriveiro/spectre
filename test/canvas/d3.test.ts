import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { bundle, readBundle, version } from "../../tools/definitions/canvas/d3";

const scratchRoot = (): string =>
  join(
    Bun.env.TMPDIR ?? "/tmp",
    `spectre-d3-test-${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`,
  );

const writeTempRoot = async (
  root: string,
  files: Readonly<Record<string, string>>,
): Promise<void> => {
  for (const [relative, content] of Object.entries(files)) {
    await Bun.write(join(root, relative), content);
  }
};

const removeTempRoot = async (root: string): Promise<void> => {
  await Bun.$`rm -rf ${root}`.quiet();
};

describe("readBundle", () => {
  test("reads a version and a bundle from a package root", async () => {
    const root = scratchRoot();
    try {
      await writeTempRoot(root, {
        "package.json": JSON.stringify({ name: "d3", version: "9.9.9" }),
        "dist/d3.min.js": "/* fake d3 bundle */",
      });
      const result = await readBundle(root);
      expect(result.ok).toBe(true);
      if (!result.ok) return;
      expect(result.value.version).toBe("9.9.9");
      expect(result.value.content).toBe("/* fake d3 bundle */");
    } finally {
      await removeTempRoot(root);
    }
  });

  test("a missing package.json is a refusal", async () => {
    const result = await readBundle(join(scratchRoot(), "no-such-root"));
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.problem).toMatch(/bun install/);
  });

  test("a missing bundle is a refusal", async () => {
    const root = scratchRoot();
    try {
      await writeTempRoot(root, {
        "package.json": JSON.stringify({ name: "d3", version: "9.9.9" }),
      });
      const result = await readBundle(root);
      expect(result.ok).toBe(false);
      if (result.ok) return;
      expect(result.problem).toContain("dist/d3.min.js");
      expect(result.problem).toMatch(/bun install|bun update d3/);
    } finally {
      await removeTempRoot(root);
    }
  });
});

describe("installed d3", () => {
  test("version matches node_modules/d3/package.json", async () => {
    const meta = (await Bun.file(
      join(import.meta.dir, "..", "..", "node_modules", "d3", "package.json"),
    ).json()) as { readonly version: string };
    expect(await version()).toBe(meta.version);
  });

  test("bundle carries the UMD build and is larger than 200_000 bytes", async () => {
    const result = await bundle();
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.content).toContain("https://d3js.org");
    expect(result.value.content.length).toBeGreaterThan(200_000);
  });
});
