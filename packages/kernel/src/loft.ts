// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The board surface between two cross-sections, as points rather than curves.
 *
 * This is the one place that answers "where is the hull at station x?", shared by
 * the tessellator, the STL exporter and the 3D guide overlays so they cannot
 * drift apart.
 *
 * ## Why points and not control points
 *
 * The obvious way to loft is to blend the two stations' bezier CONTROL POINTS
 * and evaluate the resulting curve — that is what `interpolateCrossSection`
 * does, and the mesh used it for a long time. It has a defect that cannot be
 * sampled away: the blend pairs knots BY ARRAY INDEX. Index pairing puts a
 * station's knot next to whichever knot happens to share its position in the
 * list, which may sit somewhere else entirely on the profile — and `lerpKnot`
 * lerps the TANGENT HANDLES too. Handles lerped between mismatched partners can
 * collapse or cross, and the blended cubic then carries a near-cusp that neither
 * station has.
 *
 * That is the pinch users hit by putting two control points close together (the
 * `80-20-hard` rail preset does exactly this). It is a malformed curve, not a
 * malformed sampling of a good curve, which is why three rounds of fixing the
 * ring SAMPLER each helped and none of them fixed it.
 *
 * Worth being precise about, because it misled the earlier attempts: the knot
 * COUNTS need not differ. The reported reproduction pairs `80-20-hard` against
 * `50-50-soft` and both come out with six knots, so `matchControlPointCounts`
 * never runs — and the mesh still pinches at 1.45x the endpoint curvature. It is
 * index pairing itself that is wrong, not the insertion heuristic that feeds it.
 * Normalising every station to a common knot count (the previous fix) therefore
 * could not have worked: it makes the counts agree without making the paired
 * knots correspond.
 *
 * So: never build a blended curve. Sample each station's own profile at equal
 * fractional arc length and lerp the two POINTS. A linear morph between two
 * well-formed profiles under a monotone correspondence cannot invent a cusp, and
 * knot topology stops being an input to the mesh at all. Pinned by
 * `loft.pinch.test.ts`.
 *
 * This is not a departure from BoardCAD-LE — it is a return to it. The legacy
 * shipped two surface models and the GUI defaulted to this one
 * (`BezierBoardSLinearInterpolationSurfaceModel.getPointAt`, reached via
 * `MenuBar.getCrossSectionInterpolationType`); both its STL exporter and its 3D
 * viewer went through it. We had ported the other one.
 *
 * ## Why correspondence works out
 *
 * Fractional arc length needs its endpoints to mean the same thing at both
 * stations, or the whole ring shears. They do, by construction: every profile
 * runs bottom-centreline -> rail -> deck-centreline with both ends on x = 0. So
 * f = 0 and f = 1 are anchored for free — the seam alignment a skinning pipeline
 * normally has to arrange by hand.
 *
 * ## Why it stays smooth along the board
 *
 * `f` is fixed per ring index, so the two sampled points are constants; only the
 * scale and the blend weight vary with x, both smoothly, through the board's
 * thickness/width/rocker curves. And the sampler is {@link arcLengthTable},
 * whose fixed resolution makes it a continuous function of the control points —
 * deliberately not `pointByS` / `pointByCurveLengthAt`, whose threshold-triggered
 * recursion steps discontinuously and lands in the mesh as jitter.
 */
import {
  arcLengthTable,
  pointAtArcFraction,
  splineFromKnots,
  valueAt,
  type ArcTable,
  type Spline,
} from './bezier-spline';
import {
  getLength,
  getNearestCrossSectionIndex,
  getRockerAtPos,
  getThicknessAtPos,
  getWidthAtPos,
  widthBoundsAt,
  type BezierBoard,
} from './board';
import { hasTailCutout } from './outline-cutout';
import { boardChannels } from './channel-layout';
import type { ChannelKeyPart } from './channel-apply';
import { channelAnchors, channelDepthAt, channelFullDepth, splineSpan } from './channels';
import { crossSection, scaleCrossSection, type CrossSection } from './cross-section';
import { knot } from './knot';
import { vec2, type Vec2 } from './vec2';

/** A point in board space (cm): X along the length, Y across, Z up. */
export interface Vert3 {
  x: number;
  y: number;
  z: number;
}

/**
 * The station profiles that make the surface at some x, and how much of each.
 *
 * All are already scaled to the board's thickness and width at that x, so the
 * weighted sum of their points needs no further correction. The weights sum to 1.
 */
export interface LoftedSection {
  /** One to three station profiles (arc-length tables) and their weights. */
  readonly parts: readonly { readonly table: ArcTable; readonly w: number }[];
  /** Height of the bottom centreline at this station. */
  readonly rocker: number;
}

/** All three coordinates are finite (no NaN/±Infinity from a degenerate sample). */
export const isFinite3 = (x: number, y: number, z: number): boolean =>
  Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);

/**
 * Below this (cm) a scaled dimension is treated as degenerate — legacy floor.
 *
 * Exported because it is the threshold at which a station stops describing real
 * geometry: an end whose true width is under `MIN_DIM` is a point that the floor
 * inflates into a small ring, and consumers that care about the shape of the tip
 * (the mesh's end caps, the STEP exporter's cap faces) have to branch on that.
 */
export const MIN_DIM = 0.5;

/**
 * Station weights along the board: a cardinal (Catmull–Rom) spline through the real
 * stations, its swing halved ({@link STATION_TENSION}).
 *
 * The surface passes through every station exactly and flows through it with no corner:
 * each stretch between two stations is a cubic in the stations around it, its rate of
 * change at a station the same from both sides. Straight blends between stations turned
 * a corner at each one; easing that corner while still meeting the station made the
 * surface curve the wrong way for a few centimetres either side, a shallow dip at every
 * station (owner report, 2026-11).
 *
 * Local: a stretch reads only its two stations and one either side, so editing a
 * station reshapes only the stretches touching it and the next. Inserting a station on
 * the existing shape moves the surface near it slightly (well under a millimetre on
 * the golden boards), where a straight blend moved nothing. A clamped cubic spline
 * through all the stations, smoother still, moved it up to 4 mm and the hull by 1.3 %
 * of its volume, and was not taken.
 *
 * At the first and last real station the rate of change is 0, so the spline joins the
 * profile held beyond them with no corner. Weights sum to 1; between stations some are
 * a little negative, which is what lets the surface curve through a station rather than
 * turn at it.
 */
export const STATION_TENSION = 0.5;

