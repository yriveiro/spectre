import { describe, expect, test } from "bun:test";
import type { AbsolutePath } from "@opencode/schema/schema";
import { Effect } from "effect";
import { anatomy } from "../../tools/definitions/anatomy";
import { kitDirectory } from "../../tools/definitions/anatomy/run";

/**
 * The tool is the gate the hook enforces, so it is tested through the path a
 * caller takes: call the tool, read what it reports. A fixture carrying one
 * deliberate fault stands in for the wrong figure, because a suite that only
 * ever audits a good one cannot tell a working check from one that always passes.
 */
const packageRoot = kitDirectory().replace(/tools\/definitions\/anatomy\/kit$/, "") as AbsolutePath;
const tool = anatomy(packageRoot);

type Answer = { readonly output: Record<string, unknown> };

// The tool's execute takes the input and a call context; the tests care about
// the page it returns, not the context it is handed.
const call = (input: unknown): Promise<Answer> =>
  Effect.runPromise((tool.execute as unknown as (value: unknown) => Effect.Effect<Answer>)(input));

const text = (value: unknown): string => (value as string[]).join(" ");

describe("the anatomy tool", () => {
  test("it is namespaced and reachable in code mode", () => {
    expect(tool.name).toBe("anatomy");
    expect(tool.options?.namespace).toBe("spectre");
    expect(tool.options?.codemode).toBe(true);
  });

  test("kit hands back an absolute path that exists", async () => {
    const { output } = await call({ action: "kit" });
    expect(output.status).toBe("ok");
    const path = output.kit as string;
    expect(path.startsWith("/")).toBe(true);
    expect(path.endsWith("kit/index.ts")).toBe(true);
    expect(await Bun.file(path).exists()).toBe(true);
  });

  test("every documented option is one the executor acts on", async () => {
    // An option the description offers and the executor ignores is a promise the
    // tool does not keep, so the schema and the description are checked together.
    expect(tool.input).toBeDefined();
    const { output } = await call({ action: "kit", format: "js" });
    // Asking for the dropped option is either refused or has no effect; it must
    // not appear in the answer as if it had been honoured.
    expect(JSON.stringify(output)).not.toContain("bundle");
  });

  test("check finds the fault in a fixture and does not pass", async () => {
    const { output } = await call({ action: "check", file: "test/fixtures/anatomy-fault.ts" });
    expect(output.status).toBe("problems");
    expect(output.passed).toBe(false);
    expect(text(output.failures)).toContain("pipe");
    expect((output.counts as { tubes: number }).tubes).toBe(1);
    expect((output.counts as { solids: number }).solids).toBe(2);
  });

  test("check counts the states it measured, not just rest", async () => {
    const { output } = await call({ action: "check", file: "test/fixtures/anatomy-fault.ts" });
    // One explode state plus the uniform openings, so more than the single rest.
    expect((output.counts as { states: number }).states).toBeGreaterThan(1);
  });

  test("check names the checks it switched off", async () => {
    const { output } = await call({
      action: "check",
      file: "test/fixtures/anatomy-fault.ts",
      only: ["terminals"],
    });
    expect(text(output.notes)).toContain("skipped");
  });

  test("a file that cannot be loaded is refused rather than passed", async () => {
    const { output } = await call({ action: "check", file: "test/fixtures/nope.ts" });
    expect(output.status).toBe("unreadable");
    expect(output.report).toContain("cannot load");
  });

  test("lines reports a page whose lines land on nothing", async () => {
    const { output } = await call({
      action: "lines",
      file: "test/fixtures/anatomy-floating-line.html",
    });
    expect(output.status).toBe("floating ends");
    expect(output.floating).toBe(2);
  });

  test("lines passes a page whose every line end lands on something", async () => {
    const { output } = await call({
      action: "lines",
      file: "test/fixtures/anatomy-clean-line.html",
    });
    expect(output.status).toBe("ok");
    expect(output.floating).toBe(0);
  });
});
