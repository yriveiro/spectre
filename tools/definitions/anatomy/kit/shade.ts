/**
 * Smooth shading for turned bodies.
 *
 * A faceted pass buckets each quad by its tone, and a tone band then ends on the
 * edge of the facet it came from. On a curved body that reads as a staircase.
 * This replaces the facet tone with the profile's own normal, so a band widens
 * and narrows continuously, and an arc that exists at only one level collapses
 * to a point rather than being cut off on a straight edge.
 */

import type { Projection } from "./iso-kit";
import { iso, joinPaths, pathOf } from "./iso-kit";
import type { Frame, Meridian, V2, V3 } from "./lathe";
import {
  arcOf,
  bandOf,
  type CurveRun,
  curveRuns,
  dot3,
  lightOf,
  pointOf,
  scaleOf,
  stepsFor,
  viewOf,
} from "./lathe";
import { head, pick } from "./list";

const TAU = Math.PI * 2;
const EPS = 1e-9;

/** `tone` is -1 for a hidden arc, which the emitter drops. */
type Arc = { tone: number; from: number; to: number; full?: boolean };

/** One axis of the view or the light, resolved against a frame. */
interface Basis {
  readonly a: number;
  readonly flat: number;
  readonly phi: number;
}

const basisOf = (F: Frame, direction: V3): Basis => {
  const a = dot3(F.a, direction);
  const u = dot3(F.u, direction);
  const v = dot3(F.v, direction);
  return { a, flat: Math.hypot(u, v), phi: Math.atan2(v, u) };
};

/**
 * The angle intervals where one quad row is both visible and one tone.
 *
 * Visibility uses the facet normal and tone uses the smooth normal. That split
 * is what keeps a highlight glued to the geometry while the tone gradient
 * follows the curve underneath it.
 */
const labelledArcs = (
  nr: number,
  na: number,
  view: Basis,
  light: Basis,
  gr: number,
  ga: number,
): Arc[] => {
  const cuts: number[] = [];
  // Where the quad stops facing the reader, and where each tone band begins.
  if (Math.abs(gr) > 1e-9) {
    const visibleCut = -(ga * view.a) / (gr * view.flat);
    if (visibleCut > -1 && visibleCut < 1) {
      const d = Math.acos(visibleCut);
      cuts.push(view.phi - d, view.phi + d);
    }
  }
  if (Math.abs(nr) > 1e-9)
    for (const threshold of [0, 0.2, 0.42, 0.62]) {
      const c = (threshold - na * light.a) / (nr * light.flat);
      if (c > -1 && c < 1) {
        const d = Math.acos(c);
        cuts.push(light.phi - d, light.phi + d);
      }
    }

  const wrap = (angle: number) => ((angle % TAU) + TAU) % TAU;
  const sorted = [...new Set(cuts.map((angle) => Math.round(wrap(angle) * 1e9) / 1e9))].toSorted(
    (a, b) => a - b,
  );

  const label = (angle: number): number => {
    const facing = gr * view.flat * Math.cos(angle - view.phi) + ga * view.a;
    if (facing <= 1e-9) return -1;
    return bandOf(nr * light.flat * Math.cos(angle - light.phi) + na * light.a);
  };

  // Nothing crossed a boundary, so the whole ring is one arc. Returning nothing
  // here left an uncrossed row undrawn.
  if (sorted.length === 0) {
    const tone = label(0);
    return tone < 0 ? [] : [{ tone, from: 0, to: TAU, full: true }];
  }

  const arcs = sorted.map((from, index) => {
    const to =
      index + 1 < sorted.length ? (sorted[index + 1] as number) : (sorted[0] as number) + TAU;
    return { tone: label((from + to) / 2), from, to };
  });

  // Two neighbours of the same tone are one arc; drawing them separately splits
  // a band down a seam nothing in the geometry put there.
  const merged: Arc[] = [];
  for (const arc of arcs) {
    const last = merged[merged.length - 1];
    if (last !== undefined && last.tone === arc.tone && Math.abs(last.to - arc.from) < 1e-9)
      last.to = arc.to;
    else merged.push({ ...arc });
  }
  const first = merged[0];
  const lastOne = merged[merged.length - 1];
  if (
    merged.length > 1 &&
    first !== undefined &&
    lastOne !== undefined &&
    first.tone === lastOne.tone &&
    Math.abs(lastOne.to - TAU - first.from) < 1e-9
  ) {
    const popped = merged.pop();
    if (first !== undefined && popped !== undefined) first.from = popped.from - TAU;
  }
  return merged.filter((arc) => arc.tone >= 0);
};

export interface SmoothOptions {
  readonly rows?: number;
  readonly slope?: ((s: number) => number) | null;
  readonly radius?: ((s: number) => number) | null;
  readonly steps?: number;
  readonly error?: number;
  readonly depth?: number;
  readonly fineness?: number;
}

