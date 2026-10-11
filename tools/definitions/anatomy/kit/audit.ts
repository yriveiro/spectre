/**
 * The geometry prover.
 *
 * Every check here answers one question with a number, not a judgment: does this
 * pipe pass through that solid, does that crossing draw in the right order, does
 * every end land on something. The figures are recorded as shapes rather than
 * markup, because a stand-in shape that covers less than most of the drawing is
 * how a real interlock gets silenced.
 */

import type { Plan, Point3, Projection } from "./iso-kit";
import { cameraOf, iso, roundedPlan } from "./iso-kit";
import type { Frame, Meridian, V2, V3 } from "./lathe";
import { cross3, curveRuns, dot3, mul3, pathLength, sub3, tangentAlong, unit3 } from "./lathe";
import type { TubePiece } from "./tube";

const EPS = 1e-9;
const BIG = 1e9;

/** Ray-cast resolution. */
const RAY_EPS = 0.02;
const RAY_STEPS = 160;
/** Painter's keys must clear a smaller gap than a pixel, so one wins everywhere. */
const KEY_GAP = 0.02;
const OVERLAP_LEAST = 0.25;
/** Two solids this close are touching: parts meet flush, tangent or rim-on. */
const TOUCH = 0.2;
/** Key-relaxation passes before the solver gives up. One more than the item count. */
const RELAX_PASSES = 400;

export type Shape = BodyShape | PrismShape | BoxShape | BallShape | TubeShape;

interface Meta {
  readonly name?: string;
  readonly move?: V3;
  readonly ride?: string;
  readonly piece?: string;
  readonly seated?: boolean;
  readonly cut?: Shape | ReadonlyArray<Shape>;
  readonly ground?: boolean;
  readonly touch?: ReadonlyArray<string>;
}

export interface BodyShape extends Meta {
  readonly kind: "body";
  readonly F: Frame;
  readonly poly: ReadonlyArray<readonly [number, number]>;
  readonly slide?: { from: number; to: number; r: number };
}

export interface PrismShape extends Meta {
  readonly kind: "prism";
  readonly F: Frame;
  readonly poly: ReadonlyArray<readonly [number, number]>;
  readonly s0: number;
  readonly s1: number;
}

export interface BoxShape extends Meta {
  readonly kind: "box";
  readonly o: V3;
  readonly axes: readonly [V3, V3, V3];
  readonly half: V3;
}

export interface BallShape extends Meta {
  readonly kind: "ball";
  readonly o: V3;
  readonly r: number;
}

export interface TubeShape extends Meta {
  readonly kind: "tube";
  readonly points: ReadonlyArray<V3>;
  readonly radii: ReadonlyArray<number>;
  readonly round: readonly [boolean, boolean];
  readonly tips: ReadonlyArray<V3 | null>;
  readonly free: readonly [boolean, boolean];
}

export interface Item {
  readonly name: string;
  readonly piece: string;
  readonly ride: string;
  readonly move: V3;
  readonly shapes: ReadonlyArray<Shape>;
  key: number;
}

export const body = (
  F: Frame,
  poly: ReadonlyArray<readonly number[]>,
  meta: Meta = {},
): BodyShape => ({
  kind: "body",
  F,
  poly: poly.map((knot): BodyShape["poly"][number] => [knot[0] ?? 0, Math.max(0, knot[1] ?? 0)]),
  ...meta,
});

/** Subdivide a curved run so the recorded shape follows the curve, not its chords. */
const traced = (meridian: Meridian, radius?: ((s: number) => number) | null): BodyShape["poly"] => {
  const out: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < meridian.length; index += 1) {
    const m0 = meridian[index] as Meridian[number];
    const m1 = meridian[index + 1] as Meridian[number];
    out.push([m0[0], m0[1]]);
    const along = m1[0] - m0[0];
    const at =
      radius !== undefined && radius !== null
        ? radius
        : Math.abs(along) > EPS
          ? (curveRuns(meridian)[index]?.radius ?? null)
          : null;
    if (!at) continue;
    const split = (a: number, b: number, level: number) => {
      if (level >= 6) return;
      const mid = (a + b) / 2;
      const value = at(m0[0] + along * mid);
      if (Math.abs(value - (at(m0[0] + along * a) + at(m0[0] + along * b)) / 2) <= 0.02) return;
      split(a, mid, level + 1);
      out.push([m0[0] + along * mid, value]);
      split(mid, b, level + 1);
    };
    split(0, 1, 0);
  }
  out.push([
    (meridian[meridian.length - 1] as Meridian[number])[0],
    (meridian[meridian.length - 1] as Meridian[number])[1],
  ]);
  return out;
};

export const FLOOR: Frame = { o: [0, 0, 0], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };

export const latheShape = (
  F: Frame,
  meridian: Meridian,
  meta: Meta = {},
  radius?: ((s: number) => number) | null,
): BodyShape => body(F, traced(meridian, radius) as Meridian, meta);

export const prism = (
  F: Frame,
  polygon: ReadonlyArray<readonly [number, number]>,
  s0: number,
  s1: number,
  meta: Meta = {},
): PrismShape => ({
  kind: "prism",
  F,
  poly: polygon.map(([x, y]) => [x, y] as const),
  s0: Math.min(s0, s1),
  s1: Math.max(s0, s1),
  ...meta,
});

export const slab = (
  plan: Plan,
  z: number,
  height: number,
  meta: Meta = {},
  steps = 8,
): PrismShape => prism(FLOOR, roundedPlan(plan, steps), z, z + height, meta);

export const box = (min: V3, max: V3, meta: Meta = {}): BoxShape => ({
  kind: "box",
  o: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, (min[2] + max[2]) / 2],
  axes: [
    [1, 0, 0],
    [0, 1, 0],
    [0, 0, 1],
  ],
  half: [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2],
  ...meta,
});

export const ball = (at: V3, r: number, meta: Meta = {}): BallShape => ({
  kind: "ball",
  o: at,
  r,
  ...meta,
});

export const tubeShape = (
  points: ReadonlyArray<V3>,
  radius: number | ((u: number) => number),
  meta: Meta & { round?: readonly [boolean, boolean] } = {},
): TubeShape => {
  const total = pathLength(points) || 1;
  const lengths: number[] = [0];
  for (let index = 1; index < points.length; index += 1)
    lengths.push(
      (lengths[index - 1] as number) + dist(points[index] as V3, points[index - 1] as V3),
    );
  const radii =
    typeof radius === "number"
      ? points.map(() => radius)
      : points.map((_, index) => radius((lengths[index] as number) / total));
  return {
    kind: "tube",
    points: points.map((point) => [...point] as V3),
    radii,
    round: meta.round ?? [false, false],
    tips: [points[0] ?? null, points[points.length - 1] ?? null],
    free: [false, false],
    ...meta,
  };
};

/**
 * The remaining stock shapes, each a profile on the floor frame.
 *
 * A figure is drawn from `slabOf`, `cylinder` and `disc`, so a caller recording
 * what it drew reaches for the same names. Recording a cylinder as a box would
 * measure its corners rather than its curve.
 */
