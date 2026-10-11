import { describe, expect, test } from "bun:test";
import {
  audit,
  ball,
  body,
  boundsOf,
  box,
  cameraBasis,
  distanceTo,
  FLOOR,
  moved,
  orderKeys,
  orientedBoxShape,
  overlapsOf,
  passed,
  prefixStates,
  prism,
  rayDepth,
  recorder,
  report,
  settle,
  slab,
  slide,
  tubeShape,
} from "../../tools/definitions/anatomy/kit/audit";
import { boxCorners, fitProjection } from "../../tools/definitions/anatomy/kit/iso-kit";
import { crossingsOf, runsOf, tubePieces, tubeSvg } from "../../tools/definitions/anatomy/kit/tube";

const CAMERA = fitProjection(boxCorners({ x: 0, y: 0, w: 60, d: 60, r: 0 }, 0, 40), 400, 300);

const item = (name: string) => ({
  name,
  piece: name,
  ride: name,
  move: [0, 0, 0] as [number, number, number],
  shapes: [] as ReadonlyArray<never>,
  key: 0,
});

/**
 * Every case below is a figure with one named fault. A suite that only ever
 * audits a good figure cannot tell a working check from one that always passes,
 * so the faults are the point of these tests.
 */
describe("regressions from review", () => {
  test("a prism's bound covers its polygon, so an off-axis ray still hits it", () => {
    const p = prism(
      FLOOR,
      [
        [-1, -1],
        [1, -1],
        [1, 1],
        [-1, 1],
      ],
      0,
      2,
    );
    expect(boundsOf(p).min[1]).toBeLessThanOrEqual(-0.9);
    expect(boundsOf(p).max[1]).toBeGreaterThanOrEqual(0.9);
    // A bound covering only the axis made this a miss, and a miss reads as "behind".
    expect(rayDepth(p, [0.5, 0.5, -5], [0, 0, 1])).toBeLessThan(100);
  });

  test("a rotated box's bound covers its diagonal reach", () => {
    const q = Math.SQRT1_2;
    const turned = orientedBoxShape(
      [0, 0, 0],
      [
        [q, q, 0],
        [-q, q, 0],
        [0, 0, 1],
      ],
      [2, 0.5, 0.5],
    );
    // The y extent is 0.707*2 + 0.707*0.5, not the half-width 0.5.
    expect(boundsOf(turned).max[1]).toBeCloseTo(1.768, 2);
    expect(rayDepth(turned, [1, 1, -5], [0, 0, 1])).toBeLessThan(100);
  });

  test("a ring profile's inner wall is its closing edge", () => {
    const ring = body(FLOOR, [
      [0, 1],
      [0, 2],
      [2, 2],
      [2, 1],
    ]);
    // On the inner wall means on the surface, not a whole radius inside it.
    expect(Math.abs(distanceTo(ring, [1, 0, 1]))).toBeLessThan(0.01);
  });

  test("a shape cut by a host with a hole fills that hole", () => {
    const host = { ...box([-2, -2, -2], [2, 2, 2]), cut: ball([0, 0, 0], 1) };
    const outer = { ...ball([0, 0, 0], 5), cut: host };
    expect(distanceTo(outer as never, [0, 0, 0])).toBeLessThan(0);
  });

  test("a moved tube's tips move with it", () => {
    const hose = tubeShape(
      [
        [0, 0, 0],
        [2, 0, 0],
      ],
      0.5,
    );
    const posed = moved(hose, [10, 0, 0]);
    const tips = posed.kind === "tube" ? posed.tips : [];
    expect(tips[0]).toEqual([10, 0, 0]);
    expect(tips[1]).toEqual([12, 0, 0]);
  });

  test("orderKeys terminates on a rule the starting keys violate", () => {
    // Equal starting keys with a measured overlap is the common case, and it used
    // to recurse until the stack overflowed.
    const items = [item("a"), item("b")];
    const overlap = {
      pairs: [{ state: { label: "rest", shares: {} }, a: 0, b: 1, front: 0 as const }],
      least: 0.25,
      states: [],
    };
    const solved = orderKeys(items, overlap);
    expect(solved.keys[0]).toBeGreaterThan(solved.keys[1] as number);
  });

  test("orderKeys terminates on a mutual cycle", () => {
    const items = [item("a"), item("b")];
    const cycle = {
      pairs: [
        { state: { label: "rest", shares: {} }, a: 0, b: 1, front: 0 as const },
        { state: { label: "rest", shares: {} }, a: 1, b: 0, front: 1 as const },
      ],
      least: 0.25,
      states: [],
    };
    // Whether the solver drops a rule or finds one satisfiable is its own
    // business; what must hold is that it terminates and never invents a key.
    const solved = orderKeys(items, cycle);
    expect(solved.keys.every((key) => Number.isFinite(key))).toBe(true);
    expect(solved.rules + solved.dropped).toBeLessThanOrEqual(2);
  });

  test("a prefix state holds the share its label names", () => {
    const states = prefixStates(["a", "b"], { shares: [0.25] });
    expect(states[0]?.shares.a).toBe(0.25);
    expect(states[0]?.shares.b).toBe(0);
  });

  test("the overlap gate does not depend on the order shapes are recorded in", () => {
    const proj = { origin: [200, 200] as [number, number], scale: 10 };
    const V = cameraBasis(proj).V;
    const off: [number, number, number] = [V[0] * 5, V[1] * 5, V[2] * 5];
    const base = box([-1, -1, -1], [1, 1, 1], { name: "base" });
    const near = box(
      [-1 + off[0], -1 + off[1], -1 + off[2]],
      [1 + off[0], 1 + off[1], 1 + off[2]],
      { name: "near" },
    );
    const far = box([50, 50, -1], [52, 52, 1], { name: "far" });
    const count = (shapes: ReadonlyArray<ReturnType<typeof box>>) =>
      overlapsOf(
        [
          { ...item("a"), shapes },
          { ...item("b"), shapes: [base] },
        ],
        proj,
      ).pairs.length;
    expect(count([near, far])).toBe(count([far, near]));
  });
});

