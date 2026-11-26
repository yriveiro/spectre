import { describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { shellReadRefusal } from "../../tools/definitions/search/contract";
import {
  decideShellRead,
  decideShunt,
  type Health,
  type Memory,
  type ShuntDecisionInput,
  shellParse,
} from "../../tools/definitions/search/policy";
import { scope } from "../../tools/definitions/search/run";
import {
  decodeReadInput,
  inspectReadResult,
  isControlPlanePath,
  shellAsk,
} from "../../tools/definitions/search/signals";
import { memories, memoryOf } from "../../tools/definitions/search/state";

const ROOT = "/project";
const ready: Health = { kind: "ready", binary: "/bin/ripwire", version: "0.7.0" };
const absent: Health = { kind: "absent", why: "no binary" };

const held = (overrides?: Partial<Memory>): Memory => ({
  search: true,
  touched: 0,
  asked: new Map(),
  reads: 0,
  edited: new Set(),
  editedCode: new Set(),
  mutation: 0,
  measured: {},
  spent: new Set(),
  subagents: 0,
  shunted: new Map(),
  shellReadRefused: new Set(),
  ...overrides,
});

const BASE_SHUNT: ShuntDecisionInput = {
  resolvedPath: "/project/src/large.ts",
  insideRoot: true,
  controlPlane: false,
  mediaOrDirectory: false,
  sliced: false,
  lines: 400,
  bytes: 12_000,
  minLines: 350,
  minBytes: 10_240,
};

describe("decodeReadInput", () => {
  test("decodes path with optional offset and limit", () => {
    expect(decodeReadInput({ path: "src/a.ts" })).toEqual({ path: "src/a.ts" });
    expect(decodeReadInput({ path: "src/a.ts", offset: 10, limit: 50 })).toEqual({
      path: "src/a.ts",
      offset: 10,
      limit: 50,
    });
  });

  test("returns undefined for invalid payloads", () => {
    expect(decodeReadInput(null)).toBeUndefined();
    expect(decodeReadInput({})).toBeUndefined();
    expect(decodeReadInput({ path: "src/a.ts", offset: "10" })).toBeUndefined();
  });
});

describe("inspectReadResult", () => {
  test("recognizes OpenCode v2.4.2 directory and media outputs", () => {
    expect(inspectReadResult({ output: { type: "directory" } }).kind).toBe("directory");
    expect(inspectReadResult({ output: { type: "media" } }).kind).toBe("media");
  });

  test("prefers raw output.content over formatted result.content and tracks host truncation", () => {
    const res = inspectReadResult({
      output: { type: "text", content: "héllo\nworld\n", next: 201 },
      content: "Read file x, lines 1-2\n1: héllo\n2: world\n",
    });
    expect(res).toEqual({
      kind: "text",
      rawText: "héllo\nworld\n",
      rawBytes: 13,
      lines: 2,
      truncatedByHost: true,
    });
  });

  test("falls back to Tool.Content[] array when output is absent", () => {
    const res = inspectReadResult({
      content: [
        { type: "text", text: "first line" },
        { type: "file", uri: "data:text/plain;base64,QQ==" },
        { type: "text", text: "second line" },
      ],
    });
    expect(res).toEqual({
      kind: "text",
      rawText: "first line\nsecond line",
      rawBytes: 22,
      lines: 2,
      truncatedByHost: false,
    });
    expect(inspectReadResult({ content: [{ type: "file", uri: "data:image/png;base64,AA==" }] })).toEqual({
      kind: "unknown",
      rawText: "",
      rawBytes: 0,
      lines: 0,
      truncatedByHost: false,
    });
  });

  test("reads output.content when result.content is absent", () => {
    const res = inspectReadResult({ output: { type: "text", content: "a\nb" } });
    expect(res).toEqual({
      kind: "text",
      rawText: "a\nb",
      rawBytes: 3,
      lines: 2,
      truncatedByHost: false,
    });
  });

  test("supports fallback shapes and unknown", () => {
    expect(inspectReadResult({ output: { type: "list-page" } }).kind).toBe("directory");
    expect(inspectReadResult({ output: { encoding: "base64" } }).kind).toBe("media");
    expect(inspectReadResult({ content: "plain\n" })).toEqual({
      kind: "text",
      rawText: "plain\n",
      rawBytes: 6,
      lines: 1,
      truncatedByHost: false,
    });
    expect(inspectReadResult({})).toEqual({
      kind: "unknown",
      rawText: "",
      rawBytes: 0,
      lines: 0,
      truncatedByHost: false,
    });
  });
});

describe("isControlPlanePath", () => {
  test("matches skill://, outside root, and control-plane files and directories", () => {
    expect(isControlPlanePath("skill://opencode", "skill://opencode", ROOT)).toBe(true);
    expect(isControlPlanePath("../outside.ts", "/outside.ts", ROOT)).toBe(true);
    expect(isControlPlanePath("AGENTS.md", "/project/AGENTS.md", ROOT)).toBe(true);
    expect(isControlPlanePath("sub/SKILL.md", "/project/sub/SKILL.md", ROOT)).toBe(true);
    expect(isControlPlanePath("CLAUDE.md", "/project/CLAUDE.md", ROOT)).toBe(true);
    expect(isControlPlanePath("opencode.json", "/project/opencode.json", ROOT)).toBe(true);
    expect(isControlPlanePath("opencode.jsonc", "/project/opencode.jsonc", ROOT)).toBe(true);
    expect(isControlPlanePath(".opencode/foo.ts", "/project/.opencode/foo.ts", ROOT)).toBe(true);
    expect(isControlPlanePath(".spectre/brain/a.md", "/project/.spectre/brain/a.md", ROOT)).toBe(
      true,
    );
    expect(
      isControlPlanePath("pkg/.spectre/plan.md", "/project/pkg/.spectre/plan.md", ROOT),
    ).toBe(true);
  });

  test("matches control-plane paths case-insensitively and treats tilde paths outside root", () => {
    expect(isControlPlanePath("SKILL://foo", "SKILL://foo", ROOT)).toBe(true);
    expect(isControlPlanePath("agents.md", "/project/agents.md", ROOT)).toBe(true);
    expect(isControlPlanePath("sub/skill.md", "/project/sub/skill.md", ROOT)).toBe(true);
    expect(isControlPlanePath(".SPECTRE/run.md", "/project/.SPECTRE/run.md", ROOT)).toBe(true);
    expect(isControlPlanePath(".OPENCODE/settings.json", "/project/.OPENCODE/settings.json", ROOT)).toBe(
      true,
    );
    expect(isControlPlanePath("~/notes/big.log", "~/notes/big.log", ROOT)).toBe(true);
    expect(scope(ROOT, "~/notes/big.log")).toBeUndefined();
    expect(scope(ROOT, "~")).toBeUndefined();
  });

  test("returns false for normal project files", () => {
    expect(isControlPlanePath("src/index.ts", "/project/src/index.ts", ROOT)).toBe(false);
    expect(isControlPlanePath("README.md", "/project/README.md", ROOT)).toBe(false);
  });
});

describe("shellAsk workdir decoding", () => {
  test("decodes optional workdir on shell input", () => {
    expect(shellAsk({ command: "cat src/a.ts", workdir: "/project/packages/a" })).toEqual({
      surface: "shell",
      command: "cat src/a.ts",
      workdir: "/project/packages/a",
      parsed: {
        kind: "read",
        binary: "cat",
        path: "src/a.ts",
        command: "cat src/a.ts",
      },
    });
    expect(shellAsk({ command: "cat src/a.ts", workdir: 123 })).toBeUndefined();
  });
});

describe("shellParse bare read commands", () => {
  test("recognizes unbounded cat, less, more, env-wrapped cat, and large/unbounded head/tail", () => {
    expect(shellParse("cat src/a.ts")).toEqual({
      kind: "read",
      binary: "cat",
      path: "src/a.ts",
      command: "cat src/a.ts",
    });
    expect(shellParse("cat -n src/a.ts")).toEqual({
      kind: "read",
      binary: "cat",
      path: "src/a.ts",
      command: "cat -n src/a.ts",
    });
    expect(shellParse("env cat src/a.ts")).toEqual({
      kind: "read",
      binary: "cat",
      path: "src/a.ts",
      command: "env cat src/a.ts",
    });
    expect(shellParse("LC_ALL=C cat src/a.ts")).toEqual({
      kind: "read",
      binary: "cat",
      path: "src/a.ts",
      command: "LC_ALL=C cat src/a.ts",
    });
    expect(shellParse("head -n 500 src/a.ts")).toEqual({
      kind: "read",
      binary: "head",
      path: "src/a.ts",
      command: "head -n 500 src/a.ts",
      boundedLines: 500,
    });
    expect(shellParse("head -c 20000 src/a.ts")).toEqual({
      kind: "read",
      binary: "head",
      path: "src/a.ts",
      command: "head -c 20000 src/a.ts",
      boundedBytes: 20000,
    });
    expect(shellParse("tail -n +1 src/a.ts")).toEqual({
      kind: "read",
      binary: "tail",
      path: "src/a.ts",
      command: "tail -n +1 src/a.ts",
    });
    expect(shellParse("tail +1 src/a.ts")).toEqual({
      kind: "read",
      binary: "tail",
      path: "src/a.ts",
      command: "tail +1 src/a.ts",
    });
    expect(shellParse("less -N src/a.ts")).toEqual({
      kind: "read",
      binary: "less",
      path: "src/a.ts",
      command: "less -N src/a.ts",
    });
    expect(shellParse("more src/a.ts")).toEqual({
      kind: "read",
      binary: "more",
      path: "src/a.ts",
      command: "more src/a.ts",
    });
  });

  test("treats bare head/tail, small bounded slices, and cross-binary flags as other", () => {
    expect(shellParse("head src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("tail src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("head -n 20 src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("tail -20 src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("tail --lines=50 src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("head -c 500 src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("cat --lines 10 src/a.ts")).toEqual({ kind: "other" });
    expect(shellParse("cat --lines=10 src/a.ts")).toEqual({ kind: "other" });
  });

  test("leaves piped, redirected, multi-file, and stdin reads non-read", () => {
    expect(shellParse("cat f | sort")).toEqual({ kind: "other" });
    expect(shellParse("cat f | grep x").kind).not.toBe("read");
    expect(shellParse("cat f > out.txt")).toEqual({ kind: "other" });
    expect(shellParse("cat a.ts b.ts")).toEqual({ kind: "other" });
    expect(shellParse("cat -")).toEqual({ kind: "other" });
    expect(shellParse("cat")).toEqual({ kind: "other" });
  });
});

describe("decideShunt", () => {
  test("bypasses in priority order", () => {
    expect(decideShunt({ ...BASE_SHUNT, insideRoot: false }, held()).verdict).toEqual({
      kind: "bypass",
      why: "outside-root",
      escalation: false,
    });
    expect(decideShunt({ ...BASE_SHUNT, controlPlane: true }, held()).verdict).toEqual({
      kind: "bypass",
      why: "control-plane",
      escalation: false,
    });
    expect(decideShunt({ ...BASE_SHUNT, mediaOrDirectory: true }, held()).verdict).toEqual({
      kind: "bypass",
      why: "media-or-directory",
      escalation: false,
    });
    expect(decideShunt({ ...BASE_SHUNT, sliced: true }, held()).verdict).toEqual({
      kind: "bypass",
      why: "sliced",
      escalation: false,
    });
    expect(
      decideShunt(
        BASE_SHUNT,
        held({ shunted: new Map([["/project/src/large.ts", { kind: "edited" }]]) }),
      ).verdict,
    ).toEqual({
      kind: "bypass",
      why: "edited",
      escalation: false,
    });
    expect(
      decideShunt(
        BASE_SHUNT,
        held({ shunted: new Map([["/project/src/large.ts", { kind: "verbatim-unlocked" }]]) }),
      ).verdict,
    ).toEqual({
      kind: "bypass",
      why: "verbatim-unlocked",
      escalation: false,
    });
  });

  test("escalates already-summarized to verbatim-unlocked", () => {
    const memory = held({
      shunted: new Map([["/project/src/large.ts", { kind: "summarized" }]]),
    });
    const { verdict, next } = decideShunt(BASE_SHUNT, memory);
    expect(verdict).toEqual({
      kind: "bypass",
      why: "already-summarized",
      escalation: true,
    });
    expect(next.shunted?.get("/project/src/large.ts")).toEqual({ kind: "verbatim-unlocked" });
  });

  test("bypasses below threshold and summarizes when lines or bytes meet threshold", () => {
    expect(
      decideShunt({ ...BASE_SHUNT, lines: 100, bytes: 2000 }, held()).verdict,
    ).toEqual({
      kind: "bypass",
      why: "below-threshold",
      escalation: false,
    });
    expect(
      decideShunt({ ...BASE_SHUNT, lines: 350, bytes: 1000 }, held()).verdict,
    ).toEqual({ kind: "summarize" });
    expect(
      decideShunt({ ...BASE_SHUNT, lines: 10, bytes: 10_240 }, held()).verdict,
    ).toEqual({ kind: "summarize" });
  });
});

describe("decideShellRead and shellReadRefusal", () => {
  test("refuses once per file then lets second call through", () => {
    const first = decideShellRead("/project/src/a.ts", "src/a.ts", held(), ready);
    expect(first.verdict).toEqual({
      kind: "refuse",
      gate: "read",
      message: shellReadRefusal("src/a.ts", true),
    });
    if (first.verdict.kind !== "refuse") throw new Error("expected refuse");
    expect(first.verdict.message).toContain("read({ path:");
    expect(first.verdict.message).toContain("spectre_search");

    const second = decideShellRead("/project/src/a.ts", "src/a.ts", first.next, ready);
    expect(second.verdict).toEqual({ kind: "pass", why: "gate-spent" });
  });

  test("omits spectre_search when health is not ready", () => {
    const msg = shellReadRefusal("src/a.ts", false);
    expect(msg).toContain("read({ path:");
    expect(msg).not.toContain("spectre_search");
    const decision = decideShellRead("/project/src/a.ts", "src/a.ts", held(), absent);
    expect(decision.verdict.kind).toBe("refuse");
  });
});

describe("state fresh initialization", () => {
  test("initializes shunted and shellReadRefused", () => {
    const id = Session.ID.make("ses_shunt_fresh_test");
    const mem = memoryOf(id);
    expect(mem.shunted).toEqual(new Map());
    expect(mem.shellReadRefused).toEqual(new Set());
    memories.delete(id);
  });
});
