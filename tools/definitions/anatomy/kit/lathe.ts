/**
 * Turned parts: a meridian profile revolved along any axis, shaded from the
 * profile's own curvature rather than from its facets.
 */

import type { Point3, Projection } from "./iso-kit";
import { cameraOf, iso, joinPaths, pathOf } from "./iso-kit";
import { head, pick } from "./list";

export type V3 = Point3;
export type V2 = [number, number];

export interface Frame {
  readonly o: V3;
  readonly a: V3;
  readonly u: V3;
  readonly v: V3;
}

/** `[s, r]`, or `[s, r, 1]` where the third element marks a knot the curve runs through. */
export type Knot = [number, number] | [number, number, number];
export type Meridian = Knot[];

const TAU = Math.PI * 2;
const EPS = 1e-9;

export const dot3 = (a: V3, b: V3): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];

const add3 = (a: V3, b: V3): V3 => [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
export const sub3 = (a: V3, b: V3): V3 => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
export const mul3 = (a: V3, k: number): V3 => [a[0] * k, a[1] * k, a[2] * k];
export const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);
export const cross3 = (a: V3, b: V3): V3 => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0],
];
/**
 * Divide, never multiply by the reciprocal.
 *
 * `a * (1 / len)` and `a / len` differ in the last bit, and that bit survives
 * every projection downstream, so a frame built one way renders a hair off a
 * frame built the other way.
 */
export const unit3 = (a: V3): V3 => {
  const length = len3(a) || 1;
  return [a[0] / length, a[1] / length, a[2] / length];
};
export const lerp3 = (a: V3, b: V3, t: number): V3 => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
  a[2] + (b[2] - a[2]) * t,
];

export const frameOf = (o: V3, a: V3, u: V3, v: V3): Frame => ({ o, a, u, v });

/** An orthonormal frame around an axis, flipping the helper near the pole so the cross product never vanishes. */
export const frameAlong = (o: V3, a: V3): Frame => {
  const axis = unit3(a);
  const helper: V3 = Math.abs(axis[2]) > 0.9 ? [1, 0, 0] : [0, 0, 1];
  const u = unit3(cross3(helper, axis));
  return { o, a: axis, u, v: cross3(axis, u) };
};

export const pointOf = (F: Frame, s: number, r: number, angle: number): V3 => {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [
    F.o[0] + F.a[0] * s + r * (c * F.u[0] + n * F.v[0]),
    F.o[1] + F.a[1] * s + r * (c * F.u[1] + n * F.v[1]),
    F.o[2] + F.a[2] * s + r * (c * F.u[2] + n * F.v[2]),
  ];
};

export const radialOf = (F: Frame, angle: number): V3 => {
  const c = Math.cos(angle);
  const n = Math.sin(angle);
  return [c * F.u[0] + n * F.v[0], c * F.u[1] + n * F.v[1], c * F.u[2] + n * F.v[2]];
};

export const viewOf = (projection: Projection): V3 => {
  const { sinA, cosA, sinE, cosE } = cameraOf(projection);
  return [cosA * cosE, sinA * cosE, sinE];
};

const LIGHT_UP = 1.2;

export const lightOf = (projection: Projection): V3 => {
  const { sinA, cosA } = cameraOf(projection);
  return unit3([-sinA, cosA, LIGHT_UP]);
};

export const scaleOf = (projection: Projection): number => cameraOf(projection).k;

const BANDS = [0, 0.2, 0.42, 0.62];

export const bandOf = (score: number): 0 | 1 | 2 | 3 | 4 => {
  let tone = 0;
  while (tone < BANDS.length && score >= (BANDS[tone] as number)) tone += 1;
  return tone as 0 | 1 | 2 | 3 | 4;
};

export const toneOf = (normal: V3, projection: Projection): 0 | 1 | 2 | 3 | 4 =>
  bandOf(dot3(unit3(normal), lightOf(projection)));

export const fadeOf = (value: number, [lo, hi]: readonly [number, number]): number => {
  const t = Math.max(0, Math.min(1, (value - lo) / (hi - lo || 1e-9)));
  return t * t * (3 - 2 * t);
};