/** Each real station's weight at `x` (index into the board's sections → weight). */
const splineWeights = (cs: readonly CrossSection[], x: number): [number, number][] | null => {
  const xs = cs.slice(1, -1).map((q) => q.position);
  const n = xs.length;
  if (n < 2 || xs.some((p, i) => i > 0 && !(p - xs[i - 1]! > 1e-9))) return null;
  if (x <= xs[0]!) return [[1, 1]];
  if (x >= xs[n - 1]!) return [[n, 1]];
  let i = 0;
  while (i < n - 2 && x > xs[i + 1]!) i++;
  const h = xs[i + 1]! - xs[i]!;
  const t = (x - xs[i]!) / h;
  // Cubic Hermite: the two stations, and the rate of change at each.
  const h00 = (1 + 2 * t) * (1 - t) * (1 - t);
  const h10 = t * (1 - t) * (1 - t);
  const h01 = t * t * (3 - 2 * t);
  const h11 = t * t * (t - 1);
  const w = new Map<number, number>();
  const add = (j: number, v: number) => w.set(j, (w.get(j) ?? 0) + v);
  add(i, h00);
  add(i + 1, h01);
  // The rate of change at station k: the slope across its neighbours, swing halved; 0 at
  // the first and last (held beyond).
  const rate = (k: number, by: number) => {
    if (k <= 0 || k >= n - 1) return;
    const span = xs[k + 1]! - xs[k - 1]!;
    add(k + 1, (by * (1 - STATION_TENSION)) / span);
    add(k - 1, (-by * (1 - STATION_TENSION)) / span);
  };
  rate(i, h10 * h);
  rate(i + 1, h11 * h);
  const out: [number, number][] = [];
  for (const [j, v] of w) if (v !== 0) out.push([j + 1, v]);
  return out;
};

/**
 * Prepare the surface at station `x` for sampling, or null where there is none.
 *
 * Station bracketing is deliberately identical to `getInterpolatedCrossSection`
 * (`board.ts`), including the order in which `d` is computed relative to the
 * index clamps: the mesh must keep pairing the same stations it always did.
 *
 * The stations are weighted by a cardinal spline through them (`splineWeights`):
 * exact at every station, smooth through it. Past the first and last station the
 * profile is held.
 */
export const loftSection = (b: BezierBoard, x: number): LoftedSection | null => {
  const cs = b.crossSections;
  if (cs.length === 0 || x < 0 || x > getLength(b)) return null;

  let index = getNearestCrossSectionIndex(b, x);
  if (index < 0) return null;
  if (cs[index]!.position > x) index -= 1;
  let nextIndex = index + 1;

  // Computed before the clamps, as the legacy does: outside the real-station
  // span this extrapolates, and the clamps below then collapse the pair.
  const firstPos = cs[index]!.position;
  const secondPos = cs[nextIndex]!.position;
  let d = (x - firstPos) / (secondPos - firstPos);
  if (!Number.isFinite(d)) d = 0;

  if (index < 1) index = 1;
  if (nextIndex > cs.length - 2) {
    index = cs.length - 2;
    nextIndex = index;
  }
  // Past the outermost real station both ends are the same profile, so the
  // weight is irrelevant — pin it rather than let an extrapolated value show up
  // in a debugger.
  if (index === nextIndex) d = 0;
  if (index < 1) return null;

  const rocker = getRockerAtPos(b, x);
  if (!Number.isFinite(rocker)) return null;

  let thickness = getThicknessAtPos(b, x);
  if (thickness < MIN_DIM) thickness = MIN_DIM;
  let width = getWidthAtPos(b, x);
  if (width < MIN_DIM) width = MIN_DIM;

  // Station weights: the spline through the stations, or (a single station, or two at
  // one place) the straight blend.
  const weights = new Map<number, number>();
  const add = (i: number, w: number) => weights.set(i, (weights.get(i) ?? 0) + w);
  const spline = splineWeights(cs, x);
  if (spline) {
    for (const [i, w] of spline) add(i, w);
  } else {
    add(index, 1 - d);
    if (nextIndex !== index) add(nextIndex, d);
  }

  // Scale BEFORE building the tables: fractional arc length is not invariant
  // under a non-uniform scale, so sampling an unscaled profile and scaling the
  // result would put the two stations' points at different places on the rail.
  const parts: { table: ArcTable; w: number }[] = [];
  for (const [i, w] of [...weights].sort((p, q) => p[0] - q[0])) {
    if (w === 0) continue;
    parts.push({ table: arcLengthTable(scaleCrossSection(cs[i]!, thickness, width).spline), w });
  }
  return { parts, rocker };
};

/**
 * The profile point at fractional arc length `f` ∈ [0,1], as
 * (x = distance from centreline, y = height above rocker).
 *
 * `f = 0` is the bottom centreline, `f = 1` the deck centreline.
 */
export const loftPoint = (s: LoftedSection, f: number): Vec2 => {
  if (s.parts.length === 1) return pointAtArcFraction(s.parts[0]!.table, f);
  let x = 0;
  let y = 0;
  for (const { table, w } of s.parts) {
    const p = pointAtArcFraction(table, f);
    x += w * p.x;
    y += w * p.y;
  }
  return vec2(x, y);
};

/** Points per rail for a ring of `ringSteps`; both rails share the two centreline points. */
export const ringHalf = (ringSteps: number): number => Math.max(2, Math.floor(ringSteps / 2));

// --- where the ring's points go ---

/**
 * How hard point density follows curvature. See {@link ringFractions}.
 *
 * Measured on an `80-20-hard` rail at the default viewport quality (48 ring
 * points): worst chord deviation anywhere on the profile, the same on the flat
 * bottom alone, and the ratio of the longest to the shortest gap between
 * neighbouring ring points.
 *
 *   β     worst      bottom     gap ratio   longest gap
 *   0     0.2531     0.0011     1.1         2.05 cm
 *   0.5   0.0645     0.0024     5.7         3.37 cm
 *   1     0.0767     0.0038     9.8         4.51 cm
 *   2     0.0436     0.0061     16.6        6.36 cm
 *   3     0.0262     0.0081     20.2        7.32 cm
 *
 * 0.5 takes the rail error down 4x for the smallest distortion of the rest of
 * the ring. Past it the returns are both small and unreliable — β=1 measures
 * WORSE than β=0.5, because at this point count the figure depends on whether a
 * sample happens to land on the apex, so the curve is not smooth enough to pick
 * a finer optimum from. Meanwhile the cost is real: by β=2 a single quad edge
 * spans 6.4 cm of the flat bottom, which shades badly however small its chord
 * error is. The bottom's own error stays negligible throughout — it is flat, so
 * taking points away from it costs almost nothing geometrically.
 *
 * Pinned by `loft.ladder.test.ts`.
 */
export const CURVATURE_BIAS = 0.5;

/** Resolution of the monitor / ladder tables. Fixed, so the ladder stays smooth in the board. */
const LADDER_SAMPLES = 128;

/** Half-width of the box filter applied to the monitor before integrating it. */
const LADDER_SMOOTH = 2;

const LADDER_CACHE = new WeakMap<BezierBoard, Map<number, readonly number[]>>();