/**
 * Five buckets of closed paths, tone 0 to 4, for one body.
 *
 * Rows of one axial segment are walked as a run. Where neighbouring rows carry the
 * same number of arcs of a tone they sheet into one band; where they do not, the
 * gap is closed as quads, and an arc with no partner on the other side collapses
 * onto its own centre, so a band reaches zero width rather than being cut off
 * along the row boundary.
 */
export const smoothRows = (
  meridian: Meridian,
  F: Frame,
  projection: Projection,
  {
    rows = 6,
    slope = null,
    radius = null,
    steps = 48,
    error = 0.35,
    depth: deepest = 8,
    fineness = 0.1,
  }: SmoothOptions = {},
): [string[], string[], string[], string[], string[]] => {
  const k = scaleOf(projection);
  const view = basisOf(F, viewOf(projection));
  const light = basisOf(F, lightOf(projection));
  const buckets: string[][] = [[], [], [], [], []];
  const m = meridian.length;
  const splines = slope ? null : curveRuns(meridian);

  const faces: Array<readonly [number, number]> = [];
  for (let index = 0; index + 1 < m; index += 1) {
    const ds = pick(meridian, index + 1)[0] - pick(meridian, index)[0];
    const dr = pick(meridian, index + 1)[1] - pick(meridian, index)[1];
    const length = Math.hypot(ds, dr) || 1;
    faces.push([ds / length, -dr / length]);
  }

  /** A soft knot's normal is the average of the two facets meeting there. */
  const vertexNormal = (k: number, own: readonly [number, number]): readonly [number, number] => {
    if (k <= 0 || k >= m - 1 || !pick(meridian, k)[2]) return own;
    return unit2([
      pick(faces, k - 1)[0] + pick(faces, k)[0],
      pick(faces, k - 1)[1] + pick(faces, k)[1],
    ]);
  };

  const normalAt = (i: number, u: number): readonly [number, number] => {
    const m0 = pick(meridian, i);
    const m1 = pick(meridian, i + 1);
    const s = m0[0] + (m1[0] - m0[0]) * u;
    const sign = Math.sign(m1[0] - m0[0]) || 1;
    const gradient = slope
      ? slope(s)
      : ((splines === null ? null : pick(splines, i))?.slope(s) ?? null);
    if (gradient !== null) {
      const length = Math.hypot(1, gradient);
      return [sign / length, (-sign * gradient) / length];
    }
    const a = vertexNormal(i, pick(faces, i));
    const b = vertexNormal(i + 1, pick(faces, i));
    return unit2([a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u]);
  };

  const radiusAt = (i: number, u: number): number => {
    const m0 = pick(meridian, i);
    const m1 = pick(meridian, i + 1);
    const s = m0[0] + (m1[0] - m0[0]) * u;
    if (radius) return radius(s);
    const segment = splines === null ? null : (pick(splines, i) ?? null);
    return segment ? segment.radius(s) : m0[1] + (m1[1] - m0[1]) * u;
  };

  const pointAt = (i: number, u: number, angle: number): V2 =>
    iso(
      pointOf(
        F,
        pick(meridian, i)[0] + (pick(meridian, i + 1)[0] - pick(meridian, i)[0]) * u,
        radiusAt(i, u),
        angle,
      ),
      projection,
    );

  const fine = TAU / Math.max(24, Math.min(192, steps * 1.5));

  const arcPoints = (i: number, u: number, from: number, to: number): V2[] => {
    const count = Math.max(1, Math.ceil((to - from) / fine));
    return Array.from({ length: count + 1 }, (_, index) =>
      pointAt(i, u, from + ((to - from) * index) / count),
    );
  };

  /** Two arcs are the same band cut at different branch points. */
  const align = (reference: Arc, arc: Arc): Arc => {
    const out = { ...arc };
    const centre = (reference.from + reference.to) / 2;
    while ((out.from + out.to) / 2 - centre > Math.PI) {
      out.from -= TAU;
      out.to -= TAU;
    }
    while (centre - (out.from + out.to) / 2 > Math.PI) {
      out.from += TAU;
      out.to += TAU;
    }
    return out;
  };

  interface Level {
    readonly i: number;
    readonly u: number;
    readonly groups: Map<number, Arc[]>;
  }

  const centreOf = (arc: Arc, reference: number): number => {
    let mid = (arc.from + arc.to) / 2 - reference;
    mid = ((mid % TAU) + TAU) % TAU;
    return mid;
  };

  const levelOf = (i: number, u: number): Level => {
    const [nr, na] = normalAt(i, u);
    const groups = new Map<number, Arc[]>();
    for (const arc of labelledArcs(nr, na, view, light, pick(faces, i)[0], pick(faces, i)[1])) {
      if (arc.tone < 0) continue;
      const list = groups.get(arc.tone) ?? [];
      list.push(arc);
      groups.set(arc.tone, list);
    }
    // Sorted by distance from the light, so the nth arc of a tone at one level is
    // the nth arc at the next. That correspondence is what lets a band sheet.
    // Sorted IN PLACE: the sheet and strip emitters read these lists afterwards,
    // and a `toSorted` copy would leave the stored order unsorted.
    for (const list of groups.values())
      list.sort((x, y) => centreOf(x, light.phi) - centreOf(y, light.phi));
    return { i, u, groups };
  };

  const same = (x: Level, y: Level): boolean => {
    if (x.groups.size !== y.groups.size) return false;
    for (const [tone, list] of x.groups)
      if ((y.groups.get(tone) ?? []).length !== list.length) return false;
    return true;
  };

  /** How far the midpoint row's arcs sit from the chord between its neighbours. */
  const strayOf = (i: number, a: Level, mid: Level, b: Level): number => {
    let worst = 0;
    for (const [tone, list] of mid.groups) {
      const below = a.groups.get(tone) ?? [];
      const above = b.groups.get(tone) ?? [];
      list.forEach((arc, index) => {
        const lo = below[index];
        const hi = above[index];
        if (lo === undefined || hi === undefined) return;
        const alignedLo = align(arc, lo);
        const alignedHi = align(arc, hi);
        for (const key of ["from", "to"] as const) {
          const p = pointAt(i, mid.u, arc[key]);
          const p0 = pointAt(i, a.u, alignedLo[key]);
          const p1 = pointAt(i, b.u, alignedHi[key]);
          worst = Math.max(
            worst,
            Math.hypot(p[0] - (p0[0] + p1[0]) / 2, p[1] - (p0[1] + p1[1]) / 2),
          );
        }
      });
    }
    return worst;
  };

  const sheet = (tone: number, levels: ReadonlyArray<Level>): void => {
    const first = levels[0] as Level;
    for (const [index, arc] of (first.groups.get(tone) ?? []).entries()) {
      const chain: Arc[] = [arc];
      for (let k = 1; k < levels.length; k += 1)
        chain.push(
          align(chain[k - 1] as Arc, (pick(levels, k).groups.get(tone) ?? [])[index] as Arc),
        );
      const last = levels.length - 1;
      const points = [...arcPoints(first.i, first.u, (chain[0] as Arc).from, (chain[0] as Arc).to)];
      for (let k = 1; k < last; k += 1)
        points.push(pointAt(pick(levels, k).i, pick(levels, k).u, (chain[k] as Arc).to));
      points.push(
        ...arcPoints(
          pick(levels, last).i,
          pick(levels, last).u,
          (chain[last] as Arc).from,
          (chain[last] as Arc).to,
        ).reverse(),
      );
      for (let k = last - 1; k >= 1; k -= 1)
        points.push(pointAt(pick(levels, k).i, pick(levels, k).u, (chain[k] as Arc).from));
      pick(buckets, tone).push(pathOf(oriented(points), true));
    }
  };

  const overlap = (x: Arc, y: Arc): number => Math.min(x.to, y.to) - Math.max(x.from, y.from);

  const strip = (tone: number, a: Level, b: Level): void => {
    const below = a.groups.get(tone) ?? [];
    const above = (b.groups.get(tone) ?? []).map((arc) => ({ arc, used: false }));

    const quad = (lo: Arc, hi: Arc): void => {
      const points = [
        ...arcPoints(a.i, a.u, lo.from, lo.to),
        ...arcPoints(b.i, b.u, hi.from, hi.to).reverse(),
      ];
      pick(buckets, tone).push(pathOf(oriented(points), true));
    };

    for (const arc of below) {
      // The arc it continues is the one it overlaps most once aligned.
      let best: (typeof above)[number] | null = null;
      let score = -Infinity;
      for (const entry of above) {
        if (entry.used) continue;
        const value = overlap(arc, align(arc, entry.arc));
        if (value > score) {
          score = value;
          best = entry;
        }
      }
      if (best !== null && score > -0.05) {
        best.used = true;
        quad(arc, align(arc, best.arc));
        continue;
      }
      // No partner above, so the band closes on this arc's own centre.
      const centre = (arc.from + arc.to) / 2;
      quad(arc, { tone: arc.tone, from: centre, to: centre });
    }

    for (const entry of above) {
      if (entry.used) continue;
      const centre = (entry.arc.from + entry.arc.to) / 2;
      quad({ tone: entry.arc.tone, from: centre, to: centre }, entry.arc);
    }
  };

  let run: Level[] = [];

  const flush = (): void => {
    const tones = [...new Set(run.flatMap((level) => [...level.groups.keys()]))].toSorted(
      (x, y) => x - y,
    );
    for (const tone of tones) {
      const countOf = (level: Level) => (level.groups.get(tone) ?? []).length;
      let start = 0;
      for (let at = 1; at <= run.length; at += 1) {
        if (at < run.length && countOf(pick(run, at - 1)) === countOf(pick(run, at))) continue;
        if (at - 1 > start && countOf(pick(run, start))) sheet(tone, run.slice(start, at));
        if (at < run.length) strip(tone, pick(run, at - 1), pick(run, at));
        start = at;
      }
    }
    run = [];
  };

  for (let i = 0; i + 1 < m; i += 1) {
    const ds = pick(meridian, i + 1)[0] - pick(meridian, i)[0];
    // A vertical step is a rim. It is never smoothed, and it ends the run.
    if (Math.abs(ds) < 1e-9) {
      flush();
      continue;
    }
    const count = Math.max(1, rows);
    const reach = (Math.hypot(ds, pick(meridian, i + 1)[1] - pick(meridian, i)[1]) * k) / count;
    const limit = Math.max(
      1,
      Math.min(deepest, Math.ceil(Math.log2(Math.max(2, reach / fineness)))),
    );
    const coarse = Array.from({ length: count + 1 }, (_, index) => levelOf(i, index / count));
    run.push(coarse[0] as Level);

    const refine = (a: Level, b: Level, level: number): void => {
      const mid = levelOf(i, (a.u + b.u) / 2);
      const split =
        level < limit &&
        (!same(a, b) || !same(a, mid) || (level < 6 && strayOf(i, a, mid, b) > error));
      if (!split) {
        run.push(b);
        return;
      }
      refine(a, mid, level + 1);
      refine(mid, b, level + 1);
    };
    for (let index = 1; index <= count; index += 1)
      refine(coarse[index - 1] as Level, coarse[index] as Level, 0);
  }
  flush();

  return buckets as [string[], string[], string[], string[], string[]];
};

