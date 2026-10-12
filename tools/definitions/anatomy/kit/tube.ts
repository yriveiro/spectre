/**
 * Pipes and cables.
 *
 * A whole run cannot be depth-ordered: it passes in front of one part and behind
 * another. So a run is cut into chunks, and each chunk carries its own geometry
 * and its own depth, which the page sorts like any other solid.
 */

import type { Projection } from "./iso-kit";
import { iso, joinPaths, pathOf } from "./iso-kit";
import type { V2, V3 } from "./lathe";
import {
  cross3,
  cut,
  dot3,
  fadeOf,
  frameAlong,
  pathLength,
  pointAlong,
  resample,
  scaleOf,
  sub3,
  tangentAlong,
  unit3,
  viewOf,
} from "./lathe";

const TAU = Math.PI * 2;
const EPS = 1e-6;

/** A screen ribbon at one station of a run: its centre, its normal, its half-width. */
interface Ribbon {
  readonly p: V2;
  readonly nx: number;
  readonly ny: number;
  readonly half: number;
}

export interface Rings {
  readonly pitch?: number;
  readonly twist?: number;
  readonly cross?: boolean;
  readonly fade?: readonly [number, number];
  readonly phase?: number;
  readonly steps?: number;
  readonly tone?: string;
}

export interface TubePiece {
  readonly rings: ReadonlyArray<{ d: string; alpha: number }>;
  readonly ringTone: string;
  readonly mid: V3;
  readonly body: string;
  readonly shine: string;
  readonly shade: string;
  readonly edges: string;
  readonly wide: boolean;
  readonly points: ReadonlyArray<V3>;
  readonly radii: ReadonlyArray<number>;
  readonly ends: readonly [boolean, boolean];
  readonly from: number;
  readonly to: number;
}

export interface TubeOptions {
  readonly maxLength?: number;
  readonly spacing?: number;
  readonly closed?: boolean;
  readonly breaks?: ReadonlyArray<number>;
  readonly gaps?: ReadonlyArray<readonly [number, number]>;
  readonly caps?: boolean | readonly [boolean, boolean];
  readonly stripes?: "auto" | boolean;
  readonly rings?: Rings | null;
}

/**
 * Adjacent chunks overlap by this much, so no hairline crack shows at the seam.
 *
 * The highlight and shadow bands are drawn along the same rails as the body, so
 * they carry this overlap too rather than doubling it.
 */
const LEAD = 0.5;

const LIGHT: V2 = (() => {
  const len = Math.hypot(-0.55, -0.835);
  return [-0.55 / len, -0.835 / len];
})();

const len3 = (a: V3): number => Math.hypot(a[0], a[1], a[2]);

const distance = (a: V3, b: V3): number => Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);

const normaliseGaps = (
  gaps: ReadonlyArray<readonly [number, number]>,
  total: number,
): Array<[number, number]> =>
  gaps
    .map(([a, b]) => [Math.min(a, b), Math.max(a, b)] as [number, number])
    .map(([a, b]) => [Math.max(0, a), Math.min(total, b)] as [number, number])
    .filter(([a, b]) => b - a > EPS && b > 0)
    .toSorted((x, y) => x[0] - y[0]);

/**
 * The stretches of a run that are actually drawn: everything the gaps do not
 * cover. A gap hides the pipe under a collar, so a run is cut at the gap's start
 * and resumes at its end.
 */
export const runsOf = (
  total: number,
  gaps: ReadonlyArray<readonly [number, number]> = [],
): Array<[number, number]> => {
  const hidden = normaliseGaps(gaps, total);
  const out: Array<[number, number]> = [];
  let from = 0;
  for (const [start, end] of hidden) {
    if (start - from > EPS) out.push([from, start]);
    from = Math.max(from, end);
  }
  if (total - from > EPS) out.push([from, total]);
  return out;
};

/** Shoelace area, whose sign is the winding of a closed polygon. */
const areaOf = (points: ReadonlyArray<V2>): number =>
  points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length] as V2;
    return sum + point[0] * next[1] - next[0] * point[1];
  }, 0);