/** |κ| at each of `LADDER_SAMPLES + 1` equal-arc stops along one profile, times its length. */
const curvatureProfile = (table: ArcTable): number[] => {
  const n = LADDER_SAMPLES;
  const pts: Vec2[] = [];
  for (let i = 0; i <= n; i++) pts.push(pointAtArcFraction(table, i / n));
  const out = new Array<number>(n + 1).fill(0);
  for (let i = 1; i < n; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const c = pts[i + 1]!;
    let turn = Math.atan2(c.y - b.y, c.x - b.x) - Math.atan2(b.y - a.y, b.x - a.x);
    while (turn > Math.PI) turn -= 2 * Math.PI;
    while (turn < -Math.PI) turn += 2 * Math.PI;
    const ds = (Math.hypot(b.x - a.x, b.y - a.y) + Math.hypot(c.x - b.x, c.y - b.y)) / 2;
    // |κ| · L, dimensionless: total turning per unit of the profile's own length.
    out[i] = ds > 1e-9 ? (Math.abs(turn) / ds) * table.total : 0;
  }
  out[0] = out[1]!;
  out[n] = out[n - 1]!;
  return out;
};

/**
 * Where to put a ring's `n` points along the profile, as fractional arc lengths.
 *
 * Uniform arc length spreads points evenly, which under-resolves a hard rail: at
 * the default quality a ring spends ~1.5 cm between points against an apex whose
 * radius is a few millimetres, so the tightest part of the shape — the part a
 * shaper is actually looking at — is the worst-sampled.
 *
 * A CAD tessellator would answer with a chord-height tolerance and a variable
 * point count. A lofted quad mesh cannot: every station needs the SAME count in
 * the SAME order or the correspondence that makes the loft work is gone. So use
 * the equidistribution form of the same idea — for a fixed point budget, chord
 * error is minimised when points are spread evenly in ∫|κ|^(1/2) ds. Pure
 * κ^(1/2) starves the flat bottom, so the monitor keeps a uniform floor:
 *
 *     m(f) = 1 + β·sqrt(|κ(f)|·L)
 *
 * Two properties make this safe to put inside a loft:
 *
 *   - The ladder is built ONCE PER BOARD from the pointwise MAX of `m` across
 *     every station. A rail that is sharp anywhere gets points everywhere, so
 *     every station uses the identical ladder and correspondence is untouched.
 *   - It only decides WHERE samples sit on a surface it does not otherwise
 *     change. A board edit that moves the ladder cannot move the shape, and
 *     since the ladder is constant across x it cannot affect smoothness along
 *     the board either.
 *
 * Memoised per (board, n); boards are immutable, so a stale entry can't be seen.
 */
export const ringFractions = (b: BezierBoard, n: number): readonly number[] => {
  const count = Math.max(2, Math.floor(n));
  let perBoard = LADDER_CACHE.get(b);
  if (!perBoard) {
    perBoard = new Map();
    LADDER_CACHE.set(b, perBoard);
  }
  const hit = perBoard.get(count);
  if (hit) return hit;

  const out = buildLadder(b, count);
  perBoard.set(count, out);
  return out;
};

const uniformLadder = (count: number): number[] =>
  Array.from({ length: count }, (_, i) => i / (count - 1));

/** The ladder's point density at each of `LADDER_SAMPLES + 1` arc stops, or null for uniform. */
const ladderDensity = (b: BezierBoard): number[] | null => {
  if (CURVATURE_BIAS <= 0) return null;

  // Interior stations only — index 0 and the last are the degenerate nose/tail
  // dummies, whose collapsed profiles would report meaningless curvature.
  const stations = b.crossSections.slice(1, -1);
  const monitor = new Array<number>(LADDER_SAMPLES + 1).fill(0);
  let any = false;
  for (const cs of stations) {
    if (cs.spline.knots.length < 2) continue;
    const kl = curvatureProfile(arcLengthTable(cs.spline));
    for (let i = 0; i < monitor.length; i++) monitor[i] = Math.max(monitor[i]!, kl[i]!);
    any = true;
  }
  if (!any) return null;

  // Box-smooth, so one sample's curvature spike can't claim a disproportionate
  // share of the points, then turn it into a density.
  return monitor.map((_, i) => {
    let sum = 0;
    let seen = 0;
    for (let j = i - LADDER_SMOOTH; j <= i + LADDER_SMOOTH; j++) {
      const v = monitor[j];
      if (v === undefined) continue;
      sum += v;
      seen++;
    }
    return 1 + CURVATURE_BIAS * Math.sqrt(Math.max(0, sum / Math.max(1, seen)));
  });
};

const buildLadder = (b: BezierBoard, count: number): readonly number[] => {
  const density = ladderDensity(b);
  if (!density) return uniformLadder(count);

  // Cumulative density, normalised: cum[i] is the share of the points that
  // should have been used by arc fraction i / LADDER_SAMPLES.
  const cum = new Array<number>(density.length).fill(0);
  for (let i = 1; i < density.length; i++) {
    cum[i] = cum[i - 1]! + (density[i - 1]! + density[i]!) / 2;
  }
  const total = cum[cum.length - 1]!;
  if (!(total > 0)) return uniformLadder(count);
  for (let i = 0; i < cum.length; i++) cum[i]! /= total;

  // Invert it: ring point k wants share k/(count-1), so find the arc fraction
  // where the cumulative density reaches that.
  const out = new Array<number>(count);
  out[0] = 0;
  out[count - 1] = 1;
  let j = 0;
  for (let k = 1; k < count - 1; k++) {
    const target = k / (count - 1);
    while (j + 1 < cum.length && cum[j + 1]! < target) j++;
    const lo = cum[j]!;
    const hi = cum[j + 1] ?? 1;
    const t = hi > lo ? (target - lo) / (hi - lo) : 0;
    out[k] = (j + t) / LADDER_SAMPLES;
  }
  return out;
};

/**
 * The ladder as a measure: `m(f)`, the share of a plain ring's points up to profile
 * fraction `f`, and its inverse `f(m)`. Its density is the ladder's, taken linear
 * between the sample stops, so both are smooth (C¹) and one undoes the other exactly.
 * Moving points by a share of this measure, rather than by profile fraction, keeps
 * them as dense as the ladder put them: packed where the profile curves hard.
 */
interface LadderMeasure {
  readonly m: (f: number) => number;
  readonly f: (m: number) => number;
}

const IDENTITY_MEASURE: LadderMeasure = { m: (f) => f, f: (m) => m };
const MEASURE_CACHE = new WeakMap<BezierBoard, LadderMeasure>();

const ladderMeasure = (b: BezierBoard): LadderMeasure => {
  const hit = MEASURE_CACHE.get(b);
  if (hit) return hit;
  const rho = ladderDensity(b);
  let out = IDENTITY_MEASURE;
  if (rho) {
    const n = rho.length - 1;
    const cum = [0];
    for (let i = 1; i <= n; i++) cum.push(cum[i - 1]! + (rho[i - 1]! + rho[i]!) / 2);
    const total = cum[n]!;
    if (total > 0) {
      out = {
        m: (f) => {
          const u = Math.min(n, Math.max(0, f * n));
          const i = Math.min(n - 1, Math.floor(u));
          const t = u - i;
          const r0 = rho[i]!;
          const r1 = rho[i + 1]!;
          return (cum[i]! + r0 * t + ((r1 - r0) * t * t) / 2) / total;
        },
        f: (m) => {
          const c = Math.min(1, Math.max(0, m)) * total;
          let i = 0;
          let hi = n - 1;
          while (i < hi) {
            const mid = (i + hi + 1) >> 1;
            if (cum[mid]! <= c) i = mid;
            else hi = mid - 1;
          }
          const r0 = rho[i]!;
          const r1 = rho[i + 1]!;
          const d = c - cum[i]!;
          // r0·t + (r1 − r0)·t²/2 = d, in the form that stays exact as r1 → r0.
          const t = (2 * d) / (r0 + Math.sqrt(Math.max(0, r0 * r0 + 2 * (r1 - r0) * d)));
          return Math.min(1, Math.max(0, (i + Math.min(1, Math.max(0, t))) / n));
        },
      };
    }
  }
  MEASURE_CACHE.set(b, out);
  return out;
};

