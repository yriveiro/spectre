import { describe, expect, test } from "bun:test";
import { parseDiff } from "../../tools/definitions/canvas/parse";

const TWO_HUNK = `diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,4 +1,5 @@
 line one
-old two
+new two
+extra line
 line three
 line four
@@ -10,3 +11,3 @@
 context ten
-removed eleven
+added eleven
 context twelve
`;

describe("a hand-written two-hunk diff", () => {
  test("reads one file with paired rows, headers, and counts", () => {
    const result = parseDiff(TWO_HUNK);
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.files).toHaveLength(1);

    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.index).toBe(1);
    expect(file.path).toBe("src/app.ts");
    expect(file.rows).toEqual([
      { kind: "hunk", header: "@@ -1,4 +1,5 @@" },
      { kind: "context", old: 1, new: 1, text: "line one" },
      { kind: "removed", old: 2, text: "old two" },
      { kind: "added", new: 2, text: "new two" },
      { kind: "added", new: 3, text: "extra line" },
      { kind: "context", old: 3, new: 4, text: "line three" },
      { kind: "context", old: 4, new: 5, text: "line four" },
      { kind: "hunk", header: "@@ -10,3 +11,3 @@" },
      { kind: "context", old: 10, new: 11, text: "context ten" },
      { kind: "removed", old: 11, text: "removed eleven" },
      { kind: "added", new: 12, text: "added eleven" },
      { kind: "context", old: 12, new: 13, text: "context twelve" },
    ]);

    const manualAdditions = 2 + 1;
    const manualDeletions = 1 + 1;
    expect(file.additions).toBe(manualAdditions);
    expect(file.deletions).toBe(manualDeletions);
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(2);
  });
});

describe("line numbers come from the headers", () => {
  test("a second hunk restarts from its header, not from a running counter", () => {
    const result = parseDiff(TWO_HUNK);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    const secondHunk = file.rows.find(
      (row) => row.kind === "hunk" && row.header === "@@ -10,3 +11,3 @@",
    );
    expect(secondHunk).toBeDefined();
    const at = file.rows.indexOf(secondHunk ?? { kind: "hunk", header: "" });
    expect(file.rows[at + 1]).toEqual({ kind: "context", old: 10, new: 11, text: "context ten" });
  });

  test("a new file hunk starting at -0,0 numbers its first added line 1, not 0", () => {
    const result = parseDiff(`diff --git a/new.ts b/new.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/new.ts
@@ -0,0 +1,2 @@
+first
+second
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.path).toBe("new.ts");
    expect(file.rows).toEqual([
      { kind: "hunk", header: "@@ -0,0 +1,2 @@" },
      { kind: "added", new: 1, text: "first" },
      { kind: "added", new: 2, text: "second" },
    ]);
    expect(file.additions).toBe(2);
    expect(file.deletions).toBe(0);
  });
});

describe("unmatched runs leave the longer tail hanging", () => {
  test("three removals and one addition keep every removed line with its own number", () => {
    const result = parseDiff(`diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -5,4 +5,2 @@
 keep
-drop one
-drop two
-drop three
+keep one
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.rows).toEqual([
      { kind: "hunk", header: "@@ -5,4 +5,2 @@" },
      { kind: "context", old: 5, new: 5, text: "keep" },
      { kind: "removed", old: 6, text: "drop one" },
      { kind: "removed", old: 7, text: "drop two" },
      { kind: "removed", old: 8, text: "drop three" },
      { kind: "added", new: 6, text: "keep one" },
    ]);
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(3);
  });

  test("one removal and three additions keep every added line with its own number", () => {
    const result = parseDiff(`diff --git a/b.ts b/b.ts
--- a/b.ts
+++ b/b.ts
@@ -5,2 +5,4 @@
 keep
-drop one
+keep one
+keep two
+keep three
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.rows).toEqual([
      { kind: "hunk", header: "@@ -5,2 +5,4 @@" },
      { kind: "context", old: 5, new: 5, text: "keep" },
      { kind: "removed", old: 6, text: "drop one" },
      { kind: "added", new: 6, text: "keep one" },
      { kind: "added", new: 7, text: "keep two" },
      { kind: "added", new: 8, text: "keep three" },
    ]);
    expect(file.additions).toBe(3);
    expect(file.deletions).toBe(1);
  });
});

describe("files with no text rows", () => {
  test("a binary file is unreadable with a reason, not an empty row list", () => {
    const result = parseDiff(`diff --git a/logo.png b/logo.png
index 1111111..2222222 100644
Binary files a/logo.png and b/logo.png differ
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.files).toEqual([
      { status: "unreadable", index: 1, path: "logo.png", reason: "binary file, no text rows" },
    ]);
  });

  test("a mode-only change is unreadable with a reason", () => {
    const result = parseDiff(`diff --git a/run.sh b/run.sh
old mode 100644
new mode 100755
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    expect(result.files).toEqual([
      {
        status: "unreadable",
        index: 1,
        path: "run.sh",
        reason: "mode-only change, no content rows",
      },
    ]);
  });

  test("an empty diff parses to zero files, which is not an unreadable file", () => {
    expect(parseDiff("")).toEqual({ status: "parsed", files: [] });
    expect(parseDiff("   \n")).toEqual({ status: "parsed", files: [] });
  });
});

describe("paths with spaces", () => {
  test("a quoted diff --git header yields the unquoted path", () => {
    const result = parseDiff(`diff --git "a/my dir/file.ts" "b/my dir/file.ts"
--- "a/my dir/file.ts"
+++ "b/my dir/file.ts"
@@ -1,1 +1,1 @@
-old name
+new name
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.path).toBe("my dir/file.ts");
    expect(file.rows).toEqual([
      { kind: "hunk", header: "@@ -1,1 +1,1 @@" },
      { kind: "removed", old: 1, text: "old name" },
      { kind: "added", new: 1, text: "new name" },
    ]);
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
  });
});

describe("the measured failure stays fixed", () => {
  test("format-patch mail is refused instead of counted", () => {
    const result = parseDiff(`From abc123def456abc123def456abc123def456abc1 Mon Sep 17 00:00:00 2001
Subject: [PATCH] some change
---
- a bullet from the commit message
- another bullet

diff --git a/a.ts b/a.ts
--- a/a.ts
+++ b/a.ts
@@ -1,1 +1,1 @@
-old
+new
`);
    expect(result.status).toBe("unreadable");
    if (result.status !== "unreadable") throw new Error("expected unreadable");
    expect(result.reason).toContain("--patch");
  });

  test("a backslash no-newline marker is not a row and not a count", () => {
    const result = parseDiff(`diff --git a/c.ts b/c.ts
--- a/c.ts
+++ b/c.ts
@@ -1,1 +1,1 @@
-old
+new
\\ No newline at end of file
`);
    if (result.status !== "parsed") throw new Error("expected parsed");
    const file = result.files[0];
    if (file?.status !== "read") throw new Error("expected a readable file");
    expect(file.additions).toBe(1);
    expect(file.deletions).toBe(1);
    expect(file.rows).toHaveLength(3);
  });

  test("garbage in is an unreadable result, never a throw", () => {
    const result = parseDiff("this is not a diff at all\n- nor is this a deletion\n");
    expect(result.status).toBe("unreadable");
  });
});