/**
 * The part of a cap's half-ring between two offsets from its centre, walked in the
 * order the band runs, so a capped end closes instead of stopping at the joint.
 */
const stripeEnd = (
  half: ReadonlyArray<V2>,
  centre: V2,
  nx: number,
  ny: number,
  from: number,
  to: number,
): V2[] => {
  const offset = (p: V2) => (p[0] - centre[0]) * nx + (p[1] - centre[1]) * ny;
  const values = half.map(offset);
  const lo = Math.min(from, to);
  const hi = Math.max(from, to);
  const points: V2[] = [];
  const cross = (k: number, level: number): V2 => {
    const a = half[k] as V2;
    const b = half[k + 1] as V2;
    const here = values[k] as number;
    const there = values[k + 1] as number;
    const t = (level - here) / (there - here || 1e-9);
    return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
  };
  for (let k = 0; k < half.length; k += 1) {
    const value = values[k] as number;
    if (value >= lo && value <= hi) points.push(half[k] as V2);
    if (k < half.length - 1)
      for (const level of [lo, hi]) {
        const next = values[k + 1] as number;
        if ((value - level) * (next - level) < 0) points.push(cross(k, level));
      }
  }
  return points
    .map((point) => [point, offset(point)] as const)
    .sort((x, y) => (from > to ? y[1] - x[1] : x[1] - y[1]))
    .map(([point]) => point);
};

interface CapTip {
  readonly half: V2[];
  readonly frame: Ribbon;
}

/** One cap: a disc in the plane across the run, split into the two halves of its ellipse. */
const capOf = (
  centre: V3,
  tangent: V3,
  radius: number,
  inward: V2,
  projection: Projection,
): { ring: V2[]; arc: V2[]; inner: V2[] } => {
  const view = viewOf(projection);
  let n1 = unit3(cross3(tangent, view));
  if (len3(n1) < 1e-6) n1 = frameAlong([0, 0, 0], tangent).u;
  const n2 = unit3(cross3(tangent, n1));

  const count = 28;
  const ring: V2[] = Array.from({ length: count }, (_, index) => {
    const angle = (index / count) * TAU;
    const c = Math.cos(angle) * radius;
    const s = Math.sin(angle) * radius;
    return iso(
      [
        centre[0] + n1[0] * c + n2[0] * s,
        centre[1] + n1[1] * c + n2[1] * s,
        centre[2] + n1[2] * c + n2[2] * s,
      ],
      projection,
    );
  });

  // The half away from the run's interior is the edge; the near half is drawn
  // too, but only when the cap turns to face the reader.
  const at = iso(centre, projection);
  const probe = iso([centre[0] + n2[0], centre[1] + n2[1], centre[2] + n2[2]], projection);
  const along = (probe[0] - at[0]) * inward[0] + (probe[1] - at[1]) * inward[1];
  const half = (from: number): V2[] => {
    const out: V2[] = [];
    for (let index = 0; index <= count / 2; index += 1)
      out.push(ring[(from + index) % count] as V2);
    return out;
  };
  // `arc` is the half away from the run's interior, which is the edge a cap
  // shows; `inner` is the half that turns toward the reader and needs its own
  // stroke when the cap faces the camera.
  const from = along > 0 ? count / 2 : 0;
  return { ring, arc: half(from), inner: half((from + count / 2) % count) };
};

