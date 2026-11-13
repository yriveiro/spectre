import { afterEach, describe, expect, test } from "bun:test";
import type { Schema } from "effect";
import { Effect } from "effect";
import { report } from "../../tools/definitions/search";
import { memories } from "../../tools/definitions/search/state";
import {
  afterEvent,
  captureAfter,
  cleanupDirs,
  makeBin,
  PROJECT,
  READY_BIN,
  readingContext,
  toolContext,
  withBinary,
} from "./host";

/**
 * The report names the session and the verb it skipped, from the durable record
 * alone. It reads one project's key, so another project's sessions are invisible.
 */

const DELTA = "ripwire . --quality-delta";
const LOOKUP = "ripwire . --for=<task>";
const FANOUT = "ripwire . --pack-task=<task> --partition=<n>";

const call = (values: Map<string, Schema.Json>, project: string = PROJECT) =>
  Effect.runPromise(report(readingContext(project, values)).execute({}, toolContext("ses_report_reader")));

const read = async (values: Map<string, Schema.Json>, project: string = PROJECT) => {
  const result = await call(values, project);
  if (result.output === undefined) throw new Error("the report returned no output");
  return result;
};

const edit = (after: Awaited<ReturnType<typeof captureAfter>>, session: string, index: number) =>
  Effect.runPromise(
    after.callback(afterEvent("edit", { path: `src/file_${index}.ts` }, session, `call_report_edit_${index}`)),
  );

afterEach(cleanupDirs);

describe("the report tool is one project's read", () => {
  test("it is a code-mode tool in the spectre namespace", () => {
    const tool = report(readingContext(PROJECT));
    expect(tool.name).toBe("ripwire_report");
    expect(tool.options).toEqual({ namespace: "spectre", codemode: true });
  });

  test("an empty record reports no session and no finding", async () => {
    const result = await read(new Map());
    expect(result.output?.sessions).toBe(0);
    expect(result.output?.findings).toEqual([]);
    expect(result.output?.summary).toContain("has been recorded yet");
  });

  test("a second project's sessions are invisible", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter("prj_report_a");
      await edit(after, "ses_report_scoped", 0);

      const own = await read(after.values, "prj_report_a");
      expect(own.output?.sessions).toBe(1);

      const other = await read(after.values, "prj_report_b");
      expect(other.output?.sessions).toBe(0);
      expect(other.output?.findings).toEqual([]);
      memories.delete(own.output?.findings[0]?.session as never);
    });
  });
});

describe("the report names the edits that skipped the delta", () => {
  test("a session with 148 edits and no delta is named", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_148";
      for (let index = 0; index < 148; index += 1) await edit(after, name, index);

      const result = await read(after.values);
      expect(result.output?.findings).toEqual([{ session: name, count: 148, missing: DELTA }]);
      expect(result.output?.summary).toContain(name);
      expect(result.output?.summary).toContain("148");
      expect(result.content).toBe(result.output?.summary);
      memories.delete(name as never);
    });
  });

  test("a delta after the last edit clears the finding", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_measured";
      await edit(after, name, 0);
      await edit(after, name, 1);
      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_report_delta", {
            output: "clean",
          }),
        ),
      );

      expect((await read(after.values)).output?.findings).toEqual([]);
      memories.delete(name as never);
    });
  });

  test("a delta older than the last edit still names the session", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_stale_delta";
      await edit(after, name, 0);
      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: "ripwire . --quality-delta" }, name, "call_report_stale", {
            output: "clean",
          }),
        ),
      );
      await edit(after, name, 1);

      expect((await read(after.values)).output?.findings).toEqual([{ session: name, count: 2, missing: DELTA }]);
      memories.delete(name as never);
    });
  });
});

describe("the report names the reads and the spawns with no verb", () => {
  test("a session with code reads and no lookup is named, and a search clears it", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_reads";
      await Effect.runPromise(after.callback(afterEvent("read", { path: "/tmp/src/a.ts" }, name, "call_report_r1")));
      await Effect.runPromise(after.callback(afterEvent("read", { path: "/tmp/src/b.ts" }, name, "call_report_r2")));

      expect((await read(after.values)).output?.findings).toEqual([{ session: name, count: 2, missing: LOOKUP }]);

      await Effect.runPromise(
        after.callback(
          afterEvent("spectre_search", { query: "retry" }, name, "call_report_search", {
            status: "answered",
          }),
        ),
      );

      expect((await read(after.values)).output?.findings).toEqual([]);
      memories.delete(name as never);
    });
  });

  test("a session with a spawn and no fan-out is named, and a pack-task clears it", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const name = "ses_report_fanout";
      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "x" }, name, "call_report_spawn", {
            sessionID: "ses_report_child",
            status: "completed",
            output: "done",
          }),
        ),
      );

      expect((await read(after.values)).output?.findings).toEqual([{ session: name, count: 1, missing: FANOUT }]);

      await Effect.runPromise(
        after.callback(
          afterEvent("shell", { command: 'ripwire . --pack-task="map" --partition=2' }, name, "call_report_pack", {
            output: "core",
          }),
        ),
      );

      expect((await read(after.values)).output?.findings).toEqual([]);
      memories.delete(name as never);
    });
  });

  test("a child's own edits name its parent", async () => {
    const bin = await makeBin(READY_BIN);
    await withBinary(bin, async () => {
      const after = await captureAfter();
      const parent = "ses_report_parent";
      const child = "ses_report_child_edits";
      await Effect.runPromise(
        after.callback(
          afterEvent("subagent", { agent: "explore", prompt: "x" }, parent, "call_report_birth", {
            sessionID: child,
            status: "completed",
            output: "done",
          }),
        ),
      );
      await edit(after, child, 0);

      const findings = (await read(after.values)).output?.findings ?? [];
      expect(findings).toContainEqual({ session: child, parent, count: 1, missing: DELTA });
      memories.delete(parent as never);
      memories.delete(child as never);
    });
  });
});
