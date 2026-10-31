// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The swept loft (owner proposal, 2026-10): how thick the blade is, everywhere on its
 * side profile, built the way a fin foiler sees it rather than from horizontal sections.
 *
 * The outline is split into four sides:
 * - the **base** (foil sweep start): the root on the tab top, plus a raised rear's
 *   underside when the fin has one ({@link findRaisedRear});
 * - the **leading edge**, from its root up to the tip line;
 * - the **tip line** (foil sweep end), straight across between two points on the
 *   outline ({@link FinDesign.tipLine}, or {@link defaultTipLine});
 * - the **trailing edge**, from the tip line down to its root (or a raised rear's corner).
 *
 * Between base and tip line run the sweep's sections, each from the leading edge to the
 * trailing edge at the same fraction of each edge's length, turning gradually from the
 * base to the tip line: a Coons patch over the four sides, relaxed so a corner in a side
 * fades within a few sections rather than running across the blade. The base foil is
 * laid along each section by length, stretched so its thickest point is on the
 * thickness path ({@link FinDesign.thicknessPath}), and as thick there as the taper says
 * at that height. Past the tip line the tip foil thins on a convex (parabolic) curve to
 * the minimum at the tip edge.
 *
 * blade.ts reads this as a thickness field over the profile and cuts it horizontally into
 * the sections the mesh and the STEP surface are built from. Each sweep section meets
 * both edges across, not at a glancing angle, so no edge needs smoothing.
 */
import { value, xDeriv, xDeriv2, yDeriv, yDeriv2 } from '../bezier-curve';
import type { Spline } from '../bezier-spline';
import { vec2, type Vec2 } from '../vec2';
import {
  FIN_THICKNESS_PATH_LIMITS,
  type FinDesign,
  type FinThicknessPath,
  type FinTipLine,
} from './fin-design';
import { findRaisedRear } from './raised-rear';

/** A polyline with its running length, read by fraction of that length. */
interface Path {
  readonly pts: readonly Vec2[];
  readonly cum: Float64Array;
}

const pathOf = (pts: readonly Vec2[]): Path => {
  const cum = new Float64Array(pts.length);
  for (let i = 1; i < pts.length; i++) {
    cum[i] = cum[i - 1]! + Math.hypot(pts[i]!.x - pts[i - 1]!.x, pts[i]!.y - pts[i - 1]!.y);
  }
  return { pts, cum };
};

/** The point `f` of the way along a path by length. */
const along = (p: Path, f: number): Vec2 => {
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
  return vec2(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t);
};

/** Samples per outline segment: fine enough that the polyline is the curve to a micron. */
const OUTLINE_SAMPLES = 400;

interface OutlineSamples {
  readonly pts: readonly Vec2[];
  /** Radius of curvature at each (cm), Infinity where straight. */
  readonly radius: Float64Array;
  /** Running length, as a fraction of the whole outline. */
  readonly frac: Float64Array;
}

const samplesCache = new WeakMap<Spline, OutlineSamples>();

/** The outline, densely sampled from the leading-edge root to the trailing-edge root. */
const sampleOutline = (outline: Spline): OutlineSamples => {
  const hit = samplesCache.get(outline);
  if (hit) return hit;
  const pts: Vec2[] = [];
  const radius: number[] = [];
  outline.coeffs.forEach((k, seg) => {
    for (let j = seg === 0 ? 0 : 1; j <= OUTLINE_SAMPLES; j++) {
      const t = j / OUTLINE_SAMPLES;
      const dx = xDeriv(k, t);
      const dy = yDeriv(k, t);
      const cross = dx * yDeriv2(k, t) - dy * xDeriv2(k, t);
      const speed = Math.hypot(dx, dy);
      pts.push(value(k, t));
      radius.push(Math.abs(cross) > 1e-12 ? (speed * speed * speed) / Math.abs(cross) : Infinity);
    }
  });
  const { cum } = pathOf(pts);
  const total = cum[cum.length - 1]! || 1;
  const s = { pts, radius: Float64Array.from(radius), frac: cum.map((c) => c / total) };
  samplesCache.set(outline, s);
  return s;
};

/** The sample nearest a fraction of the outline's length. */
const indexAtFraction = (s: OutlineSamples, f: number): number => {
  let lo = 0;
  let hi = s.frac.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (s.frac[mid]! <= f) lo = mid;
    else hi = mid;
  }
  return f - s.frac[lo]! <= s.frac[hi]! - f ? lo : hi;
};