const unit2 = (v: readonly [number, number]): readonly [number, number] => {
  const len = Math.hypot(v[0], v[1]) || 1;
  return [v[0] / len, v[1] / len];
};

export interface BodyOut {
  readonly fill: string;
  readonly outline: string;
  readonly crease: string;
  readonly top: string;
  readonly shades: readonly string[];
  readonly bevel?: string;
  readonly seamless?: boolean;
}

const oriented = (points: V2[]): V2[] => {
  let total = 0;
  for (let index = 0; index < points.length; index += 1) {
    const here = pick(points, index);
    const next = pick(points, index + 1);
    total += here[0] * next[1] - next[0] * here[1];
  }
  return total < 0 ? points.toReversed() : points;
};

interface Tagged {
  readonly p: V2;
  readonly ring: number;
}

/** Convex hull carrying the ring each vertex came from, so rim edges can be dropped. */
const hullTagged = (points: ReadonlyArray<Tagged>): Tagged[] => {
  const sorted = [...points].toSorted((a, b) => a.p[0] - b.p[0] || a.p[1] - b.p[1]);
  const turn = (o: Tagged, a: Tagged, b: Tagged) =>
    (a.p[0] - o.p[0]) * (b.p[1] - o.p[1]) - (a.p[1] - o.p[1]) * (b.p[0] - o.p[0]);
  const half = (input: ReadonlyArray<Tagged>): Tagged[] => {
    const stack: Tagged[] = [];
    for (const point of input) {
      while (
        stack.length >= 2 &&
        turn(pick(stack, stack.length - 2), pick(stack, stack.length - 1), point) <= 0
      )
        stack.pop();
      stack.push(point);
    }
    stack.pop();
    return stack;
  };
  return [...half(sorted), ...half(sorted.toReversed())];
};

