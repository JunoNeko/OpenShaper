// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Guards ring-vertex correspondence BETWEEN stations.
 *
 * `tessellate.continuity.test.ts` guards the other half of this problem — a
 * pinch AT a station whose knot count isn't a local maximum — using a fixture
 * where every station is the same curve, merely resliced. That deliberately
 * makes the cross-section morph a no-op, which is what isolates the sampling
 * variable, but it also means it cannot see anything that only appears when
 * neighbouring stations genuinely DIFFER.
 *
 * This file covers that gap: two adjacent stations with a different shape AND a
 * different knot count, which is what applying a rail preset to one station
 * produces.
 */
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from './bezier-spline';
import { board, type BezierBoard } from './board';
import { crossSection } from './cross-section';
import { knot, type Knot } from './knot';
import { loftPoint, loftSection } from './loft';
import { polylineSpline } from './test-support/synthetic-boards';
import { tessellateBoard } from './tessellate';
import { vec2 } from './vec2';

const LEN = 120;
const W = 10;
const T = 6;

/** Soft round rail — 4 knots. */
const softKnots = (): Knot[] => [
  knot(vec2(0, 0), vec2(0, 0), vec2(W * 0.55, 0)),
  knot(vec2(W, T * 0.3), vec2(W * 0.75, T * 0.04), vec2(W, T * 0.52)),
  knot(vec2(W, T * 0.72), vec2(W, T * 0.55), vec2(W * 0.7, T * 0.97)),
  knot(vec2(0, T), vec2(W * 0.5, T), vec2(0, T)),
];

/** Hard tucked-edge rail — 6 knots, a genuinely different shape (not a reslice). */
const hardKnots = (): Knot[] => [
  knot(vec2(0, 0), vec2(0, 0), vec2(W * 0.4, 0)),
  knot(vec2(W * 0.86, T * 0.06), vec2(W * 0.62, 0), vec2(W * 0.97, T * 0.12)),
  knot(vec2(W, T * 0.28), vec2(W, T * 0.18), vec2(W, T * 0.4)),
  knot(vec2(W * 0.98, T * 0.6), vec2(W, T * 0.5), vec2(W * 0.92, T * 0.72)),
  knot(vec2(W * 0.6, T * 0.93), vec2(W * 0.8, T * 0.86), vec2(W * 0.4, T * 0.98)),
  knot(vec2(0, T), vec2(W * 0.2, T), vec2(0, T)),
];

const STATIONS = [0, 30, 60, LEN];

/**
 * Flat outline/rocker/deck, so every scaling operation is a no-op and the ONLY
 * thing varying along x is the rail shape. Station 60 carries the hard rail —
 * the "edited" station — so the intervals 30→60 and 60→120 each blend two
 * genuinely different profiles with mismatched knot counts.
 */
const makeBoard = (): BezierBoard => {
  const outline = polylineSpline([
    [0, W],
    [LEN, W],
  ]);
  const bottom = polylineSpline([
    [0, 0],
    [LEN, 0],
  ]);
  const deck = polylineSpline([
    [0, T],
    [LEN, T],
  ]);
  const profiles = [softKnots(), softKnots(), hardKnots(), softKnots()];
  return board(
    outline,
    bottom,
    deck,
    STATIONS.map((pos, i) => crossSection(pos, splineFromKnots(profiles[i]!))),
    'controlPoint',
  );
};

/** Which station interval x falls in; ring triples that straddle a boundary are excluded. */
const intervalOf = (x: number): number => {
  for (let i = 0; i < STATIONS.length - 1; i++) if (x < STATIONS[i + 1]!) return i;
  return STATIONS.length - 2;
};

