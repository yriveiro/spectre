import { describe, expect, test } from "bun:test";

/**
 * A differential test against the upstream implementation.
 *
 * The kit is a port, so the honest question is not "does it look right" but "does
 * it agree with the thing it was ported from". These run both on the same input
 * and compare, so a divergence cannot survive as a judgement call.
 *
 * The originals are vendored under `test/fixtures/anatomy-kit/` by the
 * `anatomy-kit.sync` script. When they are absent the suite skips rather than
 * fails, because a missing fixture is a missing checkout, not a wrong drawing.
 */
import { existsSync } from "node:fs";
import { join } from "node:path";

const UPSTREAM = join(import.meta.dir, "..", "fixtures", "anatomy-kit");
const present = existsSync(join(UPSTREAM, "iso-kit.mjs"));

const suite = present ? describe : describe.skip;

const PORTED = "../..";
const upstream = async () => await import(join(UPSTREAM, "iso-kit.mjs"));
const latheUpstream = async () => await import(join(UPSTREAM, "lathe.mjs"));

const CAMERA = { origin: [200, 200], scale: 8, azimuth: 45, elevation: 30 };

suite("the port agrees with the upstream kit", () => {
  test("the projection is identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    for (const point of [
      [0, 0, 0],
      [1, 0, 0],
      [0, 1, 0],
      [0, 0, 1],
      [3, -2, 7],
    ] as const)
      expect(mine.iso(point as never, CAMERA as never)).toEqual(theirs.iso(point, CAMERA as never));
    expect(mine.towardViewer(CAMERA as never)).toEqual(theirs.towardViewer(CAMERA as never));
  });

  test("an extruded slab's paths are identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const plan = { x: 0, y: 0, w: 40, d: 30, r: 4 };
    const got = mine.slabOf(plan, 0, 6, CAMERA as never);
    const want = theirs.slabOf(plan, 0, 6, CAMERA as never);
    // `runsOf` emitting a run once instead of once per vertex is what makes
    // these equal; the outline was drawn k times over before.
    expect(got.outline).toBe(want.outline);
    expect(got.crease).toBe(want.crease);
    expect(got.fill).toBe(want.fill);
    expect(got.top).toBe(want.top);
    expect(got.shades).toEqual(want.shades);
  });

  test("a bevelled slab's bevel is identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const plan = { x: 0, y: 0, w: 40, d: 30, r: 4 };
    expect(mine.slabOf(plan, 0, 6, CAMERA as never, 8, 1.2).bevel).toBe(
      theirs.slabOf(plan, 0, 6, CAMERA as never, 8, 1.2).bevel,
    );
  });

  test("a cylinder's paths are identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const got = mine.cylinder(12, 8, 5, 0, 9, CAMERA as never, 32, 0.8);
    const want = theirs.cylinder(12, 8, 5, 0, 9, CAMERA as never, 32, 0.8);
    expect(got.outline).toBe(want.outline);
    expect(got.shades).toEqual(want.shades);
    expect(got.top).toBe(want.top);
  });

  test("ruler ticks mark every fifth one major, not all of them", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const got = mine.topTicks(0, 20, 2, 5, 0, 10, [2, 4] as never, CAMERA as never);
    const want = theirs.topTicks(0, 20, 2, 5, 0, 10, [2, 4], CAMERA as never);
    // A frozen index gave every tick the first station's verdict, so `minor`
    // came back empty and every tick drew major.
    expect(got.major).toBe(want.major);
    expect(got.minor).toBe(want.minor);
    expect(got.minor).not.toBe("");
  });

  test("a turned body puts its smooth shading in the side shades", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/shade`),
      latheUpstream(),
    ]);
    const profile: Array<[number, number] | [number, number, number]> = [
      [0, 0],
      [0, 4, 1],
      [6, 6, 1],
      [12, 3, 1],
      [12, 0],
    ];
    const frame = theirs.frameAlong([0, 0, 0], [0, 0, 1]);
    const got = mine.lathe(profile, frame as never, CAMERA as never);
    const want = theirs.lathe(profile, frame as never, CAMERA as never);
    // Routing every smoothed path into the top bucket left four empty shades.
    expect(got.shades).toEqual(want.shades);
    expect(got.shades.filter((shade: string) => shade !== "").length).toBeGreaterThan(0);
    expect(got.fill).toBe(want.fill);
    expect(got.outline).toBe(want.outline);
  });

  test("a faceted turned body is identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/shade`),
      latheUpstream(),
    ]);
    const profile: Array<[number, number]> = [
      [0, 0],
      [0, 5],
      [8, 5],
      [8, 0],
    ];
    const frame = theirs.frameAlong([0, 0, 0], [0, 0, 1]);
    const got = mine.lathe(profile, frame as never, CAMERA as never);
    const want = theirs.lathe(profile, frame as never, CAMERA as never);
    expect(got.shades).toEqual(want.shades);
    expect(got.fill).toBe(want.fill);
  });

  test("the curved helpers agree", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    for (const plan of [
      { x: 0, y: 0, w: 10, d: 20, r: 0 },
      { x: -3, y: 2, w: 40, d: 30, r: 4 },
    ]) {
      expect(mine.roundedPlan(plan as never, 8)).toEqual(theirs.roundedPlan(plan as never, 8));
      expect(mine.insetPlan(plan as never, 2)).toEqual(theirs.insetPlan(plan as never, 2));
    }
    expect(mine.circleRing(3, 4, 5, 12)).toEqual(theirs.circleRing(3, 4, 5, 12));
  });

  test("the parts library agrees", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    expect(mine.knurl(0, 0, 6, 0, 8, 24, CAMERA as never)).toBe(
      theirs.knurl(0, 0, 6, 0, 8, 24, CAMERA as never),
    );
    expect(mine.sideArc(0, 0, 5, 3, CAMERA as never)).toBe(
      theirs.sideArc(0, 0, 5, 3, CAMERA as never),
    );
    expect(mine.planOutline({ x: 0, y: 0, w: 10, d: 10, r: 2 }, 2, CAMERA as never)).toBe(
      theirs.planOutline({ x: 0, y: 0, w: 10, d: 10, r: 2 }, 2, CAMERA as never),
    );
    expect(mine.radialTicks(0, 0, 10, 24, 6, 2, [1, 2], CAMERA as never)).toEqual(
      theirs.radialTicks(0, 0, 10, 24, 6, 2, [1, 2], CAMERA as never),
    );
    expect(mine.coil(0, 20, [0, 5], 2, 6, "x", CAMERA as never)).toEqual(
      theirs.coil(0, 20, [0, 5], 2, 6, "x", CAMERA as never),
    );
  });

  test("a coil splits front from back without bleeding one sample", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const got = mine.coil(0, 20, [0, 5], 2, 6, "x", CAMERA as never);
    const want = theirs.coil(0, 20, [0, 5], 2, 6, "x", CAMERA as never);
    expect(got.back).toBe(want.back);
    expect(got.front).toBe(want.front);
  });

  test("the curve fit refuses a profile that does not rise", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/lathe`),
      latheUpstream(),
    ]);
    const profile: Array<[number, number, number]> = [
      [0, 0, 1],
      [0, 2, 1],
      [5, 3, 1],
    ];
    // A zero-length step is a disc rim; fitting through it divides by zero.
    for (const runs of [mine.curveRuns(profile as never), theirs.curveRuns(profile as never)])
      expect(runs.some((run: unknown) => run !== null)).toBe(false);
  });

  test("the tone bands and cull thresholds agree", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/lathe`),
      latheUpstream(),
    ]);
    for (const score of [-1, -0.1, 0, 0.1, 0.25, 0.5, 0.7, 1])
      expect(mine.bandOf(score)).toBe(theirs.bandOf(score));
    for (const value of [0, 0.05, 0.5, 1])
      expect(mine.fadeOf(value, [0.1, 0.55] as never)).toBe(theirs.fadeOf(value, [0.1, 0.55]));
    expect(mine.frameAlong([1, 2, 3], [0, 0, 1] as never)).toEqual(
      theirs.frameAlong([1, 2, 3], [0, 0, 1]),
    );
    expect(mine.frameAlong([0, 0, 0], [0.9, 0.1, 0.2] as never)).toEqual(
      theirs.frameAlong([0, 0, 0], [0.9, 0.1, 0.2]),
    );
  });

  test("the monotone Hermite slopes agree", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/lathe`),
      latheUpstream(),
    ]);
    const profile: Array<[number, number, number]> = [
      [0, 1, 1],
      [2, 4, 1],
      [3, 4, 1],
      [7, 2, 1],
    ];
    expect(
      mine
        .curveRuns(profile as never)
        .map((run: { radius: (s: number) => number } | null) => run?.radius(1.5)),
    ).toEqual(
      theirs
        .curveRuns(profile as never)
        .map((run: { radius: (s: number) => number } | null) => run?.radius(1.5)),
    );
    expect(
      mine
        .curveRuns(profile as never)
        .map((run: { slope: (s: number) => number } | null) => run?.slope(1.5)),
    ).toEqual(
      theirs
        .curveRuns(profile as never)
        .map((run: { slope: (s: number) => number } | null) => run?.slope(1.5)),
    );
  });

  test("the pipe builder agrees", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/tube`),
      import(join(UPSTREAM, "tube.mjs")),
    ]);
    const run: Array<[number, number, number]> = [
      [0, 0, 0],
      [40, 0, 0],
      [40, 30, 0],
    ];
    expect(mine.runsOf(70, [[20, 30]] as never)).toEqual(theirs.runsOf(70, [[20, 30]]));
    const got = mine.tubePieces(run, 1, CAMERA as never, { maxLength: 20 });
    const want = theirs.tubePieces(run, 1, CAMERA as never, { maxLength: 20 });
    expect(got.map((piece: { from: number }) => piece.from)).toEqual(
      want.map((piece: { from: number }) => piece.from),
    );
    expect(got.map((piece: { to: number }) => piece.to)).toEqual(
      want.map((piece: { to: number }) => piece.to),
    );
    expect(got.map((piece: { body: string }) => piece.body)).toEqual(
      want.map((piece: { body: string }) => piece.body),
    );
    expect(got.map((piece: { edges: string }) => piece.edges)).toEqual(
      want.map((piece: { edges: string }) => piece.edges),
    );
    // The bands come off a second polyline cut at twice the lead, and they close
    // over a capped end. Comparing body and edges alone left both untested.
    expect(got.map((piece: { shine: string }) => piece.shine)).toEqual(
      want.map((piece: { shine: string }) => piece.shine),
    );
    expect(got.map((piece: { shade: string }) => piece.shade)).toEqual(
      want.map((piece: { shade: string }) => piece.shade),
    );
  });

  test("the clamp crossings agree", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/tube`),
      import(join(UPSTREAM, "tube.mjs")),
    ]);
    const run: Array<[number, number, number]> = [
      [0, 0, 0],
      [40, 0, 0],
      [40, 30, 0],
    ];
    expect(mine.crossingsOf(run, [20, 0, 0] as never, [1, 0, 0] as never, 4)).toEqual(
      theirs.crossingsOf(run, [20, 0, 0], [1, 0, 0], 4),
    );
    expect(mine.crossingsOf(run, [20, 40, 0] as never, [1, 0, 0] as never, 4)).toEqual(
      theirs.crossingsOf(run, [20, 40, 0], [1, 0, 0], 4),
    );
  });

  test("the SVG renderers are byte-identical", async () => {
    const [mine, theirs] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/iso-kit`),
      upstream(),
    ]);
    const [render, renderUpstream] = await Promise.all([
      import(`${PORTED}/tools/definitions/anatomy/kit/render`),
      import(join(UPSTREAM, "iso-kit.mjs")),
    ]);
    void renderUpstream;
    const paths = mine.slabOf({ x: 0, y: 0, w: 20, d: 20, r: 2 }, 0, 4, CAMERA as never);
    expect(render.solidSvg(paths as never, { tone: "hi" })).toBe(
      (theirs as never as { solidSvg: (p: unknown, o: unknown) => string }).solidSvg(paths, {
        tone: "hi",
      }),
    );
    expect(render.lineSvg("M0 0L10 10", { tone: "lo" })).toBe(
      (theirs as never as { lineSvg: (d: string, o: unknown) => string }).lineSvg("M0 0L10 10", {
        tone: "lo",
      }),
    );
  });
});