/** The point a fraction of the way along the outline by length. */
export const outlineAtFraction = (outline: Spline, f: number): Vec2 => {
  const s = sampleOutline(outline);
  return s.pts[indexAtFraction(s, f)]!;
};

/** The fraction of the outline's length nearest a point (the closest sample's). */
export const outlineFractionNear = (outline: Spline, p: Vec2): number => {
  const s = sampleOutline(outline);
  let best = 0;
  let dist = Infinity;
  s.pts.forEach((q, i) => {
    const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < dist) [dist, best] = [dd, i];
  });
  return s.frac[best]!;
};

/**
 * Where the tip starts on each edge, as a fraction of the fin's depth: walked down each
 * edge from the tip's furthest point, the tip line sits where the outline first curves
 * more gently than this radius. "Where the front and rear curve radii start to
 * diminish", going up.
 */
export const FIN_TIP_RADIUS = 0.2;

/** Samples the tip line's ends keep from the tip's furthest point along each edge, at least. */
const TIP_MIN_SAMPLES = 8;

/** The tip's furthest point along the rake, as a sample index. */
const tipApex = (s: OutlineSamples): number => {
  const { pts } = s;
  // From the middle of the root toward the highest point. A hooked tip curls past the
  // highest point, and this finds the curl.
  const first = pts[0]!;
  const last = pts[pts.length - 1]!;
  let high = 0;
  for (let i = 1; i < pts.length; i++) if (pts[i]!.y > pts[high]!.y) high = i;
  const rx = pts[high]!.x - (first.x + last.x) / 2;
  const ry = pts[high]!.y - (first.y + last.y) / 2;
  let top = high;
  let best = -Infinity;
  pts.forEach((p, i) => {
    const a = p.x * rx + p.y * ry;
    if (a > best) [best, top] = [a, i];
  });
  return top;
};

/** The tip line's ends as sample indices, from the design's tip line or the default. */
const tipLineIndices = (d: FinDesign, s: OutlineSamples): [number, number] => {
  const n = s.pts.length;
  if (d.tipLine) {
    const a = Math.min(n - 3, Math.max(1, indexAtFraction(s, d.tipLine.start)));
    const b = Math.min(n - 2, Math.max(a + 1, indexAtFraction(s, d.tipLine.end)));
    return [a, b];
  }
  const top = tipApex(s);
  const r = FIN_TIP_RADIUS * Math.max(...s.pts.map((p) => p.y));
  // Gentle for a run of samples, not one: an inflection is momentarily straight.
  const run = OUTLINE_SAMPLES / 20;
  const walk = (dir: 1 | -1): number => {
    let gentle = 0;
    for (let i = top + dir * TIP_MIN_SAMPLES; i > 0 && i < n - 1; i += dir) {
      gentle = s.radius[i]! >= r ? gentle + 1 : 0;
      if (gentle >= run) return i - dir * (run - 1);
    }
    return Math.min(n - 2, Math.max(1, top + dir * TIP_MIN_SAMPLES));
  };
  return [walk(-1), walk(1)];
};

/** The tip line's ends as fractions of the outline: the design's, or the default. */
export const tipLineOf = (d: FinDesign): FinTipLine => {
  const s = sampleOutline(d.outline);
  const [a, b] = tipLineIndices(d, s);
  return { start: s.frac[a]!, end: s.frac[b]! };
};

/** The default tip line's ends (tab frame, cm): leading-edge side, trailing-edge side. */
export const defaultTipLine = (d: FinDesign): [Vec2, Vec2] => {
  const s = sampleOutline(d.outline);
  const [a, b] = tipLineIndices({ ...d, tipLine: undefined }, s);
  return [s.pts[a]!, s.pts[b]!];
};

/**
 * The tip's furthest point as a fraction of the outline: a tip line's two ends stay
 * either side of it (fin-edits.ts).
 */
export const tipApexFraction = (outline: Spline): number => {
  const s = sampleOutline(outline);
  return s.frac[tipApex(s)]!;
};

/** The four sides of the sweep and the tip edge beyond it (tab frame, cm). */
export interface SweepFrame {
  /** Leading-edge root to the trailing edge's foot: the root, then any raised rear's underside. */
  readonly base: Path;
  /** Leading-edge root up to the tip line. */
  readonly leading: Path;
  /** The trailing edge's foot (its root, or a raised rear's corner) up to the tip line. */
  readonly trailing: Path;
  /** The tip edge, from the tip line's leading-edge end round to its trailing-edge end. */
  readonly tipEdge: Path;
  readonly tipStart: Vec2;
  readonly tipEnd: Vec2;
}