export const discShape = (
  F: Frame,
  s0: number,
  s1: number,
  r: number,
  meta: Meta = {},
): BodyShape =>
  body(
    F,
    [
      [s0, 0],
      [s0, r],
      [s1, r],
      [s1, 0],
    ],
    meta,
  );

/** A ring is a hollow tube section, so a point in its bore is outside it. */
export const ringShape = (
  F: Frame,
  s0: number,
  s1: number,
  rIn: number,
  rOut: number,
  meta: Meta = {},
): BodyShape =>
  body(
    F,
    [
      [s0, rIn],
      [s0, rOut],
      [s1, rOut],
      [s1, rIn],
    ],
    meta,
  );

/** A cylinder standing on the floor: a disc whose frame is the world. */
export const cylinderShape = (
  cx: number,
  cy: number,
  r: number,
  z: number,
  height: number,
  meta: Meta = {},
): BodyShape =>
  body(
    { o: [cx, cy, 0], a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] },
    [
      [z, 0],
      [z, r],
      [z + height, r],
      [z + height, 0],
    ],
    meta,
  );

/** A prism from an explicit ring, for a footprint that is not a rounded rectangle. */
export const extrudedShape = (
  ring: ReadonlyArray<readonly [number, number]>,
  z: number,
  height: number,
  meta: Meta = {},
): PrismShape => prism(FLOOR, ring, z, z + height, meta);

/** A closed body, so a profile with open ends still measures as a solid. */
export const solidShape = (
  F: Frame,
  profile: Meridian,
  meta: Meta = {},
  radius?: ((s: number) => number) | null,
): BodyShape =>
  body(
    F,
    [
      [profile[0]?.[0] ?? 0, 0],
      ...traced(profile, radius ?? null),
      [profile[profile.length - 1]?.[0] ?? 0, 0],
    ],
    meta,
  );

/** A box on its own axes, for a part rotated away from the world grid. */
export const orientedBoxShape = (
  centre: V3,
  axes: readonly [V3, V3, V3],
  half: V3,
  meta: Meta = {},
): BoxShape => ({
  kind: "box",
  o: centre,
  axes: axes.map((one) => unit3(one)) as unknown as readonly [V3, V3, V3],
  half,
  ...meta,
});

/** A rod that slides out of a gland: the audit extends it rather than moving it. */
export const slide = (
  F: Frame,
  from: number,
  to: number,
  r: number,
  meta: Meta = {},
): BodyShape => ({
  kind: "body",
  F,
  poly: [
    [from, 0],
    [from, r],
    [to, r],
    [to, 0],
  ],
  slide: { from, to, r },
  ...meta,
});

const dist = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const pointSegment = (p: V2, a: V2, b: V2): number => {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  const t =
    length < 1e-12
      ? 0
      : Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / (length * length)));
  return Math.hypot(p[0] - (a[0] + dx * t), p[1] - (a[1] + dy * t));
};

/** Even-odd crossing count, so the sign tells inside from outside. */
const inPolygon = (p: V2, poly: ReadonlyArray<readonly [number, number]>): boolean => {
  let inside = false;
  for (let index = 0, j = poly.length - 1; index < poly.length; j = index, index += 1) {
    const a = poly[index];
    const b = poly[j];
    if (!a || !b) continue;
    if (
      a[1] > p[1] !== b[1] > p[1] &&
      p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1] || 1e-12) + a[0]
    )
      inside = !inside;
  }
  return inside;
};

const profileDistance = (p: V3, F: Frame, poly: BodyShape["poly"]): number => {
  const q = sub3(p, F.o);
  const s = dot3(q, F.a);
  const x = dot3(q, F.u);
  const y = dot3(q, F.v);
  let radial = Infinity;
  const count = poly.length;
  // The loop wraps: a ring profile's inner wall IS the closing edge, and dropping
  // it puts a point on the surface a whole radius away from the surface.
  for (let index = 0; index < count; index += 1) {
    const a = poly[index] as readonly [number, number];
    const b = poly[(index + 1) % count] as readonly [number, number];
    if (a[1] <= 1e-9 && b[1] <= 1e-9) continue;
    radial = Math.min(radial, pointSegment([s, Math.hypot(x, y)], [a[0], a[1]], [b[0], b[1]]));
  }
  if (radial === Infinity) return BIG;
  const first = poly[0];
  const last = poly[poly.length - 1];
  return s < (first?.[0] ?? 0) || s > (last?.[0] ?? 0)
    ? radial
    : radial * (inPolygon([s, Math.hypot(x, y)], poly) ? -1 : 1);
};

const polygonDistance = (p: V2, poly: ReadonlyArray<PrismShape["poly"][number]>): number => {
  let best = Infinity;
  for (let index = 0; index < poly.length; index += 1)
    best = Math.min(
      best,
      pointSegment(p, poly[index] as V2, poly[(index + 1) % poly.length] as V2),
    );
  return best * (inPolygon(p, poly) ? -1 : 1);
};

/** Distance to a capped tube segment, the standard capsule form, radius tapering along it. */
const capsuleDistance = (p: V3, a: V3, b: V3, rA: number, rB: number): number => {
  const pa = sub3(p, a);
  const ba = sub3(b, a);
  const baba = dot3(ba, ba);
  if (baba < 1e-12) return dist(p, a) - rA;
  const paba = dot3(pa, ba);
  const t = Math.max(0, Math.min(1, paba / baba));
  return dist(p, [a[0] + ba[0] * t, a[1] + ba[1] * t, a[2] + ba[2] * t]) - (rA + (rB - rA) * t);
};

const baseDistance = (shape: Shape, p: V3): number => {
  switch (shape.kind) {
    case "body":
      return profileDistance(p, shape.F, shape.poly);
    case "ball":
      return dist(p, shape.o) - shape.r;
    case "prism": {
      const q = sub3(p, shape.F.o);
      const flat = polygonDistance([dot3(q, shape.F.u), dot3(q, shape.F.v)], shape.poly);
      const along = Math.max(shape.s0 - dot3(q, shape.F.a), dot3(q, shape.F.a) - shape.s1);
      return Math.hypot(Math.max(flat, 0), Math.max(along, 0)) + Math.min(Math.max(flat, along), 0);
    }
    case "box": {
      const q = sub3(p, shape.o);
      let outside = 0;
      let deepest = -Infinity;
      for (let axis = 0; axis < 3; axis += 1) {
        const d = Math.abs(dot3(q, shape.axes[axis] as V3)) - (shape.half[axis] ?? 0);
        // Outside is the squared push out of whichever face is nearest; inside is
        // how far the point still is from the nearest one, so it reads negative.
        outside += Math.max(d, 0) ** 2;
        deepest = Math.max(deepest, d);
      }
      return Math.sqrt(outside) + Math.min(deepest, 0);
    }
    case "tube": {
      let best = BIG;
      for (let index = 0; index + 1 < shape.points.length; index += 1)
        best = Math.min(
          best,
          capsuleDistance(
            p,
            shape.points[index] as V3,
            shape.points[index + 1] as V3,
            shape.radii[index] ?? 0,
            shape.radii[index + 1] ?? shape.radii[index] ?? 0,
          ),
        );
      if (shape.round[0])
        best = Math.min(best, dist(p, shape.points[0] as V3) - (shape.radii[0] ?? 0));
      if (shape.round[1])
        best = Math.min(
          best,
          dist(p, shape.points[shape.points.length - 1] as V3) -
            (shape.radii[shape.radii.length - 1] ?? 0),
        );
      return best;
    }
  }
};

