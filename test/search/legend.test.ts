import { afterEach, describe, expect, test } from "bun:test";
import { Session } from "@opencode/schema/session";
import { Effect } from "effect";
import { search } from "../../tools/definitions/search";
import {
  clearLegendSeen,
  legendSeenFile,
  recordLegendSeen,
} from "../../tools/definitions/search/legend";
import { memories } from "../../tools/definitions/search/state";
import {
  captureAfter,
  cleanupDirs,
  makeBin,
  PROJECT,
  readingContext,
  tempDir,
  toolContext,
  withBinary,
} from "./host";

afterEach(() => {
  clearLegendSeen();
  return cleanupDirs();
});

describe("legend-seen session tracking", () => {
  test("records 16-hex hashes via --legend-dict=seen, deduplicates, and clears cleanly", async () => {
    const dir = tempDir();
    const prevTmp = Bun.env.TMPDIR;
    Bun.env.TMPDIR = dir;
    try {
      const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--legend-dict=seen" ]; then
  body=$(cat)
  case "$body" in
    *"first"*)
      printf '0123456789abcdef\nnot-a-hash\nfedcba9876543210\n'
      ;;
    *"second"*)
      printf '0123456789abcdef\naabbccddeeff0011\n'
      ;;
  esac
  exit 0
fi
exit 1
`);
      const sessionID = "ses_legend_unit";
      expect(legendSeenFile(sessionID)).toBeUndefined();

      expect(await recordLegendSeen(bin, sessionID, "<for>no comment</for>")).toBe(false);
      expect(legendSeenFile(sessionID)).toBeUndefined();

      expect(await recordLegendSeen(bin, sessionID, "<!-- first --><for/>")).toBe(true);
      const file = legendSeenFile(sessionID);
      expect(file).toBe(`${dir}/spectre-ripwire-seen/${sessionID}.txt`);
      expect(await Bun.file(file!).text()).toBe("0123456789abcdef\nfedcba9876543210\n");

      expect(await recordLegendSeen(bin, sessionID, "<!-- first --><for/>")).toBe(false);

      expect(await recordLegendSeen(bin, sessionID, "<!-- second --><for/>")).toBe(true);
      expect(await Bun.file(file!).text()).toBe(
        "0123456789abcdef\naabbccddeeff0011\nfedcba9876543210\n",
      );

      clearLegendSeen(sessionID);
      expect(legendSeenFile(sessionID)).toBeUndefined();
    } finally {
      if (prevTmp === undefined) delete Bun.env.TMPDIR;
      else Bun.env.TMPDIR = prevTmp;
    }
  });

  test("ignores non-zero exit codes and non-16-hex output from binary", async () => {
    const dir = tempDir();
    const prevTmp = Bun.env.TMPDIR;
    Bun.env.TMPDIR = dir;
    try {
      const failingBin = await makeBin(`#!/bin/sh
echo "0123456789abcdef"
exit 1
`);
      const badOutputBin = await makeBin(`#!/bin/sh
printf 'short\nZZZZZZZZZZZZZZZZ\n0123456789abcdef0\n'
exit 0
`);
      expect(await recordLegendSeen(failingBin, "ses_legend_fail", "<!-- x --><for/>")).toBe(false);
      expect(legendSeenFile("ses_legend_fail")).toBeUndefined();

      expect(await recordLegendSeen(badOutputBin, "ses_legend_bad", "<!-- x --><for/>")).toBe(false);
      expect(legendSeenFile("ses_legend_bad")).toBeUndefined();
    } finally {
      if (prevTmp === undefined) delete Bun.env.TMPDIR;
      else Bun.env.TMPDIR = prevTmp;
    }
  });

  test("spectre_search passes --legend-seen=<file> on subsequent calls after recording <!-- legend", async () => {
    const dir = tempDir();
    const prevTmp = Bun.env.TMPDIR;
    Bun.env.TMPDIR = dir;
    try {
      const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.7.0 (Release, built_from=test)"
  exit 0
fi
if [ "$1" = "--legend-dict=seen" ]; then
  cat >/dev/null
  printf '0011223344556677\n'
  exit 0
fi
printf '%s' "args:$*|<!-- legend --><for task=\"q\" coverage=\"80\"><d n=\"x\" p=\"a.ts\"/></for>"
exit 0
`);
      await withBinary(bin, async () => {
        const sessionID = "ses_legend_search";
        const tool = search(readingContext(PROJECT, undefined, dir));

        const first = await Effect.runPromise(
          tool.execute({ query: "first" }, toolContext(sessionID, "call_l_1")),
        );
        expect(first.output?.command).not.toContain("--legend-seen=");
        const seenFile = legendSeenFile(sessionID);
        expect(seenFile).toBeDefined();

        const second = await Effect.runPromise(
          tool.execute({ query: "second" }, toolContext(sessionID, "call_l_2")),
        );
        expect(second.output?.command).toContain(`--legend-seen=${seenFile}`);
      });
    } finally {
      if (prevTmp === undefined) delete Bun.env.TMPDIR;
      else Bun.env.TMPDIR = prevTmp;
    }
  });

  test("write failure leaves sessions unmutated so legendSeenFile stays undefined", async () => {
    const dir = tempDir();
    const blockingFile = `${dir}/not-a-dir`;
    await Bun.write(blockingFile, "block");
    const prevTmp = Bun.env.TMPDIR;
    Bun.env.TMPDIR = blockingFile;
    try {
      const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--legend-dict=seen" ]; then
  cat >/dev/null
  printf '0123456789abcdef\n'
  exit 0
fi
exit 1
`);
      const sessionID = "ses_legend_write_fail";
      expect(await recordLegendSeen(bin, sessionID, "<!-- x --><for/>")).toBe(false);
      expect(legendSeenFile(sessionID)).toBeUndefined();
    } finally {
      if (prevTmp === undefined) delete Bun.env.TMPDIR;
      else Bun.env.TMPDIR = prevTmp;
    }
  });

  test("measure records --legend-seen hashes from shell output.output, output.stdout, string content, and array content", async () => {
    const dir = tempDir();
    const prevTmp = Bun.env.TMPDIR;
    Bun.env.TMPDIR = dir;
    try {
      const bin = await makeBin(`#!/bin/sh
if [ "$1" = "--version" ]; then
  echo "ripwire 0.7.0 (Release, built_from=test)"
  exit 0
fi
if [ "$1" = "--legend-dict=seen" ]; then
  body=$(cat)
  case "$body" in
    *"out-prop"*) printf '1111111111111111\n' ;;
    *"stdout-prop"*) printf '2222222222222222\n' ;;
    *"str-content"*) printf '3333333333333333\n' ;;
    *"arr-content"*) printf '4444444444444444\n' ;;
  esac
  exit 0