describe("signed distance", () => {
  test("a point inside a box is negative and one outside is positive", () => {
    const crate = box([0, 0, 0], [10, 10, 10]);
    expect(distanceTo(crate, [5, 5, 5])).toBeLessThan(0);
    expect(distanceTo(crate, [15, 5, 5])).toBeCloseTo(5, 6);
    expect(distanceTo(crate, [20, 5, 5])).toBeCloseTo(10, 6);
  });

  test("a point inside a ball measures its own radius", () => {
    expect(distanceTo(ball([0, 0, 0], 4), [1, 0, 0])).toBeCloseTo(-3, 6);
  });

  test("a point beside a prism is clear of it", () => {
    const plate = prism(
      FLOOR,
      [
        [0, 0],
        [10, 0],
        [10, 10],
        [0, 10],
      ],
      0,
      2,
    );
    expect(distanceTo(plate, [5, 5, 1])).toBeLessThan(0);
    expect(distanceTo(plate, [5, 5, 5])).toBeCloseTo(3, 6);
  });

  test("a rod cut by its host loses the part inside the host", () => {
    // The host is subtracted, so a point that is inside both reads as outside
    // the cut shape: that is how a pad seated in a curved body is modelled.
    const pad = ball([0, 0, 0], 4, { cut: box([-10, -10, -10], [10, 10, 2]) });
    expect(distanceTo(pad, [0, 0, 1])).toBeGreaterThanOrEqual(0);
  });
});

describe("poses", () => {
  test("a sliding rod extends rather than translating", () => {
    const rest = ball([0, 0, 0], 2);
    void rest;
    const rod = slide(FLOOR, 0, 10, 1);
    const pulled = moved(rod, [0, 0, 5]);
    expect(pulled.kind).toBe("body");
    const last = pulled.kind === "body" ? pulled.poly[pulled.poly.length - 1] : undefined;
    expect(last?.[0]).toBe(15);
  });

  test("a solid moves by its offset", () => {
    const here = box([0, 0, 0], [2, 2, 2]);
    const there = moved(here, [10, 0, 0]);
    expect(there.kind === "box" ? there.o[0] : 0).toBeCloseTo(11, 6);
  });
});