const hullOf = (points: ReadonlyArray<V2>): V2[] =>
  hullTagged(points.map((p) => ({ p, ring: 0 }))).map((one) => one.p);

/** Subdivide until the sampled curve sits on its chord, so the outline is smooth rather than polygonal. */
const curved = (
  meridian: Meridian,
  projection: Projection,
  runs: Array<CurveRun | null>,
): Meridian => {
  const k = scaleOf(projection);
  const out: Meridian = [];
  for (let index = 0; index + 1 < meridian.length; index += 1) {
    const m0 = pick(meridian, index);
    const m1 = pick(meridian, index + 1);
    out.push(m0);
    const run = pick(runs, index);
    if (Math.abs(m1[0] - m0[0]) <= EPS || !run) continue;
    const at = (u: number) => run.radius(m0[0] + (m1[0] - m0[0]) * u);
    const split = (a: number, b: number, level: number) => {
      if (level >= 6) return;
      const mid = (a + b) / 2;
      if (Math.abs(at(mid) - (at(a) + at(b)) / 2) * k <= 0.2) return;
      split(a, mid, level + 1);
      out.push([m0[0] + (m1[0] - m0[0]) * mid, at(mid), 1]);
      split(mid, b, level + 1);
    };
    split(0, 1, 0);
  }
  out.push(pick(meridian, meridian.length - 1));
  return out;
};

