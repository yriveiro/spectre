import { describe, expect, test } from "bun:test";
import { probe } from "../../tools/definitions/search/probe";
import { run, scope } from "../../tools/definitions/search/run";

/**
 * The probe and the runner against a fake binary, never the real ripwire.
 * Each test writes its own executable script to its own temp directory and
 * hands it over through `SPECTRE_RIPWIRE`, which wins over PATH — so the
 * installed ripwire never leaks into an assertion, and the probe's per-path
 * cache never collides between tests.
 */

const makeBin = async (body: string): Promise<{ dir: string; bin: string }> => {
  const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
  const bin = `${dir}/ripwire`;
  await Bun.write(bin, body);
  const proc = Bun.spawn(["chmod", "+x", bin]);
  await proc.exited;
  return { dir, bin };
};

const withBinary = async (bin: string, fn: () => Promise<void>): Promise<void> => {
  const prev = process.env.SPECTRE_RIPWIRE;
  try {
    process.env.SPECTRE_RIPWIRE = bin;
    await fn();
  } finally {
    if (prev === undefined) delete process.env.SPECTRE_RIPWIRE;
    else process.env.SPECTRE_RIPWIRE = prev;
  }
};

describe("scope keeps a path inside the root", () => {
  test("a relative src stays", async () => {
    const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
    expect(scope(dir, "src")).toBe(`${dir}/src`);
  });

  test("../outside escapes", async () => {
    const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
    expect(scope(dir, "../outside")).toBeUndefined();
  });

  test("an absolute path outside the root escapes", async () => {
    const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
    expect(scope(dir, "/etc/passwd")).toBeUndefined();
  });

  test("no path needs no scope", async () => {
    const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
    expect(scope(dir)).toBeUndefined();
  });
});

describe("a success script answers with its XML", () => {
  test("answered carries the output and the command names the binary", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
printf '%s' '<grep pattern="hello" hits="1"><f p="a.ts"><hit l="1" in="hello"><![CDATA[function hello() { return 1; }]]></hit></f></grep>'
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--grep=hello"]);
      expect(result.status).toBe("answered");
      expect(result.answer).toContain('<hit l="1"');
      expect(result.command).toContain(bin);
      expect(result.command).toContain("--grep=hello");
      expect(result.note).toBeUndefined();
    });
  });
});

describe("an empty script is an empty answer, not a proof of absence", () => {
  test("empty carries the re-issue note", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--grep=nothing"]);
      expect(result.status).toBe("empty");
      expect(result.note).toBe(
        "No hits in the indexed tree. That is not proof of absence. Re-issue the text search with a path or include for raw text.",
      );
    });
  });
});

describe("a failing script is refused with its stderr", () => {
  test("exit 2 carries the stderr in the note", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
echo "ripwire: invalid regex: unclosed group" >&2
exit 2
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--regex=("]);
      expect(result.status).toBe("refused");
      expect(result.note).toContain("invalid regex");
    });
  });
});

describe("a missing binary is absent, never a spawn crash", () => {
  test("probe and run agree when SPECTRE_RIPWIRE names nothing", async () => {
    const dir = Bun.spawnSync(["mktemp", "-d"]).stdout.toString().trim();
    await withBinary(`${dir}/missing`, async () => {
      const health = await probe();
      expect(health.kind).toBe("absent");
      const result = await run(dir, [dir, "--grep=hello"]);
      expect(result.status).toBe("absent");
    });
  });
});

describe("probe reads the version the binary prints", () => {
  test("0.6.10 is ready with its version", async () => {
    const { bin } = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.10 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=ac869640e)"
  exit 0
fi
echo "unexpected: $@" >&2
exit 1
`);
    await withBinary(bin, async () => {
      const health = await probe();
      expect(health).toEqual({ kind: "ready", binary: bin, version: "0.6.10" });
    });
  });

  test("0.6.8 is stale with its version", async () => {
    const { bin } = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.6.8 (Release, AppleClang 21.0.0.21000101, emit=std::print, built_from=stale)"
  exit 0
fi
echo "unexpected: $@" >&2
exit 1
`);
    await withBinary(bin, async () => {
      const health = await probe();
      expect(health).toEqual({ kind: "stale", binary: bin, version: "0.6.8" });
    });
  });
});

describe("output past the budget is truncated, not dropped", () => {
  test("33,001 characters come back as 32,000 with a note", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
head -c 33001 < /dev/zero | tr '\\0' 'a'
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--grep=a"]);
      expect(result.status).toBe("answered");
      expect(result.answer.length).toBe(32_000);
      expect(result.note).toContain("truncated");
    });
  });
});

describe("truncation counts bytes, not characters", () => {
  test("20,000 two-byte chars exceed 32,000 bytes and truncate to 16,000 chars", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
awk 'BEGIN { for (i = 0; i < 20000; i++) printf "é" }'
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--grep=e"]);
      expect(result.status).toBe("answered");
      // 20,000 UTF-16 units would pass a character count; 40,000 bytes do not.
      expect(new TextEncoder().encode(result.answer).length).toBeLessThanOrEqual(32_000);
      expect(result.answer.length).toBe(16_000);
      expect(result.answer).not.toContain("�");
      expect(result.note).toContain("truncated");
    });
  });

  test("a cut three-byte char backs off instead of splitting", async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
awk 'BEGIN { for (i = 0; i < 10667; i++) printf "€" }'
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--grep=e"]);
      expect(result.status).toBe("answered");
      // 32,001 bytes cut mid-character; the slice keeps 10,666 whole chars.
      expect(new TextEncoder().encode(result.answer).length).toBe(31_998);
      expect(result.answer.length).toBe(10_666);
      expect(result.answer).not.toContain("�");
      expect(result.note).toContain("truncated");
    });
  });
});

describe("an unresolved header is partial, not answered", () => {
  test('unresolved="2" in the header is partial', async () => {
    const { dir, bin } = await makeBin(`#!/bin/sh
printf '%s' '<for task="where" unresolved="2" graph_partial="1"><d n="x" p="a.ts">fn x()</d></for>'
exit 0
`);
    await withBinary(bin, async () => {
      const result = await run(dir, [dir, "--for=where"]);
      expect(result.status).toBe("partial");
      expect(result.answer).toContain('unresolved="2"');
    });
  });
});