export const tubePieces = (
  points: ReadonlyArray<V3>,
  radius: number | ((u: number) => number),
  projection: Projection,
  {
    maxLength = 30,
    spacing = 2.2,
    closed = false,
    breaks = [],
    gaps = [],
    caps = true,
    stripes = "auto",
    rings = null,
  }: TubeOptions = {},
): TubePiece[] => {
  if (points.length < 2) return [];
  const dense = resample(points, spacing);
  const total = pathLength(dense);
  if (total <= 0) return [];

  const k = scaleOf(projection);
  const view = viewOf(projection);
  const radiusAt = typeof radius === "function" ? radius : () => radius;
  const looped = closed && gaps.length === 0;
  const wrap = (along: number) => ((along % total) + total) % total;

  const spans: Array<{
    from: number;
    to: number;
    open0: boolean;
    open1: boolean;
    gapStart: boolean;
    gapEnd: boolean;
  }> = [];
  const hidden = normaliseGaps(gaps, total);
  for (const [runFrom, runTo] of runsOf(total, gaps)) {
    const gapStart = hidden.some(([from]) => Math.abs(from - runFrom) <= EPS);
    const gapEnd = hidden.some(([, to]) => Math.abs(to - runTo) <= EPS);
    const stations = [
      runFrom,
      ...breaks.filter((at) => at > runFrom + EPS && at < runTo - EPS).toSorted((a, b) => a - b),
      runTo,
    ];
    for (let index = 0; index + 1 < stations.length; index += 1) {
      const from = stations[index] as number;
      const to = stations[index + 1] as number;
      const parts = Math.max(1, Math.ceil((to - from) / maxLength - 1e-9));
      for (let part = 0; part < parts; part += 1)
        spans.push({
          from: from + ((to - from) * part) / parts,
          to: from + ((to - from) * (part + 1)) / parts,
          open0: true,
          open1: true,
          gapStart,
          gapEnd,
        });
    }
  }
  if (spans.length === 0) return [];

  const widest = Math.max(...Array.from({ length: 33 }, (_, index) => radiusAt(index / 32) * k));
  const wide = stripes === "auto" ? widest > 1.3 : Boolean(stripes);

  // A closed run wraps its stations; an open one clamps to its ends, so the
  // tangent at the first station is a one-sided difference rather than one that
  // jumps to the far end and back.
  const station = looped ? wrap : (at: number) => Math.max(0, Math.min(total, at));

  const ribbonAt = (along: number, half: number): Ribbon => {
    const step = Math.max(0.05, Math.min(spacing, total / 4) / 2);
    const before = iso(pointAlong(dense, station(along - step)), projection);
    const after = iso(pointAlong(dense, station(along + step)), projection);
    const tx = after[0] - before[0];
    const ty = after[1] - before[1];
    const len = Math.hypot(tx, ty) || 1;
    return {
      p: iso(pointAlong(dense, station(along)), projection),
      nx: -ty / len,
      ny: tx / len,
      half,
    };
  };

  /** One polyline cut out of the run, with the frame at each of its stations. */
  const partOf = (
    start: number,
    end: number,
  ): { points: V3[]; ribbons: Ribbon[]; widths: number[] } => {
    let points = cut(dense, Math.max(0, start), Math.min(total, end));
    // A closed run carries past its own ends, so a cut that runs off either end
    // wraps round and takes the far piece of the loop with it.
    if (looped && start < 0) points = [...cut(dense, total + start, total), ...points.slice(1)];
    if (looped && end > total) points = [...points, ...cut(dense, 0, end - total).slice(1)];

    // Arclength is measured from the RUN's start, not the piece's. A piece is cut
    // back by a lead, so measuring from zero would place every station late.
    let walked = looped ? start : Math.max(0, start);
    const along = points.map((point, index) => {
      if (index > 0) walked += distance(point, points[index - 1] as V3);
      return walked;
    });

    const widths = along.map((at) => {
      const u = looped ? wrap(at) / total : Math.min(1, Math.max(0, at / total));
      return radiusAt(u) * k;
    });
    const ribbons = along.map((at, index) => ribbonAt(station(at), widths[index] as number));
    return { points, ribbons, widths };
  };

  /** The six edges a run's frames trace: its two outlines and its two bands. */
  const railsOf = (ribbons: ReadonlyArray<Ribbon>) => {
    const out = {
      left: [] as V2[],
      right: [] as V2[],
      shineA: [] as V2[],
      shineB: [] as V2[],
      shadeA: [] as V2[],
      shadeB: [] as V2[],
    };
    for (const ribbon of ribbons) {
      const { p, nx, ny, half } = ribbon;
      const at = (offset: number): V2 => [p[0] + nx * offset, p[1] + ny * offset];
      const toward = nx * LIGHT[0] + ny * LIGHT[1];
      const shineAt = half * 0.44 * toward;
      const shadeAt = -half * 0.62 * toward;
      out.left.push(at(half));
      out.right.push(at(-half));
      out.shineA.push(at(shineAt + half * 0.24));
      out.shineB.push(at(shineAt - half * 0.24));
      out.shadeA.push(at(shadeAt + half * 0.2));
      out.shadeB.push(at(shadeAt - half * 0.2));
    }
    return out;
  };

  return spans
    .map((span): TubePiece | null => {
      // A chunk is open where another chunk continues it: an interior joint, or
      // the seam where a gapless loop's last chunk meets its first.
      const openStart = span.open0 && (span.from > 0 || looped);
      const openEnd = span.open1 && (span.to < total || looped);
      const part = partOf(
        openStart ? span.from - LEAD : span.from,
        openEnd ? span.to + LEAD : span.to,
      );
      if (part.points.length < 2) return null;

      // The body carries the overlap, and the highlight and shadow bands carry it
      // twice, so they reach past the joint into the neighbouring chunk instead of
      // pinching where the two meet.
      const stripe =
        openStart || openEnd
          ? partOf(
              openStart ? span.from - 2 * LEAD : span.from,
              openEnd ? span.to + 2 * LEAD : span.to,
            )
          : part;

      const sides = railsOf(part.ribbons);
      const bands = stripe === part ? sides : railsOf(stripe.ribbons);
      const { left, right } = sides;

      const sign = Math.sign(areaOf([...left, ...right.toReversed()]));
      let body = pathOf([...left, ...right.toReversed()], true);
      let edges = joinPaths([pathOf(left), pathOf(right)]);

      // A cap is drawn where the run truly ends and nowhere else. An interior
      // chunk continues into its neighbour, so capping it would draw a disc
      // across a pipe that carries on.
      const tips: [CapTip | null, CapTip | null] = [null, null];
      const terminus: [boolean, boolean] = [
        !openStart && (span.from <= 1e-6 || span.gapStart),
        !openEnd && (span.to >= total - 1e-6 || span.gapEnd),
      ];
      const wanted: [boolean, boolean] = [
        terminus[0] && (span.gapStart || capsOn(caps, 0)),
        terminus[1] && (span.gapEnd || capsOn(caps, 1)),
      ];
      for (const side of [0, 1] as const) {
        if (!wanted[side]) continue;
        // `other` is the neighbour, not the far end: the cap's frame is built
        // from the local direction of travel, and taking the far end flips it.
        const last = part.points.length - 1;
        const here = side === 0 ? (part.points[0] as V3) : (part.points[last] as V3);
        const other = side === 0 ? (part.points[1] as V3) : (part.points[last - 1] as V3);
        const ribbon = side === 0 ? (part.ribbons[0] as Ribbon) : (part.ribbons[last] as Ribbon);
        const neighbour =
          side === 0 ? (part.ribbons[1] as Ribbon) : (part.ribbons[last - 1] as Ribbon);
        // The tangent runs from this station toward its neighbour, so the end
        // cap's outward direction is its negative and the start cap's is itself.
        const tangent = unit3(sub3(side === 0 ? other : here, side === 0 ? here : other));
        const outward: V3 = side === 0 ? [-tangent[0], -tangent[1], -tangent[2]] : tangent;
        const cap = capOf(
          here,
          tangent,
          ribbon.half / k,
          // Which half of the cap ellipse faces the run's interior: the step from
          // this station to its neighbour.
          [neighbour.p[0] - ribbon.p[0], neighbour.p[1] - ribbon.p[1]],
          projection,
        );
        // The cap has to wind the same way as the body it closes, or the fill
        // rule punches a hole where the two meet.
        const wound = Math.sign(areaOf(cap.ring)) === sign ? cap.ring : [...cap.ring].reverse();
        body += pathOf(wound, true);
        edges += pathOf(cap.arc);
        const facesReader = dot3(outward, view) > 0;
        if (facesReader) edges += pathOf(cap.inner);
        tips[side] = { half: facesReader ? cap.inner : cap.arc, frame: ribbon };
      }

      const towardOf = (frame: Ribbon) => frame.nx * LIGHT[0] + frame.ny * LIGHT[1];
      const band = (a: V2[], b: V2[], offsets: (frame: Ribbon) => [number, number]): string => {
        const head = tips[1]
          ? stripeEnd(
              tips[1].half,
              tips[1].frame.p,
              tips[1].frame.nx,
              tips[1].frame.ny,
              ...offsets(tips[1].frame),
            )
          : [];
        // The tail is the same pair of offsets read the other way round, so the
        // band runs through the cap rather than reversing at it.
        const tail = tips[0]
          ? (() => {
              const [lo, hi] = offsets(tips[0].frame);
              return stripeEnd(
                tips[0].half,
                tips[0].frame.p,
                tips[0].frame.nx,
                tips[0].frame.ny,
                hi,
                lo,
              );
            })()
          : [];
        return pathOf([...a, ...head, ...b.toReversed(), ...tail], true);
      };
      const shineOffsets = (frame: Ribbon): [number, number] => {
        const at = frame.half * 0.44 * towardOf(frame);
        return [at + frame.half * 0.24, at - frame.half * 0.24];
      };
      const shadeOffsets = (frame: Ribbon): [number, number] => {
        const at = -frame.half * 0.62 * towardOf(frame);
        return [at + frame.half * 0.2, at - frame.half * 0.2];
      };

      return {
        rings: rings === null ? [] : ringsOf(dense, total, radiusAt, projection, span, rings),
        ringTone: rings?.tone ?? "lo",
        mid: pointAlong(dense, (span.from + span.to) / 2),
        body,
        shine: wide ? band(bands.shineA, bands.shineB, shineOffsets) : "",
        shade: wide ? band(bands.shadeA, bands.shadeB, shadeOffsets) : "",
        edges,
        wide,
        points: part.points,
        radii: part.widths.map((width) => width / k),
        ends: wanted,
        from: span.from,
        to: span.to,
      };
    })
    .filter((piece): piece is TubePiece => piece !== null);
};

