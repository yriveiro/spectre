import { describe, expect, test } from "bun:test";
import { Effect } from "effect";
import { recall } from "../../tools/definitions/brain/recall";
import type { Claim } from "../../tools/definitions/brain/neuron";
import type { Edge } from "../../tools/definitions/brain/ledger";

const run = (input: {
  readonly claims: ReadonlyArray<Claim>;
  readonly edges: ReadonlyArray<Edge>;
  readonly query: string;
  readonly budget: number;
}) => Effect.runPromise(recall(input));

const ids = (claims: ReadonlyArray<Claim>): ReadonlyArray<string> =>
  claims.map((claim) => claim.id);

const canvas: Claim = {
  id: "0199b600000000000000000001",
  kind: "gotcha",
  claim: "canvas save allocates a directory",
  subject: ["tools/definitions/canvas/store.ts"],
  at: "2026-09-01T00:00:00.000Z",
  path: "/brain/neurons/0199b600000000000000000001.md",
};

const routing: Claim = {
  id: "0199b600000000000000000002",
  kind: "decision",
  claim: "routing reads profiles from spectre jsonc",
  subject: ["tools/definitions/routing/load.ts"],
  at: "2026-09-02T00:00:00.000Z",
  path: "/brain/neurons/0199b600000000000000000002.md",
};

const ledger: Claim = {
  id: "0199b600000000000000000003",
  kind: "lesson",
  claim: "ledger appends edges atomically",
  subject: ["tools/definitions/brain/ledger.ts"],
  at: "2026-09-03T00:00:00.000Z",
  path: "/brain/neurons/0199b600000000000000000003.md",
};