export const sweepFrame = (d: FinDesign): SweepFrame => {
  const s = sampleOutline(d.outline);
  const pts = s.pts;
  const [iS, iE] = tipLineIndices(d, s);
  const last = pts.length - 1;
  // A raised rear's underside belongs to the base: the trailing edge starts at its corner.
  const rear = findRaisedRear(d.outline);
  let iC = last;
  if (rear) {
    let best = Infinity;
    for (let i = iE; i <= last; i++) {
      const dd = Math.hypot(pts[i]!.x - rear.cornerX, pts[i]!.y - rear.cornerZ);
      if (dd < best) [best, iC] = [dd, i];
    }
  }
  return {
    base: pathOf([pts[0]!, ...pts.slice(iC).reverse()]),
    leading: pathOf(pts.slice(0, iS + 1)),
    trailing: pathOf(pts.slice(iE, iC + 1).reverse()),
    tipEdge: pathOf(pts.slice(iS, iE + 1)),
    tipStart: pts[iS]!,
    tipEnd: pts[iE]!,
  };
};

/**
 * The base at fraction `u` of its run back from the leading-edge root, measured along
 * the root (x), not along its length: a raised rear's steep lead-in off the root takes
 * no room then, rather than a slice of every section (the owner's A4C folded the
 * sections over each other there).
 */
const acrossBase = (p: Path, u: number): Vec2 => {
  const pts = p.pts;
  const x0 = pts[0]!.x;
  const x1 = pts[pts.length - 1]!.x;
  const target = x0 + (x1 - x0) * Math.min(1, Math.max(0, u));
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    if ((target - a.x) * (target - b.x) <= 0 && a.x !== b.x) {
      const t = (target - a.x) / (b.x - a.x);
      return vec2(target, a.y + (b.y - a.y) * t);
    }
  }
  return u <= 0 ? pts[0]! : pts[pts.length - 1]!;
};

/** The Coons patch over the four sides at (s, u): s base → tip line, u leading → trailing edge. */
const coonsPoint = (f: SweepFrame, s: number, u: number): Vec2 => {
  const B = acrossBase(f.base, u);
  const T = vec2(
    f.tipStart.x + (f.tipEnd.x - f.tipStart.x) * u,
    f.tipStart.y + (f.tipEnd.y - f.tipStart.y) * u,
  );
  const L = along(f.leading, s);
  const R = along(f.trailing, s);
  const L0 = f.leading.pts[0]!;
  const R0 = f.trailing.pts[0]!;
  const L1 = f.tipStart;
  const R1 = f.tipEnd;
  const c = (k: 'x' | 'y') =>
    (1 - s) * B[k] +
    s * T[k] +
    (1 - u) * L[k] +
    u * R[k] -
    ((1 - s) * (1 - u) * L0[k] + (1 - s) * u * R0[k] + s * (1 - u) * L1[k] + s * u * R1[k]);
  return vec2(c('x'), c('y'));
};

/**
 * The tip cap at (v, u): each row a blend, `v` of the way from the tip line (0) out to
 * the tip edge itself (1), `u` along both from the leading edge's end to the trailing
 * edge's. The last row is the edge, so every point of it is reached and thins to the
 * minimum (owner testing: straight rows across the tip left the outline's bulge beyond
 * them square).
 */
const capPoint = (f: SweepFrame, v: number, u: number): Vec2 => {
  const t = vec2(
    f.tipStart.x + (f.tipEnd.x - f.tipStart.x) * u,
    f.tipStart.y + (f.tipEnd.y - f.tipStart.y) * u,
  );
  const e = along(f.tipEdge, u);
  return vec2(t.x + (e.x - t.x) * v, t.y + (e.y - t.y) * v);
};

/** Sections from the base to the tip line, and over the tip cap; points across each. */
export const SWEEP_ROWS = 96;
export const CAP_ROWS = 24;
export const SWEEP_COLUMNS = 64;
/** Relaxation passes over the sweep's interior, and how far each overshoots. */
const RELAX = 400;
const OVER = 1.9;
/** How often (passes) the relaxation checks it hasn't folded the grid. */
const FOLD_CHECK = 10;

