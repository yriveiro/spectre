/**
 * The isometric core: a camera, extruded solids, a parts library, and the SVG
 * renderer that turns both into markup. Everything else in this kit is a
 * consumer of the projection defined here.
 */

import { head, pick } from "./list";

export type Flat = [number, number];
export type Point3 = [number, number, number];
export type Plane = [number, number];

export const AZIMUTH = 45;
export const ELEVATION = 30;
export const SHADES = 4;

const RADIANS = Math.PI / 180;

/**
 * A perceptual correction baked into every projection. Removing it moves every
 * layout, so it is a constant of the drawing and not a tuning knob.
 */
const UNIT = Math.sqrt(1.6);

export interface Projection {
  readonly origin: Flat;
  readonly scale: number;
  readonly azimuth?: number;
  readonly elevation?: number;
}

export interface Camera {
  readonly sinA: number;
  readonly cosA: number;
  readonly sinE: number;
  readonly cosE: number;
  readonly k: number;
}

export const cameraOf = ({
  scale,
  azimuth = AZIMUTH,
  elevation = ELEVATION,
}: Projection): Camera => {
  const a = azimuth * RADIANS;
  const e = elevation * RADIANS;
  return {
    sinA: Math.sin(a),
    cosA: Math.cos(a),
    sinE: Math.sin(e),
    cosE: Math.cos(e),
    k: scale * UNIT,
  };
};

export const iso = ([x, y, z]: Point3, projection: Projection): Flat => {
  const { origin } = projection;
  const { sinA, cosA, sinE, cosE, k } = cameraOf(projection);
  return [
    origin[0] + (x * sinA - y * cosA) * k,
    origin[1] + ((x * cosA + y * sinA) * sinE - z * cosE) * k,
  ];
};

/** Plan-space direction the camera looks from. Elevation plays no part in it. */
export const towardViewer = (projection: Projection): Plane => {
  const { sinA, cosA } = cameraOf(projection);
  return [cosA, sinA];
};

/** Distance along the view vector. Larger is nearer the reader. */
export const depthOf = ([x, y, z]: Point3, projection: Projection): number => {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  return (x * cosA + y * sinA) * cosE + z * sinE;
};

/** Screen pixels one world unit of height rises. */
export const screenRise = (height: number, projection: Projection): number => {
  const { cosE, k } = cameraOf(projection);
  return height * cosE * k;
};

export interface FitOptions {
  readonly pad?: number;
  readonly headroom?: number;
  readonly azimuth?: number;
  readonly elevation?: number;
}

/**
 * Uniform scale that fits a point set into a box. The caller owns the degenerate
 * case: fewer than two distinct projected points have no span to divide by.
 */
export const fitProjection = (
  points: ReadonlyArray<Point3>,
  width: number,
  height: number,
  { pad = 24, headroom = 0, azimuth = AZIMUTH, elevation = ELEVATION }: FitOptions = {},
): Projection => {
  const unit: Projection = { origin: [0, 0], scale: 1, azimuth, elevation };
  const flat = points.map((point) => iso(point, unit));
  const xs = flat.map(([x]) => x);
  const ys = flat.map(([, y]) => y);
  const left = Math.min(...xs);
  const right = Math.max(...xs);
  const up = Math.min(...ys);
  const down = Math.max(...ys);
  const scale = Math.min(
    (width - pad * 2) / (right - left),
    (height - pad * 2 - headroom) / (down - up),
  );
  return {
    origin: [
      width / 2 - ((left + right) / 2) * scale,
      headroom + (height - headroom) / 2 - ((up + down) / 2) * scale,
    ],
    scale,
    azimuth,
    elevation,
  };
};

const tenth = (value: number): string => {
  const rounded = Math.round(value * 10) / 10;
  return Object.is(rounded, -0) ? "0" : String(rounded);
};

export const pathOf = (points: ReadonlyArray<Flat>, closed = false): string =>
  points.length === 0
    ? ""
    : `M${tenth(head(points)[0])} ${tenth(head(points)[1])}${points
        .slice(1)
        .map(([x, y]) => `L${tenth(x)} ${tenth(y)}`)
        .join("")}${closed ? "Z" : ""}`;

export const joinPaths = (parts: ReadonlyArray<string>): string => parts.join("");

