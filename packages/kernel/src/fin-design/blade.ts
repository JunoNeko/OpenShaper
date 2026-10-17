// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The 3D blade of a {@link FinDesign}, as horizontal sections: step 4 of
 * docs/design/fin-designer.md. Meshing (step 7) and STEP (step 5) both loft these.
 *
 * At height h above the tab top, a section is built from:
 * - **chord:** where the line y = h crosses the outline (leading and trailing edge);
 * - **shape:** the section faces, stretched along a chord (see "Smoothed edges");
 * - **thickness:** the taper at h / depth. The section is scaled so its thickest point
 *   is exactly that thick. The outline sets the chord, the taper the thickness;
 *   neither scales the other.
 *
 * Then two adjustments:
 * - **Minimum thickness:** nowhere thinner than {@link FIN_MIN_THICKNESS}. The foil is
 *   scaled to the taper's thickness less the minimum, then the minimum is added all the
 *   way along: symmetric foils half to each face, so they stay symmetric; any other foil
 *   to the outside, so a flat inside face stays flat. The faces stay as convex as the
 *   foil right to the edges, which end exactly at the minimum, with no parallel-sided
 *   run (round 2 testing: padding only where the foil was thin left flat ends).
 * - **Cant:** the blade leans out by sliding each section sideways, h·tan(cant). The
 *   sections stay horizontal, so the root sits exactly on the flat tab top (see "Cant
 *   as a lean of horizontal sections" in the design doc). A horizontal slice of a
 *   leaning blade is wider than the blade is thick, so lateral offsets are divided by
 *   cos(cant); the thickness measured square to the blade is then the taper value.
 *
 * **Smoothed edges.** Stretching the foil from the leading to the trailing edge of
 * each slice ties every point of it to both edges: wherever an edge bends sharply
 * (a hooked tip, the underside of a raised rear), the whole slice shifts at once and the
 * blade creases right across. So the foil is laid over smoothed copies of the edges
 * instead ({@link foilEdges}): never inside the blade, smoothed over about
 * {@link FIN_EDGE_SMOOTHING} of the chord, and equal to the real edge wherever that is
 * straight or bends gently. Over the last {@link FIN_EDGE_PIN} of the chord at each edge
 * the foil is drawn back to the real edge, so edges still end at the minimum; a sharp
 * bend only reshapes the blade near that edge. The exception is a raised rear's
 * underside ({@link RaisedRear}): there the foil is cut off at the underside instead,
 * so it has the foil's real thickness rather than being a 0.5 mm flap (round 1).
 *
 * Frame (cm): the fin stands on its tab, as on a board turned deck-down.
 * - X runs along the tab toward its front (the nose), as in the outline.
 * - Z is height above the tab top.
 * - Y completes a right-handed frame. With the board deck-down and the nose toward +X,
 *   the rider's right rail is on +Y. Seen from below with the nose up (the way fin
 *   makers name fins, {@link FinHand}), +Y is on the left.
 * A left fin's outside face and cant point to +Y; a right fin is its exact mirror
 * ({@link finOutward}). A centre fin's outside is +Y too; it is symmetric with no cant,
 * so the choice is moot.
 */
import type { Spline } from '../bezier-spline';
import { value, xDeriv, yDeriv } from '../bezier-curve';
import { DEG_TO_RAD } from '../constants';
import type { Vert3 } from '../loft';
import { crossings, splineExtremes, yAtX } from './curve-shape';
import { FIN_MIN_THICKNESS, finOutward, type FinDesign, type FinSection } from './fin-design';

/** Chord stations from leading edge (0) to trailing edge (1), clustered at both edges. */
export const cosineStations = (n: number): number[] =>
  Array.from({ length: n + 1 }, (_, j) => (1 - Math.cos((Math.PI * j) / n)) / 2);

export const DEFAULT_CHORD_STATIONS: readonly number[] = cosineStations(48);

/** Everything about a design that doesn't depend on the height, worked out once. */
export interface PreparedBlade {
  readonly design: FinDesign;
  /** Height of the tip above the tab top (cm). */
  readonly depth: number;
  /** Chord fraction where the section shape is thickest. */
  readonly thickestAt: number;
  /** The shape's thickness there, in chords. */
  readonly shapeThickness: number;
  /** +1 if the outside face points to +Y, −1 for a right fin. */
  readonly outward: 1 | -1;
  /** Lateral slide per cm of height (tan cant). */
  readonly lean: number;
  /** Horizontal-slice widening, 1 / cos(cant). */
  readonly widen: number;
  /** The raised rear, if the outline has one. */
  readonly raisedRear: RaisedRear | null;
}