/** The rails either side of a body, where it meets the silhouette. */
export const silhouettePoints = (
  meridian: Meridian,
  F: Frame,
  projection: Projection,
  {
    samples = 72,
    slope = null,
    radius = null,
  }: {
    samples?: number;
    slope?: ((s: number) => number) | null;
    radius?: ((s: number) => number) | null;
  } = {},
): [V3[], V3[]] => {
  const view = viewOf(projection);
  const runs = slope === null ? curveRuns(meridian) : null;
  const aV = dot3(F.a, view);
  const flat = Math.hypot(dot3(F.u, view), dot3(F.v, view));
  const phi = Math.atan2(dot3(F.v, view), dot3(F.u, view));
  const s0 = head(meridian)[0];
  const s1 = pick(meridian, meridian.length - 1)[0];

  const rail = (sign: 1 | -1): V3[] => {
    const out: V3[] = [];
    for (let step = 0; step <= samples; step += 1) {
      const s = s0 + (s1 - s0) * (step / samples);
      const gradient =
        slope === null ? (runs === null ? null : runSlopeAt(meridian, runs, s)) : slope(s);
      if (gradient === null) continue;
      const index = Math.min(
        meridian.length - 2,
        Math.max(0, s <= pick(meridian, 1)[0] ? 0 : indexOfSegment(meridian, s)),
      );
      const segment = runs === null ? null : pick(runs, index);
      const r = radius ? radius(s) : segment ? segment.radius(s) : lerpRadius(meridian, s);
      if (flat < 1e-12 || Math.abs((gradient * aV) / flat) > 1) continue;
      const c = Math.max(-1, Math.min(1, -(gradient * aV) / flat));
      out.push(pointOf(F, s, r, phi + sign * Math.acos(c)));
    }
    return out;
  };

  return [rail(1), rail(-1)];
};

const indexOfSegment = (meridian: Meridian, s: number): number => {
  for (let index = 0; index < meridian.length - 1; index += 1)
    if (s <= pick(meridian, index + 1)[0]) return index;
  return Math.max(0, meridian.length - 2);
};

const runSlopeAt = (meridian: Meridian, runs: Array<CurveRun | null>, s: number): number | null => {
  const segment = pick(runs, indexOfSegment(meridian, s));
  return segment ? segment.slope(s) : null;
};

const lerpRadius = (meridian: Meridian, s: number): number => {
  const index = indexOfSegment(meridian, s);
  const m0 = pick(meridian, index);
  const m1 = pick(meridian, index + 1);
  const span = m1[0] - m0[0];
  const t = span > EPS ? (s - m0[0]) / span : 0;
  return m0[1] + (m1[1] - m0[1]) * t;
};

export interface LatheOptions extends SmoothOptions {
  readonly steps?: number;
  readonly fill?: "auto" | "surface" | "hull";
  readonly hole?: number | null;
  readonly bevel?: number;
  readonly rims?: "all" | "first" | "last" | "ends" | "none";
  readonly smooth?: boolean | "auto" | SmoothOptions;
  readonly waist?: number;
}

/**
 * A turned body.
 *
 * `smooth: "auto"` reads the profile: any soft knot turns smooth shading on for
 * the run that contains it. A body whose fill is forced to `"surface"` keeps its
 * analytic silhouette; otherwise the cheaper convex hull wins whenever it is
 * within `waist` pixels of it.
 */