/** Whether any cell of the sweep's first `rows` rows turns the other way round to the rest. */
const sweepFolds = (x: Float64Array, z: Float64Array, rows: number, cols: number): boolean => {
  let pos = 0;
  let neg = 0;
  for (let i = 0; i < rows; i++) {
    for (let j = 0; j < cols - 1; j++) {
      const k = i * cols + j;
      const ax = x[k + cols]! - x[k]!;
      const az = z[k + cols]! - z[k]!;
      const bx = x[k + 1]! - x[k]!;
      const bz = z[k + 1]! - z[k]!;
      if (ax * bz - az * bx > 0) pos++;
      else neg++;
    }
  }
  return pos > 0 && neg > 0;
};

/**
 * The sweep laid out as a grid of points on the profile: `rows` sections (base, up to
 * the tip line, then over the tip cap), each `cols` points from leading to trailing edge.
 */
export interface SweepGrid {
  readonly rows: number;
  readonly cols: number;
  /** Profile positions (tab frame, cm), row by row. */
  readonly x: Float64Array;
  readonly z: Float64Array;
  /** Each point's fraction of its section's length from the leading edge. */
  readonly along: Float64Array;
  /** The row that is the tip line. */
  readonly tipRow: number;
  /** v over the tip cap for each row past the tip line (0 at and below it). */
  readonly capV: Float64Array;
}

const gridCache = new WeakMap<Spline, Map<string, SweepGrid>>();

/**
 * The sweep's grid for a design: the Coons patch relaxed (each interior point moved
 * toward the average of its four neighbours, the four sides held, until the grid is
 * even), then the tip cap. Cached per outline and tip line.
 */
export const sweepGrid = (d: FinDesign): SweepGrid => {
  const key = d.tipLine ? `${d.tipLine.start},${d.tipLine.end}` : 'default';
  let byLine = gridCache.get(d.outline);
  if (!byLine) gridCache.set(d.outline, (byLine = new Map()));
  const hit = byLine.get(key);
  if (hit) return hit;
  const f = sweepFrame(d);
  const cols = SWEEP_COLUMNS + 1;
  const sweepRows = SWEEP_ROWS + 1;
  const rows = sweepRows + CAP_ROWS;
  const gx = new Float64Array(sweepRows * cols);
  const gz = new Float64Array(sweepRows * cols);
  for (let i = 0; i < sweepRows; i++) {
    for (let j = 0; j < cols; j++) {
      const p = coonsPoint(f, i / SWEEP_ROWS, j / SWEEP_COLUMNS);
      gx[i * cols + j] = p.x;
      gz[i * cols + j] = p.y;
    }
  }
  // Over-relaxed Gauss–Seidel: settles in a few hundred passes where plain averaging
  // takes thousands. Relaxed all the way, a strongly concave outline (the hatchet's hook)
  // can fold the grid over itself, so it stops at the last state with no fold.
  const folded = () => sweepFolds(gx, gz, SWEEP_ROWS, cols);
  let good: [Float64Array, Float64Array] | null = folded() ? null : [gx.slice(), gz.slice()];
  for (let it = 1; it <= RELAX; it++) {
    for (let i = 1; i < SWEEP_ROWS; i++) {
      for (let j = 1; j < SWEEP_COLUMNS; j++) {
        const k = i * cols + j;
        gx[k] =
          gx[k]! + OVER * ((gx[k - cols]! + gx[k + cols]! + gx[k - 1]! + gx[k + 1]!) / 4 - gx[k]!);
        gz[k] =
          gz[k]! + OVER * ((gz[k - cols]! + gz[k + cols]! + gz[k - 1]! + gz[k + 1]!) / 4 - gz[k]!);
      }
    }
    if (it % FOLD_CHECK === 0) {
      if (!folded()) good = [gx.slice(), gz.slice()];
      else if (good) break;
    }
  }
  if (good && folded()) {
    gx.set(good[0]);
    gz.set(good[1]);
  }
  const x = new Float64Array(rows * cols);
  const z = new Float64Array(rows * cols);
  x.set(gx);
  z.set(gz);
  const capV = new Float64Array(rows);
  // Gathered toward the tip, where the rounding turns fastest.
  for (let k = 1; k <= CAP_ROWS; k++) {
    const i = SWEEP_ROWS + k;
    const v = Math.sin((Math.PI / 2) * (k / CAP_ROWS));
    capV[i] = v;
    for (let j = 0; j < cols; j++) {
      const p = capPoint(f, v, j / SWEEP_COLUMNS);
      x[i * cols + j] = p.x;
      z[i * cols + j] = p.y;
    }
  }
  const alongs = new Float64Array(rows * cols);
  for (let i = 0; i < rows; i++) {
    let total = 0;
    for (let j = 1; j < cols; j++) {
      const k = i * cols + j;
      total += Math.hypot(x[k]! - x[k - 1]!, z[k]! - z[k - 1]!);
      alongs[k] = total;
    }
    for (let j = 1; j < cols; j++) {
      const k = i * cols + j;
      alongs[k] = total > 0 ? alongs[k]! / total : j / SWEEP_COLUMNS;
    }
  }
  const grid = { rows, cols, x, z, along: alongs, tipRow: SWEEP_ROWS, capV };
  byLine.set(key, grid);
  return grid;
};

