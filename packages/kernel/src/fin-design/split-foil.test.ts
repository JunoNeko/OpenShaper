// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { splineExtremes } from './curve-shape';
import { SPLIT_NOSE_ASPECT, radiusFace, foilShare, splitFoil } from './split-foil';
import { yAtX } from './curve-shape';

describe('a foil split by share of thickness', () => {
  const tc = 0.066; // a 10 mm root on a 150 mm chord

  it('shares the thickness: 70 / 30 is 70% above the chord line and 30% below', () => {
    const s = splitFoil(0.7, tc);
    expect(splineExtremes(s.outside, 'y').max.point.y).toBeCloseTo(0.7 * tc, 3);
    expect(-splineExtremes(s.inside!, 'y').min.point.y).toBeCloseTo(0.3 * tc, 3);
    expect(foilShare(s)).toBeCloseTo(0.7, 3);
  });

  it('is a leading-edge radius of that height, round as drawn, then a straight line on', () => {
    const r = 0.7 * tc;
    const a = SPLIT_NOSE_ASPECT;
    const f = radiusFace(r, 1);
    // In the foil view (x shown at 1/aspect of y's stretch) the radius is a circle.
    const drawn = (p: { x: number; y: number }) => ({ x: p.x / a, y: p.y });
    expect(f.knots).toHaveLength(4); // leading edge, halfway round, tangent point, trailing edge
    const [le, mid, t, te] = f.knots.map((k) => k.end);
    expect([le!.x, le!.y, te!.x, te!.y]).toEqual([0, 0, 1, 0]);
    for (const p of [mid!, t!].map(drawn)) expect(Math.hypot(p.x - r, p.y)).toBeCloseTo(r, 12);
    // The line from the tangent point is square to the radius there (as drawn).
    const td = drawn(t!);
    expect((td.x - r) * (1 / a - td.x) + td.y * -td.y).toBeCloseTo(0, 12);
    // Leaves the leading edge straight up; the radius is within 0.1% of a circle as drawn.
    expect(f.knots[0]!.tangentToNext.x).toBeCloseTo(0, 12);
    for (let i = 1; i < 40; i++) {
      const x = (t!.x * i) / 40;
      const y = yAtX(f, x);
      expect(Math.abs(Math.hypot(x / a - r, y) - r)).toBeLessThan(r * 1e-3);
    }
    // And straight from there.
    const x = (t!.x + 1) / 2;
    expect(yAtX(f, x)).toBeCloseTo((t!.y * (1 - x)) / (1 - t!.x), 9);
    // Thickest about a sixth of the way back for a 10 mm root on a 150 mm chord.
    const top = splineExtremes(f, 'y').max.point;
    expect(top.y).toBeCloseTo(r, 4);
    expect(top.x).toBeGreaterThan(0.15);
    expect(top.x).toBeLessThan(0.2);
  });

  it('is a true circle with no stretch', () => {
    const r = 0.05;
    const f = radiusFace(r, 1, 1);
    for (const p of [f.knots[1]!.end, f.knots[2]!.end]) {
      expect(Math.hypot(p.x - r, p.y)).toBeCloseTo(r, 12);
    }
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
