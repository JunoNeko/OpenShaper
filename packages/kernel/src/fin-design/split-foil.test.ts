// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { splineExtremes } from './curve-shape';
import { radiusFace, foilShare, splitFoil } from './split-foil';
import { yAtX } from './curve-shape';

describe('a foil split by share of thickness', () => {
  const tc = 0.066; // a 10 mm root on a 150 mm chord

  it('shares the thickness: 70 / 30 is 70% above the chord line and 30% below', () => {
    const s = splitFoil(0.7, tc);
    expect(splineExtremes(s.outside, 'y').max.point.y).toBeCloseTo(0.7 * tc, 3);
    expect(-splineExtremes(s.inside!, 'y').min.point.y).toBeCloseTo(0.3 * tc, 3);
    expect(foilShare(s)).toBeCloseTo(0.7, 3);
  });

  it('is a leading-edge radius of that size, then a straight line to the trailing edge', () => {
    const r = 0.7 * tc;
    const f = radiusFace(r, 1);
    expect(f.knots).toHaveLength(4); // leading edge, halfway round, tangent point, trailing edge
    const [le, mid, t, te] = f.knots.map((k) => k.end);
    expect([le!.x, le!.y, te!.x, te!.y]).toEqual([0, 0, 1, 0]);
    // On the circle through the leading edge, centre (r, 0).
    for (const p of [mid!, t!]) expect(Math.hypot(p.x - r, p.y)).toBeCloseTo(r, 12);
    // The line from the tangent point is square to the radius there.
    expect((t!.x - r) * (1 - t!.x) + t!.y * -t!.y).toBeCloseTo(0, 12);
    // Leaves the leading edge straight up, and the radius is within 0.1% of a circle.
    expect(f.knots[0]!.tangentToNext.x).toBeCloseTo(0, 12);
    for (let i = 1; i < 40; i++) {
      const x = (t!.x * i) / 40;
      const y = yAtX(f, x);
      expect(Math.abs(Math.hypot(x - r, y) - r)).toBeLessThan(r * 1e-3);
    }
    // And straight from there.
    const x = (t!.x + 1) / 2;
    expect(yAtX(f, x)).toBeCloseTo((t!.y * (1 - x)) / (1 - t!.x), 9);
  });

  it('mirrors the inside face below the chord line', () => {
    const up = radiusFace(0.03, 1);
    const down = radiusFace(0.03, -1);
    up.knots.forEach((k, i) => {
      expect(down.knots[i]!.end.x).toBeCloseTo(k.end.x, 12);
      expect(down.knots[i]!.end.y).toBeCloseTo(-k.end.y, 12);
    });
  });

  it('is flat inside at 100 / 0, and symmetric at 50 / 50', () => {
    expect(splitFoil(1, tc).inside!.knots).toHaveLength(2);
    expect(foilShare(splitFoil(1, tc))).toBe(1);
    expect(foilShare(splitFoil(0.5, tc))).toBeCloseTo(0.5, 9);
  });

  it('reads a symmetric foil as 50 / 50', () => {
    expect(foilShare({ outside: radiusFace(0.03, 1), inside: null })).toBe(0.5);
  });
});
