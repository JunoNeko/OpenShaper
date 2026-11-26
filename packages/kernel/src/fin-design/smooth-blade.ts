// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The smooth blade: the fin's surface (docs/design/fin-designer.md, "A new surface
 * engine"). Outline, foils, thickness curve and path, minimum thickness, cant and toe,
 * built as **one smooth surface** laid along the fin, so blending them can't crease it.
 *
 * ## The layout: (s, u)
 *
 * The profile is one four-sided region: the **base** (the root, and a raised rear's
 * underside), the **leading edge** on past the tip line and round the tip, a short
 * **last row** about the middle of the tip edge, and the **trailing edge** likewise. The
 * **tip line** is one row, exactly straight (owner testing: as a row bulging toward the
 * tip, the straight tip line cut across rows, and its ends were thinned far below the
 * tip foil drawn, even concave). It is laid out as an elliptic grid (smooth-map.ts,
 * Winslow), which can't fold, even on a hook, and read through bicubic splines, so every
 * point of the profile has a place (s, u) that changes smoothly across it:
 *
 * - s runs from the base (0) up the fin to the tip edge (1), following its curve: on a
 *   hook, along the arm;
 * - u runs across, from the leading edge (0) to the trailing edge (1). Each row (s
 *   fixed) is a section of the fin from edge to edge.
 *
 * ## The shape on it
 *
 * Every attribute is a smooth function of (s, u), and the faces are put together from
 * them by sums and products only, never a clamp, a table read straight or a switch:
 *
 * - **Along the row**, `along(s, u)`: the fraction of the row's length from the leading
 *   edge, so a foil is laid along a row by length.
 * - **Thickness path**, p(s): where each row is thickest (the design's base, middle and
 *   tip line values, the same quadratic as the sweep's, over the whole fin).
 * - **Foil**: the base foil and the tip foil, each laid so its thickest point is on the
 *   path, read where the row is, as fractions of their thickest; blended from the base to
 *   the tip line by `smootherstep`, flat at both ends. The warp from the row to the foil,
 *   x/(x + λ(1 − x)), leaves the edges' slope finite, so a round nose stays round (the
 *   sweep's power curve made it sharper or blunter).
 * - **Thickness**: the thickness curve read by how far along the fin the row's thickest
 *   point is, η(s), the thickness path's length from the base: on an upright fin about
 *   its height, as the curve is drawn; on a swept one, along the sweep.
 * - **The tip**: the tip line is a row, so the tip foil lies along it as drawn, at one
 *   thickness. Beyond it (owner proposal) the thickness path carries on along its own
 *   curve, the direction and bend it arrives with, until it meets the outline: the tip
 *   point. The rows close up to it (the last row a sliver about it), the outline round the
 *   tip being their edges, so each is the tip foil shrinking as it nears the point, its
 *   thickest on the path, as thick as the thickness curve says there, but never thicker
 *   for its length than the tip foil on the tip line: near the point the tip foil shrinks
 *   whole. Moving the tip line steers the tip point.
 * - **Minimum**: the foil scaled to the thickness less the minimum, then the minimum
 *   added all over (symmetric foils half each side): the edges and the tip edge end at it
 *   exactly, with no clamp.
 *
 * - **Control sections**: each a row, its height the fraction of the way from the base
 *   to the tip line along the fin, its foil drawn for that row. Kept as its
 *   difference to the fin without sections on its row, along the row, laid in full there
 *   and easing out over FIN_SLICE_REACH either side, gone by the tip line, or blended into the next section's where they are closer.
 *   So a section's row is its foil exactly, and one added as the foil already there
 *   changes nothing (smoothFoilAt).
 *
 * Then cant and toe: the fin's lean (a shear, as z·tan(cant)) and toe (a turn about the
 * root's thickest point), and any cant lines' changes above them, by height alone, so a
 * bend runs level, along the flow (blade.ts twistAt).
 */
import type { Vert3 } from '../loft';
import { splineExtremes, yAtX } from './curve-shape';
import {
  cosineStations,
  cantLineReach,
  FIN_SLICE_REACH,
  fitFoil,
  hasTwist,
  NO_LAMINATE,
  prepareBlade,
  sectionShapeAt,
  sectionThickest,
  thicknessPathOf,
  tipFoilOf,
  toeTurn,
  twistAt,
  type FinLaminate,
  type PreparedBlade,
} from './blade';
import { DEG_TO_RAD } from '../constants';
import {
  FIN_MIN_THICKNESS,
  FIN_SLICE_MIN_GAP,
  type FinCantLine,
  type FinDesign,
  type FinSection,
} from './fin-design';
import {
  spline1,
  spline2,
  winslowGrid,
  type Grid,
  type P2,
  type Sides,
  type Spline1,
  type Spline2,
} from './smooth-map';
import { findRaisedRear } from './raised-rear';
import { sweepFrame, thicknessPathAt } from './swept-loft';

/** The elliptic grid's size: rows up the fin, columns across it. */
export const SMOOTH_MAP = { rows: 64, cols: 48 } as const;

/** Sub-steps per grid cell when measuring a row's length. */
const ROW_STEPS = 8;

/** Rows the thickness path's length is measured over (η). */
const SPINE_SAMPLES = 256;

/** A polyline read by fraction of its length. */
interface Polyline {
  readonly pts: readonly P2[];
  readonly cum: ArrayLike<number>;
}

const alongPath = (p: Polyline, f: number): P2 => {
  const n = p.pts.length - 1;
  const total = p.cum[n]!;
  if (!(total > 0)) return p.pts[0]!;
  const target = Math.min(1, Math.max(0, f)) * total;
  let lo = 0;
  let hi = n;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (p.cum[mid]! <= target) lo = mid;
    else hi = mid;
  }
  const span = p.cum[hi]! - p.cum[lo]!;
  const t = span > 0 ? (target - p.cum[lo]!) / span : 0;
  const a = p.pts[lo]!;
  const b = p.pts[hi]!;
  return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
};

/**
 * The base at fraction `u` of its run back from the leading-edge root, by x along the
 * root as the sweep reads it: a raised rear's steep underside takes little of it.
 */
const acrossBase = (p: Polyline, u: number): P2 => {
  const pts = p.pts;
  const x0 = pts[0]!.x;
  const x1 = pts[pts.length - 1]!.x;
  const target = x0 + (x1 - x0) * Math.min(1, Math.max(0, u));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if ((target - a.x) * (target - b.x) <= 0 && a.x !== b.x) {
      const t = (target - a.x) / (b.x - a.x);
      return { x: target, y: a.y + (b.y - a.y) * t };
    }
  }
  return u <= 0 ? pts[0]! : pts[pts.length - 1]!;
};

