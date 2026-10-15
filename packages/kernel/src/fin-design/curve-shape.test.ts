// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { vec2 } from '../vec2';
import { slopeSigns, splineExtremes } from './curve-shape';

// One cubic (0,0) (1,2) (2,2) (3,0): x = 3t, y = 6t(1 − t) — peak 1.5 at t = 0.5.
const arch = splineFromKnots([
  knot(vec2(0, 0), vec2(0, 0), vec2(1, 2), false),
  knot(vec2(3, 0), vec2(2, 2), vec2(3, 0), false),
]);

describe('slopeSigns', () => {
  it('reads a rise then a fall', () => {
    expect(slopeSigns(arch, 'y')).toEqual([1, -1]);
    expect(slopeSigns(arch, 'x')).toEqual([1]);
  });

  it('ignores flat stretches and stationary points', () => {
    // y = t³ from 0 to 1 then flat at 1: rising, with zero slope at the join.
    const s = splineFromKnots([
      knot(vec2(0, 0), vec2(0, 0), vec2(1, 0), false),
      knot(vec2(3, 1), vec2(2, 0), vec2(4, 1), false),
      knot(vec2(6, 1), vec2(5, 1), vec2(6, 1), false),
    ]);
    expect(slopeSigns(s, 'y')).toEqual([1]);
  });
});

describe('splineExtremes', () => {
  it('finds a peak between knots exactly', () => {
    const { min, max } = splineExtremes(arch, 'y');
    expect(max.t).toBeCloseTo(0.5, 15);
    expect(max.point.y).toBeCloseTo(1.5, 15);
    expect(max.point.x).toBeCloseTo(1.5, 15);
    expect(min.point.y).toBe(0);
  });
});