/** A shape cut by its host keeps only what is outside the host. */
export const distanceTo = (shape: Shape, p: V3): number => {
  const base = baseDistance(shape, p);
  if (shape.cut === undefined) return base;
  // The host's own distance, cuts included: a host with a hole is absent where
  // the hole is, so a shape cut by it fills that hole rather than sitting outside.
  const hostDistance = (host: Shape, at: V3): number => {
    const inner = baseDistance(host, at);
    if (host.cut === undefined) return inner;
    const holes = Array.isArray(host.cut) ? host.cut : [host.cut];
    return Math.max(inner, -Math.min(...holes.map((one) => hostDistance(one, at))));
  };
  const cuts = Array.isArray(shape.cut) ? shape.cut : [shape.cut];
  return Math.max(base, -Math.min(...cuts.map((one) => hostDistance(one, p))));
};

/** The shape as it stands in a given explode state. A rod extends rather than translates. */
export const moved = (shape: Shape, offset: V3): Shape => {
  if (offset[0] === 0 && offset[1] === 0 && offset[2] === 0) return shape;
  if (shape.kind === "body" && shape.slide) {
    const { from, to, r } = shape.slide;
    const reach = Math.max(from + 1e-3, to + dot3(offset, shape.F.a));
    return {
      ...shape,
      poly: [
        [from, 0],
        [from, r],
        [reach, r],
        [reach, 0],
      ],
      slide: { from, to: reach, r },
    };
  }
  const cut =
    shape.cut === undefined
      ? undefined
      : Array.isArray(shape.cut)
        ? shape.cut.map((one) => moved(one, offset))
        : moved(shape.cut as Shape, offset);
  if (shape.kind === "body" || shape.kind === "prism")
    return {
      ...shape,
      cut,
      F: {
        ...shape.F,
        o: [shape.F.o[0] + offset[0], shape.F.o[1] + offset[1], shape.F.o[2] + offset[2]],
      },
    };
  if (shape.kind === "tube")
    return {
      ...shape,
      cut,
      points: shape.points.map(
        (point) => [point[0] + offset[0], point[1] + offset[1], point[2] + offset[2]] as V3,
      ),
      // The tips are what the terminal and loose-end checks read, so leaving them
      // at the rest pose tests the mount against the wrong place.
      tips: shape.tips.map((tip) =>
        tip === null ? null : ([tip[0] + offset[0], tip[1] + offset[1], tip[2] + offset[2]] as V3),
      ),
    };
  return {
    ...shape,
    cut,
    o: [shape.o[0] + offset[0], shape.o[1] + offset[1], shape.o[2] + offset[2]],
  };
};

export interface State {
  readonly label: string;
  readonly shares: Readonly<Record<string, number>>;
}

export interface Explode {
  readonly depth: ReadonlyArray<State>;
  readonly frames: ReadonlyArray<State>;
  readonly apart: boolean;
}

const shareOf = (ride: string, piece: string, state: State): number =>
  state.shares[ride || piece] ?? 0;

export const offsetOf = (item: Item, state: State): V3 => {
  const share = shareOf(item.ride, item.piece, state);
  return [item.move[0] * share, item.move[1] * share, item.move[2] * share];
};

/** Eleven evenly spaced openings, enough to catch a crossing that only appears halfway. */
export const uniformStates = (count = 10): State[] =>
  Array.from({ length: count + 1 }, (_, index) => ({
    label: `${Math.round((index / count) * 100)}% open`,
    shares: {},
  }));

/** The staggered half of a spring-driven explode: the script forward, then the reversal at each boundary. */
export const springStates = (
  order: ReadonlyArray<string>,
  {
    stagger = 0.035,
    stiffness = 64,
    damping = 14.2,
    substeps = 4,
    fps = 60,
    settle = 1e-3,
    stride = 1,
  } = {},
): State[] => {
  if (order.length === 0) return [];
  const states: State[] = [];
  const reversals = order
    .flatMap((_, index) => [index * stagger - 0.008, index * stagger + 0.008])
    .filter((at) => at > 0);

  const replay = (on: boolean, back?: number) => {
    const springs = new Map(
      order.map((id) => [
        id,
        {
          x: on ? 0 : 1,
          v: 0,
          target: on ? 0 : 1,
          pending: null as null | { value: number; at: number },
        },
      ]),
    );
    const toggle = (value: boolean, clock: number) => {
      const goal = value ? 1 : 0;
      const sequence = value ? order : order.toReversed();
      sequence.forEach((id, index) => {
        const spring = springs.get(id);
        if (spring && spring.target !== goal)
          spring.pending = { value: goal, at: clock + index * stagger };
      });
    };

    let goal = on ? 1 : 0;
    let clock = 0;
    toggle(on, 0);
    const dt = 1 / fps;

    for (let frame = 0; frame < 100000; frame += 1) {
      if (back !== undefined && clock >= back && clock <= clock + dt) {
        toggle(!on, back);
        goal = on ? 0 : 1;
      }
      clock += dt;
      for (const spring of springs.values()) {
        if (spring.pending && clock >= spring.pending.at) {
          spring.target = spring.pending.value;
          spring.pending = null;
        }
      }
      for (let step = 0; step < substeps; step += 1) {
        const h = dt / substeps;
        for (const spring of springs.values()) {
          spring.v += ((spring.target - spring.x) * stiffness - spring.v * damping) * h;
          spring.x += spring.v * h;
        }
      }
      const done =
        (back === undefined || clock >= back) &&
        [...springs.values()].every(
          (spring) =>
            spring.pending === null &&
            Math.abs(spring.x - goal) < settle &&
            Math.abs(spring.v) < settle,
        );
      if (done) break;
      if (frame % stride === 0) {
        const label =
          back === undefined
            ? `${on ? "apart" : "together"} at ${clock.toFixed(3)} s`
            : `${on ? "apart" : "together"}, reversed at ${back.toFixed(2)} s, ${clock.toFixed(3)} s`;
        states.push({
          label,
          shares: Object.fromEntries([...springs].map(([id, spring]) => [id, spring.x])),
        });
      }
    }
  };

  replay(true);
  replay(false);
  for (const at of reversals) {
    replay(true, at);
    replay(false, at);
  }
  return states;
};