/** The profile's layout: (s, u) → (x, z), and how far along its row each point is. */
export interface SmoothMap {
  readonly x: Spline2;
  readonly z: Spline2;
  /** Fraction of the row's length from the leading edge. */
  readonly along: Spline2;
  /** The tip line's ends (tab frame, cm). */
  readonly tipStart: P2;
  readonly tipEnd: P2;
  /** The row (s) that is the tip line, straight from end to end. */
  readonly sTip: number;
  /**
   * Where the thickness path, carried on past the tip line along its own curve, meets the
   * outline: the rows past the tip line close up to it (owner proposal).
   */
  readonly tipPoint: P2;
  /**
   * Past the tip line, the thickness path's fraction along each row, s from the tip line
   * (0) to the tip point (1), read through a C² spline over PAST_ROWS samples.
   */
  readonly pastPath: Spline1;
}

/** Passes of smoothing up the fin over the fraction-along table; rows a correction eases over. */
const ALONG_SMOOTHING = 8;
const ALONG_EASE = 8;
/** Rows above the base a raised rear's fin eases that smoothing in over. */
const ALONG_BASE = 16;

/**
 * How much of the tip edge the last row is, about the tip point: the rows past the tip
 * line close up to it, a sliver where the extended thickness path meets the outline.
 */
const TIP_TOP = 0.02;

/** Rows past the tip line the thickness path's fraction along them is sampled at. */
const PAST_ROWS = 48;

/** Steps (cm) the extended thickness path is traced in, and at most how far (cm). */
const ARC_STEP = 0.05;
const ARC_MAX = 100;

/** A polyline through `pts`, with its running length. */
const polyline = (pts: readonly P2[]): Polyline => {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return { pts, cum };
};

/** The points of `p` from fraction `a` to `b` of its length (either way round). */
const stretch = (p: Polyline, a: number, b: number): P2[] => {
  const n = p.pts.length - 1;
  const total = p.cum[n]!;
  const [lo, hi] = [Math.min(a, b) * total, Math.max(a, b) * total];
  const mid = p.pts.filter((_, i) => p.cum[i]! > lo && p.cum[i]! < hi);
  const pts = [alongPath(p, Math.min(a, b)), ...mid, alongPath(p, Math.max(a, b))];
  return a <= b ? pts : pts.reverse();
};

/** The outline's outermost points (rearmost, foremost, highest), computed once per outline. */
const outlineExtremes = (outline: FinDesign['outline']): readonly P2[] => {
  const ex = splineExtremes(outline, 'x');
  const ey = splineExtremes(outline, 'y');
  return [ex.min.point, ex.max.point, ey.max.point];
};

/**
 * A side of the layout, `edge` read at `warp(t)` of its length, with the node nearest each
 * of the outline's outermost points (rearmost, foremost, highest) on it moved onto that
 * point: the layout is read through splines over its nodes, which cut a sharp point (a
 * hook's tip) between two of them by up to a few tenths of a millimetre. Moved by a
 * smooth bump at most half a node's spacing across three nodes either side, so the nodes
 * stay in order; never near row `keep` (the tip line), whose end is on the outline already,
 * and skipping a second pin whose bump would reach an earlier one.
 */
const pinned = (
  edge: Polyline,
  warp: (t: number) => number,
  extremes: readonly P2[],
  rows: number,
  keep: number,
): ((t: number) => P2) => {
  const n = edge.pts.length - 1;
  const total = edge.cum[n]! || 1;
  const pins: { at: number; by: number }[] = [];
  const reach = 3 / rows;
  for (const e of extremes) {
    // How far along the side the point is, if it is on it.
    let best = Infinity;
    let along = 0;
    for (let i = 1; i <= n; i++) {
      const a = edge.pts[i - 1]!;
      const b = edge.pts[i]!;
      const dx = b.x - a.x;
      const dz = b.y - a.y;
      const l2 = dx * dx + dz * dz;
      const t = l2 > 0 ? Math.min(1, Math.max(0, ((e.x - a.x) * dx + (e.y - a.y) * dz) / l2)) : 0;
      const dd = (a.x + dx * t - e.x) ** 2 + (a.y + dz * t - e.y) ** 2;
      if (dd < best)
        [best, along] = [dd, (edge.cum[i - 1]! + t * (edge.cum[i]! - edge.cum[i - 1]!)) / total];
    }
    if (best > 1e-8 || along <= 0.02 || along >= 0.98) continue;
    // The t that reads it, and the node nearest that.
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 60; k++) {
      const mid = (lo + hi) / 2;
      if (warp(mid) < along) lo = mid;
      else hi = mid;
    }
    const t = (lo + hi) / 2;
    const node = Math.round(t * rows) / rows;
    // Not where it would move the tip line's end (on the outline already) or overlap an
    // earlier pin's bump (which would push it off target or fold shift(t)).
    if (
      node > 0 &&
      node < 1 &&
      Math.abs(node - keep) >= reach &&
      pins.every((p) => Math.abs(node - p.at) >= reach)
    ) {
      pins.push({ at: node, by: t - node });
    }
  }
  const shift = (t: number) => {
    let v = t;
    for (const p of pins) {
      const x = (t - p.at) / reach;
      if (Math.abs(x) < 1) v += p.by * (1 - x * x) ** 3;
    }
    return Math.min(1, Math.max(0, v));
  };
  return (t) => alongPath(edge, warp(shift(t)));
};

/** A layout without the path past the tip line: the rows close up about `q` of the tip edge. */
type Layout = Omit<SmoothMap, 'tipPoint' | 'pastPath'>;