const signedArea = (points: ReadonlyArray<Flat | Plane>): number => {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const [x0, y0] = pick(points, index);
    const [x1, y1] = pick(points, index + 1);
    total += x0 * y1 - x1 * y0;
  }
  return total / 2;
};

const oriented = (points: Flat[]): Flat[] =>
  signedArea(points) < 0 ? [...points].reverse() : points;

const cross = (o: Flat, a: Flat, b: Flat): number =>
  (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0]);

const convexHull = (points: ReadonlyArray<Flat>): Flat[] => {
  const sorted = [...points].toSorted((a, b) => a[0] - b[0] || a[1] - b[1]);
  const build = (input: ReadonlyArray<Flat>): Flat[] => {
    const stack: Flat[] = [];
    for (const point of input) {
      while (
        stack.length >= 2 &&
        cross(pick(stack, stack.length - 2), pick(stack, stack.length - 1), point) <= 0
      )
        stack.pop();
      stack.push(point);
    }
    stack.pop();
    return stack;
  };
  return [...build(sorted), ...build([...sorted].reverse())];
};

/**
 * Maximal circular runs where `flags[index] === want`. Each run carries the
 * vertex after its last, so tracing a run with an open path closes it.
 */
const runsOf = (flags: ReadonlyArray<boolean>, want: boolean): number[][] => {
  const count = flags.length;
  if (count === 0) return [];
  if (flags.every((flag) => flag === want))
    return want ? [Array.from({ length: count + 1 }, (_, index) => index % count)] : [];

  // Start on a boundary so the scan below cannot split a run that wraps zero.
  let start = 0;
  while (start < count && flags[start] === pick(flags, start + count - 1)) start += 1;

  const runs: number[][] = [];
  const until = start + count;
  let index = start;
  while (index < until) {
    if (pick(flags, index) !== want) {
      index += 1;
      continue;
    }
    // One maximal run, emitted once. Re-entering the loop at every vertex inside
    // a run emits the same run k times, which draws the outline k times over.
    const run: number[] = [];
    while (index < until && pick(flags, index) === want) {
      run.push(index % count);
      index += 1;
    }
    run.push(index % count);
    runs.push(run);
  }
  return runs;
};

export interface Plan {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly d: number;
  readonly r: number;
}

export const roundedPlan = ({ x, y, w, d, r }: Plan, steps = 8): Plane[] => {
  const radius = Math.max(0, Math.min(r, w / 2, d / 2));
  const corners: Array<[number, number, number]> = [
    [x + w - radius, y + radius, -90],
    [x + w - radius, y + d - radius, 0],
    [x + radius, y + d - radius, 90],
    [x + radius, y + radius, 180],
  ];
  const ring: Plane[] = [];
  for (const [cx, cy, from] of corners) {
    if (radius <= 0) {
      ring.push([cx, cy]);
      continue;
    }
    for (let step = 0; step <= steps; step += 1) {
      const angle = (from + (step / steps) * 90) * RADIANS;
      ring.push([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius]);
    }
  }
  return ring;
};

export const ringOf = roundedPlan;

export const circleRing = (cx: number, cy: number, radius: number, steps = 40): Plane[] =>
  Array.from({ length: steps }, (_, index) => {
    const angle = (index / steps) * Math.PI * 2;
    return [cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius] as Plane;
  });

export const insetPlan = ({ x, y, w, d, r }: Plan, by: number): Plan => ({
  x: x + by,
  y: y + by,
  w: w - by * 2,
  d: d - by * 2,
  r: Math.max(0, r - by),
});

export interface SolidPaths {
  readonly fill: string;
  readonly outline: string;
  readonly crease: string;
  readonly top: string;
  readonly shades: ReadonlyArray<string>;
  readonly bevel?: string;
  readonly seamless?: boolean;
}

export interface ExtrudeOptions {
  readonly convex?: boolean;
  readonly bevel?: number;
}

const FACING_EPSILON = 1e-9;

/**
 * A prism from a plan ring. The ring's winding fixes which edges face the reader,
 * so a ring built y-up inverts every side: `roundedPlan` and `circleRing` both
 * emit the winding this expects.
 */