/** The states where only some assemblies have moved, which is where interlocks hide. */
export const prefixStates = (
  order: ReadonlyArray<string>,
  { shares = [0.25, 0.5, 0.75, 1] }: { shares?: ReadonlyArray<number> } = {},
): State[] => {
  const out: State[] = [];
  for (let count = 1; count < order.length; count += 1)
    for (const share of shares) {
      // Each assembly gets the share its station calls for: fully out, the partial
      // one the label names, the rest untouched. A state claiming a quarter open
      // while holding all of it tested nothing.
      out.push({
        label: `first ${count - 1} out, ${order[count - 1]} at ${share}`,
        shares: Object.fromEntries(
          order.map((id, index) => [id, index < count - 1 ? 1 : index === count - 1 ? share : 0]),
        ),
      });
    }
  return out;
};

export const explodeStates = (
  order: ReadonlyArray<string> = [],
  { uniform = 10, stride = 4 }: { uniform?: number; stride?: number } = {},
): Explode => {
  if (order.length === 0)
    return { depth: [{ label: "rest", shares: {} }], frames: [], apart: false };
  const frames = [...springStates(order, { stride }), ...prefixStates(order)];
  return { depth: [...uniformStates(uniform), ...frames], frames, apart: true };
};

/** The camera basis: right, down and toward the reader. */
export const cameraBasis = (projection: Projection) => {
  const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
  const R: V3 = [sinA, -cosA, 0];
  const D: V3 = [cosA * sinE, sinA * sinE, -cosE];
  const V: V3 = [cosA * cosE, sinA * cosE, sinE];
  return { R, D, V, k };
};

/** Sphere-trace from a bounding span until the surface is within `eps`. */
const march = (
  shape: Shape,
  origin: V3,
  V: V3,
  from: number,
  to: number,
  eps = RAY_EPS,
): number => {
  let t = to;
  for (let step = 0; step < RAY_STEPS; step += 1) {
    const p: V3 = [origin[0] + V[0] * t, origin[1] + V[1] * t, origin[2] + V[2] * t];
    const d = distanceTo(shape, p);
    if (d < eps) return t;
    t -= Math.max(d, eps / 2);
    if (t < from) return BIG;
  }
  return BIG;
};

/** Where a ray meets a shape, as distance along the view direction. */
export const rayDepth = (shape: Shape, origin: V3, V: V3): number => {
  const span = boundsOf(shape);
  let from = 0;
  let to = BIG / 4;
  for (let axis = 0; axis < 3; axis += 1) {
    const o = origin[axis] as number;
    const v = V[axis] as number;
    const lo = (span.min[axis] as number) - o;
    const hi = (span.max[axis] as number) - o;
    if (Math.abs(v) < 1e-9) {
      if (o < (span.min[axis] as number) || o > (span.max[axis] as number)) return BIG;
      continue;
    }
    const near = Math.min(lo / v, hi / v);
    const far = Math.max(lo / v, hi / v);
    from = Math.max(from, near);
    to = Math.min(to, far);
    if (from > to) return BIG;
  }
  return march(shape, origin, V, from, to);
};

export const boundsOf = (shape: Shape): { min: V3; max: V3 } => {
  switch (shape.kind) {
    case "ball":
      return {
        min: [shape.o[0] - shape.r, shape.o[1] - shape.r, shape.o[2] - shape.r],
        max: [shape.o[0] + shape.r, shape.o[1] + shape.r, shape.o[2] + shape.r],
      };
    case "box": {
      // A rotated box reaches further along a world axis than its own half-width,
      // so the extent sums |axis_j[i]| * half[j] over every j rather than reading
      // half[i] straight off.
      const min: V3 = [0, 0, 0];
      const max: V3 = [0, 0, 0];
      for (let axis = 0; axis < 3; axis += 1) {
        let extent = 0;
        for (let other = 0; other < 3; other += 1)
          extent += Math.abs((shape.axes[other] as V3)[axis] as number) * (shape.half[other] ?? 0);
        const centre = shape.o[axis] as number;
        min[axis] = centre - extent - 0.001;
        max[axis] = centre + extent + 0.001;
      }
      return { min, max };
    }
    case "tube": {
      const min: V3 = [Infinity, Infinity, Infinity];
      const max: V3 = [-Infinity, -Infinity, -Infinity];
      shape.points.forEach((point, index) => {
        const r = (shape.radii[index] ?? 0) + 0.001;
        for (let axis = 0; axis < 3; axis += 1) {
          min[axis] = Math.min(min[axis] as number, (point[axis] as number) - r);
          max[axis] = Math.max(max[axis] as number, (point[axis] as number) + r);
        }
      });
      return { min, max };
    }
    case "prism":
    case "body": {
      const min: V3 = [Infinity, Infinity, Infinity];
      const max: V3 = [-Infinity, -Infinity, -Infinity];
      // The bound has to cover the solid in world space. For a prism that is its
      // own polygon swept along the axis; for a body it is the profile's reach.
      // A bound covering only the axis misses the body, and a missed ray reads as
      // "this part is behind", which inverts the painter's order for it.
      const corners: Array<readonly [number, number, number]> = [];
      if (shape.kind === "prism")
        for (const s of [shape.s0, shape.s1])
          for (const [x, y] of shape.poly) corners.push([s, x, y]);
      else
        for (const [station, r] of shape.poly)
          for (const angle of [0, Math.PI / 4, Math.PI / 2, (3 * Math.PI) / 4])
            corners.push([station, Math.cos(angle) * r, Math.sin(angle) * r]);
      for (const [station, x, y] of corners)
        for (let axis = 0; axis < 3; axis += 1) {
          const at =
            (shape.F.o[axis] as number) +
            (shape.F.a[axis] as number) * station +
            (shape.F.u[axis] as number) * x +
            (shape.F.v[axis] as number) * y;
          min[axis] = Math.min(min[axis] as number, at - 0.001);
          max[axis] = Math.max(max[axis] as number, at + 0.001);
        }
      return { min, max };
    }
  }
};

export interface Recorder {
  readonly projection: Projection;
  readonly order: string[];
  readonly items: Item[];
  readonly routes: Array<{ name: string; points: V3[]; r: number }>;
  settled: Settled | null;
  readonly put: (item: PutInput) => Item;
  readonly route: (
    name: string,
    points: ReadonlyArray<V3>,
    radius: number | ((u: number) => number),
    meta?: Meta & { round?: readonly [boolean, boolean] },
  ) => TubeShape[];
}

export interface Settled {
  readonly items: Item[];
  readonly overlaps: Overlaps;
  readonly solved: Solved;
}

export interface Overlaps {
  readonly pairs: ReadonlyArray<{ state: State; a: number; b: number; front: 0 | 1 }>;
  readonly least: number;
  readonly states: ReadonlyArray<State>;
}

export interface Solved {
  readonly keys: ReadonlyArray<number>;
  readonly rules: number;
  readonly cycles: number;
  readonly dropped: number;
}

