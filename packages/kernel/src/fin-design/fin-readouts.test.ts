// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { value } from '../bezier-curve';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { lerp, vec2, type Vec2 } from '../vec2';
import { defaultFinDesign } from './fin-defaults';
import { FIN_POSITIONS, type FinDesign } from './fin-design';
import { finReadouts } from './fin-readouts';

/** An outline of straight segments through `pts` (handles at thirds). */
const polyline = (pts: readonly Vec2[]) =>
  splineFromKnots(
    pts.map((p, i) =>
      knot(
        p,
        i > 0 ? lerp(p, pts[i - 1]!, 1 / 3) : p,
        i < pts.length - 1 ? lerp(p, pts[i + 1]!, 1 / 3) : p,
        false,
      ),
    ),
  );

const withOutline = (outline: FinDesign['outline']): FinDesign => ({
  ...defaultFinDesign('side'),
  outline,
});

describe('finReadouts: analytic shapes', () => {
  it('a triangle: ½·base·height, sweep from its slope', () => {
    // Leading-edge root (10, 0) → tip (4, 6) → trailing-edge root (0, 0).
    const r = finReadouts(withOutline(polyline([vec2(10, 0), vec2(4, 6), vec2(0, 0)])));
    expect(r.area).toBeCloseTo(30, 12);
    expect(r.depth).toBeCloseTo(6, 12);
    expect(r.tip.x).toBeCloseTo(4, 12);
    expect(r.sweep).toBeCloseTo(45, 12);
    expect(r.rootChord).toBe(10);
  });

  it('an upright edge has no sweep; a forward-leaning one is negative', () => {
    expect(finReadouts(withOutline(polyline([vec2(10, 0), vec2(10, 5), vec2(0, 0)]))).sweep).toBe(
      0,
    );
    expect(
      finReadouts(withOutline(polyline([vec2(10, 0), vec2(12, 2 * Math.sqrt(3)), vec2(0, 0)])))
        .sweep,
    ).toBeCloseTo(-30, 12);
  });

  it('a cubic arch: area 3 under x = 3 − 3t, y = 6t(1 − t)', () => {
    const arch = splineFromKnots([
      knot(vec2(3, 0), vec2(3, 0), vec2(2, 2), false),
      knot(vec2(0, 0), vec2(1, 2), vec2(0, 0), false),
    ]);
    const r = finReadouts(withOutline(arch));
    expect(r.area).toBeCloseTo(3, 12);
    expect(r.depth).toBeCloseTo(1.5, 12);
    expect(r.tip.x).toBeCloseTo(1.5, 12);
  });

  it('reads the front overhang against the position’s tab', () => {
    const outline = polyline([vec2(11.5, 0), vec2(6, 8), vec2(2, 0)]);
    expect(finReadouts({ ...defaultFinDesign('side'), outline }).frontOverhang).toBeCloseTo(
      0.2,
      12,
    );
    const setBack = polyline([vec2(10.8, 0), vec2(6, 8), vec2(2, 0)]);
    expect(
      finReadouts({ ...defaultFinDesign('centre'), outline: setBack }).frontOverhang,
    ).toBeCloseTo(-0.5, 12);
  });
});

/** Shoelace area of the outline flattened into `n` points per segment. */
const sampledArea = (d: FinDesign, n: number): number => {
  const pts: Vec2[] = [];
  d.outline.coeffs.forEach((k, s) => {
    for (let i = s === 0 ? 0 : 1; i <= n; i++) pts.push(value(k, i / n));
  });
  let sum = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    sum += p.x * q.y - q.x * p.y;
  });
  return Math.abs(sum) / 2;
};

describe.each(FIN_POSITIONS)('finReadouts(default %s)', (position) => {
  const d = defaultFinDesign(position);
  const r = finReadouts(d);

  it('agrees with a finely sampled area', () => {
    // Flattening error falls as 1/n²: 4000 chords per segment is within 1e-5 cm².
    expect(Math.abs(r.area - sampledArea(d, 4000))).toBeLessThan(1e-5);
  });

  it('matches the source sizes', () => {
    expect(r.depth).toBeCloseTo(position === 'quad-rear' ? 8 : 10, 12);
    // Rear-aligned, so the leading edge is set back from the tab front by 113 mm − chord.
    expect(r.frontOverhang).toBeCloseTo(r.rootChord - 11.3, 12);
    // The FinFoil outline's own rake: its highest point sits about 275 units behind the
    // leading-edge root and 229 up, atan(275 / 229) ≈ 50°. Pinned so a change to the
    // default outline is deliberate.
    expect(r.sweep).toBeCloseTo(49.8236, 4);
  });

  it('scales: area by depth², angles unchanged', () => {
    const big = defaultFinDesign('side');
    const small = defaultFinDesign('quad-rear'); // same outline, 80 mm vs 100 mm deep
    expect(finReadouts(small).area / finReadouts(big).area).toBeCloseTo(0.64, 12);
    expect(finReadouts(small).sweep).toBeCloseTo(finReadouts(big).sweep, 12);
  });
});
