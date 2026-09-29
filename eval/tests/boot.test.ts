import { describe, expect, test } from "bun:test";
import { parseRegistered } from "../boot";

const REAL =
  'timestamp=2026-09-28T16:25:49.096Z level=INFO run=363fd257 message="Registered skills" ' +
  'skills="[\\"i-have-adhd\\", \\"model-router\\", \\"no-comments\\", \\"principle-evidence\\", ' +
  '\\"spectre-mode\\", \\"ripwire\\"]" http.span=1 role=server';

describe("parseRegistered", () => {
  test("reads the real line, escapes and all", () => {
    expect(parseRegistered(REAL)).toEqual([
      "i-have-adhd",
      "model-router",
      "no-comments",
      "principle-evidence",
      "spectre-mode",
      "ripwire",
    ]);
  });

  test("a single id has no separator to get wrong", () => {
    const line = 'message="Registered skills" skills="[\\"ripwire\\"]"';
    expect(parseRegistered(line)).toEqual(["ripwire"]);
  });

  test("an empty list is empty, not one empty id", () => {
    expect(parseRegistered('message="Registered skills" skills="[]"')).toEqual([]);
  });

  test("a log with no registration line yields nothing rather than throwing", () => {
    expect(parseRegistered("server listening on http://127.0.0.1:4489")).toEqual([]);
  });

  test("a log that has not reached the line yet is distinguishable from an empty one", () => {
    // The caller polls this before the plugin has registered. `String.match`
    // answers null here, and treating that as a present-but-empty list threw
    // instead of letting the poll retry.
    const REGISTERED = /message="Registered skills" skills="\[(.*?)\]"/;
    const seen = "server listening on http://127.0.0.1:4489";
    if (REGISTERED.test(seen) === true) throw new Error("a log without the line must not match");
    expect(parseRegistered(seen)).toEqual([]);
  });

  test("an id is not returned with a stray backslash or quote", () => {
    for (const id of parseRegistered(REAL)) {
      expect(id).not.toContain("\\");
      expect(id).not.toContain('"');
    }
  });
});