const layoutAbout = (
  d: FinDesign,
  f: ReturnType<typeof sweepFrame>,
  q: number,
  extremes: readonly P2[],
  initial?: Grid,
): { layout: Layout; grid: Grid } => {
  const { rows, cols } = SMOOTH_MAP;
  // Each edge runs on past the tip line round the tip, up to the short last row about q.
  const lo = Math.max(1e-3, q - TIP_TOP / 2);
  const hi = Math.min(1 - 1e-3, q + TIP_TOP / 2);
  const left = polyline([...f.leading.pts, ...stretch(f.tipEdge, 0, lo).slice(1)]);
  const right = polyline([...f.trailing.pts, ...stretch(f.tipEdge, 1, hi).slice(1)]);
  const fraction = (edge: Polyline, part: Polyline) =>
    part.cum[part.pts.length - 1]! / (edge.cum[edge.pts.length - 1]! || 1);
  const fL = fraction(left, f.leading);
  const fR = fraction(right, f.trailing);
  // The tip line is one row, so both edges must reach its ends on it: each is read through
  // a smooth warp putting that row at the tip line's end.
  const tipRow = Math.min(rows - 4, Math.max(8, Math.round(((fL + fR) / 2) * rows)));
  const sTip = tipRow / rows;
  const sides: Sides = {
    bottom: (t) => acrossBase(f.base, t),
    top: (t) => alongPath(f.tipEdge, lo + (hi - lo) * t),
    left: pinned(left, (t) => foilWarp(t, sTip, fL), extremes, rows, sTip),
    right: pinned(right, (t) => foilWarp(t, sTip, fR), extremes, rows, sTip),
  };
  const g = winslowGrid(sides, rows, cols, initial);
  const grid: Grid = { rows, cols, x: g.x.slice(), y: g.y.slice() };
  // The tip line's row made exactly straight: its points moved square to where they lie by
  // length along it, the move eased out over the rows either side, flat at the row and
  // at both ends, so the layout stays smooth through it.
  const w = cols + 1;
  const base = tipRow * w;
  const run = new Float64Array(w);
  for (let j = 1; j <= cols; j++) {
    run[j] =
      run[j - 1]! +
      Math.hypot(g.x[base + j]! - g.x[base + j - 1]!, g.y[base + j]! - g.y[base + j - 1]!);
  }
  const len = run[cols]! || 1;
  const moveX = new Float64Array(w);
  const moveZ = new Float64Array(w);
  for (let j = 1; j < cols; j++) {
    const t = run[j]! / len;
    moveX[j] = f.tipStart.x + (f.tipEnd.x - f.tipStart.x) * t - g.x[base + j]!;
    moveZ[j] = f.tipStart.y + (f.tipEnd.y - f.tipStart.y) * t - g.y[base + j]!;
  }
  for (let i = 1; i < rows; i++) {
    const b = smootherstep(i <= tipRow ? i / tipRow : (rows - i) / (rows - tipRow));
    for (let j = 1; j < cols; j++) {
      g.x[i * w + j] = g.x[i * w + j]! + moveX[j]! * b;
      g.y[i * w + j] = g.y[i * w + j]! + moveZ[j]! * b;
    }
  }
  const x = spline2(g.x, rows, cols);
  const z = spline2(g.y, rows, cols);
  // Each row's length from the leading edge, measured along the splines.
  const along = new Float64Array((rows + 1) * w);
  for (let i = 0; i <= rows; i++) {
    let length = 0;
    let px = x.at(i, 0);
    let pz = z.at(i, 0);
    for (let j = 1; j <= cols; j++) {
      for (let k = 1; k <= ROW_STEPS; k++) {
        const c = j - 1 + k / ROW_STEPS;
        const qx = x.at(i, c);
        const qz = z.at(i, c);
        length += Math.hypot(qx - px, qz - pz);
        px = qx;
        pz = qz;
      }
      along[i * w + j] = length;
    }
    for (let j = 1; j <= cols; j++) {
      along[i * w + j] = length > 0 ? along[i * w + j]! / length : j / cols;
    }
  }
  // Each column of it smoothed up the fin, a few rows' worth: a row's fraction hangs on its
  // whole length, so a corner in an edge (the starting fins' at the tip's rear) stepped it
  // right across the blade. The base and tip line rows stay as they are, so their foils
  // lie along them as drawn.
  const raw = along.slice();
  for (let j = 1; j < cols; j++) {
    const true0 = along[tipRow * w + j]!;
    for (let pass = 0; pass < ALONG_SMOOTHING; pass++) {
      let last = along[j]!;
      for (let i = 1; i < rows; i++) {
        const here = along[i * w + j]!;
        along[i * w + j] = (last + 2 * here + along[(i + 1) * w + j]!) / 4;
        last = here;
      }
    }
    const off = true0 - along[tipRow * w + j]!;
    for (let i = 1; i < rows; i++) {
      const away = Math.abs(i - tipRow) / ALONG_EASE;
      if (away < 1) along[i * w + j] = along[i * w + j]! + off * (1 - smootherstep(away));
    }
  }
  // Not at a raised rear: its base row is meant to step where the underside begins.
  if (findRaisedRear(d.outline)) {
    for (let i = 1; i < ALONG_BASE; i++) {
      const b = smootherstep(i / ALONG_BASE);
      for (let j = 1; j < cols; j++) {
        along[i * w + j] = raw[i * w + j]! + (along[i * w + j]! - raw[i * w + j]!) * b;
      }
    }
  }
  return {
    layout: {
      x,
      z,
      along: spline2(along, rows, cols),
      tipStart: f.tipStart,
      tipEnd: f.tipEnd,
      sTip,
    },
    grid,
  };
};

const layoutPoint = (m: Layout, s: number, u: number): P2 => ({
  x: m.x.at(s * SMOOTH_MAP.rows, u * SMOOTH_MAP.cols),
  y: m.z.at(s * SMOOTH_MAP.rows, u * SMOOTH_MAP.cols),
});

const layoutAlong = (m: Layout, s: number, u: number): number =>
  Math.min(1, Math.max(0, m.along.at(s * SMOOTH_MAP.rows, u * SMOOTH_MAP.cols)));