const REST: State[] = [{ label: "rest", shares: {} }];

export interface PutInput extends Partial<Omit<Item, "at" | "bias">> {
  /** Where the item sits; its depth along the view direction becomes the base key. */
  readonly at?: V3;
  /** Added to the measured depth, for two items that genuinely share a plane. */
  readonly bias?: number;
  readonly shapes?: ReadonlyArray<Shape>;
}

export const recorder = (projection: Projection, order: string[] = []): Recorder => {
  const counts = new Map<string, number>();
  const nameFor = (base: string): string => {
    const count = (counts.get(base) ?? 0) + 1;
    counts.set(base, count);
    return count === 1 ? base : `${base}#${count}`;
  };

  const items: Item[] = [];
  const routes: Array<{ name: string; points: V3[]; r: number }> = [];
  const V = cameraBasis(projection).V;

  const put = (item: PutInput): Item => {
    const piece = item.piece ?? "";
    const ride = item.ride ?? piece;
    const shapes = item.shapes ?? [];
    const recorded: Item = {
      name: item.name ?? nameFor(`${piece || "item"}.item`),
      piece,
      ride,
      move: item.move ?? [0, 0, 0],
      shapes,
      key: item.key ?? dot3(item.at ?? [0, 0, 0], V) + (item.bias ?? 0),
    };
    for (const shape of shapes)
      Object.assign(shape, { move: recorded.move, ride: recorded.ride, piece });
    items.push(recorded);
    return recorded;
  };

  const route = (
    name: string,
    points: ReadonlyArray<V3>,
    radius: number | ((u: number) => number),
    meta: Meta & { round?: readonly [boolean, boolean] } = {},
  ): TubeShape[] => {
    const radiusOf = typeof radius === "function" ? radius : () => radius;
    const made = tubeShape(points, (u) => radiusOf(u), { ...meta, name });
    routes.push({ name, points: [...points], r: radiusOf(0.5) });
    // A route is recorded as an item so the audit measures it like a solid.
    put({
      name,
      piece: meta.piece ?? name,
      shapes: [made],
      at: points[Math.floor(points.length / 2)] ?? [0, 0, 0],
    });
    return [made];
  };

  return { projection, order, items, routes, settled: null, put, route };
};

/**
 * Measure which item is genuinely in front where two of them overlap.
 *
 * The screen boxes decide which pairs are worth measuring; the ray decides which
 * is in front. Everything is measured at rest and in every explode state,
 * because an item that only interlocks halfway through opening is the one the
 * eye catches.
 */
export const overlapsOf = (
  items: ReadonlyArray<Item>,
  projection: Projection,
  {
    states = REST,
    step = 0.25,
    tolerance = 0.3,
    least = OVERLAP_LEAST,
  }: { states?: ReadonlyArray<State>; step?: number; tolerance?: number; least?: number } = {},
): Overlaps => {
  const { V, k } = cameraBasis(projection);
  const live = items
    .map((item, index) => ({ item, index }))
    .filter((one) => one.item.shapes.length > 0);
  const pairs: Array<{ state: State; a: number; b: number; front: 0 | 1 }> = [];

  const rasterOf = (item: Item, offset: V3) => {
    const shapes = item.shapes.map((shape) => moved(shape, offset));
    const boxes = shapes.map((shape) => {
      const { min, max } = boundsOf(shape);
      const corners: V2[] = [
        iso([min[0], min[1], min[2]], projection),
        iso([min[0], min[1], max[2]], projection),
        iso([max[0], min[1], min[2]], projection),
        iso([max[0], min[1], max[2]], projection),
        iso([min[0], max[1], min[2]], projection),
        iso([min[0], max[1], max[2]], projection),
        iso([max[0], max[1], min[2]], projection),
        iso([max[0], max[1], max[2]], projection),
      ];
      return {
        min: [
          Math.min(...corners.map((point) => point[0])),
          Math.min(...corners.map((point) => point[1])),
        ] as V2,
        max: [
          Math.max(...corners.map((point) => point[0])),
          Math.max(...corners.map((point) => point[1])),
        ] as V2,
      };
    });
    return { shapes, boxes };
  };

  for (const state of states) {
    const rasters = new Map(
      live.map((one) => [one.index, rasterOf(one.item, offsetOf(one.item, state))] as const),
    );
    for (let a = 0; a < live.length; a += 1)
      for (let b = a + 1; b < live.length; b += 1) {
        const first = rasters.get((live[a] as (typeof live)[number]).index);
        const second = rasters.get((live[b] as (typeof live)[number]).index);
        if (!first || !second) continue;

        // Every shape against every shape: pairing by index would make the verdict
        // depend on the order an item happens to record its shapes in.
        const overlapOf = first.boxes.some((box) =>
          second.boxes.some(
            (other) =>
              box.min[0] < other.max[0] &&
              box.max[0] > other.min[0] &&
              box.min[1] < other.max[1] &&
              box.max[1] > other.min[1],
          ),
        );
        if (!overlapOf) continue;

        const verdict = measure(first, second, projection, { V, k, step, tolerance, least });
        if (verdict === null) continue;
        pairs.push({
          state,
          a: (live[a] as (typeof live)[number]).index,
          b: (live[b] as (typeof live)[number]).index,
          front: verdict,
        });
      }
  }

  return { pairs, least, states };
};

/** Count the screen area where one is measurably in front of the other. */
const measure = (
  a: { shapes: Shape[]; boxes: Array<{ min: V2; max: V2 }> },
  b: { shapes: Shape[]; boxes: Array<{ min: V2; max: V2 }> },
  projection: Projection,
  {
    V,
    k,
    step,
    tolerance,
    least,
  }: { V: V3; k: number; step: number; tolerance: number; least: number },
): 0 | 1 | null => {
  const origin = projection.origin;
  let cells = 0;
  let forward = 0;
  let backward = 0;

  for (const box of a.boxes)
    for (const other of b.boxes) {
      const x0 = Math.max(box.min[0], other.min[0]);
      const y0 = Math.max(box.min[1], other.min[1]);
      const x1 = Math.min(box.max[0], other.max[0]);
      const y1 = Math.min(box.max[1], other.max[1]);
      if (x1 <= x0 || y1 <= y0) continue;

      for (let x = x0; x < x1; x += step)
        for (let y = y0; y < y1; y += step) {
          const cx = x + step / 2;
          const cy = y + step / 2;
          const world: V3 = [
            ((cx - origin[0]) * (V[0] as number)) / k + ((cy - origin[1]) * (V[1] as number)) / k,
            ((cx - origin[0]) * ((V[1] as number) * -1)) / k +
              ((cy - origin[1]) * ((V[0] as number) * -1)) / k,
            0,
          ];
          void world;
          const ta = depthAt(a.shapes, projection, cx, cy, V);
          const tb = depthAt(b.shapes, projection, cx, cy, V);
          if (ta === null || tb === null) continue;
          cells += 1;
          if (ta > tb + tolerance) forward += 1;
          else if (tb > ta + tolerance) backward += 1;
        }
    }

  if (cells === 0) return null;
  const area = step * step;
  if (forward * area >= least && forward >= backward) return 0;
  if (backward * area >= least && backward >= forward) return 1;
  return null;
};