/** Where on the sweep a profile point is: its section (fractional row) and its fraction along it. */
export interface SweepHit {
  /** Fractional row: 0 the base, {@link SweepGrid.tipRow} the tip line, beyond it the cap. */
  readonly row: number;
  /** Fraction of the section's length from the leading edge. */
  readonly along: number;
  /**
   * Fractional column, 0 the leading edge to 1 the trailing edge: over the tip cap, the
   * fraction along the tip line (and the tip edge) the point's row runs out from.
   */
  readonly col: number;
}

/**
 * The grid's cells (by their first corner's index) that reach height `z`: where to look
 * for points at that height. Worked out once per horizontal section.
 */
export const cellsAtHeight = (g: SweepGrid, z: number): Int32Array => {
  const out: number[] = [];
  for (let i = 0; i < g.rows - 1; i++) {
    for (let j = 0; j < g.cols - 1; j++) {
      const k = i * g.cols + j;
      const a = g.z[k]!;
      const b = g.z[k + 1]!;
      const c = g.z[k + g.cols]!;
      const e = g.z[k + g.cols + 1]!;
      if (z >= Math.min(a, b, c, e) - 1e-4 && z <= Math.max(a, b, c, e) + 1e-4) out.push(k);
    }
  }
  return Int32Array.from(out);
};

/**
 * Find the profile point (x, z) on the sweep's grid: the cell containing it, inverted
 * bilinearly. A point a hair outside (the grid's sides are the outline sampled) is
 * taken from the nearest cell, clamped to its side. `cells` limits the search to those
 * cells ({@link cellsAtHeight}).
 */
export const locateOnSweep = (
  g: SweepGrid,
  px: number,
  pz: number,
  cells: Int32Array = cellsAtHeight(g, pz),
): SweepHit | null => {
  const { cols, x, z } = g;
  let best = -1;
  let bestA = 0;
  let bestB = 0;
  let bestMiss = Infinity;
  for (const k00 of cells) {
    const k01 = k00 + 1;
    const k10 = k00 + cols;
    const k11 = k10 + 1;
    const xmin = Math.min(x[k00]!, x[k01]!, x[k10]!, x[k11]!);
    const xmax = Math.max(x[k00]!, x[k01]!, x[k10]!, x[k11]!);
    if (px < xmin - 1e-4 || px > xmax + 1e-4) continue;
    // Newton on the bilinear map, a along the rows, b across.
    let a = 0.5;
    let b = 0.5;
    for (let it = 0; it < 20; it++) {
      const fx =
        (1 - a) * ((1 - b) * x[k00]! + b * x[k01]!) + a * ((1 - b) * x[k10]! + b * x[k11]!) - px;
      const fz =
        (1 - a) * ((1 - b) * z[k00]! + b * z[k01]!) + a * ((1 - b) * z[k10]! + b * z[k11]!) - pz;
      const xa = (1 - b) * (x[k10]! - x[k00]!) + b * (x[k11]! - x[k01]!);
      const xb = (1 - a) * (x[k01]! - x[k00]!) + a * (x[k11]! - x[k10]!);
      const za = (1 - b) * (z[k10]! - z[k00]!) + b * (z[k11]! - z[k01]!);
      const zb = (1 - a) * (z[k01]! - z[k00]!) + a * (z[k11]! - z[k10]!);
      const det = xa * zb - xb * za;
      if (Math.abs(det) < 1e-18) break;
      const da = (fx * zb - fz * xb) / det;
      const db = (xa * fz - za * fx) / det;
      a -= da;
      b -= db;
      if (Math.abs(da) + Math.abs(db) < 1e-12) break;
    }
    if (!Number.isFinite(a) || !Number.isFinite(b)) [a, b] = [0.5, 0.5];
    // How far the cell's nearest point (clamped to it) is from the point: 0 inside it.
    a = Math.min(1, Math.max(0, a));
    b = Math.min(1, Math.max(0, b));
    const qx = (1 - a) * ((1 - b) * x[k00]! + b * x[k01]!) + a * ((1 - b) * x[k10]! + b * x[k11]!);
    const qz = (1 - a) * ((1 - b) * z[k00]! + b * z[k01]!) + a * ((1 - b) * z[k10]! + b * z[k11]!);
    const miss = Math.hypot(qx - px, qz - pz);
    if (miss < bestMiss) [best, bestA, bestB, bestMiss] = [k00, a, b, miss];
    if (miss < 1e-9) break;
  }
  // Further than a millimetre off the grid is off the blade.
  if (best < 0 || bestMiss > 0.1) return null;
  const a = bestA;
  const b = bestB;
  const al = g.along;
  const alongAt =
    (1 - a) * ((1 - b) * al[best]! + b * al[best + 1]!) +
    a * ((1 - b) * al[best + cols]! + b * al[best + cols + 1]!);
  return {
    row: Math.floor(best / cols) + a,
    along: alongAt,
    col: ((best % cols) + b) / (cols - 1),
  };
};