fi
exit 1
`);
      await withBinary(bin, async () => {
        const after = await captureAfter();
        const shapes: Array<{ readonly id: string; readonly result: unknown }> = [
          { id: "ses_sh_out", result: { output: { output: "<!-- out-prop --><for/>" } } },
          { id: "ses_sh_stdout", result: { output: { stdout: "<!-- stdout-prop --><for/>" } } },
          { id: "ses_sh_str", result: { content: "<!-- str-content --><for/>" } },
          {
            id: "ses_sh_arr",
            result: { content: [{ type: "text", text: "<!-- arr-content --><for/>" }] },
          },
        ];

        for (const shape of shapes) {
          await Effect.runPromise(
            after.callback({
              tool: "shell",
              sessionID: Session.ID.make(shape.id),
              agent: "spectre",
              messageID: "msg_sh_legend",
              id: `call_${shape.id}`,
              input: { command: "ripwire . --for=test" },
              status: "completed",
              result: shape.result,
            }),
          );
          expect(legendSeenFile(shape.id)).toBeDefined();
          memories.delete(Session.ID.make(shape.id));
        }
      });
    } finally {
      if (prevTmp === undefined) delete Bun.env.TMPDIR;
      else Bun.env.TMPDIR = prevTmp;
    }
  });
});