describe("recall", () => {
  test("a query matching one headline returns that claim and nothing else", async () => {
    expect(
      await run({
        claims: [canvas, routing, ledger],
        edges: [],
        query: "canvas save allocates",
        budget: 1000,
      }),
    ).toEqual({
      claims: [canvas],
      edges: [],
      sources: [canvas.path],
      problems: [],
      clipped: false,
    });
  });

  test("a query matching nothing returns empty arrays and a problems entry", async () => {
    expect(
      await run({
        claims: [canvas, routing],
        edges: [],
        query: "bananas orbit",
        budget: 1000,
      }),
    ).toEqual({
      claims: [],
      edges: [],
      sources: [],
      problems: ['no match for query "bananas orbit"'],
      clipped: false,
    });
  });

  test("a relates chain spreads two hops from the seed", async () => {
    const a: Claim = {
      ...canvas,
      claim: "canvas save allocates a directory for the page",
      subject: [],
    };
    const b: Claim = {
      ...routing,
      id: "0199b60000000000000000000b",
      claim: "atomic rename lands the page without tears",
      subject: [],
      path: "/brain/neurons/0199b60000000000000000000b.md",
    };
    const c: Claim = {
      ...ledger,
      id: "0199b60000000000000000000c",
      claim: "injected memory wears an envelope",
      subject: [],
      path: "/brain/neurons/0199b60000000000000000000c.md",
    };
    const link = (from: string, to: string): Edge => ({
      kind: "relates",
      from,
      to,
      why: "same write path",
      at: "2026-09-04T00:00:00.000Z",
      until: null,
    });
    const answer = await run({
      claims: [a, b, c],
      edges: [link(a.id, b.id), link(b.id, c.id)],
      query: "canvas save allocates",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([a.id, b.id, c.id]);
    expect(answer.edges).toHaveLength(2);
    expect(answer.clipped).toBe(false);
  });

  test("the third hop stays out of the answer", async () => {
    const mk = (id: string, word: string): Claim => ({
      id,
      kind: "lesson",
      claim: `canvas save allocates ${word}`,
      subject: [],
      at: "2026-09-01T00:00:00.000Z",
      path: `/brain/neurons/${id}.md`,
    });
    const a = mk("0199b6000000000000000000a1", "alpha");
    const b: Claim = { ...mk("0199b6000000000000000000b1", "beta"), claim: "zebra panel" };
    const c: Claim = { ...b, id: "0199b6000000000000000000c1", claim: "yodel shelf" };
    const d: Claim = { ...b, id: "0199b6000000000000000000d1", claim: "xerox bench" };
    const link = (from: string, to: string): Edge => ({
      kind: "relates",
      from,
      to,
      why: "same write path",
      at: "2026-09-04T00:00:00.000Z",
      until: null,
    });
    const answer = await run({
      claims: [a, b, c, d],
      edges: [link(a.id, b.id), link(b.id, c.id), link(c.id, d.id)],
      query: "canvas save allocates",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([a.id, b.id, c.id]);
  });

  test("a demoted edge is not traversed", async () => {
    const answer = await run({
      claims: [canvas, ledger],
      edges: [
        {
          kind: "demoted",
          from: canvas.id,
          to: ledger.id,
          why: "stale grouping",
          at: "2026-09-05T00:00:00.000Z",
          until: null,
        },
      ],
      query: "canvas save allocates",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([canvas.id]);
    expect(answer.edges).toEqual([]);
    expect(answer.problems).toEqual([]);
  });

  test("a supersedes edge keeps the newer claim and drops the older", async () => {
    const old: Claim = {
      id: "0199b6000000000000000000e1",
      kind: "decision",
      claim: "flat notes live beside the code",
      subject: [],
      at: "2026-09-01T00:00:00.000Z",
      path: "/brain/neurons/0199b6000000000000000000e1.md",
    };
    const fresh: Claim = {
      id: "0199b6000000000000000000e2",
      kind: "decision",
      claim: "flat notes replaced by ledger entries",
      subject: [],
      at: "2026-09-20T00:00:00.000Z",
      path: "/brain/neurons/0199b6000000000000000000e2.md",
    };
    const answer = await run({
      claims: [old, fresh],
      edges: [
        {
          kind: "supersedes",
          from: old.id,
          to: fresh.id,
          why: "ledger replaced flat notes",
          at: "2026-09-20T00:00:00.000Z",
          until: null,
        },
      ],
      query: "flat notes ledger",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([fresh.id]);
  });

  test("equal relevance breaks the tie by recency", async () => {
    const old: Claim = {
      ...canvas,
      id: "0199b6000000000000000000f1",
      path: "/brain/neurons/0199b6000000000000000000f1.md",
      at: "2026-09-01T00:00:00.000Z",
    };
    const fresh: Claim = {
      ...canvas,
      id: "0199b6000000000000000000f2",
      path: "/brain/neurons/0199b6000000000000000000f2.md",
      at: "2026-09-20T00:00:00.000Z",
    };
    const answer = await run({
      claims: [old, fresh],
      edges: [],
      query: "canvas save allocates",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([fresh.id, old.id]);
  });

  test("a budget smaller than the top claim clips with the reason in problems", async () => {
    const answer = await run({ claims: [canvas], edges: [], query: "canvas save", budget: 1 });
    expect(answer.claims).toEqual([]);
    expect(answer.clipped).toBe(true);
    expect(answer.problems).toHaveLength(1);
    expect(answer.problems[0]).toMatch(/^budget 1 tokens holds no more/);
  });

  test("a query naming a subject path matches through the subject", async () => {
    const target: Claim = {
      id: "0199b6000000000000000000a7",
      kind: "decision",
      claim: "single reader owns the catalog entry",
      subject: ["tools/definitions/routing/index.ts"],
      at: "2026-09-06T00:00:00.000Z",
      path: "/brain/neurons/0199b6000000000000000000a7.md",
    };
    const other: Claim = {
      id: "0199b6000000000000000000b7",
      kind: "lesson",
      claim: "canvas page persists after session ends",
      subject: ["README.md"],
      at: "2026-09-01T00:00:00.000Z",
      path: "/brain/neurons/0199b6000000000000000000b7.md",
    };
    const answer = await run({
      claims: [target, other],
      edges: [],
      query: "tools/definitions/routing/index.ts",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([target.id]);
  });

  test("a malformed edge is skipped with the reason in problems", async () => {
    const answer = await run({
      claims: [canvas],
      edges: [
        {
          kind: "relates",
          from: canvas.id,
          to: "0199b60000000000000000ffff",
          why: "points nowhere",
          at: "2026-09-04T00:00:00.000Z",
          until: null,
        },
      ],
      query: "canvas save",
      budget: 1000,
    });
    expect(ids(answer.claims)).toEqual([canvas.id]);
    expect(answer.problems).toHaveLength(1);
    expect(answer.problems[0]).toMatch(/skipped: unknown claim/);
  });
});