/** The u on row s whose fraction along it is `f`. */
const layoutU = (m: Layout, s: number, f: number): number => {
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (layoutAlong(m, s, mid) < f) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/**
 * The thickness path up to the tip line: its fraction along row s (the design's base,
 * middle and tip line values, the quadratic through them), ending exactly on the tip
 * foil's thickest point at the tip line, so the tip foil lies along it as drawn.
 */
const pathToTipLine = (d: FinDesign, sTip: number): ((s: number) => number) => {
  const way = thicknessPathOf(d);
  const end = way[2] - thicknessPathAt(way, sTip);
  return (s) => thicknessPathAt(way, s) + end * smootherstep(s / sTip);
};

/** Where segment a→b crosses segment c→e: the fraction along c→e, or null. */
const crossAt = (a: P2, b: P2, c: P2, e: P2): number | null => {
  const rx = b.x - a.x;
  const ry = b.y - a.y;
  const sx = e.x - c.x;
  const sy = e.y - c.y;
  const den = rx * sy - ry * sx;
  if (Math.abs(den) < 1e-15) return null;
  const t = ((c.x - a.x) * sy - (c.y - a.y) * sx) / den;
  const u = ((c.x - a.x) * ry - (c.y - a.y) * rx) / den;
  return t >= 0 && t <= 1 && u >= 0 && u <= 1 ? u : null;
};

/**
 * The thickness path carried on past the tip line along its own curve (owner proposal:
 * the same direction and bend it arrives with), traced until it meets the tip edge: its
 * points from the tip line on, and how far along the tip edge (0 → 1) it meets it. A path
 * that never meets it (curling away) is carried on straight; failing that, the middle.
 */
const pathPast = (
  d: FinDesign,
  f: ReturnType<typeof sweepFrame>,
  m: Layout,
): { pts: P2[]; q: number } => {
  const at = pathToTipLine(d, m.sTip);
  const spine = (s: number) => layoutPoint(m, s, layoutU(m, s, at(s)));
  const h = Math.min(0.02, m.sTip / 4);
  const p1 = spine(m.sTip - 2 * h);
  const p2 = spine(m.sTip - h);
  const p3 = spine(m.sTip);
  const l1 = Math.hypot(p2.x - p1.x, p2.y - p1.y) || 1e-9;
  const l2 = Math.hypot(p3.x - p2.x, p3.y - p2.y) || 1e-9;
  const a1 = Math.atan2(p2.y - p1.y, p2.x - p1.x);
  let turn = Math.atan2(p3.y - p2.y, p3.x - p2.x) - a1;
  turn = Math.atan2(Math.sin(turn), Math.cos(turn));
  const bend = turn / ((l1 + l2) / 2);
  const edge = f.tipEdge;
  const n = edge.pts.length - 1;
  const total = edge.cum[n]! || 1;
  const trace = (k: number): { pts: P2[]; q: number } | null => {
    let dir = Math.atan2(p3.y - p2.y, p3.x - p2.x) + (k * l2) / 2;
    const pts: P2[] = [p3];
    let p = p3;
    const absK = Math.abs(k);
    for (let step = 0; step * ARC_STEP < ARC_MAX; step++) {
      // Stop if the arc has curled past half a circle (tight bend looping back inside).
      if (absK * step * ARC_STEP > Math.PI) return null;
      const mid = dir + (k * ARC_STEP) / 2;
      dir += k * ARC_STEP;
      const next = { x: p.x + Math.cos(mid) * ARC_STEP, y: p.y + Math.sin(mid) * ARC_STEP };
      for (let i = 1; i <= n; i++) {
        const u = crossAt(edge.pts[i - 1]!, edge.pts[i]!, p, next);
        if (u === null) continue;
        const hit = { x: p.x + (next.x - p.x) * u, y: p.y + (next.y - p.y) * u };
        const a = edge.pts[i - 1]!;
        const along = edge.cum[i - 1]! + Math.hypot(hit.x - a.x, hit.y - a.y);
        pts.push(hit);
        return { pts, q: along / total };
      }
      pts.push(next);
      p = next;
    }
    return null;
  };
  const found = trace(bend) ?? trace(0);
  if (found) return found;
  const mid = alongPath(edge, 0.5);
  return { pts: [p3, mid], q: 0.5 };
};

/** Steps of the tip edge the tip point is held to for the layout (its rows' closing up). */
const TIP_POINT_STEPS = 400;

/** Layouts kept per outline and tip line: where the path is found, and a few closing up. */
interface Layouts {
  readonly frame: ReturnType<typeof sweepFrame>;
  readonly extremes: readonly P2[];
  readonly first: Layout;
  readonly firstGrid: Grid;
  readonly about: Map<number, Layout>;
  readonly maps: Map<string, SmoothMap>;
}

const layoutCache = new WeakMap<object, Map<string, Layouts>>();

/** Keep a map to its last `n` entries. */
const bounded = <K, V>(m: Map<K, V>, k: K, v: V, n: number): V => {
  m.delete(k);
  m.set(k, v);
  while (m.size > n) m.delete(m.keys().next().value as K);
  return v;
};

/**
 * The design's layout. The elliptic solves are the cost, so they are kept: one per
 * outline and tip line, closing up about the tip edge's middle, which the thickness path
 * is traced on to find where it meets the outline; and the one closing up there, kept by
 * that point held to 1/400 of the tip edge, so editing a foil rarely solves again. The
 * path past the tip line is traced afresh for each design (it is cheap).
 */
export const smoothMap = (d: FinDesign): SmoothMap => {
  const tipKey = d.tipLine ? `${d.tipLine.start},${d.tipLine.end}` : 'default';
  let byLine = layoutCache.get(d.outline);
  if (!byLine) layoutCache.set(d.outline, (byLine = new Map()));
  let kept = byLine.get(tipKey);
  if (!kept) {
    const frame = sweepFrame(d);
    const extremes = outlineExtremes(d.outline);
    const { layout: first, grid: firstGrid } = layoutAbout(d, frame, 0.5, extremes);
    kept = bounded(
      byLine,
      tipKey,
      {
        frame,
        extremes,
        first,
        firstGrid,
        about: new Map([[0.5, first]]),
        maps: new Map(),
      },
      4,
    );
  }
  const way = thicknessPathOf(d);
  const wayKey = way.join(',');
  const hit = kept.maps.get(wayKey);
  if (hit) return hit;
  const f = kept.frame;
  // The thickness path carried on along its own curve, traced once, on the layout closing
  // up about the tip edge's middle: it fixes where the path meets the outline (the tip
  // point) and the path's shape past the tip line. Traced again on the layout closing up at
  // that point, it wouldn't settle: where the rows close up tilts the rows just under the
  // tip line, and with them the path's direction there (each pass moved the twin fin's tip
  // point a further 5% of its tip edge).
  const margin = TIP_TOP / 2 + 0.02;
  const past = pathPast(d, f, kept.first);
  const q =
    Math.round(Math.min(1 - margin, Math.max(margin, past.q)) * TIP_POINT_STEPS) / TIP_POINT_STEPS;
  const layout =
    kept.about.get(q) ??
    bounded(kept.about, q, layoutAbout(d, f, q, kept.extremes, kept.firstGrid).layout, 4);
  // Past the tip line the path is the traced curve itself: where it crosses each row,
  // straight from end to end there (layoutAbout), as a fraction along the row. Onto the
  // middle of the last row at the very end, where the rows close up about the tip point.
  const { sTip } = layout;
  const line =
    past.pts.length <= 201
      ? past.pts
      : (() => {
          const traced = polyline(past.pts);
          return Array.from({ length: 201 }, (_, k) => alongPath(traced, k / 200));
        })();
  const fractions = new Float64Array(PAST_ROWS + 1);
  const below = pathToTipLine(d, sTip);
  let last = below(sTip);
  fractions[0] = last;
  const ROW_SAMPLES = 64;
  let lineStart = 1;
  const findCross = (row: readonly P2[], from: number, to: number): [number, number] | null => {
    for (let i = from; i < to; i++) {
      const a = line[i - 1]!;
      const b = line[i]!;
      for (let j = 1; j < row.length; j++) {
        const u = crossAt(a, b, row[j - 1]!, row[j]!);
        if (u !== null) return [(j - 1 + u) / ROW_SAMPLES, i];
      }
    }
    return null;
  };
  for (let k = 1; k <= PAST_ROWS; k++) {
    const s = sTip + ((1 - sTip) * k) / PAST_ROWS;
    // The row as it is (still easing from the solve's just past the tip line).
    const row = Array.from({ length: ROW_SAMPLES + 1 }, (_, j) =>
      layoutPoint(layout, s, j / ROW_SAMPLES),
    );
    const found =
      findCross(row, lineStart, line.length) ??
      (lineStart > 1 ? findCross(row, 1, lineStart) : null);
    if (found !== null) {
      last = layoutAlong(layout, s, found[0]);
      lineStart = Math.max(1, found[1] - 2);
    }
    // Eased in from the path's own way on over the first half, as it arrives on this
    // layout a little differently from the one it was traced on (eased over a quarter, it
    // still creased the centre fin): a corner there creased the foils laid on it. Onto the
    // middle of the last row at the very end, where the rows
    // close up about the tip point.
    const t = k / PAST_ROWS;
    const own = below(s);
    const onto = own + (last - own) * smootherstep(t / 0.5);
    fractions[k] = onto + (0.5 - onto) * smootherstep((t - 0.9) / 0.1);
  }
  return bounded(
    kept.maps,
    wayKey,
    { ...layout, tipPoint: alongPath(f.tipEdge, q), pastPath: spline1(fractions) },
    8,
  );
};

/** 0 → 1 with flat ends: 6t⁵ − 15t⁴ + 10t³, its first two derivatives 0 at both. */
const smootherstep = (t: number): number => {
  const c = Math.min(1, Math.max(0, t));
  return c * c * c * (c * (c * 6 - 15) + 10);
};

/**
 * The foil fraction read at fraction `x` along a row thickest at `p`, for a foil
 * thickest at `a`: x / (x + λ(1 − x)), with λ putting a at p. Rising, smooth, 0 and 1 at
 * the ends, with a finite slope there (1/λ and λ), so a round nose stays round.
 */
export const foilWarp = (x: number, p: number, a: number): number => {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const lam = (p * (1 - a)) / (a * (1 - p));
  return x / (x + lam * (1 - x));
};

/** A foil read as fractions of its thickest, and its share of the minimum on the outside. */
interface EndFoil {
  readonly sec: FinSection;
  readonly at: number;
  readonly thickness: number;
  readonly share: number;
}

const endFoil = (sec: FinSection): EndFoil => {
  const t = sectionThickest(sec);
  return { sec, at: t.at, thickness: t.thickness, share: sec.inside === null ? 0.5 : 1 };
};

/** The smooth blade of a design (see the file comment). */
export interface SmoothBlade {
  readonly blade: PreparedBlade;
  readonly map: SmoothMap;
  /** The row (s) that is the tip line. */
  readonly sTip: number;
  /** The profile point at (s, u) (tab frame, cm). */
  point(s: number, u: number): P2;
  /** The faces' offsets from the blade's middle plane at (s, u) (cm, + outward), before cant and toe. */
  offsets(s: number, u: number): [number, number];
  /** The two faces at (s, u), in the fin frame (blade.ts), cant and toe applied. */
  faces(s: number, u: number): { outside: Vert3; inside: Vert3 };
  /**
   * The foil on row s, `along` of the way along it: its faces as fractions of the row's
   * thickest, control sections included; and its share of the minimum on the outside.
   */
  foil(s: number, along: number): [number, number, number];
  /** How thick (cm) row s is at its thickest, less the minimum. */
  scale(s: number): number;
  /** How far along the fin row s is, by the thickness path's length: 0 base, 1 tip edge. */
  eta(s: number): number;
  /** The same in cm from the base. */
  alongFin(s: number): number;
  /** Where the thickness path crosses row s, on the profile. */
  spine(s: number): P2;
  /** Where the thickness path crosses row s, as a fraction along it. */
  path(s: number): number;
  /** The nearest place on the layout to a profile point; `hint` a place to start from. */
  nearest(x: number, z: number, hint?: { s: number; u: number } | null): { s: number; u: number };
}

const bladeCache = new WeakMap<PreparedBlade, SmoothBlade>();

const designCache = new WeakMap<FinDesign, SmoothBlade>();

/**
 * The smooth blade of a design. The finished blade (no laminate, the design minimum) is
 * kept per design: the editor's guides and readouts ask for it after every edit.
 */
export const smoothBlade = (
  d: FinDesign,
  laminate: FinLaminate = NO_LAMINATE,
  minThickness: number = FIN_MIN_THICKNESS,
): SmoothBlade => {
  const plain = laminate === NO_LAMINATE && minThickness === FIN_MIN_THICKNESS;
  const hit = plain ? designCache.get(d) : undefined;
  if (hit) return hit;
  const sb = smoothBladeOf(prepareBlade(d, laminate, minThickness));
  if (plain) designCache.set(d, sb);
  return sb;
};

export const smoothBladeOf = (b: PreparedBlade): SmoothBlade => {
  const hit = bladeCache.get(b);
  if (hit) return hit;
  const d = b.design;
  const map = smoothMap(d);
  const { rows, cols } = SMOOTH_MAP;
  const point = (s: number, u: number): P2 => ({
    x: map.x.at(s * rows, u * cols),
    y: map.z.at(s * rows, u * cols),
  });
  const alongAt = (s: number, u: number) =>
    Math.min(1, Math.max(0, map.along.at(s * rows, u * cols)));
  const { sTip } = map;
  // The path, ending exactly on the tip foil's thickest point at the tip line, so the tip
  // foil lies along it as drawn; beyond, carried on along its own curve to the tip point,
  // where the rows close up (owner proposal), so the tip foil follows it there.
  const below = pathToTipLine(d, sTip);
  const pathAt = (s: number) =>
    s <= sTip ? below(s) : map.pastPath.at(((s - sTip) / (1 - sTip)) * PAST_ROWS);
  /** The u on row s whose fraction along it is `f`. */
  const uAlong = (s: number, f: number): number => {
    let lo = 0;
    let hi = 1;
    for (let k = 0; k < 50; k++) {
      const mid = (lo + hi) / 2;
      if (alongAt(s, mid) < f) lo = mid;
      else hi = mid;
    }
    return (lo + hi) / 2;
  };
  // The thickness path on the profile: its length from the base (η).
  const spine = Array.from({ length: SPINE_SAMPLES + 1 }, (_, k) => {
    const s = k / SPINE_SAMPLES;
    return point(s, uAlong(s, pathAt(s)));
  });
  const run = new Float64Array(SPINE_SAMPLES + 1);
  for (let k = 1; k <= SPINE_SAMPLES; k++) {
    run[k] = run[k - 1]! + Math.hypot(spine[k]!.x - spine[k - 1]!.x, spine[k]!.y - spine[k - 1]!.y);
  }
  const total = run[SPINE_SAMPLES]! || 1;
  const eta = spline1(Array.from(run, (r) => r / total));
  const base = endFoil(d.section);
  const tip = endFoil(tipFoilOf(d));
  const m = b.minThickness;
  const read = (f: EndFoil, along: number, p: number): [number, number] => {
    if (!(f.thickness > 0)) return [0, 0];
    const [o, n] = sectionShapeAt(f.sec, foilWarp(along, p, f.at));
    return [o / f.thickness, n / f.thickness];
  };
  /**
   * The fin without control sections at row s, `along` of the way along it: its faces as
   * fractions of the row's thickest, and its share of the minimum on the outside.
   */
  const bare = (s: number, along: number): [number, number, number] => {
    const p = pathAt(s);
    const w = smootherstep(s / sTip);
    const [oa, na] = read(base, along, p);
    const share = base.share + (tip.share - base.share) * w;
    if (tip.sec === base.sec || !(w > 0)) return [oa, na, share];
    const [ob, nb] = read(tip, along, p);
    return [oa + (ob - oa) * w, na + (nb - na) * w, share];
  };
  // Control sections (stage 3): each a row, its height the fraction of the way to the tip line. Kept as
  // its difference to the bare fin on its row, along the row, laid in full on its row and
  // eased out over FIN_SLICE_REACH either side, or blended into the next section's where
  // they are closer: so its row is its foil exactly, and one added as the fin's own foil
  // there changes nothing.
  const sections = d.slices.map((sl) => {
    const t = sectionThickest(sl.section);
    return {
      s: sl.height * sTip,
      sec: sl.section,
      thickness: t.thickness,
      share: sl.section.inside === null ? 0.5 : 1,
    };
  });
  /** Section k's difference to the bare fin on its row at `along`, and to its share. */
  const diff = (k: number, along: number): [number, number, number] => {
    const c = sections[k]!;
    if (!(c.thickness > 0)) return [0, 0, 0];
    const [o, n] = sectionShapeAt(c.sec, along);
    const [bo, bn, bs] = bare(c.s, along);
    return [o / c.thickness - bo, n / c.thickness - bn, c.share - bs];
  };
  /** The sections that shape row s, and how much each: as blade.ts's sliceWeight, by s. */
  const weights = (s: number): [number, number][] => {
    const n = sections.length;
    if (n === 0) return [];
    let k = 0;
    while (k < n - 1 && s >= sections[k + 1]!.s) k++;
    const sk = sections[k]!.s;
    const parts: [number, number][] =
      k === n - 1 || s <= sk
        ? [[k, 1]]
        : (() => {
            const w = smootherstep((s - sk) / (sections[k + 1]!.s - sk));
            return [
              [k, 1 - w],
              [k + 1, w],
            ];
          })();
    // How much the sections count here: all of it between two close enough for their
    // reaches to meet, else easing out over the reach (to the base below, the tip line above).
    let j = -1;
    while (j < n - 1 && sections[j + 1]!.s <= s) j++;
    const lo = j >= 0 ? sections[j]!.s : null;
    const hi = j < n - 1 ? sections[j + 1]!.s : null;
    let all = 0;
    if (lo !== null && hi !== null && hi - lo <= 2 * FIN_SLICE_REACH) all = 1;
    else {
      if (lo !== null) {
        // Gone by the tip line, so the tip foil lies along it as drawn.
        const reach = Math.min(FIN_SLICE_REACH, sTip - lo);
        all = Math.max(all, 1 - smootherstep((s - lo) / reach));
      }
      if (hi !== null) {
        const reach = Math.min(FIN_SLICE_REACH, hi);
        all = Math.max(all, smootherstep(1 - (hi - s) / reach));
      }
    }
    return all > 0 ? parts.map(([i, w]) => [i, w * all]) : [];
  };
  const taperAt = (e: number) => yAtX(d.taper, Math.min(1, Math.max(0, e)));
  const foil = (s: number, along: number): [number, number, number] => {
    let [o, n, share] = bare(s, along);
    for (const [k, w] of weights(s)) {
      const [dO, dN, dS] = diff(k, along);
      o += dO * w;
      n += dN * w;
      share += dS * w;
    }
    return [o, n, share];
  };
  const etaAt = (s: number) => eta.at(s * SPINE_SAMPLES);
  /** The thickness curve less the minimum, η along the fin. */
  const curve = (e: number) => Math.max(0, taperAt(e) - m);
  // The thickness: the curve read along the fin (η), to the tip point. Past the tip line
  // the rows close up to the tip point, the tip foil along them shrinking with them (owner
  // proposal), and no row is thicker for its length than the tip foil on the tip line
  // (owner request: the rows near the point stayed as thick as the curve said while their
  // length went to nothing, a blunt nub there). Where that cap is under the curve, the
  // thickness is the curve times h(ρ) = ρ + ρ²(1 − ρ), ρ the cap over the curve: h is 1,
  // flat, at ρ = 1 and follows the cap (slope 1) as ρ falls to 0, so the curve gives way
  // to the cap without a crease, and the tip line, where the cap is the curve, is as drawn.
  const rowLength = (s: number): number => {
    let len = 0;
    let prev = point(s, 0);
    for (let j = 1; j <= 64; j++) {
      const q = point(s, j / 64);
      len += Math.hypot(q.x - prev.x, q.y - prev.y);
      prev = q;
    }
    return len;
  };
  const pastLength = spline1(
    Array.from({ length: PAST_ROWS + 1 }, (_, k) => rowLength(sTip + ((1 - sTip) * k) / PAST_ROWS)),
  );
  const tipLength = rowLength(sTip);
  const tipAspect = tipLength > 0 ? curve(etaAt(sTip)) / tipLength : 0;
  const scale = (s: number): number => {
    const c = curve(etaAt(s));
    if (s <= sTip || !(c > 0)) return c;
    const cap = tipAspect * pastLength.at(((s - sTip) / (1 - sTip)) * PAST_ROWS);
    const r = cap / c;
    if (r >= 1) return c;
    const q = Math.max(0, r);
    return c * (q + q * q * (1 - q));
  };
  // Near the tip point the row's thickness and the foil toward the row's ends both close to
  // the minimum. Multiplied, they closed quadratically there, easing onto it: a concave neck
  // under the outline (owner testing, rmtest.json: an upright cut 145 mm back). So past the
  // tip line they are combined as the nearer closing, 1/g = 1/f + 1/r − 1: f the foil's share
  // of its thickest, r the row's thickness as a share of how it would carry on from the tip
  // line (the same value and slope there, falling exponentially). That is f on the tip line
  // (r = 1), so the tip foil lies there as drawn, and r on the thickness path (f = 1), so the
  // row is as thick as `scale` there; r's slope is 0 at the tip line, so no crease.
  const t0 = scale(sTip);
  const ds = 1e-4;
  const fall = t0 > 0 ? (scale(sTip) - scale(sTip - ds)) / ds / t0 : 0;
  const carried = (s: number) => t0 * Math.exp(fall * (s - sTip));
  /** The factor on the foil's faces at row s where the foil is `f` of its thickest. */
  const faceScale = (s: number, f: number): number => {
    const k = scale(s);
    if (s <= sTip || !(t0 > 0)) return k;
    const c = carried(s);
    const r = k / c;
    if (r >= 1) return k;
    if (!(r > 0)) return 0;
    if (!(f > 0)) return c;
    // g / f, so the faces keep the foil's shape at its thickest and close as the nearer one.
    return (c * r) / (f + r - f * r);
  };
  const offsets = (s: number, u: number): [number, number] => {
    const [o, n, share] = foil(s, alongAt(s, u));
    const k = faceScale(s, o - n);
    let out = o * k + m * share;
    let ins = n * k - m * (1 - share);
    const { outside: lamOut, inside: lamIn } = b.laminate;
    const lam = lamOut + lamIn;
    if (lam > 0) {
      // The core, as blade.ts builds it: each face in by its laminate, the face with less
      // laminate making up any shortfall under the minimum.
      const short = Math.max(0, m - (out - ins - lam));
      out += short * (lamIn / lam) - lamOut;
      ins += lamIn - short * (lamOut / lam);
    }
    return [out, ins];
  };
  // Cant and toe, by height alone (cant lines), so a bend runs level, along the flow. Each
  // point slides out by the lean summed up from the base, and each cant line's toe turns
  // everything above it about an upright axis through the thickness path at its height.
  const twisted = hasTwist(d);
  const lines = d.cantLines ?? [];
  const twist = (z: number) => twistAt(d, b.depth > 0 ? Math.max(0, z / b.depth) : 0);
  let slide = (z: number) => z * b.lean;
  let widen = (_z: number) => b.widen;
  if (twisted) {
    const N = 512;
    const dz = b.depth / N;
    const lean = (z: number) => Math.tan(twist(z).cant * DEG_TO_RAD);
    const table = new Float64Array(N + 1);
    for (let i = 1; i <= N; i++) {
      const z0 = (i - 1) * dz;
      table[i] = table[i - 1]! + (dz / 6) * (lean(z0) + 4 * lean(z0 + dz / 2) + lean(z0 + dz));
    }
    const spl = spline1(table);
    slide = (z) => spl.at((Math.max(0, z) / b.depth) * N);
    widen = (z) => 1 / Math.cos(twist(z).cant * DEG_TO_RAD);
  }
  const spineZ = spline1(spine.map((q) => q.y));
  const spineX = spline1(spine.map((q) => q.x));
  /** Each cant line's upright axis, where the thickness path first reaches its height. */
  const axes = lines.map((l, i) => {
    const h = l.height * b.depth;
    let x = spine[spine.length - 1]!.x;
    for (let k = 1; k <= SPINE_SAMPLES; k++) {
      const [p, q] = [spine[k - 1]!, spine[k]!];
      if (q.y >= h) {
        x = p.x + ((q.x - p.x) * (h - p.y)) / (q.y - p.y || 1);
        break;
      }
    }
    const before = i > 0 ? lines[i - 1]!.toe : (d.toe ?? 0);
    return { x, turn: l.toe - before, height: l.height, reach: cantLineReach(d, i) };
  });
  const turn = toeTurn(b);
  const place = (x0: number, z: number, offset: number): Vert3 => {
    let x = x0;
    let y = b.outward * (slide(z) + offset * widen(z));
    const eta = b.depth > 0 ? z / b.depth : 0;
    for (const axis of axes) {
      if (!(axis.turn && eta > axis.height)) continue;
      const a =
        -b.outward * axis.turn * DEG_TO_RAD * smootherstep((eta - axis.height) / axis.reach);
      const py = b.outward * slide(z);
      const dx = x - axis.x;
      const dy = y - py;
      x = axis.x + dx * Math.cos(a) - dy * Math.sin(a);
      y = py + dx * Math.sin(a) + dy * Math.cos(a);
    }
    if (!turn) return { x, y, z };
    const dx = x - turn.x;
    const dy = y - turn.y;
    return {
      x: turn.x + dx * turn.cos - dy * turn.sin,
      y: turn.y + dx * turn.sin + dy * turn.cos,
      z,
    };
  };
  const smooth: SmoothBlade = {
    blade: b,
    map,
    sTip,
    point,
    offsets,
    foil,
    scale,
    eta: etaAt,
    alongFin: (s) => etaAt(s) * total,
    path: pathAt,
    spine: (s) => ({
      x: spineX.at(s * SPINE_SAMPLES),
      y: spineZ.at(s * SPINE_SAMPLES),
    }),
    nearest: (x, z, hint) => nearestOnMap(map, x, z, hint),
    faces: (s, u) => {
      const p = point(s, u);
      const [o, n] = offsets(s, u);
      return { outside: place(p.x, p.y, o), inside: place(p.x, p.y, n) };
    },
  };
  bladeCache.set(b, smooth);
  return smooth;
};

/** Row s of the design's smooth blade on the profile (tab frame, cm), `n` + 1 points edge to edge. */
export const smoothRowLine = (d: FinDesign, s: number, n = 64): P2[] => {
  const map = smoothMap(d);
  const { rows, cols } = SMOOTH_MAP;
  return Array.from({ length: n + 1 }, (_, j) => ({
    x: map.x.at(s * rows, (j / n) * cols),
    y: map.z.at(s * rows, (j / n) * cols),
  }));
};

/** The map's points at its grid nodes, for the search for a profile point's place. */
const nodesCache = new WeakMap<SmoothMap, Float64Array>();

const mapNodes = (map: SmoothMap): Float64Array => {
  let n = nodesCache.get(map);
  if (n) return n;
  const { rows, cols } = SMOOTH_MAP;
  n = new Float64Array(2 * (rows + 1) * (cols + 1));
  let k = 0;
  for (let i = 0; i <= rows; i++) {
    for (let j = 0; j <= cols; j++) {
      n[k++] = map.x.at(i, j);
      n[k++] = map.z.at(i, j);
    }
  }
  nodesCache.set(map, n);
  return n;
};

/** Newton's method on the layout from (s, u), kept on it; and how far off it ends (cm). */
const newtonOnMap = (map: SmoothMap, x: number, z: number, s0: number, u0: number) => {
  const { rows, cols } = SMOOTH_MAP;
  const px = (s: number, u: number) => map.x.at(s * rows, u * cols);
  const pz = (s: number, u: number) => map.z.at(s * rows, u * cols);
  let s = s0;
  let u = u0;
  const e = 1e-6;
  for (let it = 0; it < 30; it++) {
    const fx = px(s, u) - x;
    const fz = pz(s, u) - z;
    const a = (px(s + e, u) - px(s, u)) / e;
    const b = (px(s, u + e) - px(s, u)) / e;
    const c = (pz(s + e, u) - pz(s, u)) / e;
    const dd = (pz(s, u + e) - pz(s, u)) / e;
    const det = a * dd - b * c;
    if (!(Math.abs(det) > 1e-18)) break;
    const ds = (dd * fx - b * fz) / det;
    const du = (a * fz - c * fx) / det;
    s = Math.min(1, Math.max(0, s - ds));
    u = Math.min(1, Math.max(0, u - du));
    if (Math.abs(ds) + Math.abs(du) < 1e-12) break;
  }
  return { s, u, miss: Math.hypot(px(s, u) - x, pz(s, u) - z) };
};

const nearestOnMap = (
  map: SmoothMap,
  x: number,
  z: number,
  hint?: { s: number; u: number } | null,
): { s: number; u: number; miss: number } => {
  if (hint) {
    const near = newtonOnMap(map, x, z, hint.s, hint.u);
    if (near.miss < 1e-6) return near;
  }
  const { rows, cols } = SMOOTH_MAP;
  const n = mapNodes(map);
  let best = 0;
  let dist = Infinity;
  for (let k = 0; k < n.length; k += 2) {
    const dd = (n[k]! - x) ** 2 + (n[k + 1]! - z) ** 2;
    if (dd < dist) [dist, best] = [dd, k / 2];
  }
  const w = cols + 1;
  return newtonOnMap(map, x, z, Math.floor(best / w) / rows, (best % w) / cols);
};

/** Where on the layout a profile point is, (s, u); null off the blade (over 1 mm away). */
export const smoothLocate = (
  d: FinDesign,
  x: number,
  z: number,
): { s: number; u: number } | null => {
  const at = nearestOnMap(smoothMap(d), x, z);
  return at.miss <= 0.1 ? { s: at.s, u: at.u } : null;
};

/**
 * Cant lines for the cant and toe changes old files kept on their control sections: each a
 * line low enough to reach its section's cant where the section's row crosses the
 * thickness path. Lines too close to the one below are left out.
 */
export const cantLinesFromSections = (
  d: FinDesign,
  changes: readonly { readonly height: number; readonly cant: number; readonly toe: number }[],
): FinCantLine[] => {
  const sb = smoothBlade(d);
  const depth = sb.blade.depth || 1;
  const out: FinCantLine[] = [];
  const wanted = changes
    .map((c) => ({
      ...c,
      height: Math.max(
        FIN_SLICE_MIN_GAP,
        Math.min(1 - FIN_SLICE_MIN_GAP, sb.spine(c.height * sb.sTip).y / depth - FIN_SLICE_REACH),
      ),
    }))
    .sort((p, q) => p.height - q.height);
  for (const c of wanted) {
    const below = out[out.length - 1]?.height ?? 0;
    if (c.height >= below + FIN_SLICE_MIN_GAP) out.push(c);
  }
  return out;
};

/** The row (s) of a control section at `height`, the fraction of the way to the tip line. */
export const smoothSectionRow = (d: FinDesign, height: number): number =>
  height * smoothMap(d).sTip;

/** The control-section height of row s: above 1 past the tip line. */
export const smoothSectionHeight = (d: FinDesign, s: number): number => s / smoothMap(d).sTip;

/** The length (cm) of row s, and how thick it is at its thickest there: a foil's true size. */
export const smoothRowSize = (d: FinDesign, s: number): { chord: number; thickness: number } => {
  const sb = smoothBlade(d);
  let chord = 0;
  let prev = sb.point(s, 0);
  for (let k = 1; k <= 200; k++) {
    const q = sb.point(s, k / 200);
    chord += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  return { chord, thickness: sb.scale(s) + sb.blade.minThickness };
};

/** A control section's distance along the fin from the base (cm), what it is labelled by. */
export const smoothSectionDistance = (d: FinDesign, height: number): number =>
  smoothBlade(d).alongFin(smoothSectionRow(d, height));

/** How far along the fin row s is (smoothBlade's eta), and back: the row at η. */
export const smoothEta = (d: FinDesign, s: number): number => smoothBlade(d).eta(s);

export const smoothRowAtEta = (d: FinDesign, eta: number): number => {
  const sb = smoothBlade(d);
  let lo = 0;
  let hi = 1;
  for (let k = 0; k < 50; k++) {
    const mid = (lo + hi) / 2;
    if (sb.eta(mid) < eta) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** Chord stations a row's foil is sampled at to fit it (smoothFoilAt). */
const ROW_FOIL_STATIONS = (): number[] => cosineStations(200);

/**
 * The foil on the row of a control section at `height` of the way to the tip line, as one there starts (owner's rules:
 * adding one changes nothing until it is edited): its faces in chords of the row's length,
 * less the minimum thickness, fitted with as few points as follow them (blade.ts fitFoil).
 */
export const smoothFoilAt = (d: FinDesign, height: number): FinSection => {
  const sb = smoothBlade(d);
  const s = height * sb.sTip;
  let length = 0;
  let prev = sb.point(s, 0);
  for (let k = 1; k <= 400; k++) {
    const q = sb.point(s, k / 400);
    length += Math.hypot(q.x - prev.x, q.y - prev.y);
    prev = q;
  }
  const k = sb.scale(s) / (length || 1);
  const stations = ROW_FOIL_STATIONS();
  const out: number[] = [];
  const ins: number[] = [];
  for (const x of stations) {
    const [o, n] = sb.foil(s, x);
    out.push(o * k);
    ins.push(n * k);
  }
  const symmetric = [d.section, tipFoilOf(d), ...d.slices.map((sl) => sl.section)].every(
    (sec) => sec.inside === null,
  );
  return fitFoil(stations, out, ins, symmetric);
};

/** How far in from each side (s and u) the smoothness gate's sampler starts: the edges left out. */
const GATE_EDGE = 0.06;
const GATE_TOP = 0.03;

/**
 * The smooth blade's sampler for the smoothness gate (fairness.ts): rows evenly up the fin
 * to just short of the tip edge, columns evenly across short of the edges.
 */
export const smoothSampler =
  (d: FinDesign) =>
  (rows: number, cols: number): { outside: Vert3[][]; inside: Vert3[][] } => {
    const sb = smoothBlade(d);
    const outside: Vert3[][] = [];
    const inside: Vert3[][] = [];
    for (let i = 0; i <= rows; i++) {
      const s = ((1 - GATE_TOP) * i) / rows;
      const o: Vert3[] = [];
      const n: Vert3[] = [];
      for (let j = 0; j <= cols; j++) {
        const f = sb.faces(s, GATE_EDGE + ((1 - 2 * GATE_EDGE) * j) / cols);
        o.push(f.outside);
        n.push(f.inside);
      }
      outside.push(o);
      inside.push(n);
    }
    return { outside, inside };
  };