export const extrude = (
  ring: ReadonlyArray<Plane>,
  z: number,
  height: number,
  projection: Projection,
  options: ExtrudeOptions = {},
): SolidPaths => {
  const { convex = true, bevel = 0 } = options;
  const count = ring.length;
  const counter = signedArea(ring) > 0;
  const [vx, vy] = towardViewer(projection);
  const { sinA, cosA } = cameraOf(projection);
  const [lx, ly] = [-sinA, cosA];

  const normals: Plane[] = ring.map((point, index) => {
    const next = pick(ring, index + 1);
    const dx = next[0] - point[0];
    const dy = next[1] - point[1];
    const len = Math.hypot(dx, dy) || 1;
    return counter ? [dy / len, -dx / len] : [-dy / len, dx / len];
  });

  const facing = normals.map(([nx, ny]) => nx * vx + ny * vy > FACING_EPSILON);

  const top: Flat[] = ring.map(([x, y]) => iso([x, y, z + height], projection));
  const bottom: Flat[] = ring.map(([x, y]) => iso([x, y, z], projection));

  const outlines: string[] = [];
  const creases: string[] = [];

  for (const run of runsOf(facing, false))
    outlines.push(pathOf(run.map((index) => pick(top, index))));

  for (const run of runsOf(facing, true)) {
    creases.push(pathOf(run.map((index) => pick(top, index))));
    if (height > 0) outlines.push(pathOf(run.map((index) => pick(bottom, index))));
  }

  // A vertical edge sits where facing changes, on the vertex that LEADS the
  // change — the first vertex of the front run, not the last of the back one.
  // Drawing it on the trailing vertex puts the edge a facet away, and the
  // silhouette no longer closes on the corner it belongs to.
  if (height > 0)
    for (let index = 0; index < count; index += 1) {
      if (pick(facing, index - 1) === facing[index]) continue;
      outlines.push(pathOf([top[index] as Flat, bottom[index] as Flat]));
    }

  const fill = convex
    ? pathOf(convexHull([...top, ...bottom]), true)
    : joinPaths([
        pathOf(oriented(top), true),
        pathOf(oriented(bottom), true),
        ...ring.map((_, index) => {
          if (!facing[index]) return "";
          const next = (index + 1) % count;
          return pathOf(
            oriented([
              top[index] as Flat,
              top[next] as Flat,
              bottom[next] as Flat,
              bottom[index] as Flat,
            ]),
            true,
          );
        }),
      ]);

  const shades: string[] = [];
  if (height > 0) {
    const buckets: string[][] = Array.from({ length: SHADES }, () => []);
    for (let index = 0; index < count; index += 1) {
      if (!facing[index]) continue;
      const [nx, ny] = pick(normals, index);
      const lit = (nx * lx + ny * ly + 1) / 2;
      const shade = Math.min(SHADES - 1, Math.max(0, Math.floor(lit * SHADES)));
      const next = index + 1;
      pick(buckets, shade).push(
        pathOf(
          oriented([pick(top, index), pick(top, next), pick(bottom, next), pick(bottom, index)]),
          true,
        ),
      );
    }
    for (const bucket of buckets) shades.push(joinPaths(bucket));
  }

  let bevelled: string | undefined;
  if (bevel > 0 && height > 0) {
    const insets: Flat[] = ring.map(([x, y], index) => {
      const previous = pick(normals, index - 1);
      const next = pick(normals, index);
      const mx = previous[0] + next[0];
      const my = previous[1] + next[1];
      const len = Math.hypot(mx, my) || 1;
      return iso([x - (mx / len) * bevel, y - (my / len) * bevel, z + height], projection);
    });
    const runs: string[] = [];
    for (const run of runsOf(facing, true)) {
      if (run.length < 3) continue;
      const points = [
        pick(top, head(run)),
        ...run.slice(1, -1).map((index) => pick(insets, index)),
        pick(top, run[run.length - 1] as number),
      ];
      runs.push(pathOf(points));
    }
    bevelled = joinPaths(runs);
  }

  return {
    fill,
    outline: joinPaths(outlines),
    crease: joinPaths(creases),
    top: pathOf(oriented(top), true),
    shades,
    bevel: bevelled,
  };
};

export const slabOf = (
  plan: Plan,
  z: number,
  height: number,
  projection: Projection,
  steps = 8,
  bevel = 0,
): SolidPaths => extrude(ringOf(plan, steps), z, height, projection, { convex: true, bevel });

export const cylinder = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  height: number,
  projection: Projection,
  steps = 32,
  bevel = 0,
): SolidPaths =>
  extrude(circleRing(cx, cy, radius, steps), z, height, projection, { convex: true, bevel });

