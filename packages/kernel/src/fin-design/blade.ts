// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The 3D blade of a {@link FinDesign}, as horizontal sections: step 4 of
 * docs/design/fin-designer.md. Meshing (step 7) and STEP (step 5) both loft these.
 *
 * At height h above the tab top, a section is built from:
 * - **chord:** where the line y = h crosses the outline (leading and trailing edge);
 * - **shape:** the section faces, stretched along that chord;
 * - **thickness:** the taper at h / depth. The section is scaled so its thickest point
 *   is exactly that thick. The outline sets the chord, the taper the thickness;
 *   neither scales the other.
 *
 * Then two adjustments:
 * - **Minimum thickness:** nowhere thinner than {@link FIN_MIN_THICKNESS}. Where the
 *   scaled foil is thinner (the edges, and everywhere near the tip), it is padded:
 *   - a symmetric foil grows equally both ways, so it stays symmetric;
 *   - any other foil grows on the outside only, so a flat inside face stays flat.
 *   The padding blends in (see {@link padThickness}) rather than switching on, so the
 *   faces stay smooth where the foil runs down to the minimum: a plain max(t, min)
 *   left a visible crease along the trailing edge and at the tip. The section is
 *   scaled so that, padded, its thickest point is the taper's thickness.
 * - **Cant:** the blade leans out by sliding each section sideways, h·tan(cant). The
 *   sections stay horizontal, so the root sits exactly on the flat tab top (see "Cant
 *   as a lean of horizontal sections" in the design doc). A horizontal slice of a
 *   leaning blade is wider than the blade is thick, so lateral offsets are divided by
 *   cos(cant); the thickness measured square to the blade is then the taper value.
 *
 * A raised rear (the base running on behind the tab, lifted clear of the board, see
 * {@link RaisedRear}) changes only the sections below its top. Their trailing edge is
 * on its underside, but the foil isn't squeezed into that short chord: it runs over the
 * full chord the base would have had and is cut off at the underside. The cut ends,
 * one per section, make the underside, so it has the foil's real thickness there rather
 * than being a 0.5 mm trailing edge (round 1 testing).
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
 */
export interface RaisedRear {
  readonly cornerX: number;
  readonly cornerZ: number;
  /**
   * dx/dz of the trailing edge just above the corner. Below the corner the full chord
   * ends on this line, the trailing edge carried on down, so the sections' shape runs
   * smoothly through the corner height.
   */
  readonly slope: number;
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
        const up = dir(seg, 1);
        return { cornerX: corner.x, cornerZ: corner.y, slope: up.z > 0 ? up.x / up.z : 0 };
      }
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const m = dir(seg, mid);
        if (isUnderside(m.x, m.z)) lo = mid;
        else hi = mid;
      }
      const corner = value(k[seg]!, hi);
      if (corner.y <= 0) return null;
      const up = dir(seg, hi);
      return { cornerX: corner.x, cornerZ: corner.y, slope: up.z > 0 ? up.x / up.z : 0 };
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

/**
 * The fraction of the foil's chord a section at height `h` keeps: below a raised rear's
 * corner the foil runs on past the trailing edge to the carried-down trailing-edge
 * line, and is cut off at the trailing edge (see {@link RaisedRear}). 1 elsewhere.
 */
export const foilCut = (b: PreparedBlade, h: number, leading: number, trailing: number): number => {
  const r = b.raisedRear;
  if (!r || h >= r.cornerZ) return 1;
  const end = r.cornerX + (h - r.cornerZ) * r.slope;
  const cut = (trailing - leading) / (end - leading);
  return cut > 0 && cut < 1 ? cut : 1;
};

/**
 * Extra section heights for a raised rear's underside, strictly between the root and
 * the corner: there the trailing edge runs along the underside, much further than the
 * height it climbs, so rows spaced by height would leave it a facet or two. Spaced so
 * the underside gets about as many as the same length of trailing edge would.
 */
export const raisedRearHeights = (b: PreparedBlade, rows: number, top: number): number[] => {
  const r = b.raisedRear;
  if (!r) return [];
  const root = b.design.outline.knots[b.design.outline.knots.length - 1]!.end;
  const length = Math.hypot(r.cornerX - root.x, r.cornerZ - root.y);
  const n = Math.max(4, Math.ceil((rows * length) / top));
  return Array.from({ length: n - 1 }, (_, k) => (r.cornerZ * (k + 1)) / n);
};

/** The shape's thickness (in chords) at chord fraction u. */
const shapeThicknessAt = (d: FinDesign, u: number): number => {
  const [o, i] = shapeAt(d, u);
  return o - i;
};

/**
 * Thickness band (cm) over which the minimum-thickness padding blends in: the foil is
 * untouched where it is at least this much thicker than the minimum. Equal to the
 * minimum, so a foil scaled to nothing pads to exactly the minimum (see
 * {@link unpadThickness}).
 */
export const FIN_EDGE_BLEND = FIN_MIN_THICKNESS;

/**
 * A foil thickness `t` (cm, ≥ 0) padded to the minimum, smoothly: a polynomial smooth
 * maximum of `t` and {@link FIN_MIN_THICKNESS} over {@link FIN_EDGE_BLEND}, curvature
 * continuous where it starts. It equals `t` from the minimum plus the blend up, is never
 * below the minimum, rises steadily with `t`, and is exactly the minimum at `t` = 0.
 */
export const padThickness = (t: number): number => {
  const m = FIN_MIN_THICKNESS;
  const k = FIN_EDGE_BLEND;
  const h = Math.max(k - Math.abs(t - m), 0) / k;
  return Math.max(t, m) + (h * h * h * k) / 6;
};

/**
 * The foil thickness (cm, ≥ 0) that {@link padThickness} turns into `padded`: the
 * section is scaled to this, so after padding its thickest point is exactly the taper's
 * thickness. At the minimum it is 0 (the section is a uniform minimum-thickness slab,
 * as at the tip), so the padding blends smoothly all the way up the blade instead of
 * switching to a plain max, which creased the tip.
 */
export const unpadThickness = (padded: number): number => {
  const m = FIN_MIN_THICKNESS;
  if (padded <= m) return 0;
  if (padded >= m + FIN_EDGE_BLEND) return padded;
  // padThickness rises steadily on [0, m + blend]: bisect.
  let lo = 0;
  let hi = m + FIN_EDGE_BLEND;
  for (let i = 0; i < 60; i++) {
    const mid = (lo + hi) / 2;
    if (padThickness(mid) < padded) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
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

/** The horizontal section of the blade at height `h` (cm above the tab top). */
export const bladeSection = (
  b: PreparedBlade,
  h: number,
  stations: readonly number[] = DEFAULT_CHORD_STATIONS,
): BladeSection => {
  const { leading, trailing } = chordAt(b, h);
  const thickness = thicknessAt(b, h);
  const cut = foilCut(b, h, leading, trailing);
  // Cut before the thickest point, the section is thickest at the cut.
  const thickestShape = cut >= b.thickestAt ? b.shapeThickness : shapeThicknessAt(b.design, cut);
  const scale = unpadThickness(thickness) / thickestShape;
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
    const [o, i] = shapeAt(b.design, u * cut);
    let out = o * scale;
    let ins = i * scale;
    const short = padThickness(out - ins) - (out - ins);
    if (short > 0) {
      if (symmetric) {
        out += short / 2;
        ins -= short / 2;
      } else {
        out += short;
      }
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