/**
 * The underside of a raised rear: the end of the outline, walking back from the
 * trailing-edge root, while it runs backward and rises at under 45°. Steeper than that
 * it is the trailing edge. Where it ends (`corner`) the trailing edge proper starts.
 * Below the corner the trailing edge keeps the foil's thickness (see
 * {@link bladeSection}); everywhere else it is the minimum.
 */
export interface RaisedRear {
  readonly cornerX: number;
  readonly cornerZ: number;
}

/** Samples per segment when walking the underside. */
const REAR_SAMPLES = 64;

const isUnderside = (dx: number, dz: number): boolean => dx < 0 && dz >= 0 && dz < -dx;

/** The raised rear of an outline (see {@link RaisedRear}), or null if it has none. */
export const findRaisedRear = (outline: Spline): RaisedRear | null => {
  const k = outline.coeffs;
  const top = splineExtremes(outline, 'y').max;
  // Walking back along the outline from its end, the direction is minus the derivative.
  // Kept just inside the segment: a handle pulled onto its end point has no direction there.
  const dir = (seg: number, t: number) => {
    const tt = Math.min(1 - 1e-6, Math.max(1e-6, t));
    return { x: -xDeriv(k[seg]!, tt), z: -yDeriv(k[seg]!, tt) };
  };
  let lastGood: { seg: number; t: number } | null = null;
  for (let seg = k.length - 1; seg >= 0; seg--) {
    for (let j = REAR_SAMPLES; j >= 0; j--) {
      const t = j / REAR_SAMPLES;
      if (seg < top.segment || (seg === top.segment && t <= top.t)) return null; // to the tip
      const d = dir(seg, t);
      if (isUnderside(d.x, d.z)) {
        lastGood = { seg, t };
        continue;
      }
      if (!lastGood) return null; // steep from the root: no raised rear
      // The corner is between the last sample that was underside and this one.
      let lo = lastGood.seg === seg ? lastGood.t : 0; // underside side (higher t)
      let hi = t; // trailing-edge side
      if (lastGood.seg !== seg) {
        // The previous sample was the start of the segment after: the corner is the knot.
        const corner = value(k[seg]!, 1);
        if (corner.y <= 0) return null;
        return { cornerX: corner.x, cornerZ: corner.y };
      }
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const m = dir(seg, mid);
        if (isUnderside(m.x, m.z)) lo = mid;
        else hi = mid;
      }
      const corner = value(k[seg]!, hi);
      if (corner.y <= 0) return null;
      return { cornerX: corner.x, cornerZ: corner.y };
    }
  }
  return null;
};

/** One horizontal section of the blade, at shared chord stations. */
export interface BladeSection {
  /** Height above the tab top (cm). */
  readonly height: number;
  readonly leadingX: number;
  readonly trailingX: number;
  /** The taper's thickness at this height (cm), square to the blade. */
  readonly thickness: number;
  /** The chord stations (0 leading edge → 1 trailing edge) the faces were sampled at. */
  readonly stations: readonly number[];
  /** Points on the outside face, one per station. */
  readonly outside: readonly Vert3[];
  /** Points on the inside face, one per station. */
  readonly inside: readonly Vert3[];
}

/** Outside and inside offsets of the shape at chord fraction u, in chords. */
const shapeAt = (d: FinDesign, u: number): [number, number] => {
  const out = yAtX(d.section.outside, u);
  return [out, d.section.inside ? yAtX(d.section.inside, u) : -out];
};

const SEARCH_SAMPLES = 400;

/**
 * Where the shape is thickest: a coarse scan, then a golden-section refine. It depends
 * only on the section, and is the bulk of preparing a blade (a few ms), so it is cached
 * per section object: edits that leave the section alone (outline drags, nudges, cant)
 * reuse it. A WeakMap, so the cache never keeps a section alive.
 */
const thickestCache = new WeakMap<FinSection, { at: number; thickness: number }>();

const thickest = (d: FinDesign): { at: number; thickness: number } => {
  const hit = thickestCache.get(d.section);
  if (hit) return hit;
  const found = findThickest(d);
  thickestCache.set(d.section, found);
  return found;
};

const findThickest = (d: FinDesign): { at: number; thickness: number } => {
  const t = (u: number) => {
    const [o, i] = shapeAt(d, u);
    return o - i;
  };
  let best = 0;
  for (let j = 1; j < SEARCH_SAMPLES; j++) {
    if (t(j / SEARCH_SAMPLES) > t(best / SEARCH_SAMPLES)) best = j;
  }
  let lo = Math.max(0, (best - 1) / SEARCH_SAMPLES);
  let hi = Math.min(1, (best + 1) / SEARCH_SAMPLES);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80; k++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (t(a) < t(b)) lo = a;
    else hi = b;
  }
  const at = (lo + hi) / 2;
  return { at, thickness: t(at) };
};