export const onTop = (
  points: ReadonlyArray<Plane>,
  z: number,
  projection: Projection,
  closed = false,
): string =>
  pathOf(
    points.map(([x, y]) => iso([x, y, z], projection)),
    closed,
  );

export const planOutline = (plan: Plan, z: number, projection: Projection, steps = 8): string =>
  onTop(ringOf(plan, steps), z, projection, true);

export const lineOnTop = (from: Plane, to: Plane, z: number, projection: Projection): string =>
  pathOf([iso([from[0], from[1], z], projection), iso([to[0], to[1], z], projection)]);

export const segment = (from: Point3, to: Point3, projection: Projection): string =>
  pathOf([iso(from, projection), iso(to, projection)]);

export const rise = (at: Plane, from: number, to: number, projection: Projection): string =>
  segment([at[0], at[1], from], [at[0], at[1], to], projection);

export const ring = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  projection: Projection,
  steps = 40,
): string =>
  pathOf(
    circleRing(cx, cy, radius, steps).map(([x, y]) => iso([x, y, z], projection)),
    true,
  );

export const pointsAt = (points: ReadonlyArray<Point3>, projection: Projection): Flat[] =>
  points.map((point) => iso(point, projection));

export const dotGrid = (
  x: number,
  y: number,
  columns: number,
  rows: number,
  gap: number,
  z: number,
  projection: Projection,
): Flat[] => {
  const out: Flat[] = [];
  for (let row = 0; row < rows; row += 1)
    for (let column = 0; column < columns; column += 1)
      out.push(iso([x + column * gap, y + row * gap, z], projection));
  return out;
};

export const haloOf = (plan: Plan, z: number, height: number, projection: Projection): string =>
  slabOf(plan, z, height, projection).fill;

export const corners = ({ x, y, w, d }: Plan, inset = 0): Plane[] => [
  [x + inset, y + inset],
  [x + w - inset, y + inset],
  [x + inset, y + d - inset],
  [x + w - inset, y + d - inset],
];

export const boxCorners = ({ x, y, w, d }: Plan, z0: number, z1: number): Point3[] => {
  const out: Point3[] = [];
  for (const px of [x, x + w])
    for (const py of [y, y + d]) for (const pz of [z0, z1]) out.push([px, py, pz]);
  return out;
};

/** Grip lines around a knob. A wider cull than the facing test, because a line on the silhouette reads as a scratch. */
export const knurl = (
  cx: number,
  cy: number,
  radius: number,
  z0: number,
  z1: number,
  count: number,
  projection: Projection,
  inset = 0.4,
): string => {
  const [vx, vy] = towardViewer(projection);
  const lines: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const angle = (index / count) * Math.PI * 2;
    const nx = Math.cos(angle);
    const ny = Math.sin(angle);
    if (nx * vx + ny * vy < 0.15) continue;
    lines.push(
      segment(
        [cx + nx * radius, cy + ny * radius, z0 + inset],
        [cx + nx * radius, cy + ny * radius, z1 - inset],
        projection,
      ),
    );
  }
  return joinPaths(lines);
};

/** The half of a plan circle that faces the reader. */
export const sideArc = (
  cx: number,
  cy: number,
  radius: number,
  z: number,
  projection: Projection,
  steps = 24,
): string => {
  const [vx, vy] = towardViewer(projection);
  const facing = Math.atan2(vy, vx);
  const points: Flat[] = [];
  for (let step = 0; step <= steps; step += 1) {
    const angle = facing - Math.PI / 2 + (step / steps) * Math.PI;
    points.push(iso([cx + Math.cos(angle) * radius, cy + Math.sin(angle) * radius, z], projection));
  }
  return pathOf(points);
};

export const ringSeam = (ring: ReadonlyArray<Plane>, z: number, projection: Projection): string => {
  const counter = signedArea(ring) > 0;
  const [vx, vy] = towardViewer(projection);
  const facing = ring.map((point, index) => {
    const next = pick(ring, index + 1);
    const nx = counter ? next[1] - point[1] : point[1] - next[1];
    const ny = counter ? point[0] - next[0] : next[0] - point[0];
    return nx * vx + ny * vy > FACING_EPSILON;
  });
  return joinPaths(
    runsOf(facing, true).map((run) =>
      pathOf(
        run.map((index) => {
          const point = pick(ring, index);
          return iso([point[0], point[1], z], projection);
        }),
      ),
    ),
  );
};