// --- channels: points on the walls, the bottom lifted ---------------------------

/** Distance from the stringer for a profile point's distance from the centreline. */
export type LateralMap = (px: number) => number;
const IDENTITY: LateralMap = (px) => px;

/** Samples used to find where a station's bottom ends. */
const BOTTOM_END_SAMPLES = 64;

/**
 * Where the station's bottom ends, as a fraction of its profile: the widest point,
 * the rail's apex. Points before it are bottom, which channels cut; after it, deck.
 */
export const bottomEnd = (s: LoftedSection): number => {
  let best = 0;
  let widest = -Infinity;
  for (let i = 0; i <= BOTTOM_END_SAMPLES; i++) {
    const f = i / BOTTOM_END_SAMPLES;
    const x = loftPoint(s, f).x;
    if (x > widest) {
      widest = x;
      best = f;
    }
  }
  // Then exactly, between the samples either side (golden section): a step of the
  // sampling would move where the cut ends, and the mesh's points near it would jump
  // from station to station (owner report: rail scalloping, 2026-11).
  const h = 1 / BOTTOM_END_SAMPLES;
  let lo = Math.max(0, best - h);
  let hi = Math.min(1, best + h);
  const g = (Math.sqrt(5) - 1) / 2;
  const at = (f: number) => loftPoint(s, f).x;
  let c = hi - g * (hi - lo);
  let d = lo + g * (hi - lo);
  let fc = at(c);
  let fd = at(d);
  for (let i = 0; i < BOTTOM_END_REFINE; i++) {
    if (fc >= fd) {
      hi = d;
      d = c;
      fd = fc;
      c = hi - g * (hi - lo);
      fc = at(c);
    } else {
      lo = c;
      c = d;
      fc = fd;
      d = lo + g * (hi - lo);
      fd = at(d);
    }
  }
  return (lo + hi) / 2;
};

/** Golden-section steps refining where the bottom ends: (0.618)^40 of a sample, far under a micron. */
const BOTTOM_END_REFINE = 40;

/** Bisection steps finding a wall on a station: 2^-40 of the profile, far under a micron. */
const WALL_STEPS = 40;