const capsOn = (caps: TubeOptions["caps"], side: 0 | 1): boolean =>
  Array.isArray(caps) ? caps[side] : Boolean(caps);

/**
 * Braid, corrugation or wrap.
 *
 * Drawn as short strokes lying on the surface rather than a dash pattern down
 * the centreline, so the texture follows the cross-section and stays continuous
 * through every chunk joint. Only the facing half is drawn, because the back
 * half is never visible.
 */
const ringsOf = (
  dense: ReadonlyArray<V3>,
  total: number,
  radiusAt: (u: number) => number,
  projection: Projection,
  span: { from: number; to: number; open0: boolean; open1: boolean },
  { pitch = 3, twist = 0, cross = false, fade = [0.1, 0.55], phase = 0, steps = 16 }: Rings,
): Array<{ d: string; alpha: number }> => {
  if (pitch <= 0 || steps <= 0) return [];
  const view = viewOf(projection);
  const reach = Math.abs(twist) * Math.max(radiusAt(0), radiusAt(0.5), radiusAt(1));
  // Rings never start inside the overlap skirt, nor crowd a true terminus.
  const margin = twist === 0 ? Math.min(pitch * 0.35, (span.to - span.from) / 2) : 0;
  const start = span.open0 ? span.from : span.from - LEAD + margin;
  const stop = span.open1 ? span.to : span.to + LEAD - margin;
  if (stop - start <= 0) return [];

  const hands = twist === 0 ? [0] : cross ? [1, -1] : [1];
  const firstStation = Math.ceil((start - reach - phase) / pitch);
  const lastStation = Math.floor((stop + reach - phase) / pitch);
  const out: Array<{ d: string; alpha: number }> = [];

  const surface = (along: number, angle: number) => {
    const wrapped = ((along % total) + total) % total;
    const centre = pointAlong(dense, wrapped);
    const tangent = tangentAlong(dense, wrapped);
    const n1 = unit3(cross3(tangent, view));
    if (len3(n1) < 1e-6) return null;
    const raw = unit3(cross3(tangent, n1));
    const flip = dot3(raw, view) >= 0 ? 1 : -1;
    const n2: V3 = [raw[0] * flip, raw[1] * flip, raw[2] * flip];
    const normal: V3 = [
      n1[0] * Math.cos(angle) + n2[0] * Math.sin(angle),
      n1[1] * Math.cos(angle) + n2[1] * Math.sin(angle),
      n1[2] * Math.cos(angle) + n2[2] * Math.sin(angle),
    ];
    const radius = radiusAt(wrapped / total);
    return {
      p: iso(
        [
          centre[0] + normal[0] * radius,
          centre[1] + normal[1] * radius,
          centre[2] + normal[2] * radius,
        ],
        projection,
      ),
      facing: dot3(normal, view),
    };
  };

  for (const hand of hands)
    for (let station = firstStation; station <= lastStation; station += 1) {
      const angleAt = (share: number) =>
        twist === 0 ? 0 : hand * twist * radiusAt(share) * (share - 0.5);
      for (let step = 0; step < steps; step += 1) {
        const a = station * pitch + phase + angleAt(step / steps);
        const b = station * pitch + phase + angleAt((step + 1) / steps);
        if (b <= start || a >= stop) continue;
        const first = surface(a, ((a / TAU) % 1) * Math.PI);
        const second = surface(b, ((b / TAU) % 1) * Math.PI);
        if (!first || !second) continue;
        const alpha = fadeOf((first.facing + second.facing) / 2, fade);
        if (alpha <= 0.02) continue;
        out.push({ d: pathOf([first.p, second.p]), alpha });
      }
    }
  return out;
};

