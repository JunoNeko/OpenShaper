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
 * - **Minimum thickness:** nowhere thinner than {@link PreparedBlade.minThickness}: the
 *   design minimum ({@link FIN_MIN_THICKNESS}), or an export's. The foil is
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
 * For a laminated fin, the blade can be built as its **core** ({@link FinLaminate}):
 * each face pulled in by the laminate that will be bagged onto it, so the finished fin
 * is the design. The core is never thinner than the minimum. Where the laminate would
 * take it below (toward the edges, which end at the minimum), a laminated face is still
 * pulled in by its whole laminate, so it stays true (a flat inside face stays flat and
 * flush with a wrapped tab), and the face with less laminate makes up the shortfall:
 * all of it on the bare face when only one is laminated, half each when both are
 * equally. So the edges come out a little thicker than designed once laminated, on
 * the side with less laminate.
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

/**
 * Laminate to be bagged onto the blade's faces (cm, square to the blade): the blade is
 * then built as the core under it (see the file comment). Zero on a face leaves it be.
 */
export interface FinLaminate {
  readonly outside: number;
  readonly inside: number;
  /**
   * The laminate also wraps the tab, over the base where the fin leaves the box (a
   * likely snap point in PLA and similar): the tab's laminated faces are pulled in by
   * the same amount, so laminated it still fits the box ({@link tabFacesY}).
   */
  readonly tab?: boolean;
}

/** No laminate: the blade is the design. */
export const NO_LAMINATE: FinLaminate = { outside: 0, inside: 0 };