const depthAt = (
  shapes: ReadonlyArray<Shape>,
  projection: Projection,
  x: number,
  y: number,
  V: V3,
): number | null => {
  const { R, D, k } = cameraBasis(projection);
  const world: V3 = [
    (R[0] * (x - projection.origin[0]) + D[0] * (y - projection.origin[1])) / k,
    (R[1] * (x - projection.origin[0]) + D[1] * (y - projection.origin[1])) / k,
    (R[2] * (x - projection.origin[0]) + D[2] * (y - projection.origin[1])) / k,
  ];
  let best: number | null = null;
  for (const shape of shapes) {
    const t = rayDepth(shape, world, V);
    if (t === BIG) continue;
    const along = dot3([world[0], world[1], world[2]], V) + t;
    best = best === null ? along : Math.max(best, along);
  }
  return best;
};

/**
 * Assign a painter's key to every item.
 *
 * Each overlap is a rule that the nearer item must draw later. Relaxing the keys
 * converges when the rules are consistent; where they are not, the pair
 * interpenetrates and no order can satisfy both, so the lightest rule is dropped
 * and counted rather than silently satisfied.
 */
interface Rule {
  readonly front: number;
  readonly back: number;
  weight: number;
  need: number;
}

export const orderKeys = (
  items: ReadonlyArray<Item>,
  overlaps: Overlaps,
  { gap = KEY_GAP }: { gap?: number } = {},
): Solved => {
  const rules: Rule[] = [];
  for (const pair of overlaps.pairs) {
    const front = pair.front === 0 ? pair.a : pair.b;
    const back = pair.front === 0 ? pair.b : pair.a;
    if (items[front] === undefined || items[back] === undefined) continue;
    const existing = rules.find((rule) => rule.front === front && rule.back === back);
    if (existing) {
      existing.weight = Math.max(existing.weight, 1);
      existing.need = Math.max(existing.need, gap);
      continue;
    }
    rules.push({ front, back, weight: 1, need: gap });
  }

  /**
   * Relax until every rule holds, or give up after a bounded number of passes.
   *
   * Each pass adds the gap a rule still needs rather than the front key's own
   * value, so the keys converge instead of escalating once per pass.
   */
  const relax = (active: ReadonlyArray<Rule>): number[] | null => {
    const keys = items.map((item) => item.key);
    const limit = Math.min(items.length + 1, RELAX_PASSES);
    for (let round = 0; round < limit; round += 1) {
      let changed = false;
      for (const rule of active) {
        const front = keys[rule.front] as number;
        const back = keys[rule.back] as number;
        if (front - back >= rule.need - 1e-9) continue;
        keys[rule.front] = back + rule.need;
        changed = true;
      }
      if (!changed) return keys;
    }
    return null;
  };

  // Every retry removes exactly one rule, so this terminates even when no
  // assignment satisfies the whole set.
  let active: Rule[] = [...rules];
  let dropped = 0;
  for (;;) {
    const keys = relax(active);
    if (keys !== null)
      return { keys, rules: active.length, cycles: dropped === 0 ? 0 : 1, dropped };
    if (active.length === 0)
      return { keys: items.map((item) => item.key), rules: 0, cycles: 1, dropped };
    let weakest = 0;
    for (let index = 1; index < active.length; index += 1)
      if ((active[index]?.weight ?? 0) < (active[weakest]?.weight ?? 0)) weakest = index;
    active = active.filter((_, index) => index !== weakest);
    dropped += 1;
  }
};

/**
 * Measure every overlap and set the painter's keys from the measurement.
 *
 * Hand-tuned keys cannot be right at every angle and in every pose, so the keys
 * are read off the geometry rather than chosen by eye.
 */
export const settle = (
  R: Recorder,
  projection: Projection = R.projection,
  { states }: { states?: ReadonlyArray<State> } = {},
): Settled => {
  const depth = states ?? explodeStates(R.order).depth;
  const overlaps = overlapsOf(R.items, projection, { states: depth });
  const solved = orderKeys(R.items, overlaps);
  R.items.forEach((item, index) => {
    item.key = solved.keys[index] ?? item.key;
  });
  R.settled = { items: R.items, overlaps, solved };
  return R.settled;
};

export interface Failure {
  readonly check: string;
  readonly what: string;
  readonly at: V3;
}

export interface Result {
  readonly failures: ReadonlyArray<Failure>;
  readonly clearance: ReadonlyArray<Failure>;
  readonly apart: ReadonlyArray<Failure>;
  readonly flight: ReadonlyArray<Failure>;
  readonly terminals: ReadonlyArray<Failure>;
  readonly loose: ReadonlyArray<Failure>;
  readonly supports: ReadonlyArray<Failure>;
  readonly depth: ReadonlyArray<Failure>;
  readonly passing: ReadonlyArray<string>;
  readonly counts: { tubes: number; solids: number; items: number; states: number };
}

const label = (shape: Shape): string => shape.name ?? shape.kind;

export interface AuditOptions {
  readonly allow?: ReadonlyArray<string>;
  readonly ground?: (shape: Shape) => boolean;
}

/**
 * Run every check.
 *
 * The thresholds are the ones the figures were drawn against: a pipe keeps about
 * one and a half radii from anything it does not connect to, an end lands on a
 * mount, and nothing that moves has its end left in mid-air when the figure is
 * apart.
 */
