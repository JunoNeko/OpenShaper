// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { triangulatePolygon, type P2 } from './polygon';

const area = (a: P2, b: P2, c: P2) => ((b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)) / 2;
const polyArea = (pts: readonly P2[]) =>
  pts.reduce((s, p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    return s + (p.x * q.y - q.x * p.y) / 2;
  }, 0);

/** A tail's end: flat deck, a bottom with two sawtooth notches cut up into it. */
const notched: P2[] = [
  { x: -10, y: 0 },
  { x: -5, y: 0 },
  { x: -5, y: 0.0001 }, // a vertical wall, two points a micron apart
  { x: -5.0001, y: 0.6 },
  { x: 0, y: 0 },
  { x: 5, y: 0.6 },
  { x: 5.0001, y: 0.0001 },
  { x: 5, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 2 },
  { x: -10, y: 2 },
];

describe('triangulatePolygon', () => {
  it('covers exactly a notched outline, n − 2 triangles wound as it runs', () => {
    const tris = triangulatePolygon(notched);
    expect(tris).toHaveLength(notched.length - 2);
    const sum = tris.reduce((s, [a, b, c]) => s + area(notched[a]!, notched[b]!, notched[c]!), 0);
    expect(sum).toBeCloseTo(polyArea(notched), 9);
    for (const [a, b, c] of tris) {
      expect(area(notched[a]!, notched[b]!, notched[c]!)).toBeGreaterThanOrEqual(-1e-12);
    }
  });

  it('keeps a clockwise outline clockwise', () => {
    const cw = [...notched].reverse();
    const tris = triangulatePolygon(cw);
    const sum = tris.reduce((s, [a, b, c]) => s + area(cw[a]!, cw[b]!, cw[c]!), 0);
    expect(sum).toBeCloseTo(polyArea(cw), 9);
    expect(sum).toBeLessThan(0);
  });

  it('joins points on a straight run across the outline, not into zero-area slivers', () => {
    // A step's straight floor: nine points on one line, then the wall and the deck.
    // Listed from the middle of the run, where taking the first ear found clipped a sliver.
    const run: P2[] = [
      ...Array.from({ length: 8 }, (_, i) => ({ x: i + 1, y: (i + 1) * 0.1 })),
      { x: 8, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 3 },
      { x: 0, y: 3 },
      { x: 0, y: 0 },
    ];
    const tris = triangulatePolygon(run);
    expect(tris).toHaveLength(run.length - 2);
    for (const [a, b, c] of tris)
      expect(Math.abs(area(run[a]!, run[b]!, run[c]!))).toBeGreaterThan(1e-6);
  });

  it('needs three points', () => {
    expect(
      triangulatePolygon([
        { x: 0, y: 0 },
        { x: 1, y: 0 },
      ]),
    ).toEqual([]);
  });
});
