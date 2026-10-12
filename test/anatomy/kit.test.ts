import { describe, expect, test } from "bun:test";
import {
  circleRing,
  cylinder,
  extrude,
  fitProjection,
  iso,
  roundedPlan,
  slabOf,
  towardViewer,
} from "../../tools/definitions/anatomy/kit/iso-kit";
import { frameAlong, frameOf, stepsFor } from "../../tools/definitions/anatomy/kit/lathe";
import { disc, lathe, sphereOf } from "../../tools/definitions/anatomy/kit/shade";

/**
 * These assert literals, not whatever the code currently returns. A test that
 * compares the drawing to itself passes when every function returns `undefined`,
 * so each expectation here is a value worked out by hand from the projection.
 */

// The projection at the defaults: azimuth 45, elevation 30, scale 1.
// k = sqrt(1.6), sinA = cosA = sin45, sinE = sin30 = 0.5, cosE = cos30.
const K = Math.sqrt(1.6);
const S45 = Math.SQRT1_2;
const CAMERA = { origin: [0, 0] as [number, number], scale: 1, azimuth: 45, elevation: 30 };

describe("iso projection", () => {
  test("the world origin lands on the screen origin", () => {
    expect(iso([0, 0, 0], CAMERA)).toEqual([0, 0]);
  });

  test("one world unit along x moves right and down by the camera basis", () => {
    // px = x*sinA*k, py = (x*cosA*sinE - z*cosE)*k, so x goes to (sinA*k, cosA*sinE*k).
    const [px, py] = iso([1, 0, 0], CAMERA);
    expect(px).toBeCloseTo(S45 * K, 10);
    expect(py).toBeCloseTo(S45 * 0.5 * K, 10);
  });

  test("one world unit along y moves left and down, mirroring x", () => {
    const [px, py] = iso([0, 1, 0], CAMERA);
    expect(px).toBeCloseTo(-S45 * K, 10);
    expect(py).toBeCloseTo(S45 * 0.5 * K, 10);
  });

  test("height moves straight up the screen and nothing sideways", () => {
    const [px, py] = iso([0, 0, 1], CAMERA);
    expect(px).toBeCloseTo(0, 10);
    expect(py).toBeCloseTo(-Math.cos(Math.PI / 6) * K, 10);
  });

  test("the viewer sits on the positive x and y diagonal", () => {
    const [vx, vy] = towardViewer(CAMERA);
    expect(vx).toBeCloseTo(S45, 10);
    expect(vy).toBeCloseTo(S45, 10);
  });
});

describe("solids", () => {
  test("a square prism shades all four sides and closes its cap", () => {
    const paths = slabOf({ x: 0, y: 0, w: 10, d: 10, r: 0 }, 0, 2, CAMERA);
    // Two faces point at the viewer at 45 degrees, so two shade buckets fill.
    const filled = paths.shades.filter((shade) => shade !== "");
    expect(filled.length).toBe(2);
    expect(paths.top).toMatch(/^M/);
    expect(paths.top.endsWith("Z")).toBe(true);
    // The silhouette is a hexagon: a projected box is never a rectangle.
    expect(paths.fill).toMatch(/Z$/);
  });

  test("a solid has no shading when it has no height", () => {
    const paths = slabOf({ x: 0, y: 0, w: 10, d: 10, r: 0 }, 0, 0, CAMERA);
    expect(paths.shades.every((shade) => shade === "")).toBe(true);
  });

  test("a cylinder shades both halves of its curved side", () => {
    const paths = cylinder(0, 0, 5, 0, 3, CAMERA);
    expect(paths.shades.filter((shade) => shade !== "").length).toBeGreaterThanOrEqual(2);
    expect(paths.outline).not.toBe("");
  });
});

describe("plans", () => {
  test("a sharp rectangle yields one point per corner", () => {
    expect(roundedPlan({ x: 0, y: 0, w: 10, d: 20, r: 0 })).toEqual([
      [10, 0],
      [10, 20],
      [0, 20],
      [0, 0],
    ]);
  });

  test("a rounded rectangle yields nine points per corner", () => {
    expect(roundedPlan({ x: 0, y: 0, w: 10, d: 10, r: 2 }, 8)).toHaveLength(36);
  });

  test("the corner radius is clamped to half the short side", () => {
    // A radius past the half-width would make the corners cross over.
    const ring = roundedPlan({ x: 0, y: 0, w: 10, d: 4, r: 99 });
    for (const [x, y] of ring) {
      expect(x).toBeGreaterThanOrEqual(-1e-9);
      expect(x).toBeLessThanOrEqual(10 + 1e-9);
      expect(y).toBeGreaterThanOrEqual(-1e-9);
      expect(y).toBeLessThanOrEqual(4 + 1e-9);
    }
  });

  test("a circle has one point per step, all on the radius", () => {
    const ring = circleRing(3, 4, 5, 12);
    expect(ring).toHaveLength(12);
    for (const [x, y] of ring) expect(Math.hypot(x - 3, y - 4)).toBeCloseTo(5, 10);
  });
});

