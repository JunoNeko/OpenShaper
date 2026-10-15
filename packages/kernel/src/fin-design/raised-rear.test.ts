// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A long-based fin with a raised rear: the blade overhangs the tab's rear end, and its
 * underside rises from the base to a low point behind the tab, so the fin can be
 * rocked onto the box's rear pin without its tail hitting the board. The outline is
 * one chain that comes down the trailing edge to that low point, then runs forward
 * and down along the underside to the base. Height falls all the way from the tip,
 * so the model needs nothing new; these tests prove it end to end.
 */
import { describe, expect, it } from 'vitest';
import { value } from '../bezier-curve';
import type { Vec2 } from '../vec2';
import { RAISED_BASE_END, RAISED_LOW, raisedRearDesign } from '../test-support/fin-designs';
import { bladeSection, chordAt, prepareBlade } from './blade';
import { BLADE_CI_TOLERANCE, bladeSurfaceDeviation, fitBladeSurface } from './blade-surface';
import { splineExtremes } from './curve-shape';
import type { FinDesign } from './fin-design';
import { finReadouts } from './fin-readouts';
import { validateFinDesign } from './fin-rules';

const LOW = RAISED_LOW;
const BASE_END = RAISED_BASE_END;
const raisedRear = raisedRearDesign;

const shoelace = (d: FinDesign, n = 4000): number => {
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

describe('a raised rear', () => {
  const d = raisedRear();

  it('is a valid design', () => {
    expect(validateFinDesign(d)).toEqual([]);
  });

  it('keeps everything behind the tab clear of the base', () => {
    // Behind the tab's rear end (x < 0) the outline never comes down to the base: the
    // lowest it gets is where the underside passes x = 0.
    let lowest = Infinity;
    d.outline.coeffs.forEach((k) => {
      for (let i = 0; i <= 2000; i++) {
        const p = value(k, i / 2000);
        if (p.x < 0) lowest = Math.min(lowest, p.y);
      }
    });
    expect(lowest).toBeGreaterThan(0.05);
    expect(splineExtremes(d.outline, 'y').min.point.y).toBeCloseTo(0, 15); // on the base, at the roots
  });

  it('reads the base length to where the underside meets the base', () => {
    const r = finReadouts(d);
    expect(r.rootChord).toBeCloseTo(d.outline.knots[0]!.end.x - BASE_END.x, 12);
    expect(Math.abs(r.area - shoelace(d))).toBeLessThan(1e-5);
  });

  it('slices below the low point end on the underside, above it on the trailing edge', () => {
    const b = prepareBlade(d);
    const below = chordAt(b, 0.25).trailing;
    const above = chordAt(b, 1).trailing;
    // Under the low point the chord stops short on the rising underside...
    expect(below).toBeGreaterThan(LOW.x);
    expect(below).toBeLessThan(BASE_END.x);
    // ...and just above it reaches back past the low point's x, on the trailing edge.
    expect(above).toBeLessThan(below);
    expect(chordAt(b, 0).trailing).toBeCloseTo(BASE_END.x, 12);
  });

  it('builds sections all the way up', () => {
    const b = prepareBlade(d);
    for (const h of [0, 0.25, LOW.y, 1, 5, b.depth * 0.9]) {
      const s = bladeSection(b, h);
      expect(s.leadingX).toBeGreaterThan(s.trailingX);
    }
  });

  it('fits a blade surface within tolerance, creased at the sharp low point', () => {
    const m = fitBladeSurface(d);
    expect(bladeSurfaceDeviation(prepareBlade(d), m.surface, m.topZ, 31, 211)).toBeLessThanOrEqual(
      BLADE_CI_TOLERANCE,
    );
  });
});
