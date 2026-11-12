import { describe, expect, test } from "bun:test";
import { deadAnchors } from "../../tools/definitions/canvas/check";
import type { Review } from "../../tools/definitions/canvas/content";
import type { Evidence } from "../../tools/definitions/canvas/evidence";
import type { ParsedFile, ReadFile } from "../../tools/definitions/canvas/parse";
import { pr } from "../../tools/definitions/canvas/pr";

const HEAD: ReadFile = {
  status: "read",
  index: 1,
  path: "src/head.ts",
  additions: 2,
  deletions: 1,
  rows: [
    { kind: "hunk", header: "@@ -1,3 +1,4 @@" },
    { kind: "context", old: 1, new: 1, text: "one" },
    { kind: "removed", old: 2, text: "two" },
    { kind: "added", new: 2, text: "TWO" },
    { kind: "added", new: 3, text: "three" },
    { kind: "context", old: 3, new: 4, text: "four" },
  ],
};

const OTHER: ReadFile = {
  status: "read",
  index: 2,
  path: "src/other.ts",
  additions: 1,
  deletions: 1,
  rows: [
    { kind: "hunk", header: "@@ -10,2 +10,2 @@" },
    { kind: "context", old: 10, new: 10, text: "ten" },
    { kind: "removed", old: 11, text: "eleven" },
    { kind: "added", new: 11, text: "ELEVEN" },
  ],
};

const BINARY: ParsedFile = {
  status: "unreadable",
  index: 3,
  path: "assets/logo.png",
  reason: "binary file, no text rows",
};

const DOCS: ReadFile = {
  status: "read",
  index: 4,
  path: "docs/readme.md",
  additions: 1,
  deletions: 0,
  rows: [
    { kind: "hunk", header: "@@ -1,1 +1,2 @@" },
    { kind: "context", old: 1, new: 1, text: "readme" },
    { kind: "added", new: 2, text: "new line" },
  ],
};

const evidence = (overrides: Partial<Evidence> = {}): Evidence => ({
  token: "pr-42-c002efd-abcdef",
  directory: "/tmp/evidence",
  subject: {
    kind: "pull-request",
    number: 42,
    repository: "yriveiro/spectre",
    url: "https://github.com/yriveiro/spectre/pull/42",
    title: "Canvas artifacts",
    author: "yriveiro",
    state: "open",
    headSha: "c002efd",
    baseRef: "main",
    headRef: "canvas-artifacts",
    additions: 4,
    deletions: 2,
    changedFiles: 4,
    isDraft: false,
    body: "",
  },
  files: [HEAD, OTHER, BINARY, DOCS],
  cross: {
    kind: "matched",
    parsed: { files: 4, additions: 4, deletions: 2 },
    reported: { files: 4, additions: 4, deletions: 2 },
  },
  problems: [],
  rows: [],
  ...overrides,
});

const review = (overrides: Partial<Review> = {}): Review => ({
  summary: "The canvas tool stops owning storage.",
  groups: [
    {
      heading: "Core",
      note: "the read path",
      paths: ["src/head.ts", "src/other.ts", "assets/logo.png"],
    },
  ],
  points: [
    {
      kind: "requirement",
      text: "One tool publishes all four kinds.",
      source: "arena brief, 2026-11-12",
      at: { path: "src/head.ts", side: "head", line: 2 },
    },
    {
      kind: "change",
      text: "Pairs removed and added rows.",
      at: { path: "src/head.ts", side: "base", line: 2 },
    },
    {
      kind: "question",
      text: "Is the third added row cached?",
      note: "Not load-bearing yet.",
      at: { path: "src/other.ts", side: "head", line: 11 },
    },
  ],
  unknowns: ["The artifact view route was not exercised."],
  ...overrides,
});

const composedOf = (
  result: ReturnType<typeof pr>,
): Extract<ReturnType<typeof pr>, { ok: true }> => {
  if (!result.ok) throw new Error(result.problem);
  return result;
};

const htmlOf = (result: ReturnType<typeof pr>): string => {
  if (!result.ok) throw new Error(result.problem);
  const html = result.files["index.html"];
  if (html === undefined) throw new Error("index.html is missing");
  return html;
};

