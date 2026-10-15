// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Exact shape queries on a spline, for the fin designer's rules: which way each
 * coordinate runs along the curve, and where it peaks. Both read the roots of the
 * derivative of each cubic segment, so neither depends on a sampling resolution.
 */
import type { Coeffs } from '../bezier-curve';
import type { Spline } from '../bezier-spline';
import { vec2, type Vec2 } from '../vec2';

type Axis = 'x' | 'y';

const cubicCoeffs = (k: Coeffs, axis: Axis): [number, number, number, number] =>
  axis === 'x' ? [k.ax, k.bx, k.cx, k.dx] : [k.ay, k.by, k.cy, k.dy];

/** Roots in (0, 1) of the derivative 3a·t² + 2b·t + c, ascending. */
const derivativeRoots = (a: number, b: number, c: number): number[] => {
  const A = 3 * a;
  const B = 2 * b;
  const scale = Math.max(Math.abs(A), Math.abs(B), Math.abs(c));
  if (scale === 0) return [];
  const roots: number[] = [];
  if (Math.abs(A) <= 1e-12 * scale) {
    if (Math.abs(B) > 1e-12 * scale) roots.push(-c / B);
  } else {
    const disc = B * B - 4 * A * c;
    if (disc >= 0) {
      const sq = Math.sqrt(disc);
      roots.push((-B - sq) / (2 * A), (-B + sq) / (2 * A));
    }
  }
  return roots.filter((t) => t > 0 && t < 1).sort((p, q) => p - q);
};

/**
 * The direction `axis` runs along the spline, as a run-length list of signs: +1
 * increasing, −1 decreasing. Stretches where it doesn't change are left out, so a curve
 * that rises, pauses, and rises again is `[1]`.
 */
export const slopeSigns = (s: Spline, axis: Axis): number[] => {
  const signs: number[] = [];
  for (const k of s.coeffs) {
    const [a, b, c] = cubicCoeffs(k, axis);
    const cuts = [0, ...derivativeRoots(a, b, c), 1];
    const scale = Math.abs(3 * a) + Math.abs(2 * b) + Math.abs(c);
    for (let i = 0; i < cuts.length - 1; i++) {
      const t = (cuts[i]! + cuts[i + 1]!) / 2;
      const d = (3 * a * t + 2 * b) * t + c;
      if (Math.abs(d) <= 1e-12 * scale) continue;
      const sign = Math.sign(d);
      if (signs[signs.length - 1] !== sign) signs.push(sign);
    }
  }
  return signs;
};

/** A point on a spline: segment index, parameter within it, and position. */
export interface SplinePoint {
  readonly segment: number;
  readonly t: number;
  readonly point: Vec2;
}

const pointOn = (k: Coeffs, t: number): Vec2 =>
  vec2(((k.ax * t + k.bx) * t + k.cx) * t + k.dx, ((k.ay * t + k.by) * t + k.cy) * t + k.dy);

/** The exact lowest and highest points of the spline along `axis`. */
export const splineExtremes = (
  s: Spline,
  axis: Axis,
): { readonly min: SplinePoint; readonly max: SplinePoint } => {
  let min: SplinePoint | null = null;
  let max: SplinePoint | null = null;
  s.coeffs.forEach((k, segment) => {
    const [a, b, c] = cubicCoeffs(k, axis);
    for (const t of [0, ...derivativeRoots(a, b, c), 1]) {
      const point = pointOn(k, t);
      const v = point[axis];
      if (!min || v < min.point[axis]) min = { segment, t, point };
      if (!max || v > max.point[axis]) max = { segment, t, point };
    }
  });
  if (!min || !max) throw new Error('splineExtremes: spline has no segments');
  return { min, max };
};