/**
 * Work out the height-independent parts of the blade. The design must pass
 * `validateFinDesign`; the result is undefined otherwise.
 */
export const prepareBlade = (d: FinDesign): PreparedBlade => {
  const { at, thickness } = thickest(d);
  const cant = d.cant * DEG_TO_RAD;
  return {
    design: d,
    depth: splineExtremes(d.outline, 'y').max.point.y,
    thickestAt: at,
    shapeThickness: thickness,
    outward: finOutward(d.hand),
    lean: Math.tan(cant),
    widen: 1 / Math.cos(cant),
    raisedRear: findRaisedRear(d.outline),
  };
};

/** Leading- and trailing-edge x where the outline is `h` above the tab top. */
export const chordAt = (b: PreparedBlade, h: number): { leading: number; trailing: number } => {
  if (!(h >= 0 && h <= b.depth)) {
    throw new RangeError(`chordAt: height ${h} is outside 0–${b.depth}`);
  }
  // Single-peaked outline: the first crossing is on the leading edge, the last on the
  // trailing edge. At the tip they meet.
  const hits = crossings(b.design.outline, 'y', h);
  if (h === b.depth || hits.length === 0) {
    const tip = splineExtremes(b.design.outline, 'y').max.point.x;
    return { leading: tip, trailing: tip };
  }
  return { leading: hits[0]!.point.x, trailing: hits[hits.length - 1]!.point.x };
};

/** The taper's thickness (cm) at height `h`. */
export const thicknessAt = (b: PreparedBlade, h: number): number =>
  yAtX(b.design.taper, Math.min(1, Math.max(0, h / b.depth)));

/**
 * How widely each edge is smoothed, as a fraction of the chord at that height: 0.05 is
 * 5 mm on a 100 mm chord. Scaled by the chord, so near the tip, where the chord closes,
 * the smoothed edges hug the real ones.
 */
export const FIN_EDGE_SMOOTHING = 0.05;

/** The narrowest smoothing (cm), so it never shrinks below a few samples. */
const MIN_SMOOTHING = 0.02;

/** Heights the edges are sampled at for smoothing and row spacing. */
const EDGE_SAMPLES = 1200;

/**
 * Both edges sampled up the blade: the real ones (`leading`, `trailing`), the smoothed
 * ones the foil is laid over (`foilLeading`, `foilTrailing`), and `travel`, the running
 * total of height plus how far both edges have moved, which spaces sections evenly
 * along the edges rather than the height ({@link bladeRowHeights}).
 */
export interface FoilEdges {
  readonly heights: Float64Array;
  readonly leading: Float64Array;
  readonly trailing: Float64Array;
  readonly foilLeading: Float64Array;
  readonly foilTrailing: Float64Array;
  readonly travel: Float64Array;
}

const edgesCache = new WeakMap<PreparedBlade, FoilEdges>();

/**
 * One edge, smoothed: a local straight-line fit, Gaussian-weighted over `sigma[i]` either
 * side (exact for a straight edge, whatever its slope), then moved outward by however
 * far it cut inside the real edge nearby, so the foil never ends inside the blade.
 * `out` is +1 where outward is +x (the leading edge on a fin facing +x), −1 otherwise.
 */