export const stepsFor = (radius: number, least: number, most: number, scale = 0): number =>
  Math.max(
    least,
    Math.min(
      most,
      scale ? Math.ceil((TAU * radius * scale) / 3) : Math.round((radius * 1.3) / 4) * 4,
    ),
  );

/**
 * Fritsch-Carlson monotone cubic. A natural spline overshoots between two knots
 * of equal radius, and an overshoot in a tone band reads as a staircase, so the
 * slopes are flattened at every local extremum instead.
 */
const hermiteSlopes = (run: Meridian): number[] => {
  const n = run.length - 1;
  const h: number[] = [];
  const delta: number[] = [];
  for (let index = 0; index < n; index += 1) {
    h[index] = pick(run, index + 1)[0] - pick(run, index)[0];
    delta[index] = (pick(run, index + 1)[1] - pick(run, index)[1]) / (h[index] as number);
  }
  if (n === 1) return [delta[0] as number, delta[0] as number];

  const d: number[] = new Array(n + 1);
  const end = (i: number, j: number, d0: number, d1: number): number => {
    let v =
      ((2 * (h[i] as number) + (h[j] as number)) * d0 - (h[i] as number) * d1) /
      ((h[i] as number) + (h[j] as number));
    if (Math.sign(v) !== Math.sign(d0)) v = 0;
    else if (Math.sign(d0) !== Math.sign(d1) && Math.abs(v) > 3 * Math.abs(d0)) v = 3 * d0;
    return v;
  };
  d[0] = end(0, 1, delta[0] as number, delta[1] as number);
  d[n] = end(n - 1, n - 2, delta[n - 1] as number, delta[n - 2] as number);
  for (let index = 1; index < n; index += 1) {
    if ((delta[index - 1] as number) * (delta[index] as number) <= 0) {
      d[index] = 0;
      continue;
    }
    const w1 = 2 * (h[index] as number) + (h[index - 1] as number);
    const w2 = (h[index] as number) + 2 * (h[index - 1] as number);
    d[index] = (w1 + w2) / (w1 / (delta[index - 1] as number) + w2 / (delta[index] as number));
  }
  return d;
};

export interface CurveRun {
  readonly radius: (s: number) => number;
  readonly slope: (s: number) => number;
}

/** A smooth run needs at least three knots and a strictly rising `s`. A disc rim, where `ds` is zero, is never one. */
export const curveRuns = (meridian: Meridian): Array<CurveRun | null> => {
  const segments: Array<CurveRun | null> = new Array(Math.max(0, meridian.length - 1)).fill(null);
  let start = 0;
  while (start < meridian.length - 1) {
    let end = start + 1;
    while (
      end < meridian.length - 1 &&
      pick(meridian, end)[2] &&
      Math.abs(pick(meridian, end + 1)[0] - pick(meridian, end)[0]) > EPS &&
      Math.abs(pick(meridian, end)[0] - pick(meridian, end - 1)[0]) > EPS
    )
      end += 1;
    const run = meridian.slice(start, end + 1);
    const count = run.length - 1;
    // Every step must rise. A zero-length step is a disc rim, and fitting a
    // Hermite through it divides by zero for a slope that does not exist.
    const rising = run.every(
      (knot, index) => index === 0 || knot[0] - (run[index - 1] as Meridian[number])[0] > EPS,
    );
    if (count >= 2 && rising) {
      const slopes = hermiteSlopes(run);
      for (let index = 0; index < count; index += 1) {
        const [s0, r0] = pick(run, index);
        const [s1, r1] = pick(run, index + 1);
        const h = s1 - s0;
        const d0 = pick(slopes, index);
        const d1 = pick(slopes, index + 1);
        segments[start + index] = {
          radius: (s) => {
            const t = (s - s0) / h;
            const t2 = t * t;
            const t3 = t2 * t;
            return (
              (2 * t3 - 3 * t2 + 1) * r0 +
              (t3 - 2 * t2 + t) * h * d0 +
              (-2 * t3 + 3 * t2) * r1 +
              (t3 - t2) * h * d1
            );
          },
          slope: (s) => {
            const t = (s - s0) / h;
            const t2 = t * t;
            return (
              ((6 * t2 - 6 * t) * r0 + (6 * t - 6 * t2) * r1) / h +
              (3 * t2 - 4 * t + 1) * d0 +
              (3 * t2 - 2 * t) * d1
            );
          },
        };
      }
    }
    start = end;
  }
  return segments;
};