/** The thickness path's fraction along the section at `t` (0 the base, 1 the tip line). */
export const thicknessPathAt = (path: FinThicknessPath, t: number): number => {
  const s = Math.min(1, Math.max(0, t));
  // The quadratic through the three points (base, middle, tip line).
  const [p0, p1, p2] = path;
  const v = p0 * (1 - s) * (1 - 2 * s) + 4 * p1 * s * (1 - s) + p2 * s * (2 * s - 1);
  return Math.min(FIN_THICKNESS_PATH_LIMITS.max, Math.max(FIN_THICKNESS_PATH_LIMITS.min, v));
};

/**
 * The foil fraction to read at `along` on a section whose thickest point is to sit at
 * `path`, for a foil thickest at `foilAt`: a power curve, smooth and rising, that puts
 * the foil's thickest point on the path and leaves its ends at the edges.
 */
export const foilFractionAt = (along: number, path: number, foilAt: number): number => {
  if (along <= 0) return 0;
  if (along >= 1) return 1;
  if (Math.abs(path - foilAt) < 1e-9) return along;
  return Math.pow(along, Math.log(foilAt) / Math.log(path));
};

/** Section `row` of the grid (tab frame), for drawing: its points, leading → trailing edge. */
export const sweepSectionLine = (g: SweepGrid, row: number): Vec2[] => {
  const i = Math.min(g.rows - 1, Math.max(0, Math.round(row)));
  return Array.from({ length: g.cols }, (_, j) => vec2(g.x[i * g.cols + j]!, g.z[i * g.cols + j]!));
};

/** The point `along` of the way along section `row` (fractional), tab frame. */
export const sweepPointOn = (g: SweepGrid, row: number, alongF: number): Vec2 => {
  const i0 = Math.min(g.rows - 2, Math.max(0, Math.floor(row)));
  const a = Math.min(1, Math.max(0, row - i0));
  const on = (i: number): Vec2 => {
    const base = i * g.cols;
    let j = 1;
    while (j < g.cols - 1 && g.along[base + j]! < alongF) j++;
    const a0 = g.along[base + j - 1]!;
    const a1 = g.along[base + j]!;
    const t = a1 > a0 ? Math.min(1, Math.max(0, (alongF - a0) / (a1 - a0))) : 0;
    return vec2(
      g.x[base + j - 1]! + (g.x[base + j]! - g.x[base + j - 1]!) * t,
      g.z[base + j - 1]! + (g.z[base + j]! - g.z[base + j - 1]!) * t,
    );
  };
  const p = on(i0);
  const q = on(i0 + 1);
  return vec2(p.x + (q.x - p.x) * a, p.y + (q.y - p.y) * a);
};

/**
 * Where on section `row` (fractional) a profile point is nearest, as a fraction of the
 * section's length: dragging a thickness path point along its section.
 */
export const sweepAlongNear = (g: SweepGrid, row: number, p: Vec2): number => {
  const n = 200;
  let best = 0;
  let dist = Infinity;
  for (let k = 0; k <= n; k++) {
    const q = sweepPointOn(g, row, k / n);
    const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
    if (dd < dist) [dist, best] = [dd, k / n];
  }
  return best;
};

/** The tip edge past the tip line (tab frame): the cap's outline, tip line end to end. */
export const sweepTipEdge = (d: FinDesign): Vec2[] => [...sweepFrame(d).tipEdge.pts];