describe("validation", () => {
  test("an unknown group path refuses and names a basename match", () => {
    const result = pr(
      evidence(),
      review({ groups: [{ heading: "Core", paths: ["other/head.ts"] }] }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain('"other/head.ts"');
    expect(result.problem).toContain("same basename");
    expect(result.problem).toContain('"src/head.ts"');
  });

  test("a path listed in two groups refuses", () => {
    const result = pr(
      evidence(),
      review({
        groups: [
          { heading: "A", paths: ["src/head.ts"] },
          { heading: "B", paths: ["src/head.ts"] },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("two groups");
  });

  test("a line absent from the cited side refuses and names that side's range", () => {
    const result = pr(
      evidence(),
      review({
        groups: [{ heading: "Core", paths: ["src/head.ts"] }],
        points: [
          {
            kind: "change",
            text: "Line four is only on the head side.",
            at: { path: "src/head.ts", side: "base", line: 4 },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("base side");
    expect(result.problem).toContain("1-3");
  });

  test("a point on an unreadable file refuses", () => {
    const result = pr(
      evidence(),
      review({
        points: [
          {
            kind: "question",
            text: "What is in the image?",
            at: { path: "assets/logo.png", side: "head", line: 1 },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("could not be read");
  });

  test("a point on a path outside the inventory refuses", () => {
    const result = pr(
      evidence(),
      review({
        points: [
          {
            kind: "change",
            text: "x",
            at: { path: "src/nope.ts", side: "head", line: 1 },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("not in the diff");
  });

  test("a requirement with a blank source refuses", () => {
    const result = pr(
      evidence(),
      review({
        points: [
          {
            kind: "requirement",
            text: "x",
            source: "   ",
            at: { path: "src/head.ts", side: "head", line: 1 },
          },
        ],
      }),
    );
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("blank source");
  });
});

describe("the composed page", () => {
  test("takes its title from the pull request, not from the review", () => {
    const result = pr(evidence(), review());
    if (!result.ok) throw new Error(result.problem);
    expect(result.title).toBe("PR #42 · Canvas artifacts");
  });

  test("titles a local diff by its two refs", () => {
    const result = pr(
      evidence({
        subject: { kind: "local-diff", base: "main", head: "feature", headSha: "abc1234" },
        cross: {
          kind: "no-oracle",
          parsed: { files: 4, additions: 4, deletions: 2 },
          why: "a local diff has no pull request to check its counts against",
        },
      }),
      review(),
    );
    if (!result.ok) throw new Error(result.problem);
    expect(result.title).toBe("Local diff main...feature");
  });

  test("pairs a removed row with the added row on one diff row", () => {
    const html = htmlOf(pr(evidence(), review()));
    const paired = /<tr class="row paired">[\s\S]*?<\/tr>/.exec(html);
    expect(paired?.[0]).toBeDefined();
    expect(paired?.[0]).toContain("two");
    expect(paired?.[0]).toContain("TWO");

    const head = /<section class="file" id="f-1">[\s\S]*?<\/section>/.exec(html)?.[0] ?? "";
    const rightOnly = [...head.matchAll(/<tr class="row right">[\s\S]*?<\/tr>/g)].map(
      (one) => one[0],
    );
    expect(rightOnly).toHaveLength(1);
    expect(rightOnly[0]).toContain("three");
  });

  test("shows a requirement's source and gives a change no source field", () => {
    const html = htmlOf(pr(evidence(), review()));
    const requirement = /<li class="point point-requirement">[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
    const change = /<li class="point point-change">[\s\S]*?<\/li>/.exec(html)?.[0] ?? "";
    expect(requirement).toContain("Source: arena brief, 2026-11-12");
    expect(change).not.toContain("Source:");
  });

  test("labels every annotation by kind next to its row", () => {
    const html = htmlOf(pr(evidence(), review()));
    expect(html).toContain('<span class="badge">Requirement</span>');
    expect(html).toContain('<span class="badge">Change</span>');
    expect(html).toContain('<span class="badge">Question</span>');
    expect(html).toContain('id="p-1"');
    expect(html).toContain('id="p-2"');
    expect(html).toContain('id="p-3"');
    expect(deadAnchors(html)).toEqual([]);
  });

  test("renders a Mermaid fence in the summary", () => {
    const html = htmlOf(
      pr(evidence(), review({ summary: "```mermaid\nflowchart LR\n  A --> B\n```" })),
    );
    expect(html).toContain("<svg");
  });

  test("refuses when the summary cannot be rendered", () => {
    const result = pr(evidence(), review({ summary: "```mermaid\nflowchart LR\n  A -->\n```" }));
    expect(result.ok).toBe(false);
    if (result.ok) throw new Error("expected a refusal");
    expect(result.problem).toContain("review summary");
    expect(result.problem).toContain("Mermaid block 1");
  });
});

describe("the navigator and the limits", () => {
  test("lists every changed path, including the ungrouped one", () => {
    const result = composedOf(pr(evidence(), review()));
    const html = htmlOf(result);
    const nav = /<nav class="file-nav"[\s\S]*?<\/nav>/.exec(html)?.[0] ?? "";
    expect(nav).toContain("src/head.ts");
    expect(nav).toContain("src/other.ts");
    expect(nav).toContain("assets/logo.png");
    expect(nav).toContain("docs/readme.md");
    expect(result.warnings).toContain(
      "1 changed path is in no group; the page lists it under Not grouped",
    );
    expect(html).toContain("Not grouped");
  });

  test("prints a mismatched cross-check in the limits and returns a warning", () => {
    const result = composedOf(
      pr(
        evidence({
          cross: {
            kind: "mismatched",
            parsed: { files: 4, additions: 4, deletions: 2 },
            reported: { files: 4, additions: 6, deletions: 2 },
            why: "parsed 4/2 against gh's 6/2",
          },
        }),
        review(),
      ),
    );
    const html = htmlOf(result);
    expect(html).toContain("Counts disagree.");
    expect(html).toContain("+6");
    expect(result.warnings).toContain(
      "the parsed counts disagree with the reported counts; the Limits section prints both",
    );
  });

  test("reports a head that moved while the diff was read", () => {
    const moved = "the head moved while the diff was read: pinned c002efd, now deadbee";
    const result = composedOf(pr(evidence({ problems: [moved] }), review()));
    const html = htmlOf(result);
    expect(html).toContain(moved);
    expect(result.warnings).toContain(moved);
  });

  test("says every changed path was rendered", () => {
    const html = htmlOf(pr(evidence(), review()));
    expect(html).toContain("Rendered all 4 changed paths");
    expect(html).toContain("No path is omitted or truncated.");
  });
});