export const audit = (
  R: Recorder,
  projection: Projection = R.projection,
  { allow = [], ground = (shape) => shape.ground === true }: AuditOptions = {},
): Result => {
  const explode = explodeStates(R.order);
  const clearance: Failure[] = [];
  const apart: Failure[] = [];
  const flight: Failure[] = [];
  const terminals: Failure[] = [];
  const loose: Failure[] = [];
  const supports: Failure[] = [];
  const depth: Failure[] = [];
  const passing: string[] = [];

  const tubes: TubeShape[] = [];
  const solids: Shape[] = [];
  for (const item of R.items)
    for (const shape of item.shapes) {
      if (shape.kind === "tube") tubes.push(shape);
      else solids.push(shape);
    }
  const connected = (a: TubeShape, b: Shape): boolean =>
    a.touch?.includes(label(b)) === true ||
    (a.piece !== undefined &&
      a.piece === (b as Meta).piece &&
      (label(b) === label(a) || (b as Meta).ride === a.ride));

  /** Walk a tube's centreline and measure it against everything it is not joined to. */
  const sweep = (tube: TubeShape, others: ReadonlyArray<Shape>, state: State | null): Failure[] => {
    const found: Failure[] = [];
    const posed = state !== null ? moved(tube, share(state, tube)) : tube;
    if (posed.kind !== "tube") return found;
    const movedTube = posed;
    const step = Math.max(0.4, Math.min(1, movedTube.radii[0] ?? 0.5));
    for (let index = 0; index + 1 < movedTube.points.length; index += 1) {
      const a = movedTube.points[index] as V3;
      const b = movedTube.points[index + 1] as V3;
      const count = Math.max(1, Math.ceil(dist(a, b) / step));
      const r = movedTube.radii[index] ?? 0.5;
      const need = Math.max(0.2, r * 0.5);
      for (let part = 0; part <= count; part += 1) {
        const t = part / count;
        const point: V3 = [
          a[0] + (b[0] - a[0]) * t,
          a[1] + (b[1] - a[1]) * t,
          a[2] + (b[2] - a[2]) * t,
        ];
        for (const other of others) {
          if (other.kind === "tube" && (other as TubeShape).name === tube.name) continue;
          if (connected(tube, other)) continue;
          const otherMoved =
            other.move !== undefined && state !== null ? moved(other, share(state, other)) : other;
          const gap = distanceTo(otherMoved, point) - r;
          if (gap >= need) continue;
          found.push({
            check: state === null ? "clearance" : "apart",
            what: `${label(tube)} ${gap < 0 ? "passes through" : "runs close to"} ${label(otherMoved)}: gap ${gap.toFixed(2)} needs ${need.toFixed(2)}`,
            at: point,
          });
        }
      }
    }
    return found;
  };

  const share = (state: State, shape: Shape): V3 => {
    const meta = shape as Meta;
    const move = meta.move ?? [0, 0, 0];
    const amount = state.shares[meta.ride ?? meta.piece ?? ""] ?? 0;
    return [move[0] * amount, move[1] * amount, move[2] * amount];
  };

  for (const tube of tubes) {
    for (const failure of sweep(tube, solids, null)) clearance.push(failure);
    if (!explode.apart) continue;
    for (const failure of sweep(tube, solids, {
      label: "apart",
      shares: Object.fromEntries(R.order.map((id) => [id, 1])),
    }))
      apart.push(failure);
  }

  // The worst moment in flight, not every frame: the pair that comes closest is
  // the one a reader sees.
  const worst = new Map<string, Failure>();
  for (const frame of explode.frames)
    for (const tube of tubes)
      for (const failure of sweep(tube, solids, frame)) {
        const key = `${label(tube)}|${failure.what.slice(0, 40)}`;
        const held = worst.get(key);
        if (!held || failure.what < held.what) worst.set(key, failure);
      }
  for (const failure of worst.values())
    if (failure.check === "clearance" || failure.what.includes("passes through"))
      flight.push(failure);

  for (const tube of tubes)
    for (let side = 0; side < 2; side += 1) {
      const tip = tube.tips[side];
      if (tip === null || tip === undefined) continue;
      if (allow.includes(label(tube))) continue;
      const r = tube.radii[side === 0 ? 0 : tube.radii.length - 1] ?? 0.5;
      const landed = solids.some((other) => distanceTo(other, tip) <= r + 0.15);
      if (!landed)
        terminals.push({
          check: "terminals",
          what: `${label(tube)} ${side === 0 ? "start" : "end"} ends in mid-air at ${tip.map((n) => n.toFixed(1)).join(", ")}`,
          at: tip,
        });
    }

  // When the figure is apart, an end must touch something that moved with it.
  if (explode.apart)
    for (const tube of tubes)
      for (let side = 0; side < 2; side += 1) {
        const tip = tube.tips[side];
        if (tip === null || tip === undefined) continue;
        if (tube.free[side]) {
          passing.push(`${label(tube)} ${side === 0 ? "start" : "end"} is marked free`);
          continue;
        }
        const piece = (tube as Meta).piece;
        const movedSolids = solids.filter((other) => ((other as Meta).piece ?? "") === piece);
        if (!movedSolids.some((other) => distanceTo(other, tip) <= 0.15))
          loose.push({
            check: "loose ends",
            what: `${label(tube)} ${side === 0 ? "start" : "end"} touches nothing that moves with it when apart`,
            at: tip,
          });
      }

  /**
   * Do two solids touch?
   *
   * Samples A's bounding box on a grid and measures each sample against B's field.
   * A sample that lies on A's own boundary and within TOUCH of B means the two are
   * in contact, which is how a figure's parts hold each other up. The grid is fine
   * enough that a flush contact cannot fall between samples, because the gap being
   * tested is far larger than the spacing.
   */
  const touching = (a: Shape, b: Shape): boolean => {
    const box = boundsOf(a);
    const steps = 5;
    for (let ix = 0; ix <= steps; ix += 1)
      for (let iy = 0; iy <= steps; iy += 1)
        for (let iz = 0; iz <= steps; iz += 1) {
          const at: V3 = [
            (box.min[0] as number) +
              ((box.max[0] as number) - (box.min[0] as number)) * (ix / steps),
            (box.min[1] as number) +
              ((box.max[1] as number) - (box.min[1] as number)) * (iy / steps),
            (box.min[2] as number) +
              ((box.max[2] as number) - (box.min[2] as number)) * (iz / steps),
          ];
          if (distanceTo(a, at) > TOUCH) continue;
          if (Math.abs(distanceTo(b, at)) <= TOUCH) return true;
        }
    return false;
  };

  // Contact is measured from each part's boundary, not its centre: a post seated
  // on a plate has its centre a whole height above that plate's surface, so a
  // centre-only test links nothing and reports every part as floating. Sampling
  // one shape's boundary against the other's field finds the real gap.
  const links: Array<[Shape, Shape]> = [];
  for (let a = 0; a < solids.length; a += 1)
    for (let b = a + 1; b < solids.length; b += 1) {
      const one = solids[a] as Shape;
      const two = solids[b] as Shape;
      if (touching(one, two)) links.push([one, two]);
    }
  const reached = new Set<Shape>(solids.filter((shape) => ground(shape)));
  let grew = true;
  while (grew) {
    grew = false;
    for (const [one, two] of links)
      if (reached.has(one) && !reached.has(two)) {
        reached.add(two);
        grew = true;
      } else if (reached.has(two) && !reached.has(one)) {
        reached.add(one);
        grew = true;
      }
  }
  for (const shape of solids)
    if (!reached.has(shape))
      supports.push({
        check: "support",
        what: `${label(shape)} reaches nothing it can stand on`,
        at: centreOf(shape),
      });

  // Painter's order, checked against the measurement rather than the intent.
  const settled = R.settled ?? settle(R, projection);
  for (const pair of settled.overlaps.pairs) {
    const [front, back] = pair.front === 0 ? [pair.a, pair.b] : [pair.b, pair.a];
    const a = settled.items[front];
    const b = settled.items[back];
    if (!a || !b) continue;
    if (allow.includes(a.name) || allow.includes(b.name)) {
      passing.push(`${a.name} in front of ${b.name} is excused`);
      continue;
    }
    if (a.key <= b.key)
      depth.push({
        check: "depth order",
        what: `${pair.front === 0 ? a.name : b.name} is in front of the other but drawn first`,
        at: [0, 0, 0],
      });
  }

  for (const item of R.items)
    if (item.shapes.length === 0) passing.push(`${item.name} records no shape`);

  const failures = [
    ...clearance,
    ...apart,
    ...flight,
    ...terminals,
    ...loose,
    ...supports,
    ...depth,
  ];

  return {
    failures,
    clearance,
    apart,
    flight,
    terminals,
    loose,
    supports,
    depth,
    passing,
    counts: {
      tubes: tubes.length,
      solids: solids.length,
      items: R.items.length,
      states: settled.overlaps.states.length,
    },
  };
};