/** Everything about a design that doesn't depend on the height, worked out once. */
export interface PreparedBlade {
  readonly design: FinDesign;
  /** Laminate the blade is the core of; {@link NO_LAMINATE} for the finished fin. */
  readonly laminate: FinLaminate;
  /**
   * Thinnest the blade gets (cm): the design minimum, or an export's (never less).
   * The edges and tip come up to it; the thickest point stays on the taper.
   */
  readonly minThickness: number;
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
 * trailing-edge root, while it runs backward and rises at under 45° (after a steep
 * lead-in of up to {@link REAR_LEAD} off the root, if it has one). Steeper than that
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

/**
 * How high (cm) the outline may rise steeply off the trailing-edge root before its
 * underside starts: a root handle pulled up (the owner's twin fin) leaves the root
 * steeply for a millimetre or two, then turns back along the underside. Steep for
 * longer than this, it is a trailing edge rising from the root: no raised rear.
 */
const REAR_LEAD = 0.3;

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
      if (!lastGood) {
        // Steep at the root: allowed for a short lead-in, then it's a plain trailing edge.
        if (value(k[seg]!, t).y > REAR_LEAD) return null;
        continue;
      }
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
      const turn = value(k[seg]!, hi);
      if (turn.y <= 0) return null;
      // An underside that curls up into a sharp point (the owner's keel) turns steep a
      // little short of it: the point is the corner, where the edge really changes
      // direction. Without this the point's kink lands in the trailing edge above the
      // corner and creases the blade across at its height.
      const knot = outline.knots[seg]!;
      if (
        !knot.continuous &&
        knot.end.x < turn.x &&
        knot.end.y > turn.y &&
        knot.end.y - turn.y <= REAR_LEAD
      ) {
        return { cornerX: knot.end.x, cornerZ: knot.end.y };
      }
      return { cornerX: turn.x, cornerZ: turn.y };
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

/** Outside and inside offsets of a foil at chord fraction u, in chords. */
const sectionShapeAt = (sec: FinSection, u: number): [number, number] => {
  const out = yAtX(sec.outside, u);
  return [out, sec.inside ? yAtX(sec.inside, u) : -out];
};

const SEARCH_SAMPLES = 400;

/** The thickest point of `t` on [0, 1]: a coarse scan, then a golden-section refine. */
const findThickest = (t: (u: number) => number): { at: number; thickness: number } => {
  let best = 0;
  let bestT = t(0);
  for (let j = 1; j < SEARCH_SAMPLES; j++) {
    const tj = t(j / SEARCH_SAMPLES);
    if (tj > bestT) {
      best = j;
      bestT = tj;
    }
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
 * Where a foil is thickest. It depends only on the foil, and is the bulk of preparing a
 * blade (a few ms), so it is cached per section object: edits that leave the foil alone
 * (outline drags, nudges, cant) reuse it. A WeakMap, so the cache never keeps a section
 * alive.
 */
const thickestCache = new WeakMap<FinSection, { at: number; thickness: number }>();

const sectionThickest = (sec: FinSection): { at: number; thickness: number } => {
  const hit = thickestCache.get(sec);
  if (hit) return hit;
  const found = findThickest((u) => {
    const [o, i] = sectionShapeAt(sec, u);
    return o - i;
  });
  thickestCache.set(sec, found);
  return found;
};

/** The foil a section is shaped by, at one height (see {@link foilAt}). */
export interface Foil {
  /** Outside and inside offsets at chord fraction u, in chords. */
  readonly shapeAt: (u: number) => [number, number];
  /** Where it is thickest, and how thick (in chords). */
  readonly thickest: { readonly at: number; readonly thickness: number };
  /** The share of the minimum thickness added to the outside face: ½ symmetric, 1 not. */
  readonly outsideShare: number;
}

const share = (sec: FinSection): number => (sec.inside === null ? 0.5 : 1);

const pureFoil = (sec: FinSection): Foil => ({
  shapeAt: (u) => sectionShapeAt(sec, u),
  thickest: sectionThickest(sec),
  outsideShare: share(sec),
});

/**
 * The foil at height `eta` (a fraction of the depth): the root foil, a slice's, or a
 * blend of the two either side. The blend eases in and out with flat ends (`smoother`),
 * so the shape changes smoothly through every slice and can't crease the blade there.
 * Above the last slice the foil stays as the last.
 */
export const foilAt = (d: FinDesign, eta: number): Foil => {
  const anchors = [{ height: 0, section: d.section }, ...d.slices];
  let k = 0;
  while (k < anchors.length - 1 && eta >= anchors[k + 1]!.height) k++;
  const lo = anchors[k]!;
  const hi = anchors[k + 1];
  if (!hi) return pureFoil(lo.section);
  const w = smoother(Math.min(1, Math.max(0, (eta - lo.height) / (hi.height - lo.height))));
  if (w <= 0) return pureFoil(lo.section);
  if (w >= 1) return pureFoil(hi.section);
  const shapeAt = (u: number): [number, number] => {
    const [o0, i0] = sectionShapeAt(lo.section, u);
    const [o1, i1] = sectionShapeAt(hi.section, u);
    return [o0 + (o1 - o0) * w, i0 + (i1 - i0) * w];
  };
  return {
    shapeAt,
    thickest: findThickest((u) => {
      const [o, i] = shapeAt(u);
      return o - i;
    }),
    outsideShare: share(lo.section) + (share(hi.section) - share(lo.section)) * w,
  };
};

/**
 * Work out the height-independent parts of the blade. The design must pass
 * `validateFinDesign`; the result is undefined otherwise.
 */
export const prepareBlade = (
  d: FinDesign,
  laminate: FinLaminate = NO_LAMINATE,
  minThickness: number = FIN_MIN_THICKNESS,
): PreparedBlade => {
  const { at, thickness } = sectionThickest(d.section);
  const cant = d.cant * DEG_TO_RAD;
  return {
    design: d,
    laminate,
    minThickness: Math.max(FIN_MIN_THICKNESS, minThickness),
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

/**
 * Longest the flat cap that closes the blade under the tip may be (cm). Under a rounded
 * top the chord closes slowly: 0.1 mm down, the keel's is still 8 mm, which a flat cap
 * there leaves as a flat on the top edge (round 4 testing). 1 mm reads as the edge.
 */
export const FIN_TIP_CAP = 0.1;

/**
 * Where the blade's sections stop under the tip: `gap` below it, or higher where the
 * chord there is longer than {@link FIN_TIP_CAP}, so the cap closing it stays short.
 */
export const bladeTop = (b: PreparedBlade, gap: number): number => {
  const span = (h: number) => {
    const c = chordAt(b, h);
    return c.leading - c.trailing;
  };
  let lo = Math.max(0, b.depth - gap);
  if (!(span(lo) > FIN_TIP_CAP)) return lo;
  let hi = b.depth;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (span(mid) > FIN_TIP_CAP) lo = mid;
    else hi = mid;
  }
  return hi;
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
  /**
   * Where the real edges sit on the foil laid over the smoothed ones ({@link foilRange}),
   * smoothed up the blade the same way: what the foil is drawn toward over most of the
   * chord, so a corner in an edge doesn't crease the blade right across.
   */
  readonly smoothFrom: Float64Array;
  readonly smoothTo: Float64Array;
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

/** `xs` averaged over heights with Gaussian weights of width `sigma[i]` at each sample. */
const gaussianAverage = (hs: Float64Array, xs: Float64Array, sigma: Float64Array): Float64Array => {
  const n = hs.length;
  const out = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const reach = 3 * sigma[i]!;
    let sw = 0;
    let sx = 0;
    for (let j = i; j >= 0 && hs[i]! - hs[j]! <= reach; j--) {
      const d = (hs[j]! - hs[i]!) / sigma[i]!;
      const w = Math.exp(-0.5 * d * d);
      sw += w;
      sx += w * xs[j]!;
    }
    for (let j = i + 1; j < n && hs[j]! - hs[i]! <= reach; j++) {
      const d = (hs[j]! - hs[i]!) / sigma[i]!;
      const w = Math.exp(-0.5 * d * d);
      sw += w;
      sx += w * xs[j]!;
    }
    out[i] = sw > 0 ? sx / sw : xs[i]!;
  }
  return out;
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
  // Where the real edges sit on the foil, then smoothed up the blade like the edges.
  const rawFrom = new Float64Array(n + 1);
  const rawTo = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const span = foilTrailing[i]! - foilLeading[i]!;
    const c = (v: number) => Math.min(1, Math.max(0, v));
    rawFrom[i] = span === 0 ? 0 : c((leading[i]! - foilLeading[i]!) / span);
    rawTo[i] = span === 0 ? 1 : c((trailing[i]! - foilLeading[i]!) / span);
  }
  const smoothFrom = gaussianAverage(heights, rawFrom, sigma);
  const smoothTo = gaussianAverage(heights, rawTo, sigma);
  const edges = {
    heights,
    leading,
    trailing,
    foilLeading,
    foilTrailing,
    travel,
    smoothFrom,
    smoothTo,
  };
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

/**
 * Heights (cm, strictly inside the blade, below `top`) where the outline turns hardest:
 * its points (a corner, or a smooth point with short handles, like a hooked tip's) and
 * wherever it runs exactly level or upright between them. A tip that sticks out
 * backward or forward peaks at one of these, so sections there catch it: sections only
 * at evenly spaced heights cut it off between them.
 */
export const outlineFeatureHeights = (b: PreparedBlade, top: number): number[] => {
  const hs: number[] = b.design.outline.knots.slice(1, -1).map((k) => k.end.y);
  for (const k of b.design.outline.coeffs) {
    // Roots of each derivative component (a quadratic): level (dy = 0) or upright (dx = 0).
    for (const [a, bb, c] of [
      [3 * k.ax, 2 * k.bx, k.cx],
      [3 * k.ay, 2 * k.by, k.cy],
    ] as const) {
      const roots: number[] = [];
      if (Math.abs(a) < 1e-12) {
        if (Math.abs(bb) > 1e-12) roots.push(-c / bb);
      } else {
        const disc = bb * bb - 4 * a * c;
        if (disc >= 0) {
          const r = Math.sqrt(disc);
          roots.push((-bb - r) / (2 * a), (-bb + r) / (2 * a));
        }
      }
      for (const t of roots) if (t > 0 && t < 1) hs.push(value(k, t).y);
    }
  }
  return [...new Set(hs)].filter((h) => h > 0 && h < top).sort((p, q) => p - q);
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

/**
 * The root section's outside and inside faces (blade-frame y, cm) at its thickest point:
 * what the tab must sit between (fin-placement.ts). Worked out directly rather than by
 * building the section: there the faces are the root foil's, scaled to the taper, and
 * the smoothed edges (which make building a section costly, and every nudge rechecks
 * this) don't change them.
 */
export const rootThickestFaces = (b: PreparedBlade): { outside: number; inside: number } => {
  const foil = foilAt(b.design, 0);
  const m = b.minThickness;
  const t = thicknessAt(b, 0);
  const scale = foil.thickest.thickness > 0 ? Math.max(0, t - m) / foil.thickest.thickness : 0;
  const [o, i] = foil.shapeAt(foil.thickest.at);
  const y = (offset: number) => b.outward * offset * b.widen; // no slide at the root
  return {
    outside: y(o * scale + m * foil.outsideShare),
    inside: y(i * scale - m * (1 - foil.outsideShare)),
  };
};

/**
 * The fraction of the chord, from each edge, over which the foil is drawn back from the
 * smoothed edge to the real one. Inside it the smoothed edges set the foil, so a sharp
 * bend doesn't crease the blade across; at the edge itself it is the real foil edge,
 * so edges end at the minimum rather than bulging (round 2 testing).
 */
export const FIN_EDGE_PIN = 0.3;

/**
 * The last stretch of chord, from each edge, over which the foil is brought exactly to
 * the real edge. Across the wider {@link FIN_EDGE_PIN} stretch it is drawn toward where
 * the edge sits smoothed up the blade, so a corner in an edge only reaches this far
 * across the blade: drawing straight to the real edge over the whole stretch carried
 * each corner a third of the way across as a crease (the owner's test fin).
 */
export const FIN_EDGE_LAND = 0.03;

/**
 * Where the wide step carries the foil past the real edge, the land draws it back. Drawn
 * back over too short a land, the foil ran backward there: folded over and clamped at
 * the minimum, a bulge and then a flat at the edge, 0.07 mm deep but plain in the 3D
 * view and in CAD under the keel's rounded top (round 4 testing). So a land is at least
 * this many times as wide as what it draws back: the ramp's steepest slope, which keeps
 * the foil from ever running backward. It leaves corners' lands as they were.
 */
const LAND_PER_DRAW_BACK = 15 / 8;

/**
 * Height (cm) over which a raised rear's thick trailing edge fades out above its corner:
 * how fast the foil goes from running on to the underside's cut to being drawn in to
 * the trailing edge. That change reaches a third of the chord forward, so done in 3 mm
 * it left a ridge across the blade just above the corner (the owner's keel); over
 * 10 mm the ridge is about four times smoother, and the trailing edge is back to the
 * minimum 10 mm above the corner (0.84 mm 3 mm up on the keel).
 */
export const FIN_REAR_FADE = 1.0;

/** 0 → 1 with flat ends: 6t⁵ − 15t⁴ + 10t³, curvature continuous where it joins. */
const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/**
 * How much of the cut trailing edge a section keeps: all of it on a raised rear's
 * underside, so it has the foil's thickness there; none above, so the trailing edge is
 * the minimum. Fades between, just above the corner.
 */
const rearCut = (b: PreparedBlade, h: number): number => {
  const r = b.raisedRear;
  if (!r || h >= r.cornerZ + FIN_REAR_FADE) return 0;
  if (h <= r.cornerZ) return 1;
  return 1 - smoother((h - r.cornerZ) / FIN_REAR_FADE);
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

/** Whether any slice changes the cant or toe. */
export const hasTwist = (d: FinDesign): boolean => d.slices.some((sl) => sl.twist);

/**
 * Cant and toe (deg) at height `eta` (fraction of the depth): the fin's own, changed by
 * each slice with a twist as it is passed. Below a slice's transition zone the blade
 * keeps what it had; through the zone it eases to the slice's values (`smoother`, so the
 * bend and twist have no crease where they start or end); above, it has them.
 */
export const twistAt = (d: FinDesign, eta: number): { cant: number; toe: number } => {
  let cant = d.cant;
  let toe = d.toe ?? 0;
  let floor = 0; // the last anchor: a zone can't start below it
  for (const sl of d.slices) {
    if (!sl.twist) continue;
    const top = sl.height;
    const start = Math.max(floor, top - sl.twist.transition);
    if (eta >= top) {
      cant = sl.twist.cant;
      toe = sl.twist.toe;
    } else if (eta > start) {
      const w = smoother((eta - start) / (top - start));
      cant += (sl.twist.cant - cant) * w;
      toe += (sl.twist.toe - toe) * w;
      break;
    } else break;
    floor = top;
  }
  return { cant, toe };
};

const slideCache = new WeakMap<PreparedBlade, Float64Array>();

/**
 * How far the blade has leant out by height `h` (cm): the lean, tan(cant), added up
 * from the root, since with a slice's cant the lean changes up the blade and bends it.
 * Tabulated once per blade (Simpson's rule per step), read by interpolation.
 */
const slideAt = (b: PreparedBlade, h: number): number => {
  let table = slideCache.get(b);
  const n = EDGE_SAMPLES;
  if (!table) {
    table = new Float64Array(n + 1);
    const lean = (z: number) =>
      Math.tan(twistAt(b.design, b.depth > 0 ? z / b.depth : 0).cant * DEG_TO_RAD);
    const dz = b.depth / n;
    for (let i = 1; i <= n; i++) {
      const z0 = (i - 1) * dz;
      table[i] = table[i - 1]! + (dz / 6) * (lean(z0) + 4 * lean(z0 + dz / 2) + lean(z0 + dz));
    }
    slideCache.set(b, table);
  }
  const f = Math.min(n, Math.max(0, (h / b.depth) * n));
  const i = Math.min(n - 1, Math.floor(f));
  return table[i]! + (table[i + 1]! - table[i]!) * (f - i);
};

/**
 * Where the toe turns the blade, and by how much: about the upright axis through the
 * centre of the root's thickest point, x along the root chord at the foil's thickest
 * fraction, y midway between its faces. Positive toe turns the leading edge toward the
 * stringer: on a fin whose outside face is +Y (a left fin), toward −Y, so a turn of
 * −toe about +Z; a right fin's mirror turns the other way. Null for no toe.
 */
export const toeTurn = (
  b: PreparedBlade,
): { x: number; y: number; cos: number; sin: number } | null => {
  const toe = b.design.toe ?? 0;
  if (!toe) return null;
  const { leading, trailing } = chordAt(b, 0);
  const faces = rootThickestFaces(b);
  const a = -b.outward * toe * DEG_TO_RAD;
  return {
    x: leading + (trailing - leading) * b.thickestAt,
    y: (faces.outside + faces.inside) / 2,
    cos: Math.cos(a),
    sin: Math.sin(a),
  };
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
  // both edges end at the minimum; only a raised rear's underside keeps its cut. In two
  // steps: across the wide stretch toward where the edge sits smoothed up the blade
  // (smooth in height, so a corner in an edge doesn't crease the blade across), then over
  // the last few percent exactly onto the real edge.
  const keep = rearCut(b, h);
  const e = foilEdges(b);
  // Not clamped to the real range: a min or max here would put the corner's kink back.
  const s0 = edgeAt(e, e.smoothFrom, h);
  const s1 = edgeAt(e, e.smoothTo, h);
  const pin = FIN_EDGE_PIN * (s1 - s0);
  const land = FIN_EDGE_LAND * (c1 - c0);
  const ramp = (t: number) => smoother(Math.min(1, Math.max(0, t)));
  const wide = (g: number) =>
    g - s0 * ramp((s0 + pin - g) / pin) + (1 - keep) * (1 - s1) * ramp((g - (s1 - pin)) / pin);
  // What the wide step leaves to do at each real edge: 0 at the leading edge, and at the
  // trailing edge 1 (or the cut, where a raised rear keeps it).
  const short0 = wide(c0);
  const short1 = c1 + (1 - keep) * (1 - c1) - wide(c1);
  // Widened only to draw back (a negative share), blended in smoothly, never past the pin.
  const landFor = (short: number) =>
    Math.min(pin, Math.hypot(land, LAND_PER_DRAW_BACK * Math.max(0, -short)));
  const land0 = landFor(short0);
  const land1 = landFor(short1);
  const fractionAt = (u: number): number => {
    const g = c0 + (c1 - c0) * u;
    if (!(pin > 0) || !(land > 0)) return g;
    // The edges exactly, not as the sum below comes out to a hair either side of them.
    if (u <= 0) return 0;
    if (u >= 1) return Math.min(1, Math.max(0, c1 + (1 - keep) * (1 - c1)));
    const f =
      wide(g) - short0 * ramp((c0 + land0 - g) / land0) + short1 * ramp((g - (c1 - land1)) / land1);
    return Math.min(1, Math.max(0, f)); // exactly 0 and 1 at the edges, not a hair past
  };
  const end = fractionAt(1);
  // Cut short of the foil's thickest point, the section is thickest at the cut.
  const foil = foilAt(b.design, b.depth > 0 ? h / b.depth : 0);
  const thickestShape =
    foil.thickest.at <= end ? foil.thickest.thickness : foil.shapeAt(end)[0] - foil.shapeAt(end)[1];
  const m = b.minThickness;
  const scale = thickestShape > 0 ? Math.max(0, thickness - m) / thickestShape : 0;
  const turn = toeTurn(b);
  // Cant and toe here: the fin's own, unless a slice changes them (twistAt).
  const tw = hasTwist(b.design) ? twistAt(b.design, b.depth > 0 ? h / b.depth : 0) : null;
  const slide = tw ? slideAt(b, h) : h * b.lean;
  const widen = tw ? 1 / Math.cos(tw.cant * DEG_TO_RAD) : b.widen;
  // A slice's own toe turns its section about its thickest point, before the fin's toe.
  const own = tw && tw.toe !== (b.design.toe ?? 0) ? tw.toe - (b.design.toe ?? 0) : 0;
  let pivot: { x: number; y: number; cos: number; sin: number } | null = null;
  if (own) {
    const [ot, it] = foil.shapeAt(foil.thickest.at);
    const centre = ((ot + it) * scale + m * (2 * foil.outsideShare - 1)) / 2;
    const a = -b.outward * own * DEG_TO_RAD;
    pivot = {
      x: leading + (trailing - leading) * foil.thickest.at,
      y: b.outward * (slide + centre * widen),
      cos: Math.cos(a),
      sin: Math.sin(a),
    };
  }
  const at = (x0: number, offset: number): Vert3 => {
    let x = x0;
    let y = b.outward * (slide + offset * widen);
    if (pivot) {
      const dx = x - pivot.x;
      const dy = y - pivot.y;
      x = pivot.x + dx * pivot.cos - dy * pivot.sin;
      y = pivot.y + dx * pivot.sin + dy * pivot.cos;
    }
    if (!turn) return { x, y, z: h };
    // Toe: turned about the upright axis through the root's thickest point.
    const dx = x - turn.x;
    const dy = y - turn.y;
    return {
      x: turn.x + dx * turn.cos - dy * turn.sin,
      y: turn.y + dx * turn.sin + dy * turn.cos,
      z: h,
    };
  };

  const { outside: lamOut, inside: lamIn } = b.laminate;
  const lam = lamOut + lamIn;
  const outside: Vert3[] = [];
  const inside: Vert3[] = [];
  for (const u of stations) {
    const [o, i] = foil.shapeAt(fractionAt(u));
    let out = o * scale + m * foil.outsideShare;
    let ins = i * scale - m * (1 - foil.outsideShare);
    if (lam > 0) {
      // The core: each face in by its laminate. Under the minimum, the face with less
      // laminate makes up the shortfall, so a laminated face stays true.
      const short = Math.max(0, m - (out - ins - lam));
      out += short * (lamIn / lam) - lamOut;
      ins += lamIn - short * (lamOut / lam);
    }
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
