// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { vec2, type Vec2 } from '../vec2';
import { polygonArea, triangulate, triangulateWithHoles } from './triangulate';

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

describe('triangulateWithHoles', () => {
  const area = (pts: readonly Vec2[], tris: [number, number, number][]) =>
    tris.reduce((s, [a, b, c]) => s + polygonArea([pts[a]!, pts[b]!, pts[c]!]), 0);
  const rect = (x0: number, y0: number, x1: number, y1: number): Vec2[] => [
    vec2(x0, y0),
    vec2(x1, y0),
    vec2(x1, y1),
    vec2(x0, y1),
  ];

  it('covers a square less its square hole, every triangle the same way round', () => {
    const outer = rect(0, 0, 10, 10);
    const hole = rect(3, 3, 6, 7);
    const tris = triangulateWithHoles(outer, [hole]);
    const all = [...outer, ...hole];
    expect(area(all, tris)).toBeCloseTo(100 - 12, 12);
    for (const [a, b, c] of tris) {
      expect(polygonArea([all[a]!, all[b]!, all[c]!])).toBeGreaterThanOrEqual(0);
    }
  });

  it('covers a strip less a row of holes, none inside a hole', () => {
    const outer = rect(0, 0, 40, 6);
    const holes = [5, 15, 25].map((x) => rect(x, 2, x + 5, 4));
    const tris = triangulateWithHoles(outer, holes);
    const all = [...outer, ...holes.flat()];
    expect(area(all, tris)).toBeCloseTo(240 - 3 * 10, 12);
    for (const [a, b, c] of tris) {
      const cx = (all[a]!.x + all[b]!.x + all[c]!.x) / 3;
      const cy = (all[a]!.y + all[b]!.y + all[c]!.y) / 3;
      const inHole = holes.some((h) => cx > h[0]!.x && cx < h[1]!.x && cy > 2 && cy < 4);
      expect(inHole).toBe(false);
    }
  });

  it('is plain triangulation with no holes', () => {
    const outer = rect(0, 0, 2, 1);
    expect(area(outer, triangulateWithHoles(outer, []))).toBeCloseTo(2, 12);
  });
});