const centreOf = (shape: Shape): V3 =>
  boundsOf(shape).min.map(
    (value, axis) => (value + (boundsOf(shape).max[axis] as number)) / 2,
  ) as V3;

export const report = (result: Result): string => {
  const lines: string[] = [];
  const section = (name: string, rows: ReadonlyArray<Failure>) => {
    if (rows.length === 0) return;
    lines.push(`${name}: ${rows.length} problems`);
    for (const row of rows.slice(0, 20))
      lines.push(`  ${row.what} at ${row.at.map((n) => n.toFixed(1)).join(", ")}`);
  };
  section("clearance", result.clearance);
  section("clearance apart", result.apart);
  section("through in mid-flight", result.flight);
  section("terminals", result.terminals);
  section("loose ends", result.loose);
  section("support", result.supports);
  section("depth order", result.depth);
  const { tubes, solids, items, states } = result.counts;
  lines.push(`audit · ${tubes} tubes · ${solids} solids · ${items} items · ${states} states`);
  return lines.join("\n");
};

/** The pass or fail a caller gates on. */
export const passed = (result: Result): boolean => result.failures.length === 0;

/**
 * Every open line must land on something.
 *
 * A line that stops in the middle of a face reads as a mistake, so this is the
 * check that catches the detail nobody meant to leave unfinished.
 */
export interface LineEnd {
  readonly d: string;
  readonly at: V2;
  readonly free: boolean;
}

const COMMAND = /([MmLlHhVvAaCcSsQqTtZz])([^MmLlHhVvAaCcSsQqTtZz]*)/g;
const NUMBER = /-?[\d.]+(?:e-?\d+)?/gi;

/**
 * The points a path passes through, following the pen.
 *
 * Commands differ in how many numbers they carry and whether they are relative,
 * so treating them all as absolute pairs makes `V190` leave the pen where it
 * started and report an end that is not where the line stops.
 */
const pathPoints = (d: string): V2[] => subPaths(d).flat();

/**
 * Every open end of every drawn line.
 *
 * A subpath that is not closed has two ends that could land in mid-air, so both
 * are reported. A closed one has none, and a path the author marked free is
 * excused: only a printed rule line, a needle tail and a pointer tip may set it.
 */
export const lineEnds = (svg: string): ReadonlyArray<LineEnd> => {
  const out: LineEnd[] = [];
  const pattern = /<path\b[^>]*\bd="([^"]+)"[^>]*>/g;

  for (const match of svg.matchAll(pattern)) {
    const element = match[0];
    const d = match[1] as string;
    if (!element.includes("iso-line") && !element.includes("tb-ring")) continue;
    if (/[Zz]\s*$/.test(d.trim())) continue;
    const free = /data-free(?:="")?/.test(element);

    // Walk the subpaths once. Each open subpath contributes its first and its
    // last point; a degenerate one is a single end, not two at the same place.
    for (const sub of subPaths(d)) {
      const first = sub[0];
      const last = sub[sub.length - 1];
      if (first === undefined) continue;
      out.push({ d: element, at: first, free });
      if (last !== undefined && (last[0] !== first[0] || last[1] !== first[1]))
        out.push({ d: element, at: last, free });
    }
  }
  return out;
};

/** One array of points per `M`-started subpath, pen carried across the whole path. */
const subPaths = (d: string): V2[][] => {
  const out: V2[][] = [];
  let at: V2 = [0, 0];
  let current: V2[] | null = null;

  for (const piece of d.matchAll(COMMAND)) {
    const command = piece[1] as string;
    const upper = command.toUpperCase();
    const relative = command !== upper;
    const numbers = ((piece[2] ?? "").match(NUMBER) ?? []).map(Number);
    const move = (x: number, y: number): V2 => {
      const point: V2 = relative ? [at[0] + x, at[1] + y] : [x, y];
      at = point;
      return point;
    };
    const put = (x: number, y: number) => {
      const point = move(x, y);
      if (current === null) current = [point];
      else current.push(point);
    };

    if (upper === "Z") {
      current = null;
      continue;
    }
    if (upper === "M") {
      current = [];
      out.push(current);
      for (let index = 0; index + 1 < numbers.length; index += 2)
        put(numbers[index] as number, numbers[index + 1] as number);
      continue;
    }
    if (upper === "H") {
      for (const x of numbers) put(x, at[1]);
      continue;
    }
    if (upper === "V") {
      for (const y of numbers) put(at[0], y);
      continue;
    }
    if (upper === "L" || upper === "T") {
      for (let index = 0; index + 1 < numbers.length; index += 2)
        put(numbers[index] as number, numbers[index + 1] as number);
      continue;
    }
    // A carries rx ry rot laf sf x y; C and S carry x1 y1 x2 y2 x y; Q carries
    // x1 y1 x y. All land on a final pair, and the control points before it are
    // not ends of anything, so only the endpoint of each run is recorded.
    const stride = upper === "A" ? 7 : 6;
    const end = stride - 2;
    for (let index = 0; index + stride <= numbers.length; index += stride)
      put(numbers[index + end] as number, numbers[index + end + 1] as number);
  }
  return out;
};

/**
 * Every coordinate the page draws, and which element drew it.
 *
 * A line lands on a stroke, a dot or an outline, so the landing targets are all
 * the geometry rather than only the other line ends. Keeping the element with
 * the point is what stops an end counting itself as its own landing.
 */
export interface Drawn {
  readonly at: V2;
  readonly element: string;
}

export const drawnPoints = (svg: string): ReadonlyArray<Drawn> => {
  const out: Drawn[] = [];
  const pattern = /<[^>]*\bd="([^"]+)"[^>]*>/g;
  // The same pen walk the ends use, so a `V` or an arc is a landing target on
  // the same terms a line end is judged by.
  for (const match of svg.matchAll(pattern))
    for (const at of pathPoints(match[1] as string))
      if (Number.isFinite(at[0]) && Number.isFinite(at[1])) out.push({ at, element: match[0] });
  return out;
};

/** Whether an end is close enough to something drawn to count as landing. */
export const landsOn = (at: V2, others: ReadonlyArray<V2>, tolerance = 1): boolean =>
  others.some((other) => Math.hypot(other[0] - at[0], other[1] - at[1]) <= tolerance);

export type { Point3, TubePiece };
export { cross3, mul3, tangentAlong, unit3 };