export interface Curve {
  readonly s0: number;
  readonly s1: number;
  readonly radius: (s: number) => number;
  readonly slope: (s: number) => number;
  readonly analytic: boolean;
}

/** The profile as two callables, either the caller's analytic pair or the Hermite fit. */
export const profileCurve = (
  profile: Meridian,
  {
    slope = null,
    radius = null,
  }: { slope?: ((s: number) => number) | null; radius?: ((s: number) => number) | null } = {},
): Curve => {
  const s0 = head(profile)[0];
  const s1 = pick(profile, profile.length - 1)[0];
  const analytic = slope !== null && radius !== null;
  const segments = analytic ? null : curveRuns(profile);

  const find = (
    s: number,
  ): { segment: CurveRun; s0: number; s1: number; r0: number; r1: number } | null => {
    for (let index = 0; index < profile.length - 1; index += 1) {
      const here = pick(profile, index);
      const next = pick(profile, index + 1);
      if (s <= next[0] || index === profile.length - 2) {
        const segment = segments?.[index];
        const span = next[0] - here[0];
        return segment && span > EPS
          ? { segment, s0: here[0], s1: next[0], r0: here[1], r1: next[1] }
          : null;
      }
    }
    return null;
  };

  const value = (s: number) => {
    const clamped = Math.max(s0, Math.min(s1, s));
    const given =
      analytic && slope !== null && radius !== null
        ? { r: radius(clamped), g: slope(clamped) }
        : null;
    if (given) return given;
    const found = find(clamped);
    if (!found) {
      const last = pick(profile, profile.length - 1);
      return { r: last[1], g: 0 };
    }
    return { r: found.segment.radius(clamped), g: found.segment.slope(clamped) };
  };

  return {
    s0,
    s1,
    analytic,
    radius: (s) => value(s).r,
    slope: (s) => value(s).g,
  };
};

const clamp01 = (value: number): number => Math.max(0, Math.min(1, value));

export const pathLength = (points: ReadonlyArray<V3>): number => {
  let total = 0;
  for (let index = 1; index < points.length; index += 1) {
    const here = pick(points, index);
    const previous = pick(points, index - 1);
    total += Math.hypot(here[0] - previous[0], here[1] - previous[1], here[2] - previous[2]);
  }
  return total;
};

export const resample = (points: ReadonlyArray<V3>, spacing: number): V3[] => {
  const total = pathLength(points);
  if (total === 0 || points.length < 2) return [...points];
  const count = Math.max(1, Math.round(total / spacing));
  return Array.from({ length: count + 1 }, (_, index) =>
    pointAlong(points, (index / count) * total),
  );
};

const cumulative = (points: ReadonlyArray<V3>): number[] => {
  const walked = [0];
  for (let index = 1; index < points.length; index += 1)
    walked.push(
      (walked[index - 1] as number) +
        Math.hypot(
          (points[index] as V3)[0] - (points[index - 1] as V3)[0],
          (points[index] as V3)[1] - (points[index - 1] as V3)[1],
          (points[index] as V3)[2] - (points[index - 1] as V3)[2],
        ),
    );
  return walked;
};

export const pointAlong = (points: ReadonlyArray<V3>, along: number): V3 => {
  if (points.length === 0) return [0, 0, 0];
  if (points.length === 1) return points[0] as V3;
  const lengths = cumulative(points);
  const total = pick(lengths, lengths.length - 1);
  if (total === 0) return points[0] as V3;
  const want = Math.max(0, Math.min(total, along));
  for (let index = 1; index < points.length; index += 1) {
    if (want <= (lengths[index] as number) || index === points.length - 1) {
      const span = (lengths[index] as number) - (lengths[index - 1] as number);
      return lerp3(
        points[index - 1] as V3,
        points[index] as V3,
        span > EPS ? (want - (lengths[index - 1] as number)) / span : 0,
      );
    }
  }
  return points[points.length - 1] as V3;
};