/** The fraction on the bottom (0 to `end`) where the profile is `y` out from the stringer. */
const bottomFractionAt = (s: LoftedSection, y: number, end: number, map: LateralMap): number => {
  const at = (f: number) => map(loftPoint(s, f).x);
  if (at(0) >= y) return 0;
  if (at(end) <= y) return end;
  let lo = 0;
  let hi = end;
  for (let i = 0; i < WALL_STEPS; i++) {
    const m = (lo + hi) / 2;
    if (at(m) < y) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

/** The share of a station's bottom anchors may use; the rest is left for the rail. */
const ANCHOR_REACH = 0.95;

/** How far inside a hard rail's edge (cm) the channel anchors reach at most. */
const RAIL_EDGE_GAP = 0.05;

/** How much of the bottom, at most, just inside its reach takes the anchors that run past it (cm): narrow, so a wall that fits close to the rail keeps its place. */
const SQUEEZE_BAND = 0.25;

/**
 * Where an anchor `y` out from the stringer goes on a bottom `reach` wide, the widest
 * anchor being `widest`. Strictly increasing in `y` and continuous in all three, so the
 * anchors keep their order, never meet, and move smoothly along the board.
 *
 * - Where they all fit, nothing moves.
 * - Where some run past the reach (a channel designed off the bottom near the tail), the
 *   anchors inside the last {@link SQUEEZE_BAND} before it, and those past it, are
 *   squeezed smoothly into that band; every wall short of it stays exactly where it is.
 * - Where they run far past it (toward a pointed tail, where walls are held past the
 *   channel's end), squeezing would crowd them to nothing, so they are scaled in
 *   together instead, blending over from the squeeze as `widest` passes twice the reach.
 */
const ontoBottom = (y: number, reach: number, widest: number): number => {
  if (!(reach > 0)) return 0;
  const band = Math.min(SQUEEZE_BAND, reach / 4);
  const knee = reach - band;
  const squeezed = y <= knee ? y : knee + band * (1 - Math.exp(-(y - knee) / band));
  const w = Math.min(1, Math.max(0, widest / reach - 2));
  if (w === 0) return squeezed;
  const scaled = widest > reach ? (y * reach) / widest : y;
  return (1 - w) * squeezed + w * scaled;
};

/**
 * The channel anchors at station `x` as fractions of its profile, never decreasing.
 *
 * Where they don't fit on this station's bottom (a channel designed off the bottom
 * near the tail; toward a pointed tail, where the walls are held past the channel's
 * end; in a swallow's notch, where the bottom starts off the stringer), they are moved
 * onto it: shifted out to where the bottom starts, and those past {@link ANCHOR_REACH}
 * of it brought inside ({@link ontoBottom}). Clamping them instead would pile them onto
 * one point, which a mesh welds into edges shared by four faces. Every wall that fits
 * keeps its exact place, so only a channel that runs off the bottom (a design problem,
 * `channelProblems`) loses its edge, and its neighbours don't.
 */
const anchorFractions = (
  b: BezierBoard,
  s: LoftedSection,
  x: number,
  end: number,
  map: LateralMap,
): number[] => {
  const ys = channelAnchors(boardChannels(b), x);
  const start = map(loftPoint(s, 0).x);
  // Most of the way to the rail's widest point; on a hard rail, right up to its edge,
  // where the bottom really ends, so a wall that fits there keeps its place.
  const reach = Math.max(
    (map(loftPoint(s, end).x) - start) * ANCHOR_REACH,
    map(loftPoint(s, railStart(s, end)).x) - start - RAIL_EDGE_GAP,
  );
  const widest = ys.length ? ys[ys.length - 1]! : 0;
  const out = ys.map((y) => bottomFractionAt(s, start + ontoBottom(y, reach, widest), end, map));
  for (let i = 1; i < out.length; i++) out[i] = Math.max(out[i]!, out[i - 1]!);
  return out;
};

/**
 * A board's ring with channels: the ladder and the anchors in one fixed order, each
 * entry placed between two of the knots `0, anchor 1, …, anchor k, 1` (interval `k`,
 * share `t` along it). A station moves the anchors; every other point keeps its share
 * of the interval it is in, so every ring has the same points in the same order, and
 * anchor j is point `index[j]` everywhere: a wall is one unbroken edge of the mesh.
 */
interface RingPlan {
  readonly k: readonly number[];
  readonly t: readonly number[];
  /** The last anchor at the reference station, or null without anchors. */
  readonly lastRef: number | null;
  /** Where the rail starts at the reference station ({@link railStart}). */
  readonly railRef: number;
}

/** The least span (profile fraction) past the last anchor over which the rail's points are eased back to their own places. */
const RAIL_EASE = 0.1;

/**
 * Where a ring point past the last anchor goes: `fRef` is its own place on the board's
 * ladder (where it is at the reference station, and on a board without channels), `a`
 * the last anchor here and `aRef` there.
 *
 * Stretching the whole span from the last anchor to the deck centreline with it (as
 * every other span is) slid the rail's points, which the ladder packs where the rail
 * curves tightest, off that curve wherever the anchor sits elsewhere than at the
 * reference: near a tail that faceted the rail by up to 0.4 mm (owner report, 2026-11).
 * So only the points near the anchor move with it, easing back to their own places by
 * `D` past it, and the rail and deck are sampled exactly as without channels. Strictly
 * increasing in `fRef` and continuous in `a`; where the anchor has moved too far for
 * that (a pointed tail), it blends over to the plain stretch.
 *
 * All of it in the ladder's measure (`lm`), not in profile fraction. A wall swept far
 * across the bottom (from near the rail at the tail to near the stringer up the board)
 * moves the anchor a long way, and eased by fraction the points it pushed toward the
 * rail came out evenly spaced, thinned over a hard rail edge the ladder had packed:
 * each slid over the edge at a different station, which the mesh showed as a serrated
 * rail (owner report: rail scalloping, 2026-11). Moved by counts of points instead,
 * they keep the ladder's packing wherever they go.
 */
const pastLastAnchor = (
  fRef: number,
  a: number,
  aRef: number,
  lm: LadderMeasure = IDENTITY_MEASURE,
  e?: number,
  eRef?: number,
): number => {
  // In the ladder's measure (see LadderMeasure): points move by counts of points, not
  // by distance, so wherever the ladder packed them (a hard rail edge) they stay
  // packed, however far the anchor has moved.
  const mRef = lm.m(fRef);
  const mA = lm.m(a);
  const mARef = lm.m(aRef);
  // With the rail's start known on both stations, it is a fixed boundary: the bottom's
  // points stay on the bottom, between the last wall and the rail, and the rail's on
  // the rail, tracking where it starts and easing back to their own places up it. A
  // point never crosses a hard edge, however fast the wall moves (owner report: rail
  // cuts wrapping onto the deck, 2026-11).
  if (e !== undefined && eRef !== undefined && e > a && eRef > aRef) {
    const mE = lm.m(e);
    const mERef = lm.m(eRef);
    if (mRef <= mERef) {
      return lm.f(mA + ((mRef - mARef) * (mE - mA)) / (mERef - mARef || 1));
    }
    const delta = mE - mERef;
    const rest = 1 - mERef;
    if (!(rest > 0)) return lm.f(mRef);
    const span = Math.min(rest, Math.max(RAIL_EASE, 2 * Math.abs(delta)));
    if (1.5 * Math.abs(delta) >= span) {
      return lm.f(mE + ((mRef - mERef) * (1 - mE)) / rest);
    }
    const v = Math.min(1, (mRef - mERef) / span);
    return lm.f(mRef + delta * (1 - v * v * (3 - 2 * v)));
  }
  const shift = mA - mARef;
  const span = 1 - mARef;
  const stretched = mA + ((mRef - mARef) * (1 - mA)) / (span || 1);
  if (!(span > 0)) return lm.f(stretched);
  const D = Math.min(span, Math.max(RAIL_EASE, 2 * Math.abs(shift)));
  const u = Math.min(1, Math.max(0, (mRef - mARef) / D));
  const eased = mRef + shift * (1 - u * u * (3 - 2 * u));
  // Its slope is at least 1 - 1.5 |shift| / D: blend to the stretch before that nears 0.
  const steep = (1.5 * Math.abs(shift)) / D;
  const lambda = Math.min(1, Math.max(0, (steep - 0.5) / 0.5));
  return lm.f((1 - lambda) * eased + lambda * stretched);
};

const PLAN_CACHE = new WeakMap<BezierBoard, Map<number, RingPlan | null>>();

/** Where the plan takes its reference anchors: the middle of the first channel. */
const referenceX = (b: BezierBoard): number => {
  const [a, c] = splineSpan(boardChannels(b)[0]!.depth);
  return Math.min(getLength(b), Math.max(0, (a + c) / 2));
};

const buildPlan = (
  b: BezierBoard,
  half: number,
  mapAt: (x: number) => LateralMap,
): RingPlan | null => {
  const x = referenceX(b);
  const s = loftSection(b, x);
  if (!s) return null;
  const refEnd = bottomEnd(s);
  const ref = anchorFractions(b, s, x, refEnd, mapAt(x));
  const knots = [0, ...ref, 1];
  const entries: { f: number; k: number; t: number }[] = [];
  for (const f of ringFractions(b, half)) {
    if (f <= 0) entries.push({ f, k: 0, t: 0 });
    else if (f >= 1) entries.push({ f, k: knots.length - 2, t: 1 });
    else {
      let k = 0;
      while (k + 2 < knots.length && knots[k + 1]! <= f) k++;
      const lo = knots[k]!;
      const hi = knots[k + 1]!;
      entries.push({ f, k, t: hi > lo ? (f - lo) / (hi - lo) : 0 });
    }
  }
  ref.forEach((f, j) => entries.push({ f, k: j + 1, t: 0 }));
  // Stable: a ladder point and an anchor at the same place keep this order everywhere.
  entries.sort((p, q) => p.f - q.f || p.k - q.k || p.t - q.t);
  return {
    k: entries.map((e) => e.k),
    t: entries.map((e) => e.t),
    lastRef: ref.length ? ref[ref.length - 1]! : null,
    railRef: railStart(s, refEnd),
  };
};

/** A station's ring: fractions along its profile, and where its bottom ends. */
export interface StationRing {
  readonly fs: readonly number[];
  /** Points before this fraction are on the bottom; channels lift them. */
  readonly bottomEnd: number;
  /**
   * Where the bottom turns into the rail ({@link railStart}): a channel that runs out
   * through the rail cuts it off at its floor from here.
   */
  readonly railFrom: number;
  /**
   * Where the profile past `railFrom` first rises back above the channel's floor: the
   * points between are cut away, and spread along the floor ({@link channelCutAt}).
   * Equal to `railFrom` where no channel reaches the rail.
   */
  readonly cutTo: number;
}

/**
 * The ring fractions for station `x` of a board: {@link ringFractions} on a board
 * without channels (the same array, so such a board's mesh is unchanged to the bit),
 * and with channels the same ladder bent so a point lands exactly on every wall
 * ({@link RingPlan}). `mapAt(x)` turns a profile's distance from the centreline into
 * distance from the stringer, where a swallow tail's notch moves the profile out.
 */
export const stationRing = (
  b: BezierBoard,
  s: LoftedSection,
  x: number,
  half: number,
  mapAt: (x: number) => LateralMap = () => IDENTITY,
): StationRing => {
  if (boardChannels(b).length === 0) return { fs: ringFractions(b, half), bottomEnd: 0, railFrom: 0, cutTo: 0 }; // prettier-ignore
  let plans = PLAN_CACHE.get(b);
  if (!plans) {
    plans = new Map();
    PLAN_CACHE.set(b, plans);
  }
  if (!plans.has(half)) plans.set(half, buildPlan(b, half, mapAt));
  const plan = plans.get(half);
  const end = bottomEnd(s);
  const railFrom = railStart(s, end);
  const cutTo = railCutEnd(b, s, x, railFrom, mapAt(x));
  if (!plan) return { fs: ringFractions(b, half), bottomEnd: end, railFrom, cutTo };
  const knots = [0, ...anchorFractions(b, s, x, end, mapAt(x)), 1];
  const last = knots.length - 2;
  const { lastRef } = plan;
  const fs = plan.k.map((k, i) => {
    const lo = knots[k]!;
    const t = plan.t[i]!;
    if (k === last && lastRef !== null && t > 0 && t < 1) {
      const fRef = lastRef + (1 - lastRef) * t;
      return pastLastAnchor(fRef, lo, lastRef, ladderMeasure(b), railFrom, plan.railRef);
    }
    return lo + (knots[k + 1]! - lo) * t;
  });
  return { fs, bottomEnd: end, railFrom, cutTo };
};

/** The channel floor's height at profile point `f` of `s`, cut from where the rail starts. */
const floorAt = (
  b: BezierBoard,
  s: LoftedSection,
  x: number,
  railFrom: number,
  px: number,
  map: LateralMap,
) =>
  // prettier-ignore
  loftPoint(s, railFrom).y + channelDepthAt(boardChannels(b), x, map(px));

/**
 * Where the profile past `railFrom` first rises back above the channel's floor: on the
 * rail's lower side, or, where the floor is above its widest point, on its upper side.
 * Sampled, then found by bisection, so it moves smoothly along the board.
 */
const railCutEnd = (
  b: BezierBoard,
  s: LoftedSection,
  x: number,
  railFrom: number,
  map: LateralMap,
): number => {
  // prettier-ignore
  const above = (f: number) => {
    const p = loftPoint(s, f);
    return p.y >= floorAt(b, s, x, railFrom, p.x, map);
  };
  if (above(railFrom)) return railFrom;
  let lo = railFrom;
  let hi = 1;
  const n = RAIL_START_SAMPLES;
  for (let i = 1; i <= n; i++) {
    const f = railFrom + ((1 - railFrom) * i) / n;
    if (above(f)) {
      hi = f;
      break;
    }
    lo = f;
  }
  for (let i = 0; i < RAIL_START_STEPS; i++) {
    const m = (lo + hi) / 2;
    if (above(m)) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
};

/** Samples, then bisection steps, finding where the bottom turns into the rail. */
const RAIL_START_SAMPLES = 64;
const RAIL_START_STEPS = 40;

/**
 * Where a station's bottom turns into its rail, as a fraction of its profile: the first
 * point out from the stringer where the profile is steeper than 45°, or `end` (the
 * rail's widest point) if it never is. On a hard rail that is the edge itself. Found
 * by bisection, so it moves smoothly along the board.
 */
export const railStart = (s: LoftedSection, end: number): number => {
  const h = 1e-5;
  const steep = (f: number) => {
    const a = loftPoint(s, Math.max(0, f - h));
    const c = loftPoint(s, Math.min(end, f + h));
    return Math.abs(c.y - a.y) > Math.abs(c.x - a.x);
  };
  let lo = 0;
  let hi = -1;
  for (let i = 1; i <= RAIL_START_SAMPLES; i++) {
    const f = (end * i) / RAIL_START_SAMPLES;
    if (steep(f)) {
      hi = f;
      break;
    }
    lo = f;
  }
  if (hi < 0) return end;
  for (let i = 0; i < RAIL_START_STEPS; i++) {
    const m = (lo + hi) / 2;
    if (steep(m)) hi = m;
    else lo = m;
  }
  return (lo + hi) / 2;
};

/**
 * The hull's surface point at fraction `f` of station `x`, with the board's channels
 * cut: as (x = distance from the centreline, y = height above the rocker) in the frame
 * of section `s`, like {@link loftPoint}. `map` turns the profile's x into distance
 * from the stringer.
 *
 * The channels take away everything below their cut. On the bottom, up to where it
 * turns into the rail (`ring.railFrom`), a point is lifted by the channel's depth
 * there. Where a channel runs out through the rail, the rail is cut off at the
 * channel's floor: the points up to where the profile rises back above it
 * (`ring.cutTo`, on the rail's lower side or past its widest point) are cut away, and
 * spread evenly along the floor from where the rail started to there, in order, so the
 * surface neither folds nor stacks points on top of each other. (Lifting the rail's
 * points by the depth folded the cut rail up over the uncut part: ragged flaps in a
 * print, owner report 2026-11.) Past that, and wherever no channel is, unchanged.
 */
export const channelCutAt = (
  b: BezierBoard,
  ring: StationRing,
  s: LoftedSection,
  f: number,
  x: number,
  map: LateralMap = IDENTITY,
): Vec2 => {
  const p = loftPoint(s, f);
  if (f < ring.railFrom) {
    const d = channelDepthAt(boardChannels(b), x, map(p.x));
    return d > 0 ? vec2(p.x, p.y + d) : p;
  }
  if (!(f < ring.cutTo)) return p;
  const a = loftPoint(s, ring.railFrom);
  const z = loftPoint(s, ring.cutTo);
  const t = (f - ring.railFrom) / (ring.cutTo - ring.railFrom);
  const px = a.x + (z.x - a.x) * t;
  return vec2(px, floorAt(b, s, x, ring.railFrom, px, map));
};

/** Signed polygon area of a half-section curve (bottom centreline → rail → deck centreline). */
const halfSectionArea = (pts: readonly Vec2[]): number => {
  let sum = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    sum += a.x * b.y - b.x * a.y;
  }
  return sum / 2;
};

/**
 * Cross-sectional area removed by the board's bottom channels at station `x` (cm², both
 * sides of the stringer). Computed from the same {@link stationRing} + {@link channelCutAt}
 * surface that builds the 3D mesh, STL, DXF and 1:1 PDF, so volume, center of mass and
 * specs describe the same solid as the exports. Zero where no channel has depth.
 */
export const channelCutAreaAt = (b: BezierBoard, x: number): number => {
  if (!b.channels) return 0;
  const channels = boardChannels(b);
  if (!channels.length || !channels.some((c) => channelFullDepth(c, x) > 0)) return 0;
  const s = loftSection(b, x);
  if (!s) return 0;
  const cutout = hasTailCutout(b.outline);
  const mapAt = cutout
    ? (pxX: number): LateralMap => {
        const { yIn, yOut } = widthBoundsAt(b, pxX);
        const scale = yOut > 1e-6 ? (yOut - yIn) / yOut : 1;
        return (px) => yIn + px * scale;
      }
    : () => IDENTITY;
  const plan = stationRing(b, s, x, 24, mapAt);
  const map = mapAt(x);
  const uncut: Vec2[] = [];
  const cut: Vec2[] = [];
  for (const f of plan.fs) {
    uncut.push(loftPoint(s, f));
    cut.push(channelCutAt(b, plan, s, f, x, map));
  }
  const delta = halfSectionArea(uncut) - halfSectionArea(cut);
  if (!(delta > 0)) return 0;
  if (!cutout) return delta * 2;
  const { yIn, yOut } = widthBoundsAt(b, x);
  const factor = yOut > 1e-6 ? Math.max(0, (yOut - yIn) / yOut) : 1;
  return delta * 2 * factor;
};

/**
 * A full closed cross-section ring at station `x`, as `2 * ringHalf - 2` points (more
 * with channels: see {@link stationRing}).
 *
 * Walks the +Y rail from the bottom centreline up to the deck centreline, then
 * mirrors the sweep back down the -Y rail, skipping the two shared centreline
 * points so they appear exactly once. The ring is symmetric about y = 0 by
 * construction. Returns null if the section is missing or degenerate.
 */
export const loftRing = (b: BezierBoard, x: number, ringSteps: number): Vert3[] | null => {
  const section = loftSection(b, x);
  if (!section) return null;

  const half = ringHalf(ringSteps);
  const plan = stationRing(b, section, x, half);
  const fs = plan.fs;
  const cut = boardChannels(b).length > 0;
  const ring: Vert3[] = [];

  const push = (f: number, mirror: boolean): boolean => {
    const p = cut ? channelCutAt(b, plan, section, f, x) : loftPoint(section, f);
    const vy = mirror ? -p.x : p.x;
    const vz = p.y + section.rocker;
    if (!isFinite3(x, vy, vz)) return false;
    ring.push({ x, y: vy, z: vz });
    return true;
  };

  const n = fs.length;
  for (let i = 0; i < n; i++) if (!push(fs[i]!, false)) return null;
  for (let i = n - 2; i >= 1; i--) if (!push(fs[i]!, true)) return null;

  if (ring.length < 3) return null;
  return ring;
};

/** Samples across a station's bottom when drawing its channel cut. */
const CUT_SAMPLES = 160;

/** A station's channel cut, for drawing on its cross-section (one side, +y). */
export interface ChannelCut {
  /** The cut bottom from the stringer to the rail, as (out from the centreline, height above the bottom). */
  readonly curve: readonly Vec2[];
  /** The points the mesh puts on the channels: on the walls, round corners and over the floors. */
  readonly points: readonly Vec2[];
}

/**
 * The board's channels cut into the station at `x`: the cut bottom and the points on
 * it, in the frame of its cross-section (as `loftPoint`). Null where there are no
 * channels with depth at `x`.
 */
export const channelCut = (b: BezierBoard, x: number): ChannelCut | null => {
  const channels = boardChannels(b);
  if (!channels.length || !channels.some((c) => channelFullDepth(c, x) > 0)) return null;
  const s = loftSection(b, x);
  if (!s) return null;
  const end = bottomEnd(s);
  const lifted = (f: number): Vec2 => {
    const p = loftPoint(s, f);
    return vec2(p.x, p.y + channelDepthAt(channels, x, p.x));
  };
  const anchors = anchorFractions(b, s, x, end, IDENTITY);
  const fs = [...anchors];
  for (let i = 0; i <= CUT_SAMPLES; i++) fs.push((end * i) / CUT_SAMPLES);
  fs.sort((p, q) => p - q);
  // The two points either side of a vertical wall are at the same fraction to within a
  // micron: keep both, in order of depth, so the wall draws as a wall.
  const curve = fs.map(lifted);
  return { curve, points: anchors.map(lifted) };
};

/** A point on an applied channel at a station, to drag in the cross-section view. */
export interface ChannelKey {
  /** Stable within a station: `o1`, `i0`, `d2`. */
  readonly id: string;
  /** Which channel (index into `boardChannels`). */
  readonly k: number;
  readonly part: ChannelKeyPart;
  /** The next channel, whose inner wall is this outer one: it moves too. */
  readonly joined?: number;
  /** The wall's distance from the stringer, or the depth (cm). */
  readonly value: number;
  /** Where it is drawn, in the cross-section's frame (as `loftPoint`). */
  readonly p: Vec2;
}

/** How far in from a step's wall its depth key sits, past the lip (cm). */
const DEPTH_KEY_INSET = 0.05;

/**
 * The points of drawn channels at station `x`, one on each wall where it meets the
 * bottom and one where each channel is deepest, for dragging in the cross-section view.
 * Empty for typed-in channels (apply them first) and where no channel runs.
 */
export const channelKeys = (b: BezierBoard, x: number): ChannelKey[] => {
  if (b.channels?.from !== 'drawn') return [];
  const channels = boardChannels(b);
  const s = loftSection(b, x);
  if (!s) return [];
  const end = bottomEnd(s);
  const bottomAt = (y: number) => loftPoint(s, bottomFractionAt(s, y, end, IDENTITY)).y;
  const out: ChannelKey[] = [];
  const wallAt = (w: Spline) => Math.max(0, valueAt(w, x));
  channels.forEach((c, k) => {
    const [a, z] = splineSpan(c.outer);
    if (!(x > a && x < z)) return;
    const yo = wallAt(c.outer);
    const yi = c.inner ? Math.min(yo, wallAt(c.inner)) : null;
    const prev = channels[k - 1];
    const sharedWithPrev =
      yi !== null && prev && Math.abs(wallAt(prev.outer) - yi) < 1e-6 && x > splineSpan(prev.outer)[0] && x < splineSpan(prev.outer)[1]; // prettier-ignore
    if (yi !== null && !sharedWithPrev) {
      out.push({ id: `i${k}`, k, part: 'inner', value: yi, p: vec2(yi, bottomAt(yi)) });
    }
    const next = channels[k + 1];
    const joined = next?.inner && Math.abs(wallAt(next.inner) - yo) < 1e-6 ? k + 1 : undefined;
    out.push({
      id: `o${k}`,
      k,
      part: 'outer',
      ...(joined !== undefined ? { joined } : {}),
      value: yo,
      p: vec2(yo, bottomAt(yo)),
    });
    const lo = yi ?? 0;
    const yd =
      c.wall.shape === 'step'
        ? Math.max(lo, yo - c.wall.lip - DEPTH_KEY_INSET)
        : yi === null
          ? 0
          : (lo + yo) / 2;
    out.push({
      id: `d${k}`,
      k,
      part: 'depth',
      value: channelFullDepth(c, x),
      p: vec2(yd, bottomAt(yd) + channelDepthAt(channels, x, yd)),
    });
  });
  return out;
};

// --- the same surface, as a curve ----------------------------------------------

/**
 * Knots used to rebuild a lofted profile as a curve. See {@link loftCrossSection}.
 *
 * Measured against the exact blend (arc-length sampling with no table, every station
 * of the golden boards carrying a different rail preset), worst deviation of the
 * rebuilt curve:
 *
 *   knots   shortboard   longboard
 *   48        60.4 um      82.4 um
 *   64        59.0 um      75.6 um
 *   96        58.7 um      75.2 um
 *   128       58.7 um      74.9 um
 *
 * against 59.3 / 68.0 um for the loft's own polyline — so past 64 the residual is
 * the sampled surface itself, not the rebuild, and the rebuild adds under 10 um to
 * it. 96 sits comfortably inside that floor and is still cheap: this runs a few
 * dozen times per export, not per frame.
 */
export const LOFT_SECTION_KNOTS = 96;

/** Points closer than this (cm) are the same point, and one knot is enough for both. */
const COINCIDENT = 1e-7;

/**
 * Float dust on a profile endpoint's distance from the centreline (cm), which is
 * snapped away. Anything larger is a profile that genuinely does not start there.
 *
 * Both profile ends sit on x = 0 by construction — it is the anchor that makes the
 * fractional-arc-length correspondence work at all (see "Why correspondence works out"
 * above). But an endpoint is reached here by evaluating a cubic at its own end, and that
 * sum does not land on exactly zero: 3.6e-15 measured on `curvyBoard`. That is enough to
 * put x = 0 *outside* the rebuilt spline's range, where `valueAtReverse` reports 0 rather
 * than the deck height — `deckZAt` at the stringer came back as the bare rocker.
 */
const CENTRELINE_DUST = 1e-9;

/**
 * Most recent sections per board, so a caller asking about one station twice pays once.
 *
 * `deckZAt` and `bottomZAt` (`surface.ts`) are the reason: they take a plan point and
 * answer for one surface each, so every sample of a rail band asks for the same station
 * twice in a row, and the adaptive sampler behind it asks thousands of times per export.
 * Rebuilding is not cheap — two arc-length tables and a 96-knot spline.
 *
 * Keyed on the board object, which is immutable, so a stale entry cannot be observed;
 * the same argument {@link ringFractions} already makes. Bounded and insertion-ordered:
 * a few entries cover the back-to-back pattern, and an adaptive sampler walking new
 * stations forever must not be able to grow this without limit.
 */
const SECTION_CACHE = new WeakMap<BezierBoard, Map<string, CrossSection | null>>();
const SECTION_CACHE_MAX = 8;

/**
 * The lofted surface at station `x` as a **cross-section curve**, for the callers that
 * need tangents rather than points.
 *
 * `getInterpolatedCrossSection` (board.ts) answers the same question by blending the
 * two stations' CONTROL POINTS, and carries the defect this module exists to avoid:
 * index pairing lerps mismatched tangent handles, which can put a near-cusp in the
 * blended curve that neither station has. Sampling cannot remove it, because the curve
 * itself is malformed. Anything reading SLOPE off a section — the rail-band tangent fit
 * above all, which picks a facet by where the section's own slope reaches an angle —
 * reads that invented curvature as real shape. Measured on a longboard carrying a
 * different rail preset at each station, the blended section stood 4.96 mm off the
 * surface the mesh and the STL show, and the fitted first band came out 17 deg, 65.5
 * deg, 41.5 deg at three consecutive stations of a rail that is 21 deg all the way
 * along.
 *
 * So the curve is rebuilt from the surface rather than blended into existence: sample
 * {@link loftPoint} on the {@link ringFractions} ladder and interpolate those points
 * with a C1 cubic Hermite spline (handles one third of the neighbouring chord, tangent
 * directions by central difference — exact on a circular arc, which is what a rail zone
 * nearly is). Because the ladder is the mesh's own, the knots land exactly where the
 * rendered ring points land: the printed section and the rendered surface are the same
 * curve by construction rather than by coincidence.
 *
 * Returns null wherever {@link loftSection} does.
 */
export const loftCrossSection = (
  b: BezierBoard,
  x: number,
  knotCount = LOFT_SECTION_KNOTS,
): CrossSection | null => {
  let cache = SECTION_CACHE.get(b);
  if (!cache) {
    cache = new Map();
    SECTION_CACHE.set(b, cache);
  }
  const key = `${x}:${knotCount}`;
  if (cache.has(key)) return cache.get(key)!;

  const built = buildLoftCrossSection(b, x, knotCount);
  if (cache.size >= SECTION_CACHE_MAX) {
    const oldest = cache.keys().next();
    if (!oldest.done) cache.delete(oldest.value);
  }
  cache.set(key, built);
  return built;
};

const buildLoftCrossSection = (
  b: BezierBoard,
  x: number,
  knotCount: number,
): CrossSection | null => {
  const section = loftSection(b, x);
  if (!section) return null;

  // Drop repeats before anything else: a profile that collapses toward a tip can put
  // two ladder stops on one point, and a zero-length segment has no tangent for
  // `normalByTT` to find.
  const pts: Vec2[] = [];
  for (const f of ringFractions(b, Math.max(4, Math.floor(knotCount)))) {
    const p = loftPoint(section, f);
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y)) return null;
    const last = pts[pts.length - 1];
    if (last && Math.hypot(p.x - last.x, p.y - last.y) < COINCIDENT) continue;
    pts.push(p);
  }
  if (pts.length < 3) return null;

  // Put the two ends back on the centreline they came off. See CENTRELINE_DUST.
  const snap = (i: number): void => {
    const p = pts[i]!;
    if (p.x !== 0 && Math.abs(p.x) < CENTRELINE_DUST) pts[i] = vec2(0, p.y);
  };
  snap(0);
  snap(pts.length - 1);

  const n = pts.length;
  const knots = pts.map((p, i) => {
    // Central difference; one-sided at the two ends, where there is no other choice.
    const a = pts[Math.max(0, i - 1)]!;
    const c = pts[Math.min(n - 1, i + 1)]!;
    const len = Math.hypot(c.x - a.x, c.y - a.y);
    const ux = len > 0 ? (c.x - a.x) / len : 1;
    const uy = len > 0 ? (c.y - a.y) / len : 0;
    const back = i > 0 ? Math.hypot(p.x - pts[i - 1]!.x, p.y - pts[i - 1]!.y) / 3 : 0;
    const fwd = i < n - 1 ? Math.hypot(pts[i + 1]!.x - p.x, pts[i + 1]!.y - p.y) / 3 : 0;
    return knot(
      p,
      vec2(p.x - ux * back, p.y - uy * back),
      vec2(p.x + ux * fwd, p.y + uy * fwd),
      true,
      false,
    );
  });

  return crossSection(x, splineFromKnots(knots));
};
