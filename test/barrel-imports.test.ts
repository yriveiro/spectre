import { describe, expect, test } from "bun:test";
import { join } from "node:path";

/**
 * The host redirects `@opencode/plugin` to its own copy and leaves `@opencode/schema` to the
 * plugin's, so a schema class imported from `@opencode/schema/<module>` is not the class the host
 * tests with `instanceof`. `tools/FOR_AGENTS.md` ("Which `Tool.Error` the host sees") is the rule:
 * every schema the barrel re-exports comes from the barrel.
 *
 * The re-exported modules are read off the installed barrel, so a bump that adds one makes every
 * deep import of it fail here without editing this file.
 */

const ROOT = join(import.meta.dir, "..");
const SKIP = new Set(["node_modules", "dist"]);

const reexported = async () => {
  const barrel = await Bun.file(
    join(ROOT, "node_modules/@opencode/plugin/dist/effect/index.d.ts"),
  ).text();
  return [...barrel.matchAll(/^export \{ \w+ \} from "(@opencode\/schema\/[\w-]+)";$/gm)].flatMap(
    ([, module]) => (module === undefined ? [] : [module]),
  );
};

const sourceFiles = async () =>
  (await Array.fromAsync(new Bun.Glob("**/*.{ts,tsx}").scan({ cwd: ROOT, dot: false }))).filter(
    (entry) => !SKIP.has(entry.split("/")[0] ?? ""),
  );

describe("a schema the barrel re-exports is imported from the barrel", () => {
  test("the installed barrel re-exports Tool", async () => {
    expect(await reexported()).toContain("@opencode/schema/tool");
  });

  test("no file imports a re-exported schema module directly", async () => {
    const modules = new Set(await reexported());
    const offenders: Array<string> = [];
    for (const file of await sourceFiles()) {
      const text = await Bun.file(join(ROOT, file)).text();
      for (const [, module] of text.matchAll(/from\s+"(@opencode\/schema\/[\w-]+)"/g))
        if (module !== undefined && modules.has(module)) offenders.push(`${file}: ${module}`);
    }
    expect(offenders.toSorted()).toEqual([]);
  });
});