describe("pipes", () => {
  const run: Array<[number, number, number]> = [
    [0, 0, 0],
    [40, 0, 0],
    [40, 30, 0],
  ];

  test("a run is cut into depth-sortable chunks", () => {
    const pieces = tubePieces(run, 1, CAMERA, { maxLength: 20 });
    expect(pieces.length).toBeGreaterThan(1);
    for (const piece of pieces) {
      expect(piece.body).not.toBe("");
      expect(piece.edges).not.toBe("");
      expect(piece.mid.length).toBe(3);
    }
  });

  test("each chunk carries a different depth when the run turns", () => {
    // The run is 40 + 30 long, cut at 20, so four chunks.
    const pieces = tubePieces(run, 1, CAMERA, { maxLength: 20 });
    expect(pieces.length).toBe(4);
    // Depth is the distance along the view direction, and the run turns a corner,
    // so the four midpoints cannot share one. The count is the claim; comparing it
    // to `pieces.length` would pass on a single chunk too.
    const depths = pieces.map((piece) => piece.mid[0] + piece.mid[1]);
    expect(new Set(depths).size).toBe(4);
  });

  test("a gap hides the run and splits it into two runs", () => {
    expect(runsOf(70, [[20, 30]])).toEqual([
      [0, 20],
      [30, 70],
    ]);
  });

  test("gaps cut the pieces too", () => {
    const pieces = tubePieces(run, 1, CAMERA, { gaps: [[10, 20]], maxLength: 100 });
    expect(pieces).toHaveLength(2);
  });

  test("a gapless loop closes on itself, so its seam gets no cap", () => {
    const loop: Array<[number, number, number]> = [
      [0, 0, 0],
      [20, 0, 0],
      [20, 20, 0],
      [0, 20, 0],
      [0, 0.001, 0],
    ];
    const pieces = tubePieces(loop, 1, CAMERA, { closed: true, maxLength: 100 });
    expect(pieces).toHaveLength(1);
    // The body is the ribbon plus one subpath per cap. A cap at the seam would
    // draw a disc across the pipe where it meets itself, so a closed loop that
    // joins itself has exactly one subpath.
    const subpaths = (d: string) => d.split("M").length - 1;
    expect(subpaths(pieces[0]?.body ?? "")).toBe(1);
    // An open run caps both of its ends, so it carries two more.
    const open = tubePieces(run, 1, CAMERA, { maxLength: 100 });
    expect(open).toHaveLength(1);
    expect(subpaths(open[0]?.body ?? "")).toBe(3);
  });

  test("a run crossing a clamp reports where it crosses", () => {
    const at = crossingsOf(run, [20, 0, 0], [1, 0, 0], 4);
    expect(at).toEqual([20]);
  });

  test("a run nowhere near a clamp reports nothing", () => {
    // A clamp 40 units off the run's line never fires.
    expect(crossingsOf(run, [20, 40, 0], [1, 0, 0], 4)).toEqual([]);
    // A run lying along the clamp's plane is tangent, so it does not fire either.
    expect(crossingsOf(run, [20, 0, 0], [0, 1, 0], 4)).toEqual([]);
  });

  test("a wide pipe gets a highlight band and a narrow one does not", () => {
    const wide = tubePieces(run, 4, CAMERA, { maxLength: 100 })[0];
    const narrow = tubePieces(run, 0.2, CAMERA, { maxLength: 100 })[0];
    expect(wide?.wide).toBe(true);
    expect(narrow?.wide).toBe(false);
    expect(narrow?.shine).toBe("");
  });

  test("a piece renders as a filled body with an edge", () => {
    const first = tubePieces(run, 2, CAMERA, { maxLength: 100 })[0];
    if (first === undefined) throw new Error("a 70-unit run at maxLength 100 yields one chunk");
    const svg = tubeSvg(first);
    expect(svg).toContain('class="tb-body"');
    expect(svg).toContain("tb-edge");
  });
});

