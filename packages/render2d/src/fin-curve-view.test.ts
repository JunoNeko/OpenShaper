// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { knot, splineFromKnots, vec2 } from '@openshaper/kernel';
import {
  dragTo,
  fromView,
  layersBounds,
  pickCurve,
  pickHandle,
  splineToView,
  toView,
  type FinCurveLayer,
} from './fin-curve-view';
import { worldToScreen, type Viewport } from './viewport';

// A straight line (0,0) → (10,0) with handles at thirds, and an arch above it.
const line = splineFromKnots([
  knot(vec2(0, 0), vec2(0, 0), vec2(10 / 3, 0), false),
  knot(vec2(10, 0), vec2(20 / 3, 0), vec2(10, 0), false),
]);
const arch = splineFromKnots([
  knot(vec2(0, 0), vec2(0, 0), vec2(2, 4), false),
  knot(vec2(10, 0), vec2(8, 4), vec2(10, 0), false),
]);
const vp: Viewport = { scale: 20, originX: 50, originY: 300 };
const at = (p: { x: number; y: number }, yScale = 1) => worldToScreen(vp, toView(p, yScale));

const layers = (over: Partial<FinCurveLayer> = {}): FinCurveLayer[] => [
  { id: 'line', spline: line, editable: true },
  { id: 'arch', spline: arch, editable: true, ...over },
];

describe('view space', () => {
  it('stretches y and back', () => {
    const p = vec2(3, 0.25);
    expect(fromView(toView(p, 4), 4)).toEqual(p);
    expect(splineToView(line, 1)).toBe(line); // no copy when unstretched
    expect(splineToView(arch, 3).knots[0]!.tangentToNext).toEqual(vec2(2, 12));
  });
});

describe('pickHandle', () => {
  it('finds the handle under the pointer, within the radius', () => {
    const s = at(vec2(10, 0));
    expect(pickHandle(layers(), vp, { x: s.x + 5, y: s.y }, 1, 8)).toEqual({
      layer: 'arch', // on top, and its end is at the same spot as the line's
      index: 1,
      kind: 'end',
    });
    expect(pickHandle(layers(), vp, { x: s.x + 12, y: s.y }, 1, 8)).toBeNull();
    expect(pickHandle(layers(), vp, { x: s.x + 12, y: s.y }, 1, 22)).not.toBeNull();
  });

  it('ignores layers that are not editable', () => {
    const s = at(vec2(2, 4));
    expect(pickHandle(layers({ editable: false }), vp, s, 1, 8)).toBeNull();
    expect(pickHandle(layers(), vp, s, 1, 8)).toEqual({ layer: 'arch', index: 0, kind: 'next' });
  });

  it('works in stretched view space', () => {
    const s = at(vec2(2, 4), 3);
    expect(pickHandle(layers(), vp, s, 3, 8)).toEqual({ layer: 'arch', index: 0, kind: 'next' });
  });

  it('prefers the current selection where handles overlap', () => {
    const s = at(vec2(0, 0));
    const line0 = { layer: 'line', index: 0, kind: 'end' as const };
    expect(pickHandle(layers(), vp, s, 1, 8, line0)).toEqual(line0);
  });
});

describe('pickCurve', () => {
  it('returns the nearest point on a curve, in data space', () => {
    const s = at(vec2(5, 0));
    const hit = pickCurve([layers()[0]!], vp, { x: s.x, y: s.y - 3 }, 1, 8)!;
    expect(hit.layer).toBe('line');
    expect(hit.point.x).toBeCloseTo(5, 6);
    expect(hit.point.y).toBeCloseTo(0, 9);
  });

  it('misses beyond the radius', () => {
    const s = at(vec2(5, 0));
    expect(pickCurve([layers()[0]!], vp, { x: s.x, y: s.y - 30 }, 1, 8)).toBeNull();
  });
});

describe('dragTo', () => {
  it('moves by the pointer’s travel, not to the pointer', () => {
    // Grabbed 0.3 off-centre; the pointer travels (1, 2).
    const to = dragTo(vec2(5, 5), vec2(5.3, 4.8), vec2(6.3, 6.8));
    expect(to.x).toBeCloseTo(6, 12);
    expect(to.y).toBeCloseTo(7, 12);
  });
});

describe('layersBounds', () => {
  it('covers every layer, stretched, plus any extra', () => {
    const b = layersBounds(layers(), 2, { minX: -1, minY: -5, maxX: 1, maxY: 0 })!;
    expect(b.minX).toBe(-1);
    expect(b.maxX).toBe(10);
    expect(b.minY).toBe(-5);
    expect(b.maxY).toBeCloseTo(6, 6); // the arch peaks at 3, stretched ×2
  });
});