export const tangentAlong = (points: ReadonlyArray<V3>, along: number): V3 =>
  unit3(sub3(pointAlong(points, along + 0.6), pointAlong(points, Math.max(0, along - 0.6))));

/** An arclength slice, seeded with an exact lerp so the cut lands on the station. */
export const cut = (points: ReadonlyArray<V3>, from: number, to: number): V3[] => {
  if (points.length < 2) return [...points];
  const lengths = cumulative(points);
  const total = pick(lengths, lengths.length - 1);
  const out: V3[] = [pointAlong(points, from)];
  for (let index = 1; index < points.length - 1; index += 1)
    if ((lengths[index] as number) > from && (lengths[index] as number) < to)
      out.push(pick(points, index));
  out.push(pointAlong(points, Math.min(to, total)));
  return out;
};

/** Bend a polyline's corners into arcs. A bend facing the reader foreshortens, so it takes a larger radius than one across the screen. */
export const fillet = (
  points: ReadonlyArray<V3>,
  radius: number,
  perArc = 7,
  {
    projection = null,
    tube = 0,
    margin = 1.3,
  }: { projection?: Projection | null; tube?: number; margin?: number } = {},
): V3[] => {
  if (points.length < 3) return [...points];
  const view = projection ? viewOf(projection) : null;
  const out: V3[] = [pick(points, 0)];

  for (let index = 1; index < points.length - 1; index += 1) {
    const here = pick(points, index);
    const into = unit3(sub3(here, pick(points, index - 1)));
    const outOf = unit3(sub3(pick(points, index + 1), here));
    const turn = Math.acos(Math.max(-1, Math.min(1, dot3(into, outOf))));
    if (turn < 1e-3) {
      out.push(here);
      continue;
    }
    const room =
      Math.min(
        len3(sub3(here, pick(points, index - 1))),
        len3(sub3(pick(points, index + 1), here)),
      ) * 0.48;
    let bend = radius;
    if (view && tube > 0) {
      const facing = Math.abs(dot3(unit3(cross3(into, outOf)), view));
      bend = Math.max(radius, (margin * tube) / (0.7 * Math.max(0.05, facing) ** 2));
    }
    const cutLength = Math.min(bend * Math.tan(turn / 2), room);
    const a = sub3(here, mul3(into, cutLength));
    const b = add3(here, mul3(outOf, cutLength));
    const count = Math.max(2, Math.ceil((perArc * turn) / (Math.PI / 2)));
    for (let step = 0; step <= count; step += 1) {
      const t = step / count;
      out.push(lerp3(lerp3(a, here, t), lerp3(here, b, t), t));
    }
  }

  out.push(pick(points, points.length - 1));
  return out;
};

const countFor = (span: number, r: number, k: number, base: number): number =>
  Math.max(2, Math.ceil((base * span) / TAU), Math.ceil((span * r * k) / 1.5));

/**
 * The part of a rim circle the reader can see. A rim that runs to the silhouette
 * reads as a broken line, so each true limb is trimmed a fraction of a pixel.
 */