export const sideSeam = (plan: Plan, z: number, projection: Projection, steps = 8): string =>
  ringSeam(ringOf(plan, steps), z, projection);

/** A bore or pipe cross-section standing on one horizontal axis. */
export const sideRing = (
  center: Point3,
  radius: number,
  axis: "x" | "y",
  projection: Projection,
  steps = 20,
): string => {
  const points: Flat[] = [];
  for (let index = 0; index < steps; index += 1) {
    const angle = (index / steps) * Math.PI * 2;
    const u = Math.cos(angle) * radius;
    const v = Math.sin(angle) * radius;
    points.push(
      iso(
        axis === "x"
          ? [center[0], center[1] + u, center[2] + v]
          : [center[0] + u, center[1], center[2] + v],
        projection,
      ),
    );
  }
  return pathOf(points, true);
};

/** A helix split at its facing flips, so a rod can be drawn between the two runs. */
export const coil = (
  from: number,
  to: number,
  center: Plane,
  radius: number,
  turns: number,
  axis: "x" | "y",
  projection: Projection,
  perTurn = 16,
): { back: string; front: string } => {
  const count = Math.max(1, Math.round(turns * perTurn));
  const samples: Array<{ point: Point3; facing: boolean }> = [];
  for (let index = 0; index <= count; index += 1) {
    const share = index / count;
    const angle = share * turns * Math.PI * 2;
    const u = Math.cos(angle) * radius;
    const v = Math.sin(angle) * radius;
    const along = from + (to - from) * share;
    samples.push({
      point:
        axis === "x"
          ? [along, center[0] + u, center[1] + v]
          : [center[0] + u, along, center[1] + v],
      facing:
        depthOf(
          axis === "x"
            ? [0, Math.cos(angle), Math.sin(angle)]
            : [Math.cos(angle), 0, Math.sin(angle)],
          projection,
        ) > 0,
    });
  }
  // Split the helix where it turns away from the reader, keeping the turn's own
  // point in both runs so the two meet instead of leaving a gap.
  const back: string[] = [];
  const front: string[] = [];
  let run: Flat[] = [];
  let near: boolean | null = null;

  for (const sample of samples) {
    const flat = iso(sample.point, projection);
    if (near === null) near = sample.facing;
    if (sample.facing !== near) {
      run.push(flat);
      (near ? front : back).push(pathOf(run));
      run = [flat];
      near = sample.facing;
      continue;
    }
    run.push(flat);
  }
  if (run.length > 1) (near ? front : back).push(pathOf(run));

  return { back: joinPaths(back), front: joinPaths(front) };
};

export interface Ticks {
  readonly minor: string;
  readonly major: string;
}

/** Stations on a ruler, marking every `every`-th one as major. */
const markEvery = (from: number, to: number, step: number, every: number) => {
  const first = Math.ceil(from / step) * step;
  const start = Math.round(first / step);
  const stations: Array<{ at: number; big: boolean }> = [];
  // The index advances with the station. Held at its first value, every tick
  // inherits that one's verdict and a ruler comes out all-major or all-minor.
  for (let n = 0, at = first; at <= to + 1e-9; n += 1, at = first + n * step)
    stations.push({ at, big: every > 0 && (start + n) % every === 0 });
  return stations;
};

export const topTicks = (
  from: number,
  to: number,
  step: number,
  every: number,
  edge: number,
  z: number,
  lengths: readonly [number, number],
  projection: Projection,
  axis: "x" | "y" = "x",
): Ticks => {
  const minor: string[] = [];
  const major: string[] = [];
  for (const station of markEvery(from, to, step, every))
    (station.big ? major : minor).push(
      axis === "x"
        ? lineOnTop(
            [station.at, edge],
            [station.at, edge + (station.big ? lengths[1] : lengths[0])],
            z,
            projection,
          )
        : lineOnTop(
            [edge, station.at],
            [edge + (station.big ? lengths[1] : lengths[0]), station.at],
            z,
            projection,
          ),
    );
  return { minor: joinPaths(minor), major: joinPaths(major) };
};

