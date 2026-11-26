import { afterEach, describe, expect, test } from "bun:test";
import type { Plugin, Tool } from "@opencode/plugin/effect";
import { Session } from "@opencode/schema/session";
import { Effect, Exit, type Schema } from "effect";
import { attachGuard } from "../../tools/definitions/search/apply";
import { clearLegendSeen, legendSeenFile } from "../../tools/definitions/search/legend";
import { attachMeasure, recordsOf } from "../../tools/definitions/search/measure";
import { probe } from "../../tools/definitions/search/probe";
import { scope } from "../../tools/definitions/search/run";
import { utf8Bytes } from "../../tools/definitions/search/shunt";
import { memories } from "../../tools/definitions/search/state";
import {
  afterEvent,
  cleanupDirs,
  forget,
  locationOf,
  makeBin,
  makeStorage,
  PROJECT,
  READY_BIN,
  tempDir,
  toolEvent,
  withBinary,
} from "./host";

afterEach(cleanupDirs);

interface CaptureOptions {
  readonly project?: string;
  readonly parentID?: Session.ID;
  readonly values?: Map<string, Schema.Json>;
}

const captureHooks = async (directory: string, options: CaptureOptions = {}) => {
  const project = options.project ?? PROJECT;
  const values = options.values ?? new Map<string, Schema.Json>();
  const baseStorage = makeStorage(values);
  let sessionGetCalls = 0;
  let storageSetCalls = 0;
  const storage: Plugin.Context["storage"] = {
    ...baseStorage,
    set: (key, value) =>
      Effect.sync(() => {
        storageSetCalls += 1;
      }).pipe(Effect.andThen(baseStorage.set(key, value))),
  };
  let beforeCb: ((event: unknown) => Effect.Effect<void, Tool.Error>) | undefined;
  let afterCb: ((event: unknown) => Effect.Effect<void>) | undefined;
  const ctx = {
    location: locationOf(project, directory),
    storage,
    permission: { assert: () => Effect.void },
    session: {
      get: () =>
        Effect.sync(() => {
          sessionGetCalls += 1;
          return {
            location: { directory },
            ...(options.parentID === undefined ? {} : { parentID: options.parentID }),
          };
        }),
    },
    tool: {
      hook: (name: string, cb: (event: unknown) => Effect.Effect<void, Tool.Error>) => {
        if (name === "execute.before") beforeCb = cb;
        if (name === "execute.after") afterCb = cb as (event: unknown) => Effect.Effect<void>;
        return Effect.succeed({ dispose: Effect.void });
      },
    },
  } as unknown as Plugin.Context;
  await Effect.runPromise(Effect.scoped(attachGuard(ctx)));
  await Effect.runPromise(Effect.scoped(attachMeasure(ctx)));
  if (beforeCb === undefined || afterCb === undefined) {
    throw new Error("hooks did not register");
  }
  return {
    before: beforeCb,
    after: afterCb,
    values,
    storage,
    project,
    counts: () => ({ sessionGetCalls, storageSetCalls }),
  };
};

interface ReadAfterEvent {
  readonly result: {
    output?: unknown;
    content?: unknown;
    metadata?: Record<string, unknown>;
  };
}

const largeJson = (entries = 400): string => {
  const obj: Record<string, unknown> = {};
  for (let i = 0; i < entries; i += 1) {
    obj[`key_${i}`] = { index: i, label: `item-${i}`, enabled: i % 2 === 0 };
  }
  return JSON.stringify(obj, null, 2);
};

const largeTypeScript = (): string => {
  const blocks: Array<string> = [
    "export interface RecordEntry { readonly id: number; readonly label: string; readonly weight: number }",
  ];
  for (let i = 0; i < 65; i += 1) {
    blocks.push(
      [
        `export function computeBucket${i}(entry: RecordEntry, scale: number): number {`,
        `  const base = entry.id * ${i + 1} + entry.weight * scale;`,
        `  const tag = entry.label.length + ${i};`,
        `  if (base <= 0) return tag;`,
        `  const adjusted = base + tag * 2;`,
        `  return adjusted - (adjusted % 7);`,
        "}",
      ].join("\n"),
    );
  }
  return `${blocks.join("\n\n")}\n`;
};