describe('tessellateBoard: correspondence smoothness between differing stations', () => {
  const lengthSteps = 400;
  const ringSteps = 24;

  const mesh = tessellateBoard(makeBoard(), { lengthSteps, ringSteps });
  const ringLen = (mesh.positions.length / 3 - 2) / lengthSteps; // −2 tip-cap vertices
  // Mirrors the station formula in `tessellateBoard`: stations span the full length.
  const xOf = (r: number) => (LEN * r) / (lengthSteps - 1);

  /** Ring vertex (y, z). x is the station's own position and is excluded by design. */
  const yz = (r: number, i: number): [number, number] => {
    const b = (r * ringLen + i) * 3;
    return [mesh.positions[b + 1]!, mesh.positions[b + 2]!];
  };

  it('produces one full ring per station', () => {
    expect(Number.isInteger(ringLen)).toBe(true);
  });

  /**
   * Within a station interval, each ring vertex sweeps along the stations' cubic
   * cardinal spline in x (since outline, bottom and deck are flat here). The fourth
   * finite difference of any cubic polynomial sampled on a uniform grid is identically
   * zero — a strict analytic oracle replacing the old piecewise-linear second-difference
   * check. Evaluated on `loftPoint` (Float64) it vanishes to machine precision (< 1e-12);
   * on the Float32 mesh it sits at the exact Float32 quantization floor (16·eps_f32·W ≈ 1e-5).
   */
  it('sweeps ring vertices along an exact cubic within a station interval', () => {
    const b = makeBoard();
    let maxD4Exact = 0;
    for (let r = 2; r < lengthSteps - 2; r++) {
      const run = intervalOf(xOf(r - 2));
      if (run < 0 || run !== intervalOf(xOf(r + 2))) continue; // straddles a station
      const secs = [r - 2, r - 1, r, r + 1, r + 2].map((k) => loftSection(b, xOf(k))!);
      for (const f of [0.15, 0.35, 0.55, 0.8]) {
        const pts = secs.map((s) => loftPoint(s, f));
        const d4x = pts[4]!.x - 4 * pts[3]!.x + 6 * pts[2]!.x - 4 * pts[1]!.x + pts[0]!.x;
        const d4y = pts[4]!.y - 4 * pts[3]!.y + 6 * pts[2]!.y - 4 * pts[1]!.y + pts[0]!.y;
        maxD4Exact = Math.max(maxD4Exact, Math.hypot(d4x, d4y));
      }
    }
    expect(maxD4Exact).toBeLessThan(1e-12);
  });

  /**
   * The visible symptom of broken correspondence is high-frequency jitter in curvature
   * along x (normals and curvature overlays differentiate vertex positions twice).
   * The point-blended loft keeps this under 1e-5 cm inside every interval.
   */
  it('has no high-frequency jitter in that sweep', () => {
    let maxJitter = 0;
    const d2 = (r: number, i: number): number => {
      const [ay, az] = yz(r - 1, i);
      const [by, bz] = yz(r, i);
      const [cy, cz] = yz(r + 1, i);
      return Math.hypot(cy - 2 * by + ay, cz - 2 * bz + az);
    };
    for (let r = 1; r < lengthSteps - 2; r++) {
      const run = intervalOf(xOf(r - 1));
      if (run < 0 || run !== intervalOf(xOf(r + 2))) continue;
      for (let i = 0; i < ringLen; i++) {
        maxJitter = Math.max(maxJitter, Math.abs(d2(r + 1, i) - d2(r, i)));
      }
    }
    expect(maxJitter).toBeLessThan(1e-5);
  });

  /**
   * C¹ continuity across every station boundary via O(h²) mesh-refinement convergence.
   *
   * At a C⁰ corner (linear station blend), the worst second difference |p(x+h) − 2p(x) +
   * p(x−h)| ≈ h·Δθ shrinks only as O(h) when halving step size (ratio ≈ 2.0). For a C¹
   * spline with matching slopes from both sides, |Δ²p| = h²|p''| + O(h³) shrinks as O(h²)
   * (ratio ≈ 4.0) even across station boundaries.
   */
  it('is C¹ continuous across stations (O(h²) second-difference convergence)', () => {
    const maxSecondDiff = (steps: number): number => {
      const m = tessellateBoard(makeBoard(), { lengthSteps: steps, ringSteps });
      const rl = (m.positions.length / 3 - 2) / steps;
      const at = (r: number, i: number): [number, number] => {
        const b = (r * rl + i) * 3;
        return [m.positions[b + 1]!, m.positions[b + 2]!];
      };
      let maxD2 = 0;
      for (let r = 1; r < steps - 1; r++) {
        for (let i = 0; i < rl; i++) {
          const [ay, az] = at(r - 1, i);
          const [by, bz] = at(r, i);
          const [cy, cz] = at(r + 1, i);
          maxD2 = Math.max(maxD2, Math.hypot(cy - 2 * by + ay, cz - 2 * bz + az));
        }
      }
      return maxD2;
    };
    const coarse = maxSecondDiff(200);
    const fine = maxSecondDiff(400);
    const ratio = coarse / fine;
    // O(h²) ⇒ ratio converges to 4.0; a C⁰ crease would stall near 2.0.
    expect(ratio).toBeGreaterThan(3.7);
    expect(ratio).toBeLessThan(4.3);
  });
});