export const lathe = (
  meridian: Meridian,
  F: Frame,
  projection: Projection,
  {
    steps,
    fill = "auto",
    hole = null,
    bevel = 0,
    rims = "all",
    smooth = "auto",
    waist = 0.5,
  }: LatheOptions = {},
): BodyOut => {
  const maxR = Math.max(...meridian.map((knot) => knot[1]), 1e-6);
  const n = steps ?? stepsFor(maxR, 32, 160, scaleOf(projection));
  const asked = smooth;
  const options: SmoothOptions = typeof asked === "object" ? asked : { steps: n };
  const isSmooth = asked === "auto" ? meridian.some((knot) => Boolean(knot[2])) : Boolean(asked);
  const analytic = typeof asked === "object" && asked !== null ? asked : null;

  const view = viewOf(projection);
  const light = lightOf(projection);
  const uV = dot3(F.u, view);
  const vV = dot3(F.v, view);
  const aV = dot3(F.a, view);
  const uL = dot3(F.u, light);
  const vL = dot3(F.v, light);
  const aL = dot3(F.a, light);

  const buckets: string[][] = [[], [], [], [], []];
  const smoothed = isSmooth ? smoothRows(meridian, F, projection, { ...options, steps: n }) : null;
  const smoothSegments = new Set<number>();
  if (smoothed)
    for (let index = 0; index + 1 < meridian.length; index += 1)
      if (Math.abs(pick(meridian, index + 1)[0] - pick(meridian, index)[0]) > EPS)
        smoothSegments.add(index);

  for (let index = 0; index + 1 < meridian.length; index += 1) {
    if (smoothSegments.has(index)) continue;
    const m0 = pick(meridian, index);
    const m1 = pick(meridian, index + 1);
    const ds = m1[0] - m0[0];
    const dr = m1[1] - m0[1];
    const length = Math.hypot(ds, dr);
    if (length < 1e-9) continue;

    // Every step gets a ring at both ends and a tone, hidden ones included. A
    // run's indices then address the step they came from, so leaving the hidden
    // rings out of the arrays would shift every coordinate in the run.
    const keys: Array<number | null> = [];
    const lower: V2[] = [];
    const upper: V2[] = [];
    for (let step = 0; step < n; step += 1) {
      const angleA = (step / n) * TAU;
      const angleB = ((step + 1) / n) * TAU;
      const mid = (angleA + angleB) / 2;
      const midC = Math.cos(mid);
      const midS = Math.sin(mid);
      lower.push(iso(pointOf(F, m0[0], m0[1], angleA), projection));
      upper.push(iso(pointOf(F, m1[0], m1[1], angleA), projection));
      const facing = ds * (midC * uV + midS * vV) - dr * aV;
      keys.push(
        facing > 1e-6 * length ? bandOf((ds * (midC * uL + midS * vL) - dr * aL) / length) : null,
      );
    }

    for (const { key, indices } of circularRuns(keys)) {
      const path = pathOf(
        // Both rails run the whole way round, using the run's wrapped vertex at
        // the end, so the quad closes on itself instead of leaving a gap.
        oriented([
          ...indices.map((i) => pick(lower, i)),
          ...indices.toReversed().map((i) => pick(upper, i)),
        ]),
        true,
      );
      if (path === "") continue;
      pick(buckets, key).push(path);
    }
  }

  // Each tone keeps its own bucket. Funnelling every smoothed path into the top
  // bucket leaves the four side shades empty, which is the faceted look the
  // smooth path exists to replace.
  if (smoothed)
    smoothed.forEach((bucket, tone) => {
      for (const path of bucket) pick(buckets, tone).push(path);
    });

  const shape = curved(meridian, projection, curveRuns(meridian));
  const silhouette = silhouettePoints(shape, F, projection, {
    slope: analytic === null ? null : (analytic.slope ?? null),
    radius: analytic === null ? null : (analytic.radius ?? null),
  });

  const solid = outlineOf(shape, F, projection, { fill, hole, rims, silhouette, waist, n });

  return {
    fill: solid.fill,
    outline: solid.outline,
    crease: creaseOf(meridian, F, projection, { uV, vV, aV }),
    top: joinPaths(pick(buckets, 4)),
    shades: buckets.slice(0, 4).map((bucket) => joinPaths(bucket)),
    bevel: bevel > 0 ? bevelOf(meridian, F, projection, bevel) : undefined,
    seamless: smoothed !== null,
  };
};

/** Runs of one tone around a closed row, each carrying the vertex after its last. */
const circularRuns = (
  keys: ReadonlyArray<number | null>,
): Array<{ key: number; indices: number[] }> => {
  const count = keys.length;
  const present = keys.filter((key): key is number => key !== null);
  if (present.length === 0) return [];
  if (present.length === count)
    return [{ key: keys[0] as number, indices: Array.from({ length: count }, (_, i) => i) }];

  // The boundary is the first vertex that differs from its predecessor. A
  // different start rotates the whole run and every coordinate in it.
  // and every coordinate in it.
  let start = -1;
  for (let index = 0; index < count; index += 1) {
    if ((keys[index] ?? -1) !== (pick(keys, index + count - 1) ?? -1)) {
      start = index;
      break;
    }
  }
  if (start < 0)
    return [
      {
        key: keys[0] as number,
        indices: Array.from({ length: count + 1 }, (_, index) => index % count),
      },
    ];

  const out: Array<{ key: number; indices: number[] }> = [];
  const until = start + count;
  let index = start;
  while (index < until) {
    const key = pick(keys, index);
    if (key === null || key === undefined) {
      index += 1;
      continue;
    }
    // One maximal run, emitted once. Re-entering at every vertex inside a run
    // emits it once per vertex, which multiplies the path length by the run length.
    const indices: number[] = [];
    while (index < until && pick(keys, index) === key) {
      indices.push(index % count);
      index += 1;
    }
    indices.push(index % count);
    out.push({ key, indices });
  }
  return out;
};

