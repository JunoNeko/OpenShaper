// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The 3D blade of a {@link FinDesign}, as horizontal sections: step 4 of
 * docs/design/fin-designer.md. Meshing (step 7) and STEP (step 5) both loft these.
 *
 * At height h above the tab top, a section runs along the chord there (where the line
 * y = h crosses the outline) and takes its thickness from the **foil sweep**
 * (swept-loft.ts): the root foil laid along sections swept from the base to the tip
 * line, each as thick at its thickest point as the taper says at that point's height.
 * A horizontal slice foil ({@link sliceWeight}) blends in around its height: along the
 * chord, scaled to the taper at h. The outline sets the chord, the taper the thickness;
 * neither scales the other.
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
 * **Why sweep.** Stretching the foil along horizontal sections ties every point of it to
 * both edges, and wherever an edge runs near level (a hooked tip, a raised rear's
 * underside) a horizontal section meets it at a glancing angle: whole sections shifted
 * at once, creasing the blade, or thinned to a flap. Owner testing needed a pile of edge
 * smoothing to hide that; the sweep's sections meet both edges across instead. Every
 * edge ends at the minimum, except a raised rear's underside ({@link RaisedRear}), which
 * is part of the sweep's base and keeps the root foil's thickness.
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
import { value } from '../bezier-curve';
import { splineFromKnots, type Spline } from '../bezier-spline';
import { knot } from '../knot';
import { vec2 } from '../vec2';
import { DEG_TO_RAD } from '../constants';
import type { Vert3 } from '../loft';
import { crossings, splineExtremes, yAtX } from './curve-shape';
import {
  FIN_MIN_THICKNESS,
  finOutward,
  type FinDesign,
  type FinSection,
  type FinThicknessPath,
} from './fin-design';
import { findRaisedRear, type RaisedRear } from './raised-rear';
import {
  capRounding,
  cellsAtHeight,
  foilFractionAt,
  locateOnSweep,
  sweepGrid,
  sweepPointOn,
  thicknessPathAt,
  type SweepGrid,
  type SweepHit,
} from './swept-loft';

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

export { findRaisedRear, type RaisedRear } from './raised-rear';

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

