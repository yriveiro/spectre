import { beforeAll, describe, expect, test } from "bun:test";
import { join } from "node:path";

const ROOT = join(import.meta.dir, "..");
const APPROVED = ["node:path", "node:fs/promises"] as const;
const SKIP = new Set(["node_modules", "test", "dist"]);

const sourceFiles = async () => {
  const top = new Bun.Glob("*").scan({ cwd: ROOT, dot: false, onlyFiles: false });
  const folders: Array<string> = [];
  const found: Array<string> = [];
  for await (const name of top) {
    if (SKIP.has(name)) continue;
    const at = join(ROOT, name);
    if ((await Bun.file(at).stat()).isDirectory()) folders.push(name);
    else if (name.endsWith(".ts") || name.endsWith(".tsx")) found.push(name);
  }

  const ts = new Bun.Glob("**/*.{ts,tsx}");
  for (const folder of folders)
    for await (const entry of ts.scan({ cwd: join(ROOT, folder), dot: false }))
      found.push(`${folder}/${entry}`);

  return found.toSorted();
};

const byModule = new Map<string, Array<string>>();

beforeAll(async () => {
  for (const file of await sourceFiles()) {
    const text = await Bun.file(join(ROOT, file)).text();
    for (const match of text.matchAll(/from\s+["'](node:[a-z_/]+)["']/g)) {
      const specifier = match[1];
      if (!specifier) continue;
      const files = byModule.get(specifier) ?? [];
      files.push(file);
      byModule.set(specifier, files.toSorted());
    }
  }
});

describe("every node:* import is an approved exception", () => {
  test("no source file imports an unapproved node:* module", () => {
    const unapproved = [...byModule.keys()].filter((one) => !APPROVED.includes(one as never));
    expect(unapproved.toSorted()).toEqual([]);
  });

  test("every approved node:* module is still used and listed in AGENTS.md", async () => {
    const agents = await Bun.file(join(ROOT, "AGENTS.md")).text();
    for (const specifier of APPROVED) {
      expect(byModule.get(specifier)?.length ?? 0).toBeGreaterThan(0);
      expect(agents).toContain(`\`${specifier}\``);
    }
  });
});