const outlineOf = (
  shape: Meridian,
  F: Frame,
  projection: Projection,
  {
    fill,
    hole,
    rims,
    silhouette,
    waist,
    n,
  }: {
    readonly fill: LatheOptions["fill"];
    readonly hole: number | null;
    readonly rims: LatheOptions["rims"];
    readonly silhouette: [V3[], V3[]];
    readonly waist: number;
    readonly n: number;
  },
): { fill: string; outline: string } => {
  const k = scaleOf(projection);
  const [left, right] = silhouette;
  const leftFlat = left.map((point) => iso(point, projection));
  const rightFlat = right.map((point) => iso(point, projection));
  const combined = [...leftFlat, ...rightFlat];

  // A waisted body is concave, so a hull would fill its waist in. The analytic
  // silhouette only earns its cost when it visibly departs from the hull.
  const spaced = shape.every(
    (knot, index) => index === 0 || knot[0] > pick(shape, index - 1)[0] + 1e-9,
  );
  const hull = hullOf(combined);
  const gap = combined.reduce((worst, point) => Math.max(worst, distanceTo(point, hull)), 0);

  if (
    fill === "surface" ||
    (fill === "auto" && spaced && leftFlat.length > 1 && rightFlat.length > 1 && gap > waist)
  )
    return {
      fill: pathOf([...leftFlat, ...rightFlat.toReversed()], true),
      outline: joinPaths([
        pathOf(leftFlat),
        pathOf(rightFlat),
        ...(rims === "none" || rims === "ends"
          ? []
          : [
              arcOf(F, head(shape)[0], head(shape)[1], projection),
              arcOf(
                F,
                pick(shape, shape.length - 1)[0],
                pick(shape, shape.length - 1)[1],
                projection,
              ),
            ].filter((arc) => rims === "all" || arc !== "")),
      ]),
    };

  const maxR = Math.max(...shape.map((knot) => knot[1]), 1e-6);
  const around = Math.min(320, Math.max(n, Math.ceil((TAU * maxR * k) / 1.5)));
  const rings: V2[][] = shape.map((knot) =>
    Array.from({ length: around }, (_, step) =>
      iso(pointOf(F, knot[0], knot[1], (step / around) * TAU), projection),
    ),
  );
  const edge = hullTagged(
    rings.flatMap((ringPoints, ring) => ringPoints.map((p) => ({ p, ring }))),
  );
  const firstRing = 0;
  const lastRing = shape.length - 1;
  const opening = hole === null ? "" : pathOf(circleOn(F, head(shape)[0], hole, projection), true);

  const kept = edge.filter((_, index) => {
    if (rims === "all") return true;
    const next = pick(edge, index + 1);
    const on = (ring: number) => pick(edge, index).ring === ring && next.ring === ring;
    if (rims === "first") return !on(firstRing);
    if (rims === "last") return !on(lastRing);
    return !on(firstRing) && !on(lastRing);
  });

  return {
    fill: joinPaths([
      pathOf(
        edge.map((one) => one.p),
        true,
      ),
      opening,
    ]),
    outline: pathOf(
      kept.map((one) => one.p),
      true,
    ),
  };
};

const distanceTo = (point: V2, edge: ReadonlyArray<V2>): number => {
  let best = Infinity;
  for (let index = 0; index < edge.length; index += 1) {
    const a = pick(edge, index);
    const b = pick(edge, index + 1);
    const dx = b[0] - a[0];
    const dy = b[1] - a[1];
    const length = Math.hypot(dx, dy);
    if (length < 1e-9) continue;
    const t = Math.max(
      0,
      Math.min(1, ((point[0] - a[0]) * dx + (point[1] - a[1]) * dy) / (length * length)),
    );
    best = Math.min(best, Math.hypot(point[0] - (a[0] + dx * t), point[1] - (a[1] + dy * t)));
  }
  return best;
};

const circleOn = (F: Frame, s: number, r: number, projection: Projection): V2[] => {
  const count = stepsFor(r, 24, 112, scaleOf(projection));
  return Array.from({ length: count }, (_, index) =>
    iso(pointOf(F, s, r, (index / count) * TAU), projection),
  );
};

/** The hard crease at a knot, drawn only where the crease faces the reader. */
const creaseOf = (
  meridian: Meridian,
  F: Frame,
  projection: Projection,
  { uV, vV, aV }: { uV: number; vV: number; aV: number },
): string => {
  const parts: string[] = [];
  const phi = Math.atan2(vV, uV);
  const flat = Math.hypot(uV, vV);

  for (let index = 1; index + 1 < meridian.length; index += 1) {
    const knot = pick(meridian, index);
    if (knot[2]) continue;
    const next = pick(meridian, index + 1);
    if (next[1] <= 1e-9) continue;
    const ds = next[0] - knot[0];
    const dr = next[1] - knot[1];
    let range: [number, number] | null;
    if (Math.abs(ds) < 1e-9 || flat < 1e-9) range = -dr * aV > 1e-9 ? [-1, 1] : null;
    else {
      const c = (dr * aV) / (ds * flat);
      range = ds > 0 ? [Math.max(-1, c), 1] : [-1, Math.min(1, c)];
    }
    if (!range) continue;
    const arc = arcOf(F, knot[0], knot[1], projection, {
      from: phi + range[0] * (Math.PI / 2),
      to: phi + range[1] * (Math.PI / 2),
    });
    if (arc !== "") parts.push(arc);
  }
  return joinPaths(parts);
};