export const arcOf = (
  F: Frame,
  s: number,
  r: number,
  projection: Projection,
  {
    slope = 0,
    steps = 0,
    least = 0.02,
    inward = false,
    from = 0,
    to = TAU,
    trim = 0.3,
  }: {
    slope?: number;
    steps?: number;
    least?: number;
    inward?: boolean;
    from?: number;
    to?: number;
    trim?: number;
  } = {},
): string => {
  const k = scaleOf(projection);
  const view = viewOf(projection);
  const aV = dot3(F.a, view);
  const uV = dot3(F.u, view);
  const vV = dot3(F.v, view);
  const flat = Math.hypot(uV, vV);
  const phi = Math.atan2(vV, uV);
  const norm = Math.hypot(1, slope);

  let visible: Array<[number, number]>;
  if (flat < 1e-9) {
    const facing = (inward ? slope * aV : -slope * aV) / norm;
    visible = facing > least ? [[phi, phi + TAU]] : [];
  } else if (inward) {
    const c = (slope * aV - least * norm) / flat;
    visible =
      c <= -1 ? [] : c >= 1 ? [[phi, phi + TAU]] : [[phi + Math.acos(c), phi + TAU - Math.acos(c)]];
  } else {
    const c = (least * norm + slope * aV) / flat;
    visible =
      c >= 1 ? [] : c <= -1 ? [[phi, phi + TAU]] : [[phi - Math.acos(c), phi + Math.acos(c)]];
  }

  if (visible.length === 0) return "";

  const full = Math.abs(to - from - TAU) < 1e-9;
  const base = steps > 0 ? steps : stepsFor(r, 24, 112);
  const wanted: Array<[number, number]> = full
    ? visible
    : visible
        .map(([a, b]): [number, number] => [Math.max(a, from), Math.min(b, to)])
        .filter(([a, b]) => b > a);

  if (wanted.length === 0) return "";
  const only = wanted[0];
  if (full && only !== undefined && Math.abs(only[1] - only[0] - TAU) < 1e-9) {
    const total = countFor(TAU, r, k, base);
    return pathOf(
      Array.from({ length: total }, (_, index) =>
        iso(pointOf(F, s, r, only[0] + (index / (total - 1)) * TAU), projection),
      ),
      true,
    );
  }

  const parts: string[] = [];
  for (const [start, stop] of wanted) {
    const span = stop - start;
    if (span <= 0) continue;
    const count = countFor(span, r, k, base);
    const points = Array.from({ length: count }, (_, index) =>
      iso(pointOf(F, s, r, start + (index / Math.max(1, count - 1)) * span), projection),
    );
    if (points.length >= 2) {
      const before = points[0];
      const startTrim = Math.min(
        span * 0.25,
        trim / Math.max(1, len3(sub3(pointOf(F, s, r, start + 0.01), pointOf(F, s, r, start)))),
      );
      const stopTrim = Math.min(
        span * 0.25,
        trim / Math.max(1, len3(sub3(pointOf(F, s, r, stop - 0.01), pointOf(F, s, r, stop)))),
      );
      const first = points[0];
      const last = points.length - 1;
      if (startTrim > 0 && first !== undefined)
        points[0] = iso(pointOf(F, s, r, start + startTrim), projection);
      if (stopTrim > 0 && last > 0)
        points[last] = iso(pointOf(F, s, r, stop - stopTrim), projection);
      const lead = points[0];
      if (
        lead !== undefined &&
        before !== undefined &&
        Math.hypot(lead[0] - before[0], lead[1] - before[1]) > 0
      )
        parts.push(pathOf(points));
    }
  }
  return joinPaths(parts);
};

export const circleOf = (
  F: Frame,
  s: number,
  r: number,
  projection: Projection,
  steps = 0,
): string => {
  const count = steps > 0 ? steps : stepsFor(r, 24, 112);
  return pathOf(
    Array.from({ length: count }, (_, index) =>
      iso(pointOf(F, s, r, (index / count) * TAU), projection),
    ),
    true,
  );
};

export const facingOf = (F: Frame, angle: number, projection: Projection, slope = 0): number =>
  dot3(unit3(sub3(radialOf(F, angle), mul3(F.a, slope))), viewOf(projection));