export const ringsSvg = (
  rings: ReadonlyArray<{ d: string; alpha: number }>,
  tone = "lo",
): string => {
  const buckets = new Map<number, string[]>();
  for (const ring of rings) {
    const level = Math.round(Math.min(1, ring.alpha) * 20) / 20;
    const bucket = buckets.get(level) ?? [];
    bucket.push(ring.d);
    buckets.set(level, bucket);
  }
  return [...buckets.entries()]
    .toSorted((a, b) => a[0] - b[0])
    .map(
      ([alpha, parts]) =>
        `<path class="tb-ring" data-tone="${tone}" d="${parts.join("")}"${
          alpha < 1 ? ` opacity="${alpha.toFixed(2)}"` : ""
        }/>`,
    )
    .join("");
};

export const tubeSvg = (piece: TubePiece, { tone = "hi" }: { tone?: "hi" | "lo" } = {}): string => {
  const bands = piece.wide
    ? `<path class="tb-shine" d="${piece.shine}"/><path class="tb-shade" d="${piece.shade}"/>`
    : "";
  return `<g class="tb"><path class="tb-body" d="${piece.body}"/>${bands}${ringsSvg(piece.rings, piece.ringTone)}<path class="iso-line tb-edge" data-tone="${tone}" d="${piece.edges}"/></g>`;
};