/** A bevel only has anywhere to sit at a pole cap. */
const bevelOf = (meridian: Meridian, F: Frame, projection: Projection, bevel: number): string => {
  if (meridian.length < 3) return "";
  const first = pick(meridian, 0);
  const last = pick(meridian, meridian.length - 1);
  const parts: string[] = [];
  if (first[1] <= 1e-9) {
    const neighbour = pick(meridian, 1);
    parts.push(arcOf(F, neighbour[0], Math.max(0, neighbour[1] - bevel), projection));
  }
  if (last[1] <= 1e-9) {
    const neighbour = pick(meridian, meridian.length - 2);
    parts.push(arcOf(F, neighbour[0], Math.max(0, neighbour[1] - bevel), projection));
  }
  return joinPaths(parts);
};

export const solidOf = (
  profile: Meridian,
  F: Frame,
  projection: Projection,
  options: LatheOptions = {},
): BodyOut =>
  lathe(
    [[profile[0]?.[0] ?? 0, 0], ...profile, [pick(profile, profile.length - 1)[0], 0]],
    F,
    projection,
    options,
  );

export const disc = (
  s0: number,
  s1: number,
  r: number,
  F: Frame,
  projection: Projection,
  options: LatheOptions = {},
): BodyOut =>
  lathe(
    [
      [s0, 0],
      [s0, r],
      [s1, r],
      [s1, 0],
    ],
    F,
    projection,
    {
      steps: stepsFor(r, 32, 160, scaleOf(projection)),
      ...options,
    },
  );

export const ringBand = (
  s0: number,
  s1: number,
  rIn: number,
  rOut: number,
  F: Frame,
  projection: Projection,
  options: LatheOptions = {},
): BodyOut =>
  lathe(
    [
      [s0, rIn],
      [s0, rOut],
      [s1, rOut],
      [s1, rIn],
    ],
    F,
    projection,
    {
      steps: stepsFor(rOut, 32, 160, scaleOf(projection)),
      ...options,
    },
  );

/**
 * A ball is nested caps rather than a lathe: each cap is one tone, so the
 * shading is a stack of hulls painted outward to inward.
 */
export const sphereOf = (
  centre: V3,
  r: number,
  projection: Projection,
  { steps = 48 }: { steps?: number } = {},
): BodyOut => {
  const F: Frame = { o: centre, a: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0] };
  const view = viewOf(projection);
  const light = lightOf(projection);
  const outline = pathOf(
    Array.from({ length: steps }, (_, index) =>
      iso(pointOf(F, 0, r, (index / steps) * TAU), projection),
    ),
    true,
  );

  const capOf = (threshold: number): string => {
    const points: V2[] = [];
    for (let index = 0; index < steps; index += 1) {
      const point = pointOf(F, 0, r, (index / steps) * TAU);
      const relative: V3 = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]];
      if (dot3(relative, light) / r >= threshold) points.push(iso(point, projection));
    }
    if (points.length < 3) return "";
    // The lit cap reaches further than the rim it was cut from, so the inner
    // circle is drawn on the light's own frame and clipped to the facing half.
    const shift: V3 = [
      light[0] * r * threshold,
      light[1] * r * threshold,
      light[2] * r * threshold,
    ];
    const inner = r * Math.sqrt(1 - threshold * threshold);
    for (let index = 0; index < steps; index += 1) {
      const angle = (index / steps) * TAU;
      const point: V3 = [
        centre[0] + shift[0] + Math.cos(angle) * inner,
        centre[1] + shift[1] + Math.sin(angle) * inner,
        centre[2] + shift[2],
      ];
      const relative: V3 = [point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]];
      if (dot3(relative, view) >= -1e-9) points.push(iso(point, projection));
    }
    return pathOf(hullOf(points), true);
  };

  return {
    fill: outline,
    outline,
    crease: "",
    top: "",
    shades: [outline, capOf(0.2), capOf(0.42), capOf(0.62)],
    seamless: true,
  };
};

/**
 * A rod drawn at full length, plus the clip that hides the part still inside
 * the gland it slides out of.
 */
export const rodOut = (
  F: Frame,
  from: number,
  to: number,
  r: number,
  projection: Projection,
  { stroke = 0, ...options }: { stroke?: number } & LatheOptions = {},
): { paths: BodyOut; clip: string; from: number; to: number; stroke: number; reach: number } => {
  const k = scaleOf(projection);
  const paths = disc(from - stroke, to, r, F, projection, options);
  const ringAt = (s: number): V2[] =>
    Array.from({ length: 48 }, (_, index) =>
      iso(pointOf(F, s, r + 0.35 / k, (index / 48) * TAU), projection),
    );
  return {
    paths,
    clip: pathOf(hullOf([...ringAt(from), ...ringAt(to + stroke)]), true),
    from,
    to,
    stroke,
    reach: to + stroke,
  };
};

export { curveRuns };