/** Ribs on a cone or cylinder. `fade` returns them with a per-rib alpha rather than culling by facing. */
export const ribsOf = (
  F: Frame,
  s0: number,
  s1: number,
  r: number,
  count: number,
  projection: Projection,
  {
    phase = 0,
    twist = 0,
    least = 0.12,
    r1 = r,
    fade = null,
    seams = false,
  }: {
    phase?: number;
    twist?: number;
    least?: number;
    r1?: number;
    fade?: readonly [number, number] | null;
    seams?: boolean | "first" | "last";
  } = {},
): string | Array<{ d: string; alpha: number }> => {
  const view = viewOf(projection);
  const cone = (r1 - r) / (s1 - s0 || 1);
  const out: Array<{ d: string; alpha: number }> = [];
  const plain: string[] = [];

  for (let index = 0; index < count; index += 1) {
    const t = phase + (index / count) * TAU;
    const normal = unit3(sub3(radialOf(F, t + twist / 2), mul3(F.a, cone)));
    const facing = dot3(normal, view);
    if (fade) {
      const alpha = fadeOf(facing, fade);
      if (alpha <= 0.02) continue;
      out.push({
        d: pathOf([
          iso(pointOf(F, s0, r, t), projection),
          iso(pointOf(F, s1, r1, t + twist), projection),
        ]),
        alpha,
      });
      continue;
    }
    if (facing < least) continue;
    plain.push(
      pathOf([
        iso(pointOf(F, s0, r, t), projection),
        iso(pointOf(F, s1, r1, t + twist), projection),
      ]),
    );
  }

  if (fade) {
    if (seams) {
      const ends = seams === "first" ? [s1] : seams === "last" ? [s0] : [s0, s1];
      for (const s of ends) out.push({ d: arcOf(F, s, s === s0 ? r : r1, projection), alpha: 1 });
    }
    return out;
  }

  if (seams) {
    const ends = seams === "first" ? [s1] : seams === "last" ? [s0] : [s0, s1];
    for (const s of ends) plain.push(arcOf(F, s, s === s0 ? r : r1, projection));
  }
  return joinPaths(plain);
};

/** A bolt circle. `all` keeps the back row, which a hole pattern on an upward face needs. */
export const dotsOf = (
  F: Frame,
  s: number,
  r: number,
  count: number,
  projection: Projection,
  {
    phase = 0,
    slope = 0,
    least = 0.08,
    all = false,
    fade = null,
  }: {
    phase?: number;
    slope?: number;
    least?: number;
    all?: boolean;
    fade?: readonly [number, number] | null;
  } = {},
): Array<[number, number] | [number, number, number]> => {
  const view = viewOf(projection);
  const out: Array<[number, number] | [number, number, number]> = [];

  for (let index = 0; index < count; index += 1) {
    const t = phase + (index / count) * TAU;
    const [x, y] = iso(pointOf(F, s, r, t), projection);
    if (all) {
      out.push([x, y]);
      continue;
    }
    const facing = dot3(unit3(sub3(radialOf(F, t), mul3(F.a, slope))), view);
    if (fade) {
      const alpha = fadeOf(facing, fade);
      if (alpha > 0.02) out.push([x, y, alpha]);
      continue;
    }
    if (facing >= least) out.push([x, y]);
  }
  return out;
};

export const spokesOf = (
  F: Frame,
  s: number,
  r0: number,
  r1: number,
  count: number,
  projection: Projection,
  {
    phase = 0,
    sweep = 0,
    from = 0,
    to = TAU,
  }: { phase?: number; sweep?: number; from?: number; to?: number } = {},
): string => {
  const parts: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const t = from + (index / Math.max(1, count - 1)) * (to - from) + phase;
    parts.push(
      pathOf([
        iso(pointOf(F, s, r0, t), projection),
        iso(pointOf(F, s, r1, t + sweep), projection),
      ]),
    );
  }
  return joinPaths(parts);
};

export const arcPoints = (
  F: Frame,
  s: number,
  r: number,
  a0: number,
  a1: number,
  steps = 24,
): V3[] =>
  Array.from({ length: steps + 1 }, (_, index) =>
    pointOf(F, s, r, a0 + (index / steps) * (a1 - a0)),
  );

export const spiral = (
  F: Frame,
  s: number,
  r0: number,
  r1: number,
  a0: number,
  a1: number,
  steps = 28,
): V3[] =>
  Array.from({ length: steps + 1 }, (_, index) => {
    const t = index / steps;
    return pointOf(F, s, r0 + (r1 - r0) * t, a0 + (a1 - a0) * t);
  });

export const clamp = clamp01;