export const sectionThickest = (sec: FinSection): { at: number; thickness: number } => {
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

/** Two foils blended, `w` of the way from `a` to `b`. */
const blendFoils = (a: FinSection, b: FinSection, w: number): Foil => {
  if (w <= 0 || a === b) return pureFoil(a);
  if (w >= 1) return pureFoil(b);
  const shapeAt = (u: number): [number, number] => {
    const [o0, i0] = sectionShapeAt(a, u);
    const [o1, i1] = sectionShapeAt(b, u);
    return [o0 + (o1 - o0) * w, i0 + (i1 - i0) * w];
  };
  return {
    shapeAt,
    thickest: findThickest((u) => {
      const [o, i] = shapeAt(u);
      return o - i;
    }),
    outsideShare: share(a) + (share(b) - share(a)) * w,
  };
};

/** The tip foil (foil sweep end): its own, or the base foil's. */
export const tipFoilOf = (d: FinDesign): FinSection => d.tipSection ?? d.section;

/**
 * The thickness path (base, halfway, tip line): the base and tip foils' thickest points
 * at its ends, the design's middle or halfway between them.
 */
export const thicknessPathOf = (d: FinDesign): FinThicknessPath => {
  const a = sectionThickest(d.section).at;
  const c = sectionThickest(tipFoilOf(d)).at;
  return [a, d.thicknessMid ?? (a + c) / 2, c];
};

/**
 * `sec` reshaped so it is thickest at `to` (fraction of the chord), keeping its ends and
 * the order of its points: every point's (and handle's) x moved by a power curve that
 * takes the old thickest point to the new one, a few times over, as the curve between
 * the points follows them only roughly.
 */
export const moveFoilThickest = (sec: FinSection, to: number): FinSection => {
  const target = Math.min(0.95, Math.max(0.05, to));
  const warp = (s: Spline, q: number): Spline => {
    const x = (v: number) => (v <= 0 || v >= 1 ? v : Math.pow(v, q));
    return splineFromKnots(
      s.knots.map((k) =>
        knot(
          vec2(x(k.end.x), k.end.y),
          vec2(x(k.tangentToPrev.x), k.tangentToPrev.y),
          vec2(x(k.tangentToNext.x), k.tangentToNext.y),
          k.continuous,
        ),
      ),
    );
  };
  let out = sec;
  for (let i = 0; i < 6; i++) {
    const at = sectionThickest(out).at;
    if (Math.abs(at - target) < 5e-4 || !(at > 0 && at < 1)) break;
    const q = Math.log(target) / Math.log(at);
    out = { outside: warp(out.outside, q), inside: out.inside ? warp(out.inside, q) : null };
  }
  return out;
};

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

/** Heights the edges are sampled at, for row spacing and the lean. */
const EDGE_SAMPLES = 1200;

/**
 * Both edges sampled up the blade, and `travel`: the running total of height plus how
 * far both edges have moved, which spaces sections evenly along the edges rather than
 * the height ({@link bladeRowHeights}).
 */
export interface BladeEdges {
  readonly heights: Float64Array;
  readonly leading: Float64Array;
  readonly trailing: Float64Array;
  readonly travel: Float64Array;
}

const edgesCache = new WeakMap<PreparedBlade, BladeEdges>();

/** Both edges up the blade (see {@link BladeEdges}). Cached per blade. */
export const bladeEdges = (b: PreparedBlade): BladeEdges => {
  const hit = edgesCache.get(b);
  if (hit) return hit;
  const n = EDGE_SAMPLES;
  const heights = new Float64Array(n + 1);
  const leading = new Float64Array(n + 1);
  const trailing = new Float64Array(n + 1);
  const travel = new Float64Array(n + 1);
  for (let i = 0; i <= n; i++) {
    const h = (b.depth * i) / n;
    const c = chordAt(b, h);
    heights[i] = h;
    leading[i] = c.leading;
    trailing[i] = c.trailing;
    if (i > 0) {
      travel[i] =
        travel[i - 1]! +
        (h - heights[i - 1]!) +
        Math.abs(c.leading - leading[i - 1]!) +
        Math.abs(c.trailing - trailing[i - 1]!);
    }
  }
  const edges = { heights, leading, trailing, travel };
  edgesCache.set(b, edges);
  return edges;
};

/** Linear interpolation in a column of {@link BladeEdges} at height `h`. */
const edgeAt = (e: BladeEdges, col: Float64Array, h: number): number => {
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

/** How far the edges have travelled from the root to height `h` (see {@link BladeEdges}). */
export const bladeTravel = (b: PreparedBlade, h: number): number => {
  const e = bladeEdges(b);
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
  const e = bladeEdges(b);
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
 * building the section (every nudge rechecks this): at the root the sweep lays the root
 * foil along the chord, scaled to the taper, and wherever the thickness path puts its
 * thickest point the faces there are the same.
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

/** 0 → 1 with flat ends: 6t⁵ − 15t⁴ + 10t³, curvature continuous where it joins. */
const smoother = (t: number): number => t * t * t * (t * (t * 6 - 15) + 10);

/** Whether any slice changes the cant or toe. */
export const hasTwist = (d: FinDesign): boolean => d.slices.some((sl) => sl.twist);

/**
 * Cant and toe (deg) at height `eta` (fraction of the depth): the fin's own at the root,
 * each slice's with a twist from its height up, easing in over {@link FIN_SLICE_REACH}
 * below it (less if the root or the slice below is nearer) with no crease where it
 * starts or ends (`smoother`).
 */
export const twistAt = (d: FinDesign, eta: number): { cant: number; toe: number } => {
  let from = { height: 0, cant: d.cant, toe: d.toe ?? 0 };
  for (const sl of d.slices) {
    if (!sl.twist) continue;
    const to = { height: sl.height, cant: sl.twist.cant, toe: sl.twist.toe };
    if (eta < to.height) {
      const start = Math.max(from.height, to.height - FIN_SLICE_REACH);
      const w = smoother(Math.max(0, (eta - start) / (to.height - start)));
      return {
        cant: from.cant + (to.cant - from.cant) * w,
        toe: from.toe + (to.toe - from.toe) * w,
      };
    }
    from = to;
  }
  return { cant: from.cant, toe: from.toe };
};

const slideCache = new WeakMap<PreparedBlade, Float64Array>();

/**
 * How far the blade has leant out by height `h` (cm): the lean, tan(cant), added up
 * from the root, since with a slice's cant the lean changes up the blade and bends it.
 * Tabulated once per blade (Simpson's rule per step), read by interpolation.
 */
export const slideAt = (b: PreparedBlade, h: number): number => {
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

/** What the swept loft needs per blade: its grid, and each section's thickness and path. */
interface SweptBlade {
  readonly grid: SweepGrid;
  /** Per grid row: the foil laid along it, blended from the base foil to the tip foil. */
  readonly foils: readonly Foil[];
  /** Per grid row: where the section is thickest (fraction along it), and how much (cm). */
  readonly path: Float64Array;
  readonly scale: Float64Array;
  /** The tip line's height, as a fraction of the depth: where slices hand back to the sweep. */
  readonly tipEta: number;
}

const sweptCache = new WeakMap<PreparedBlade, SweptBlade>();

const sweptBlade = (b: PreparedBlade): SweptBlade => {
  const hit = sweptCache.get(b);
  if (hit) return hit;
  const d = b.design;
  const grid = sweepGrid(d);
  const tip = tipFoilOf(d);
  const foils = Array.from({ length: grid.rows }, (_, i) =>
    blendFoils(d.section, tip, smoother(Math.min(1, i / grid.tipRow))),
  );
  const path = new Float64Array(grid.rows);
  const scale = new Float64Array(grid.rows);
  const m = b.minThickness;
  const taper = (z: number) => thicknessAt(b, Math.min(b.depth, Math.max(0, z)));
  const way = thicknessPathOf(d);
  let tipThickness = m;
  for (let i = 0; i < grid.rows; i++) {
    const t = Math.min(1, i / grid.tipRow);
    path[i] = thicknessPathAt(way, t);
    let thickness: number;
    if (i <= grid.tipRow) {
      // As thick as the taper says at the height of the section's thickest point.
      thickness = taper(sweepPointOn(grid, i, path[i]!).y);
      if (i === grid.tipRow) tipThickness = thickness;
    } else {
      thickness = m + (tipThickness - m) * capRounding(grid.capV[i]!);
    }
    const most = foils[i]!.thickest.thickness;
    scale[i] = most > 0 ? Math.max(0, thickness - m) / most : 0;
  }
  const tipBase = grid.tipRow * grid.cols;
  const tipZ = (grid.z[tipBase]! + grid.z[tipBase + grid.cols - 1]!) / 2;
  const swept = {
    grid,
    foils,
    path,
    scale,
    tipEta: b.depth > 0 ? tipZ / b.depth : 1,
  };
  sweptCache.set(b, swept);
  return swept;
};

/**
 * How far a slice reaches either side of its height (fraction of the depth): its foil
 * blends in over this below it and out over this above it, and its cant and toe ease in
 * over this below it (owner testing: blended over the whole span from the base, a slice
 * high up bent and reshaped the blade a third of the way up). Less where the base, the
 * tip line or another slice is nearer.
 */
export const FIN_SLICE_REACH = 0.15;

/**
 * How much the horizontal slice foils count at height `eta`, 0 to 1: all of it at a
 * slice, easing to none over {@link FIN_SLICE_REACH} either side, or to the base below
 * and the tip line (the tip, for a slice above it) above when they are nearer. Between
 * two slices close enough that their reaches meet, all of it.
 */
export const sliceWeight = (d: FinDesign, eta: number, tipEta: number): number => {
  const sl = d.slices;
  if (sl.length === 0) return 0;
  let k = -1; // the last slice at or below eta
  while (k < sl.length - 1 && sl[k + 1]!.height <= eta) k++;
  const lo = k >= 0 ? sl[k]!.height : null;
  const hi = k < sl.length - 1 ? sl[k + 1]!.height : null;
  if (lo !== null && hi !== null && hi - lo <= 2 * FIN_SLICE_REACH) return 1;
  let w = 0;
  if (lo !== null) {
    const top = tipEta > lo ? tipEta : 1;
    const reach = Math.min(FIN_SLICE_REACH, top - lo);
    w = Math.max(w, reach > 0 ? 1 - smoother(Math.min(1, (eta - lo) / reach)) : 0);
  }
  if (hi !== null) {
    const reach = Math.min(FIN_SLICE_REACH, hi);
    w = Math.max(w, reach > 0 ? smoother(Math.max(0, 1 - (hi - eta) / reach)) : 1);
  }
  return w;
};

/** The horizontal slice foil at height `eta`: a slice's, or a blend of the two either side. */
export const sliceFoilAt = (d: FinDesign, eta: number): Foil | null => {
  const sl = d.slices;
  if (sl.length === 0) return null;
  let k = 0;
  while (k < sl.length - 1 && eta >= sl[k + 1]!.height) k++;
  const lo = sl[k]!;
  const hi = sl[k + 1];
  if (!hi || eta <= lo.height) return pureFoil(lo.section);
  const w = smoother(Math.min(1, (eta - lo.height) / (hi.height - lo.height)));
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
 * How fast the blade may thicken going in from the tip edge (thickness per unit of
 * distance up the sweep, both faces together): about 7° all in. Short of the tip line the sweep
 * carries the taper's thickness right up to it, and where the rounded tip past it is
 * only a few millimetres deep that thickness fell away in a shoulder at the edge, a
 * bulge round the tip (owner testing). Within reach of the tip edge the blade is no
 * thicker than this slope allows, blended in over {@link TIP_EDGE_BLEND}.
 */
export const FIN_TIP_EDGE_SLOPE = 0.12;

/**
 * How wide (cm of thickness) the blend between the sweep's thickness and the tip-edge
 * slope is: where they differ by less, the join is rounded off.
 */
const TIP_EDGE_BLEND = 0.015;

/** The smaller of a and b, rounded off over `w` so the join has no corner. */
const smoothMin = (a: number, b: number, w: number): number => {
  const h = Math.min(1, Math.max(0, 0.5 + (0.5 * (b - a)) / w));
  return b + (a - b) * h - w * h * (1 - h);
};

/** The tip line's height as a fraction of the depth (see {@link sliceWeight}). */
export const tipLineEta = (b: PreparedBlade): number => sweptBlade(b).tipEta;

/**
 * The horizontal section of the blade at height `h` (cm above the tab top): the swept
 * loft's thickness field (swept-loft.ts) read along the chord there, blended with the
 * horizontal slice foils by {@link sliceWeight}.
 */
export const bladeSection = (
  b: PreparedBlade,
  h: number,
  stations: readonly number[] = DEFAULT_CHORD_STATIONS,
): BladeSection => {
  const { leading, trailing } = chordAt(b, h);
  const thickness = thicknessAt(b, h);
  const m = b.minThickness;
  const sw = sweptBlade(b);
  const { grid, foils } = sw;
  const base = foils[0]!;
  const cells = cellsAtHeight(grid, h);
  const eta = b.depth > 0 ? h / b.depth : 0;
  const weight = sliceWeight(b.design, eta, sw.tipEta);
  const sliceFoil = weight > 0 ? sliceFoilAt(b.design, eta) : null;
  const sliceScale =
    sliceFoil && sliceFoil.thickest.thickness > 0
      ? Math.max(0, thickness - m) / sliceFoil.thickest.thickness
      : 0;
  // Near the tip edge, no thicker than FIN_TIP_EDGE_SLOPE allows: the faces drawn in
  // toward the minimum together, keeping their shares of it.
  const share = base.outsideShare;
  const limitAtTip = (toTip: number | null, out: number, ins: number): [number, number] => {
    const t = out - ins;
    if (toTip === null || !(t > m)) return [out, ins];
    const t2 = Math.max(m, smoothMin(t, m + FIN_TIP_EDGE_SLOPE * toTip, TIP_EDGE_BLEND));
    if (t2 >= t) return [out, ins];
    const r = (t2 - m) / (t - m);
    const lo = -m * (1 - share);
    const hi = m * share;
    return [hi + (out - hi) * r, lo + (ins - lo) * r];
  };
  const faces = (u: number): [number, number] => {
    // The sweep's: each section's foil, read where this point falls on it.
    // The edges are the minimum, except along the base: a raised rear's underside is the
    // base's foil cut off, as thick as the foil there.
    let out = m * base.outsideShare;
    let ins = -m * (1 - base.outsideShare);
    let toTip: number | null = null;
    {
      const hit = locateOnSweep(grid, leading + (trailing - leading) * u, h, cells);
      if (hit) toTip = hit.toTip;
      const onBase = (hit: SweepHit) => hit.row < 1 && hit.along > 1e-3 && hit.along < 1 - 1e-3;
      if (hit && (u > 0 && u < 1 ? true : onBase(hit))) {
        const alongAt = hit.along;
        const i0 = Math.min(grid.rows - 2, Math.floor(hit.row));
        const a = hit.row - i0;
        const row = (i: number): [number, number] => {
          const f = foils[i]!;
          const [o, n] = f.shapeAt(foilFractionAt(alongAt, sw.path[i]!, f.thickest.at));
          return [
            o * sw.scale[i]! + m * f.outsideShare,
            n * sw.scale[i]! - m * (1 - f.outsideShare),
          ];
        };
        const [o0, n0] = row(i0);
        const [o1, n1] = row(i0 + 1);
        out = o0 + (o1 - o0) * a;
        ins = n0 + (n1 - n0) * a;
      }
    }
    if (!sliceFoil) return limitAtTip(toTip, out, ins);
    // A horizontal slice foil: along the chord here, as the taper says.
    const [o, n] = sliceFoil.shapeAt(u);
    const sOut = o * sliceScale + m * sliceFoil.outsideShare;
    const sIns = n * sliceScale - m * (1 - sliceFoil.outsideShare);
    return limitAtTip(toTip, out + (sOut - out) * weight, ins + (sIns - ins) * weight);
  };
  const { outside: lamOut, inside: lamIn } = b.laminate;
  const lam = lamOut + lamIn;
  const offsets = stations.map((u) => {
    let [out, ins] = faces(u);
    if (lam > 0) {
      // The core: each face in by its laminate. Under the minimum, the face with less
      // laminate makes up the shortfall, so a laminated face stays true.
      const short = Math.max(0, m - (out - ins - lam));
      out += short * (lamIn / lam) - lamOut;
      ins += lamIn - short * (lamOut / lam);
    }
    return [out, ins] as const;
  });

  const turn = toeTurn(b);
  // Cant and toe here: the fin's own, unless a slice changes them (twistAt).
  const tw = hasTwist(b.design) ? twistAt(b.design, eta) : null;
  const slide = tw ? slideAt(b, h) : h * b.lean;
  const widen = tw ? 1 / Math.cos(tw.cant * DEG_TO_RAD) : b.widen;
  // A slice's own toe turns its section about its thickest point, before the fin's toe.
  const own = tw && tw.toe !== (b.design.toe ?? 0) ? tw.toe - (b.design.toe ?? 0) : 0;
  let pivot: { x: number; y: number; cos: number; sin: number } | null = null;
  if (own) {
    let k = 0;
    offsets.forEach(([o, n], j) => {
      if (o - n > offsets[k]![0] - offsets[k]![1]) k = j;
    });
    const a = -b.outward * own * DEG_TO_RAD;
    pivot = {
      x: leading + (trailing - leading) * stations[k]!,
      y: b.outward * (slide + ((offsets[k]![0] + offsets[k]![1]) / 2) * widen),
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
  const outside: Vert3[] = [];
  const inside: Vert3[] = [];
  stations.forEach((u, j) => {
    const x = leading + (trailing - leading) * u;
    outside.push(at(x, offsets[j]![0]));
    inside.push(at(x, offsets[j]![1]));
  });
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