/**
 * Where a run passes through a clamp, as arclength stations.
 *
 * Only a transverse crossing counts. A vertex sitting exactly on the clamp plane
 * is counted once on the way in, and a run lying along the plane never fires.
 */
export const crossingsOf = (
  points: ReadonlyArray<V3>,
  centre: V3,
  axis: V3,
  radius: number,
): number[] => {
  const unit = unit3(axis);
  const out: number[] = [];
  let walked = 0;
  for (let index = 1; index < points.length; index += 1) {
    const here = points[index] as V3;
    const before = points[index - 1] as V3;
    const step = distance(here, before);
    const da = dot3([before[0] - centre[0], before[1] - centre[1], before[2] - centre[2]], unit);
    const db = dot3([here[0] - centre[0], here[1] - centre[1], here[2] - centre[2]], unit);
    if ((da <= 0 && db > 0) || (da >= 0 && db < 0)) {
      const t = da / (da - db);
      const point: V3 = [
        before[0] + (here[0] - before[0]) * t,
        before[1] + (here[1] - before[1]) * t,
        before[2] + (here[2] - before[2]) * t,
      ];
      if (Math.hypot(point[0] - centre[0], point[1] - centre[1], point[2] - centre[2]) <= radius)
        out.push(walked + t * step);
    }
    walked += step;
  }
  return out;
};
