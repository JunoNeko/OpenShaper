// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { vec2, type Vec2 } from '../vec2';
import { polygonArea, triangulate } from './triangulate';

const covered = (pts: readonly Vec2[]) =>
  triangulate(pts).reduce((s, [a, b, c]) => s + polygonArea([pts[a]!, pts[b]!, pts[c]!]), 0);

describe('triangulate', () => {
  it('covers a convex polygon exactly', () => {
    const sq = [vec2(0, 0), vec2(2, 0), vec2(2, 1), vec2(0, 1)];
    expect(triangulate(sq)).toHaveLength(2);
    expect(covered(sq)).toBeCloseTo(2, 15);
  });

  it('covers a non-convex polygon, every triangle inside', () => {
    // An L: area 3, with a reflex corner at (1, 1).
    const l = [vec2(0, 0), vec2(2, 0), vec2(2, 1), vec2(1, 1), vec2(1, 2), vec2(0, 2)];
    const tris = triangulate(l);
    expect(tris).toHaveLength(4);
    expect(covered(l)).toBeCloseTo(3, 15);
    for (const [a, b, c] of tris) expect(polygonArea([l[a]!, l[b]!, l[c]!])).toBeGreaterThan(0);
  });

  it('keeps the winding of a clockwise polygon', () => {
    const cw = [vec2(0, 0), vec2(0, 1), vec2(2, 1), vec2(2, 0)];
    expect(covered(cw)).toBeCloseTo(-2, 15);
  });

  it('uses every vertex of a flat run, so neighbouring faces still meet it', () => {
    // A flat bottom with points along it, like a fin's flat inside face.
    const pts = [vec2(0, 0), vec2(1, 0), vec2(2, 0), vec2(3, 0), vec2(1.5, 1)];
    const used = new Set(triangulate(pts).flat());
    expect(used.size).toBe(pts.length);
    expect(covered(pts)).toBeCloseTo(1.5, 15);
  });
});