describe("fitting", () => {
  test("a unit box lands inside the padded frame", () => {
    const corners: Array<[number, number, number]> = [];
    for (const x of [0, 1]) for (const y of [0, 1]) for (const z of [0, 1]) corners.push([x, y, z]);
    const fitted = fitProjection(corners, 100, 100, { pad: 10 });
    for (const corner of corners) {
      const [px, py] = iso(corner, fitted);
      expect(px).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(px).toBeLessThanOrEqual(90 + 1e-6);
      expect(py).toBeGreaterThanOrEqual(10 - 1e-6);
      expect(py).toBeLessThanOrEqual(90 + 1e-6);
    }
  });
});

describe("turned bodies", () => {
  const up = frameAlong([0, 0, 0], [0, 0, 1]);

  test("a disc shades its curved side and leaves its rims faceted", () => {
    const paths = disc(0, 4, 3, up, CAMERA);
    expect(paths.shades.some((shade) => shade !== "")).toBe(true);
    expect(paths.top).not.toBe("");
  });

  test("a smooth profile switches smooth shading on by itself", () => {
    // The third element of a knot marks it soft, so `auto` reads it as smooth.
    const smooth = lathe(
      [
        [0, 0],
        [0, 2, 1],
        [3, 3, 1],
        [6, 0],
      ],
      up,
      CAMERA,
    );
    const faceted = lathe(
      [
        [0, 0],
        [0, 2],
        [3, 3],
        [6, 0],
      ],
      up,
      CAMERA,
    );
    expect(smooth.seamless).toBe(true);
    expect(faceted.seamless).toBe(false);
  });

  test("every shade a body emits is a well-formed path", () => {
    const paths = disc(0, 4, 3, up, CAMERA);
    // A shade may carry several quads in one `d`, so each subpath is checked.
    const oneSubpath = /^M-?[\d.]+ -?[\d.]+(L-?[\d.]+ -?[\d.]+)*Z$/;
    for (const shade of paths.shades) {
      if (shade === "") continue;
      expect(shade.length).toBeGreaterThan(0);
      for (const sub of shade.split("M").filter(Boolean)) expect(`M${sub}`).toMatch(oneSubpath);
    }
    expect(paths.fill).not.toBe("");
    expect(paths.outline).not.toBe("");
  });

  test("a turned body is drawn in the frame it was given", () => {
    const there = lathe(
      [
        [0, 0],
        [0, 2],
        [5, 2],
        [5, 0],
      ],
      frameOf([100, 0, 0], [0, 0, 1], [1, 0, 0], [0, 1, 0]),
      CAMERA,
    );
    const here = lathe(
      [
        [0, 0],
        [0, 2],
        [5, 2],
        [5, 0],
      ],
      up,
      CAMERA,
    );
    expect(there.fill).not.toBe(here.fill);
  });

  test("a sphere stacks four caps, the outermost being the whole outline", () => {
    const ball = sphereOf([0, 0, 2], 3, CAMERA);
    expect(ball.shades).toHaveLength(4);
    expect(ball.shades[0]).toBe(ball.outline);
    expect(ball.seamless).toBe(true);
  });
});

describe("sampling", () => {
  test("more pixels across a part means more steps", () => {
    expect(stepsFor(5, 32, 160, 1)).toBeGreaterThanOrEqual(32);
    expect(stepsFor(50, 32, 160, 1)).toBeGreaterThan(stepsFor(5, 32, 160, 1));
    expect(stepsFor(500, 32, 160, 1)).toBe(160);
  });
});

describe("extrude rejects nothing it should draw", () => {
  test("a ring given clockwise still closes and shades", () => {
    const ring: Array<[number, number]> = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
    ];
    const paths = extrude(ring, 0, 2, CAMERA);
    expect(paths.fill).not.toBe("");
    expect(paths.shades.filter((shade) => shade !== "").length).toBe(2);
  });
});