const smoothEdge = (
  hs: Float64Array,
  xs: Float64Array,
  sigma: Float64Array,
  out: 1 | -1,
): Float64Array => {
  const n = hs.length;
  const window = (i: number): [number, number] => {
    const reach = 3 * sigma[i]!;
    let a = i;
    let b = i;
    while (a > 0 && hs[i]! - hs[a - 1]! <= reach) a--;
    while (b < n - 1 && hs[b + 1]! - hs[i]! <= reach) b++;
    return [a, b];
  };
  const weight = (i: number, j: number) => {
    const d = (hs[j]! - hs[i]!) / sigma[i]!;
    return Math.exp(-0.5 * d * d);
  };
  // The local line fit at each sample.
  const fit = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = window(i);
    let sw = 0;
    let sh = 0;
    let sx = 0;
    let shh = 0;
    let shx = 0;
    for (let j = a; j <= b; j++) {
      const w = weight(i, j);
      const dh = hs[j]! - hs[i]!;
      sw += w;
      sh += w * dh;
      sx += w * xs[j]!;
      shh += w * dh * dh;
      shx += w * dh * xs[j]!;
    }
    const det = sw * shh - sh * sh;
    fit[i] = det > 1e-18 ? (sx * shh - sh * shx) / det : xs[i]!;
  }
  // How far inside the real edge the fit is, spread over its neighbourhood (the most in
  // reach of each sample, then a weighted average of that), so the push back out is
  // smooth too and at least as large as the cut at every sample.
  const inside = Float64Array.from(fit, (f, i) => Math.max(0, out * (xs[i]! - f)));
  const reachMax = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = window(i);
    let m = 0;
    for (let j = a; j <= b; j++) m = Math.max(m, inside[j]!);
    reachMax[i] = m;
  }
  const smoothed = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const [a, b] = window(i);
    let sw = 0;
    let sm = 0;
    for (let j = a; j <= b; j++) {
      const w = weight(i, j);
      sw += w;
      sm += w * reachMax[j]!;
    }
    const x = fit[i]! + out * (sw > 0 ? sm / sw : 0);
    // Never inside the blade, even where the spread falls a hair short.
    smoothed[i] = out > 0 ? Math.max(x, xs[i]!) : Math.min(x, xs[i]!);
  }
  return smoothed;
};

/** Both edges up the blade, real and smoothed (see {@link FoilEdges}). Cached per blade. */
export const foilEdges = (b: PreparedBlade): FoilEdges => {
  const hit = edgesCache.get(b);
  if (hit) return hit;
  const n = EDGE_SAMPLES;
  const heights = new Float64Array(n + 1);
  const leading = new Float64Array(n + 1);
  const trailing = new Float64Array(n + 1);
  const sigma = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const h = (b.depth * i) / n;
    const c = chordAt(b, h);
    heights[i] = h;
    leading[i] = c.leading;
    trailing[i] = c.trailing;
    sigma[i] = Math.max(MIN_SMOOTHING, FIN_EDGE_SMOOTHING * Math.abs(c.leading - c.trailing));
  }
  // Forward is toward the leading edge: +x on every fin the designer makes, but
  // worked out rather than assumed.
  const fwd: 1 | -1 = leading[0]! >= trailing[0]! ? 1 : -1;
  const foilLeading = smoothEdge(heights, leading, sigma, fwd);
  const foilTrailing = smoothEdge(heights, trailing, sigma, fwd === 1 ? -1 : 1);
  const travel = new Float64Array(n + 1);
  for (let i = 1; i <= n; i++) {
    travel[i] =
      travel[i - 1]! +
      (heights[i]! - heights[i - 1]!) +
      Math.abs(leading[i]! - leading[i - 1]!) +
      Math.abs(trailing[i]! - trailing[i - 1]!);
  }
  const edges = { heights, leading, trailing, foilLeading, foilTrailing, travel };
  edgesCache.set(b, edges);
  return edges;
};

/** Linear interpolation in a column of {@link FoilEdges} at height `h`. */
const edgeAt = (e: FoilEdges, col: Float64Array, h: number): number => {
  const n = e.heights.length - 1;
  const f = Math.min(n, Math.max(0, (h / e.heights[n]!) * n));
  const i = Math.min(n - 1, Math.floor(f));
  return col[i]! + (col[i + 1]! - col[i]!) * (f - i);
};

/** How far the edges have travelled from the root to height `h` (see {@link FoilEdges}). */
export const bladeTravel = (b: PreparedBlade, h: number): number => {
  const e = foilEdges(b);
  return edgeAt(e, e.travel, h);
};

/**
 * Section heights from `lo` to `hi` (cm), `count` steps, spaced evenly in how far the
 * edges travel rather than in height: where an edge runs nearly level (a raised rear's
 * underside, a hooked tip) it moves far for little height, and gets sections to match.
 * The tip, where both edges close in, gathers them too.
 */
export const bladeRowHeights = (
  b: PreparedBlade,
  lo: number,
  hi: number,
  count: number,
): number[] => {
  const e = foilEdges(b);
  const t0 = edgeAt(e, e.travel, lo);
  const t1 = edgeAt(e, e.travel, hi);
  const out: number[] = [lo];
  let i = 0;
  for (let k = 1; k < count; k++) {
    const target = t0 + ((t1 - t0) * k) / count;
    while (i < e.travel.length - 2 && e.travel[i + 1]! < target) i++;
    const a = e.travel[i]!;
    const c = e.travel[i + 1]!;
    const h = e.heights[i]! + ((e.heights[i + 1]! - e.heights[i]!) * (target - a)) / (c - a || 1);
    out.push(Math.min(hi, Math.max(lo, h)));
  }
  out.push(hi);
  return out;
};