const largeLog = (): string => {
  const lines: Array<string> = [];
  for (let i = 1; i <= 420; i += 1) {
    lines.push(
      i === 150
        ? `2026-11-26T00:00:00Z ERROR failed at step ${i}`
        : `2026-11-26T00:00:00Z INFO tick ${i}`,
    );
  }
  return `${lines.join("\n")}\n`;
};

const largeMarkdown = (): string => {
  const sections: Array<string> = [];
  for (let i = 1; i <= 30; i += 1) {
    sections.push(`## Section ${i}`);
    for (let j = 1; j <= 15; j += 1) {
      sections.push(`Paragraph line ${i}.${j} with enough text to keep the section substantial.`);
    }
  }
  return `${sections.join("\n")}\n`;
};

describe("shunt hook integration", () => {
  test("cold large .json, .log, and .md reads are summarized and recorded in storage", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_cold";

    const jsonText = largeJson();
    const logText = largeLog();
    const mdText = largeMarkdown();
    await Bun.write(`${dir}/data.json`, jsonText);
    await Bun.write(`${dir}/app.log`, logText);
    await Bun.write(`${dir}/guide.md`, mdText);

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const jsonEv = afterEvent("read", { path: "data.json" }, session, "call_json", {
        type: "text",
        content: jsonText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(jsonEv));
      expect(typeof jsonEv.result.content).toBe("string");
      expect(String(jsonEv.result.content)).toContain("[spectre:read-summary]");
      expect((jsonEv.result.output as { content: string }).content).toBe(
        String(jsonEv.result.content),
      );
      expect(utf8Bytes(String(jsonEv.result.content))).toBeLessThan(utf8Bytes(jsonText));

      const logEv = afterEvent("read", { path: "app.log" }, session, "call_log", {
        type: "text",
        content: logText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(logEv));
      expect(String(logEv.result.content)).toContain("[spectre:read-summary]");
      expect((logEv.result.output as { content: string }).content).toBe(
        String(logEv.result.content),
      );
      expect(utf8Bytes(String(logEv.result.content))).toBeLessThan(utf8Bytes(logText));

      const mdEv = afterEvent("read", { path: "guide.md" }, session, "call_md", {
        type: "text",
        content: mdText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(mdEv));
      expect(String(mdEv.result.content)).toContain("[spectre:read-summary]");
      expect((mdEv.result.output as { content: string }).content).toBe(
        String(mdEv.result.content),
      );
      expect(utf8Bytes(String(mdEv.result.content))).toBeLessThan(utf8Bytes(mdText));
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = records.find((one) => one.session === session);
    expect(row?.shunt?.summarized).toBe(3);
    expect(row?.shunt?.escalations).toBe(0);
    expect(row?.shunt?.bytesServed).toBeLessThan(row?.shunt?.bytesRaw ?? 0);

    forget(session);
  });

  test("sliced read passes through verbatim", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_sliced";
    const logText = largeLog();

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const ev = afterEvent(
        "read",
        { path: "app.log", offset: 10, limit: 20 },
        session,
        "call_sliced",
        { type: "text", content: logText },
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(ev));
      expect(ev.result.content).toBeUndefined();
      expect((ev.result.output as { content: string }).content).toBe(logText);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(records.find((one) => one.session === session)?.shunt).toBeUndefined();
    forget(session);
  });

  test("control-plane files pass through verbatim", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_control";
    const bigText = largeMarkdown();

    await withBinary(`${dir}/missing-ripwire`, async () => {
      for (const path of [
        "AGENTS.md",
        "SKILL.md",
        "skill://foo/SKILL.md",
        ".spectre/run.md",
        ".opencode/settings.json",
      ]) {
        const ev = afterEvent("read", { path }, session, `call_cp_${path}`, {
          type: "text",
          content: bigText,
        }) as ReadAfterEvent;
        await Effect.runPromise(hooks.after(ev));
        expect(ev.result.content).toBeUndefined();
        expect((ev.result.output as { content: string }).content).toBe(bigText);
      }
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(records.find((one) => one.session === session)?.shunt).toBeUndefined();
    forget(session);
  });

  test("small file below thresholds passes through verbatim", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_small";
    const smallText = "line 1\nline 2\nline 3\n";

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const ev = afterEvent("read", { path: "small.log" }, session, "call_small", {
        type: "text",
        content: smallText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(ev));
      expect(ev.result.content).toBeUndefined();
      expect((ev.result.output as { content: string }).content).toBe(smallText);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(records.find((one) => one.session === session)?.shunt).toBeUndefined();
    forget(session);
  });

  test("media and directory outputs pass through verbatim", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_media_dir";

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const mediaOut = { type: "media", encoding: "base64", data: "abc" };
      const mediaEv = afterEvent(
        "read",
        { path: "image.png" },
        session,
        "call_media",
        mediaOut,
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(mediaEv));
      expect(mediaEv.result.output).toEqual(mediaOut);
      expect(mediaEv.result.content).toBeUndefined();

      const dirOut = { type: "directory", entries: ["a.ts", "b.ts"] };
      const dirEv = afterEvent(
        "read",
        { path: "src" },
        session,
        "call_dir",
        dirOut,
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(dirEv));
      expect(dirEv.result.output).toEqual(dirOut);
      expect(dirEv.result.content).toBeUndefined();
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(records.find((one) => one.session === session)?.shunt).toBeUndefined();
    forget(session);
  });

  test("repeat unsliced read on summarized file returns verbatim and increments escalations without double-counting bytesRaw", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_repeat";
    const logText = largeLog();
    const rawBytes = utf8Bytes(logText);
    let summaryBytes = 0;

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const first = afterEvent("read", { path: "app.log" }, session, "call_rep_1", {
        type: "text",
        content: logText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(first));
      expect(String(first.result.content)).toContain("[spectre:read-summary]");
      summaryBytes = utf8Bytes(String(first.result.content));

      const second = afterEvent("read", { path: "app.log" }, session, "call_rep_2", {
        type: "text",
        content: logText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(second));
      expect(second.result.content).toBeUndefined();
      expect((second.result.output as { content: string }).content).toBe(logText);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = records.find((one) => one.session === session);
    expect(row?.shunt?.summarized).toBe(1);
    expect(row?.shunt?.escalations).toBe(1);
    expect(row?.shunt?.bytesRaw).toBe(rawBytes);
    expect(row?.shunt?.bytesServed).toBe(summaryBytes + rawBytes);
    forget(session);
  });

  test("edit completion on summarized file marks edited so next read is verbatim with zero escalations", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_edit";
    const logText = largeLog();

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const first = afterEvent("read", { path: "app.log" }, session, "call_ed_1", {
        type: "text",
        content: logText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(first));
      expect(String(first.result.content)).toContain("[spectre:read-summary]");

      await Effect.runPromise(
        hooks.after(afterEvent("edit", { path: "app.log" }, session, "call_ed_2", "ok")),
      );

      const third = afterEvent("read", { path: "app.log" }, session, "call_ed_3", {
        type: "text",
        content: logText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(third));
      expect(third.result.content).toBeUndefined();
      expect((third.result.output as { content: string }).content).toBe(logText);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = records.find((one) => one.session === session);
    expect(row?.shunt?.summarized).toBe(1);
    expect(row?.shunt?.escalations).toBe(0);
    forget(session);
  });

  test("bare shell read on large file refuses once, piped passes, small passes", async () => {
    const dir = tempDir();
    const bin = await makeBin(READY_BIN);
    await Bun.write(`${dir}/large.log`, largeLog());
    await Bun.write(`${dir}/small.log`, "ok\n");

    await withBinary(bin, async () => {
      const hooks = await captureHooks(dir);
      const session = "ses_shunt_shell";

      const firstBare = await Effect.runPromiseExit(
        hooks.before(toolEvent("shell", { command: "cat large.log" }, session, "call_sh_1")),
      );
      expect(Exit.isFailure(firstBare)).toBe(true);
      if (Exit.isFailure(firstBare)) {
        expect(String(firstBare.cause)).toContain("large.log");
      }

      const secondBare = await Effect.runPromiseExit(
        hooks.before(toolEvent("shell", { command: "cat large.log" }, session, "call_sh_2")),
      );
      expect(Exit.isSuccess(secondBare)).toBe(true);

      const piped = await Effect.runPromiseExit(
        hooks.before(
          toolEvent("shell", { command: "cat large.log | grep ERR" }, session, "call_sh_3"),
        ),
      );
      expect(Exit.isSuccess(piped)).toBe(true);

      const small = await Effect.runPromiseExit(
        hooks.before(toolEvent("shell", { command: "cat small.log" }, session, "call_sh_4")),
      );
      expect(Exit.isSuccess(small)).toBe(true);

      expect(memories.get(Session.ID.make(session))?.shellReadRefused?.size).toBe(1);
      forget(session);
    });
  });

  test("v2.4.2 truncated ReadTool payload reads full >50KB JSON from disk, strips output.next and metadata.truncated, and fails open above 2MB", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_v242";

    const fullJson = largeJson(900);
    expect(utf8Bytes(fullJson)).toBeGreaterThan(64 * 1024);
    const truncated = fullJson.slice(0, 50 * 1024);
    expect(() => JSON.parse(truncated)).toThrow();
    await Bun.write(`${dir}/huge.json`, fullJson);

    const oversizedPayload = `{"blob":"${"x".repeat(2 * 1024 * 1024 + 4096)}"}`;
    const oversizedPrefix = oversizedPayload.slice(0, 50 * 1024);
    await Bun.write(`${dir}/oversized.json`, oversizedPayload);

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const ev = afterEvent(
        "read",
        { path: "huge.json" },
        session,
        "call_v242_json",
        { type: "text", offset: 1, next: 2001, content: truncated },
        "spectre",
        {
          content: [{ type: "text", text: truncated }],
          metadata: { truncated: true, preserved: "yes" },
        },
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(ev));

      expect(typeof ev.result.content).toBe("string");
      expect(String(ev.result.content)).toContain("[spectre:read-summary] huge.json");
      expect(String(ev.result.content)).toContain("kind=structured");
      const out = ev.result.output as Record<string, unknown>;
      expect(out.content).toBe(ev.result.content);
      expect("next" in out).toBe(false);
      expect("truncated" in (ev.result.metadata ?? {})).toBe(false);
      expect(ev.result.metadata?.preserved).toBe("yes");
      expect(utf8Bytes(String(ev.result.content))).toBeLessThan(utf8Bytes(truncated));

      const overEv = afterEvent(
        "read",
        { path: "oversized.json" },
        session,
        "call_v242_over",
        { type: "text", offset: 1, next: 2001, content: oversizedPrefix },
        "spectre",
        {
          content: [{ type: "text", text: oversizedPrefix }],
          metadata: { truncated: true },
        },
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(overEv));
      expect(Array.isArray(overEv.result.content)).toBe(true);
      expect((overEv.result.output as Record<string, unknown>).next).toBe(2001);
      expect(overEv.result.metadata?.truncated).toBe(true);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = records.find((one) => one.session === session);
    expect(row?.shunt?.summarized).toBe(1);
    expect(row?.shunt?.bytesRaw).toBe(utf8Bytes(truncated));
    forget(session);
  });

  test("codemode read passes through verbatim without mutating result or recording shunt state", async () => {
    const dir = tempDir();
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_codemode";
    const jsonText = largeJson();
    await Bun.write(`${dir}/data.json`, jsonText);

    await withBinary(`${dir}/missing-ripwire`, async () => {
      const ev = afterEvent(
        "read",
        { path: "data.json" },
        session,
        "call_cm_1",
        { type: "text", offset: 1, content: jsonText },
        "spectre",
        { codemode: true, content: [{ type: "text", text: jsonText }] },
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(ev));
      expect(Array.isArray(ev.result.content)).toBe(true);
      expect((ev.result.output as { content: string }).content).toBe(jsonText);
    });

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(records.find((one) => one.session === session)).toBeUndefined();
    expect(memories.get(Session.ID.make(session))?.shunted?.size ?? 0).toBe(0);
    forget(session);
  });

  test("parallel reads preserve both shunted entries and never clobber a concurrent edit", async () => {
    const dir = tempDir();
    const slowBin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.7.0 (Release, built_from=test)"
  exit 0
fi
sleep 0.06
echo "<pack><sig>export function stub(): void</sig></pack>"
exit 0
`);
    const hooks = await captureHooks(dir);
    const session = "ses_shunt_parallel";
    const sid = Session.ID.make(session);
    const jsonA = largeJson();
    const jsonB = largeJson();
    const tsCode = largeTypeScript();
    await Bun.write(`${dir}/a.json`, jsonA);
    await Bun.write(`${dir}/b.json`, jsonB);
    await Bun.write(`${dir}/race.ts`, tsCode);

    await withBinary(slowBin, async () => {
      const evA = afterEvent("read", { path: "a.json" }, session, "call_par_a", {
        type: "text",
        content: jsonA,
      }) as ReadAfterEvent;
      const evB = afterEvent("read", { path: "b.json" }, session, "call_par_b", {
        type: "text",
        content: jsonB,
      }) as ReadAfterEvent;
      await Promise.all([Effect.runPromise(hooks.after(evA)), Effect.runPromise(hooks.after(evB))]);

      const resolvedA = scope(dir, "a.json");
      const resolvedB = scope(dir, "b.json");
      expect(resolvedA).toBeDefined();
      expect(resolvedB).toBeDefined();
      expect(memories.get(sid)?.shunted?.get(resolvedA ?? "")).toEqual({ kind: "summarized" });
      expect(memories.get(sid)?.shunted?.get(resolvedB ?? "")).toEqual({ kind: "summarized" });

      const raceRead = afterEvent("read", { path: "race.ts" }, session, "call_par_race", {
        type: "text",
        content: tsCode,
      }) as ReadAfterEvent;
      const inFlight = Effect.runPromise(hooks.after(raceRead));
      await Bun.sleep(15);
      await Effect.runPromise(
        hooks.after(afterEvent("edit", { path: "race.ts" }, session, "call_par_edit", "ok")),
      );
      await inFlight;

      const resolvedRace = scope(dir, "race.ts");
      expect(resolvedRace).toBeDefined();
      expect(memories.get(sid)?.shunted?.get(resolvedRace ?? "")).toEqual({ kind: "edited" });
      expect(raceRead.result.content).toBeUndefined();
      expect((raceRead.result.output as { content: string }).content).toBe(tsCode);
    });

    forget(session);
  });

  test("child subagents and operator shunt reads without counting UsageRecord.reads; sicko and nocturna are excluded", async () => {
    const dir = tempDir();
    const jsonText = largeJson();
    const logText = largeLog();
    await Bun.write(`${dir}/data.json`, jsonText);
    await Bun.write(`${dir}/large.log`, logText);
    const bin = await makeBin(READY_BIN);

    await withBinary(bin, async () => {
      const childHooks = await captureHooks(dir, { parentID: Session.ID.make("ses_parent") });
      const childSession = "ses_shunt_child";
      const childEv = afterEvent("read", { path: "data.json" }, childSession, "call_child_1", {
        type: "text",
        content: jsonText,
      }) as ReadAfterEvent;
      await Effect.runPromise(childHooks.after(childEv));

      expect(String(childEv.result.content)).toContain("[spectre:read-summary]");
      expect(childHooks.counts().sessionGetCalls).toBe(1);
      expect(childHooks.counts().storageSetCalls).toBe(1);
      const childRow = (
        await Effect.runPromise(recordsOf(childHooks.storage, childHooks.project))
      ).find((one) => one.session === childSession);
      expect(childRow?.shunt?.summarized).toBe(1);
      expect(childRow?.reads).toBe(0);
      forget(childSession);

      const hooks = await captureHooks(dir);
      const opSession = "ses_shunt_operator";
      const opEv = afterEvent(
        "read",
        { path: "data.json" },
        opSession,
        "call_op_1",
        { type: "text", content: jsonText },
        "operator",
      ) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(opEv));
      expect(String(opEv.result.content)).toContain("[spectre:read-summary]");
      const opRow = (await Effect.runPromise(recordsOf(hooks.storage, hooks.project))).find(
        (one) => one.session === opSession,
      );
      expect(opRow?.shunt?.summarized).toBe(1);
      expect(opRow?.reads).toBe(0);
      forget(opSession);

      for (const agent of ["sicko", "nocturna"] as const) {
        const excludedSession = `ses_shunt_${agent}`;
        const readEv = afterEvent(
          "read",
          { path: "data.json" },
          excludedSession,
          `call_${agent}_read`,
          { type: "text", content: jsonText },
          agent,
        ) as ReadAfterEvent;
        await Effect.runPromise(hooks.after(readEv));
        expect(readEv.result.content).toBeUndefined();
        expect((readEv.result.output as { content: string }).content).toBe(jsonText);

        const shellExit = await Effect.runPromiseExit(
          hooks.before(
            toolEvent("shell", { command: "cat large.log" }, excludedSession, `call_${agent}_sh`, agent),
          ),
        );
        expect(Exit.isSuccess(shellExit)).toBe(true);
        forget(excludedSession);
      }

      const allRows = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
      expect(allRows.some((one) => one.session === "ses_shunt_sicko")).toBe(false);
      expect(allRows.some((one) => one.session === "ses_shunt_nocturna")).toBe(false);
    });
  });

  test("guardShellRead handles workdir, bounded head slices, and env cat wrapper", async () => {
    const dir = tempDir();
    const bin = await makeBin(READY_BIN);
    await Bun.write(`${dir}/large.log`, largeLog());
    await Bun.write(`${dir}/sub/nested.log`, largeLog());

    await withBinary(bin, async () => {
      const hooks = await captureHooks(dir);
      const session = "ses_shunt_workdir";

      const workdirRefuse = await Effect.runPromiseExit(
        hooks.before(
          toolEvent(
            "shell",
            { command: "cat nested.log", workdir: "sub" },
            session,
            "call_wd_1",
          ),
        ),
      );
      expect(Exit.isFailure(workdirRefuse)).toBe(true);

      const workdirSecond = await Effect.runPromiseExit(
        hooks.before(
          toolEvent(
            "shell",
            { command: "cat nested.log", workdir: "sub" },
            session,
            "call_wd_2",
          ),
        ),
      );
      expect(Exit.isSuccess(workdirSecond)).toBe(true);

      const outsideWorkdir = await Effect.runPromiseExit(
        hooks.before(
          toolEvent(
            "shell",
            { command: "cat nested.log", workdir: "/elsewhere" },
            session,
            "call_wd_out",
          ),
        ),
      );
      expect(Exit.isSuccess(outsideWorkdir)).toBe(true);

      const head20 = await Effect.runPromiseExit(
        hooks.before(toolEvent("shell", { command: "head -n 20 large.log" }, session, "call_h20")),
      );
      expect(Exit.isSuccess(head20)).toBe(true);

      const head250 = await Effect.runPromiseExit(
        hooks.before(
          toolEvent("shell", { command: "head -n 250 large.log" }, session, "call_h250"),
        ),
      );
      expect(Exit.isSuccess(head250)).toBe(true);

      const envCat = await Effect.runPromiseExit(
        hooks.before(toolEvent("shell", { command: "env cat large.log" }, session, "call_env")),
      );
      expect(Exit.isFailure(envCat)).toBe(true);

      forget(session);
    });
  });

  test("real ripwire shunts a .ts code file through execute.after, records legendSeen, and writes storage once", async () => {
    const health = await probe();
    if (health.kind !== "ready") return;

    const dir = tempDir();
    const tsCode = largeTypeScript();
    await Bun.write(`${dir}/src/buckets.ts`, tsCode);

    const hooks = await captureHooks(dir);
    const session = "ses_shunt_real_ripwire";
    clearLegendSeen(session);

    const ev = afterEvent("read", { path: "src/buckets.ts" }, session, "call_real_ts", {
      type: "text",
      offset: 1,
      content: tsCode,
    }) as ReadAfterEvent;
    await Effect.runPromise(hooks.after(ev));

    expect(typeof ev.result.content).toBe("string");
    expect(String(ev.result.content)).toContain("[spectre:read-summary] src/buckets.ts");
    expect(String(ev.result.content)).toContain("kind=code");
    expect(utf8Bytes(String(ev.result.content))).toBeLessThan(utf8Bytes(tsCode));
    expect(hooks.counts().sessionGetCalls).toBe(1);
    expect(hooks.counts().storageSetCalls).toBe(1);

    const records = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = records.find((one) => one.session === session);
    expect(row?.reads).toBe(1);
    expect(row?.shunt?.summarized).toBe(1);
    expect(row?.shunt?.bytesServed).toBeLessThan(row?.shunt?.bytesRaw ?? 0);
    expect(legendSeenFile(session)).toBeDefined();

    clearLegendSeen(session);
    forget(session);
  });

  test("legacy UsageRecord without shunt decodes cleanly and merges later shunt telemetry", async () => {
    const dir = tempDir();
    const session = "ses_shunt_legacy";
    const legacy = JSON.stringify({
      records: [
        {
          session,
          project: PROJECT,
          lookups: 4,
          reads: 2,
          edits: 1,
          subagents: 0,
          packed: 0,
          measured: { delta: 1 },
          outcome: "answered",
        },
      ],
    });
    const values = new Map<string, Schema.Json>([[`usage:${PROJECT}`, legacy]]);
    const hooks = await captureHooks(dir, { values });

    const before = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    expect(before).toHaveLength(1);
    expect(before[0]?.lookups).toBe(4);
    expect(before[0]?.shunt).toBeUndefined();

    const jsonText = largeJson();
    await Bun.write(`${dir}/data.json`, jsonText);
    await withBinary(`${dir}/missing-ripwire`, async () => {
      const ev = afterEvent("read", { path: "data.json" }, session, "call_legacy_1", {
        type: "text",
        content: jsonText,
      }) as ReadAfterEvent;
      await Effect.runPromise(hooks.after(ev));
      expect(String(ev.result.content)).toContain("[spectre:read-summary]");
    });

    const after = await Effect.runPromise(recordsOf(hooks.storage, hooks.project));
    const row = after.find((one) => one.session === session);
    expect(row?.lookups).toBe(4);
    expect(row?.reads).toBe(2);
    expect(row?.edits).toBe(1);
    expect(row?.shunt?.summarized).toBe(1);
    forget(session);
  });
});