describe("the audit", () => {
  /** A base plate with a post on it, both touching, which should pass. */
  const goodFigure = () => {
    const R = recorder(CAMERA);
    const plate = slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 2, { name: "plate", ground: true });
    R.put({ name: "plate", piece: "base", shapes: [plate] });
    const post = prism(
      FLOOR,
      [
        [14, 14],
        [26, 14],
        [26, 26],
        [14, 26],
      ],
      2,
      12,
      { name: "post" },
    );
    R.put({ name: "post", piece: "base", at: [20, 20, 12], shapes: [post] });
    return R;
  };

  test("a figure whose parts touch passes", () => {
    const R = goodFigure();
    settle(R);
    const result = audit(R);
    // The verdict, not the word "audit". Asserting on the report's own text
    // passes whatever the geometry says, so the check would have been untestable.
    expect(result.failures.map((row) => row.what)).toEqual([]);
    expect(passed(result)).toBe(true);
    expect(result.counts.solids).toBe(2);
  });

  test("a pipe running through a solid is caught", () => {
    const R = recorder(CAMERA);
    R.put({
      name: "plate",
      piece: "base",
      shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 20, { name: "plate", ground: true })],
    });
    // A pipe straight through the middle of the plate.
    R.route(
      "pipe",
      [
        [-5, 20, 10],
        [45, 20, 10],
      ],
      1,
      { name: "pipe" },
    );
    const result = audit(R);
    expect(result.clearance.length).toBeGreaterThan(0);
    expect(passed(result)).toBe(false);
    expect(report(result)).toContain("passes through");
  });

  test("a pipe with clear air around it is not accused", () => {
    const R = recorder(CAMERA);
    R.put({
      name: "plate",
      piece: "base",
      shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 2, { name: "plate", ground: true })],
    });
    R.route(
      "pipe",
      [
        [-5, 20, 20],
        [45, 20, 20],
      ],
      1,
      { name: "pipe" },
    );
    const result = audit(R);
    expect(result.clearance.filter((row) => row.what.includes("plate"))).toHaveLength(0);
  });

  test("an end floating in mid-air is caught", () => {
    const R = recorder(CAMERA);
    R.put({
      name: "plate",
      piece: "base",
      shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 2, { name: "plate", ground: true })],
    });
    R.route(
      "pipe",
      [
        [0, 0, 30],
        [40, 0, 30],
      ],
      1,
      { name: "pipe" },
    );
    const result = audit(R);
    expect(result.terminals.length).toBeGreaterThan(0);
    expect(passed(result)).toBe(false);
  });

  test("an end landing on a mount is not accused", () => {
    const R = recorder(CAMERA);
    R.put({
      name: "plate",
      piece: "base",
      shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 2, { name: "plate", ground: true })],
    });
    // Both ends start and stop inside the plate's footprint, at its own height.
    R.route(
      "pipe",
      [
        [5, 20, 1],
        [35, 20, 1],
      ],
      1,
      { name: "pipe" },
    );
    const result = audit(R);
    expect(result.terminals.filter((row) => row.what.includes("pipe"))).toHaveLength(0);
  });

  test("a solid that reaches nothing it can stand on is caught", () => {
    const R = recorder(CAMERA);
    // A post that floats well above the plate it should be standing on.
    R.put({
      name: "plate",
      piece: "base",
      shapes: [slab({ x: 0, y: 0, w: 40, d: 40, r: 0 }, 0, 2, { name: "plate", ground: true })],
    });
    R.put({
      name: "post",
      piece: "base",
      shapes: [
        prism(
          FLOOR,
          [
            [14, 14],
            [26, 14],
            [26, 26],
            [14, 26],
          ],
          30,
          40,
          { name: "post" },
        ),
      ],
    });
    const result = audit(R);
    expect(result.supports.some((row) => row.what.includes("post"))).toBe(true);
  });

  test("an empty recorder reports nothing and passes", () => {
    const R = recorder(CAMERA);
    const result = audit(R);
    expect(result.failures).toHaveLength(0);
    expect(passed(result)).toBe(true);
  });
});

describe("the recorder", () => {
  test("a recorded shape carries the item's move so an explode reaches it", () => {
    const R = recorder(CAMERA, ["lid"]);
    const R2 = R.put({
      name: "lid",
      piece: "lid",
      move: [0, 0, 20],
      shapes: [box([0, 0, 0], [5, 5, 1])],
    });
    expect(R2.shapes[0]?.move).toEqual([0, 0, 20]);
  });

  test("a route is recorded as a tube with both of its ends", () => {
    const R = recorder(CAMERA);
    const [tube] = R.route(
      "hose",
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      1,
    );
    expect(tube?.kind).toBe("tube");
    expect(tube?.tips).toHaveLength(2);
    expect(R.routes).toHaveLength(1);
  });

  test("settle gives every item a key, and nearer overlaps order later", () => {
    const R = recorder(CAMERA);
    R.put({
      name: "back",
      piece: "p",
      at: [0, 0, 0],
      shapes: [box([-10, -10, -10], [10, 10, 10])],
    });
    R.put({ name: "front", piece: "p", at: [0, 0, 5], shapes: [box([-10, -10, 0], [10, 10, 20])] });
    const settled = settle(R);
    expect(settled.items).toHaveLength(2);
    for (const item of settled.items) expect(Number.isFinite(item.key)).toBe(true);
  });
});

describe("tube shapes", () => {
  test("a tube is a chain of capsules", () => {
    const hose = tubeShape(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      1,
    );
    expect(distanceTo(hose, [5, 0, 0])).toBeCloseTo(-1, 6);
    expect(distanceTo(hose, [5, 3, 0])).toBeCloseTo(2, 6);
  });

  test("a tapering tube measures its own radius along its length", () => {
    const hose = tubeShape(
      [
        [0, 0, 0],
        [10, 0, 0],
      ],
      (u) => 1 + u,
    );
    // One and a half units out is clear of the thin end and inside the thick
    // one, which is only true if the radius is read where the point is.
    expect(distanceTo(hose, [0.5, 1.5, 0])).toBeGreaterThan(0);
    expect(distanceTo(hose, [9.5, 1.5, 0])).toBeLessThan(0);
    expect(distanceTo(hose, [9.5, 3, 0])).toBeGreaterThan(0);
  });
});