/** The shape's thickness (in chords) at chord fraction u. */
const shapeThicknessAt = (d: FinDesign, u: number): number => {
  const [o, i] = shapeAt(d, u);
  return o - i;
};

/**
 * The fraction of the chord, from each edge, over which the foil is drawn back from the
 * smoothed edge to the real one. Inside it the smoothed edges set the foil, so a sharp
 * bend doesn't crease the blade across; at the edge itself it is the real foil edge,
 * so edges end at the minimum rather than bulging (round 2 testing).
 */
export const FIN_EDGE_PIN = 0.3;

/** Height (cm) over which a raised rear's thick trailing edge fades out above its corner. */
const REAR_FADE = 0.3;

/** 0 → 1 with flat ends: 6t⁵ − 15t⁴ + 10t³, curvature continuous where it joins. */
const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * How much of the cut trailing edge a section keeps: all of it on a raised rear's
 * underside, so it has the foil's thickness there; none above, so the trailing edge is
 * the minimum. Fades between, just above the corner.
 */
const rearCut = (b: PreparedBlade, h: number): number => {
  const r = b.raisedRear;
  if (!r || h >= r.cornerZ + REAR_FADE) return 0;
  if (h <= r.cornerZ) return 1;
  return 1 - smoother((h - r.cornerZ) / REAR_FADE);
};

/**
 * The part of the foil a section at height `h` keeps, as fractions of the foil's chord:
 * where the real edges sit on the foil laid over the smoothed ones. 0 and 1 where the
 * edges are straight or bend gently; inside that at a sharp bend.
 */
export const foilRange = (b: PreparedBlade, h: number): { from: number; to: number } => {
  const { leading, trailing } = chordAt(b, h);
  const e = foilEdges(b);
  const fl = edgeAt(e, e.foilLeading, h);
  const span = edgeAt(e, e.foilTrailing, h) - fl;
  if (span === 0) return { from: 0, to: 1 };
  const clamp = (f: number) => Math.min(1, Math.max(0, f));
  return { from: clamp((leading - fl) / span), to: clamp((trailing - fl) / span) };
};

/** The horizontal section of the blade at height `h` (cm above the tab top). */
export const bladeSection = (
  b: PreparedBlade,
  h: number,
  stations: readonly number[] = DEFAULT_CHORD_STATIONS,
): BladeSection => {
  const { leading, trailing } = chordAt(b, h);
  const thickness = thicknessAt(b, h);
  const { from: c0, to: c1 } = foilRange(b, h);
  // Over the last stretch of chord at each edge, draw the foil back to its own edge, so
  // both edges end at the minimum; only a raised rear's underside keeps its cut.
  const keep = rearCut(b, h);
  const pin = FIN_EDGE_PIN * (c1 - c0);
  const foilAt = (u: number): number => {
    const g = c0 + (c1 - c0) * u;
    if (!(pin > 0)) return g;
    let f = g;
    if (g < c0 + pin) f -= c0 * smoother((c0 + pin - g) / pin);
    if (g > c1 - pin) f += (1 - keep) * (1 - c1) * smoother((g - (c1 - pin)) / pin);
    return Math.min(1, Math.max(0, f)); // exactly 0 and 1 at the edges, not a hair past
  };
  const end = foilAt(1);
  // Cut short of the foil's thickest point, the section is thickest at the cut.
  const thickestShape = b.thickestAt <= end ? b.shapeThickness : shapeThicknessAt(b.design, end);
  const m = FIN_MIN_THICKNESS;
  const scale = thickestShape > 0 ? Math.max(0, thickness - m) / thickestShape : 0;
  const symmetric = b.design.section.inside === null;
  const slide = h * b.lean;
  const at = (x: number, offset: number): Vert3 => ({
    x,
    y: b.outward * (slide + offset * b.widen),
    z: h,
  });

  const outside: Vert3[] = [];
  const inside: Vert3[] = [];
  for (const u of stations) {
    const [o, i] = shapeAt(b.design, foilAt(u));
    const out = o * scale + (symmetric ? m / 2 : m);
    const ins = i * scale - (symmetric ? m / 2 : 0);
    const x = leading + (trailing - leading) * u;
    outside.push(at(x, out));
    inside.push(at(x, ins));
  }
  return {
    height: h,
    leadingX: leading,
    trailingX: trailing,
    thickness,
    stations,
    outside,
    inside,
  };
};