export const sideTicks = (
  from: number,
  to: number,
  step: number,
  every: number,
  face: number,
  top: number,
  lengths: readonly [number, number],
  projection: Projection,
  axis: "x" | "y" = "x",
): Ticks => {
  const minor: string[] = [];
  const major: string[] = [];
  for (const station of markEvery(from, to, step, every)) {
    const length = station.big ? lengths[1] : lengths[0];
    const line =
      axis === "x"
        ? segment([station.at, face, top], [station.at, face, top - length], projection)
        : segment([face, station.at, top], [face, station.at, top - length], projection);
    (station.big ? major : minor).push(line);
  }
  return { minor: joinPaths(minor), major: joinPaths(major) };
};

export const radialTicks = (
  cx: number,
  cy: number,
  radius: number,
  count: number,
  every: number,
  z: number,
  lengths: readonly [number, number],
  projection: Projection,
  from = 0,
  span = Math.PI * 2,
): Ticks => {
  const minor: string[] = [];
  const major: string[] = [];
  const steps = Math.abs(span - Math.PI * 2) < 1e-9 ? count : count + 1;
  for (let index = 0; index < steps; index += 1) {
    const angle = from + (index / count) * span;
    const length = every > 0 && index % every === 0 ? lengths[1] : lengths[0];
    const dx = Math.sin(angle);
    const dy = -Math.cos(angle);
    const line = lineOnTop(
      [cx + dx * (radius - length), cy + dy * (radius - length)],
      [cx + dx * radius, cy + dy * radius],
      z,
      projection,
    );
    (every > 0 && index % every === 0 ? major : minor).push(line);
  }
  return { minor: joinPaths(minor), major: joinPaths(major) };
};

const round3 = (value: number): string => String(Math.round(value * 1000) / 1000);

const axesAt = (point: Plane, z: number, projection: Projection) => {
  const origin = iso([point[0], point[1], z], projection);
  const x = iso([point[0] + 1, point[1], z], projection);
  const y = iso([point[0], point[1] + 1, z], projection);
  const up = iso([point[0], point[1], z + 1], projection);
  return {
    origin,
    x: [x[0] - origin[0], x[1] - origin[1]] as Flat,
    y: [y[0] - origin[0], y[1] - origin[1]] as Flat,
    down: [0, up[1] - origin[1]] as Flat,
  };
};

export const topMatrix = (
  at: Plane,
  z: number,
  projection: Projection,
  along: "x" | "y" = "x",
): string => {
  const { origin, x, y } = axesAt(at, z, projection);
  const a: Flat = along === "x" ? x : [-y[0], -y[1]];
  const b: Flat = along === "x" ? y : x;
  return `matrix(${round3(a[0])} ${round3(a[1])} ${round3(b[0])} ${round3(b[1])} ${round3(origin[0])} ${round3(origin[1])})`;
};

export const sideMatrix = (
  at: Plane,
  z: number,
  projection: Projection,
  face: "left" | "right",
): string => {
  const { origin, x, y, down } = axesAt(at, z, projection);
  const a: Flat = face === "left" ? x : [-y[0], -y[1]];
  const b: Flat = face === "left" ? down : [down[0], -down[1]];
  return `matrix(${round3(a[0])} ${round3(a[1])} ${round3(b[0])} ${round3(b[1])} ${round3(origin[0])} ${round3(origin[1])})`;
};

/** The screen displacement of a world move, for a transform attribute. */
export const axisVector = (projection: Projection, [dx, dy, dz]: Point3): Flat => {
  const to = iso([dx, dy, dz], projection);
  const from = iso([0, 0, 0], projection);
  return [to[0] - from[0], to[1] - from[1]];
};

export const translateAlong = (projection: Projection, by: Point3): string => {
  const [x, y] = axisVector(projection, by);
  const fine = (value: number) => Math.round(value * 100) / 100;
  return `translate(${fine(x)} ${fine(y)})`;
};

/**
 * Counter-move for a rod that slides out of a gland.
 *
 * This one needs a live DOM, and the kit is compiled without the DOM lib, so it
 * ships as source for the generated page to evaluate rather than as kit code.
 */
export const holdStillSource = (dx: number, dy: number): string =>
  `for (const held of el.querySelectorAll("[data-hold]")) { ${dx === 0 && dy === 0 ? 'held.removeAttribute("transform");' : `held.setAttribute("transform", "translate(${-dx} ${-dy})");`} }`;
