// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A long-based fin with a raised rear: the blade overhangs the tab's rear end, and its
 * underside rises from the base to a low point behind the tab, so the fin can be
 * rocked onto the box's rear pin without its tail hitting the board. The outline is
 * one chain that comes down the trailing edge to that low point, then runs forward
 * and down along the underside to the base. Height falls all the way from the tip,
 * so the slicing needs nothing new; these tests prove it end to end. The foil is laid
 * over smoothed edges (blade.ts), which below the low point run behind the underside:
 * the foil is cut off at it, so the underside has the foil's thickness (rounds 1–2).
 */
import { describe, expect, it } from 'vitest';
import { value } from '../bezier-curve';
import type { Vec2 } from '../vec2';
import {
  RAISED_BASE_END,
  RAISED_LOW,
  hookedTipDesign,
  raisedRearDesign,
} from '../test-support/fin-designs';
import { FIN_MIN_THICKNESS, FIN_POSITIONS } from './fin-design';
import { defaultFinDesign } from './fin-defaults';
import { finMesh } from './fin-mesh';
import { bladeSection, chordAt, findRaisedRear, prepareBlade } from './blade';
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

  it('fits a blade surface within tolerance, smooth past the sharp low point', () => {
    const m = fitBladeSurface(d);
    expect(bladeSurfaceDeviation(prepareBlade(d), m.surface, m.topZ, 31, 211)).toBeLessThanOrEqual(
      BLADE_CI_TOLERANCE,
    );
  });
});

describe('the underside of a raised rear', () => {
  const d = raisedRear();
  const b = prepareBlade(d);
  const atTe = (h: number) => {
    const s = bladeSection(b, h);
    const j = s.stations.length - 1;
    return Math.abs(s.outside[j]!.y - s.inside[j]!.y);
  };

  it('is found where the outline turns up into the trailing edge', () => {
    const r = b.raisedRear!;
    expect(r.cornerX).toBeCloseTo(LOW.x, 9);
    expect(r.cornerZ).toBeCloseTo(LOW.y, 9);
  });

  it('is not found on a fin whose trailing edge rises steeply from the base', () => {
    for (const position of FIN_POSITIONS) {
      expect(findRaisedRear(defaultFinDesign(position).outline)).toBeNull();
    }
  });

  it('has the foil’s thickness, thinning toward the low point', () => {
    // The foil runs over the smoothed trailing edge, well behind the underside, and is
    // cut off at it: a real edge, not the 0.5 mm flap a slice ending there would give.
    expect(atTe(0)).toBeGreaterThan(4 * FIN_MIN_THICKNESS);
    let last = Infinity;
    for (const f of [0, 0.2, 0.4, 0.6, 0.8]) {
      const t = atTe(LOW.y * f);
      expect(t).toBeLessThan(last);
      last = t;
    }
  });

  it('meshes the underside with rings of its own', () => {
    const m = finMesh(d);
    const zs = new Set<number>();
    for (let i = 2; i < m.blade.positions.length; i += 3) zs.add(m.blade.positions[i]!);
    expect([...zs].filter((z) => z > 0 && z < LOW.y).length).toBeGreaterThanOrEqual(3);
  });
});

describe('a hooked tip', () => {
  const b = prepareBlade(hookedTipDesign());
  /** The outside face's offset where it crosses x, at height h (cm). */
  const outsideAt = (h: number, x: number): number => {
    const s = bladeSection(b, h);
    for (let j = 0; j < s.outside.length - 1; j++) {
      const p = s.outside[j]!;
      const q = s.outside[j + 1]!;
      if ((p.x - x) * (q.x - x) <= 0 && p.x !== q.x) {
        return p.y + ((q.y - p.y) * (x - p.x)) / (q.x - p.x);
      }
    }
    return NaN;
  };

  it('is valid', () => expect(validateFinDesign(hookedTipDesign())).toEqual([]));

  it('ends both edges at the minimum, hook and all', () => {
    // Round 2 testing: cutting the foil off at the real edge bulged the trailing edge
    // wherever it bent. Only a raised rear's underside keeps a thick edge.
    const above = b.raisedRear!.cornerZ + 0.3;
    for (let h = above; h < b.depth * 0.995; h += 0.1) {
      const s = bladeSection(b, h, [0, 1]);
      for (const j of [0, 1]) {
        const w = Math.abs(s.outside[j]!.y - s.inside[j]!.y) * Math.cos(7 * (Math.PI / 180));
        expect(w).toBeCloseTo(FIN_MIN_THICKNESS, 12);
      }
    }
  });

  it('has no crease across the blade where the trailing edge turns', () => {
    // Before: the face bent at up to 19 /cm right at the turn (9.74 cm up), 3 cm behind
    // the tab. Smoothing the edges the foil is laid over spreads that out. Within the
    // last stretch before the edge (it is 5.4 cm back here) the face follows the edge's
    // own sharp turn, so the edge can stay at the minimum.
    const step = 0.01;
    for (const x of [0.2, -2, -3]) {
      const ys: number[] = [];
      for (let h = 9.4; h <= 10.1; h += step) ys.push(outsideAt(h, x));
      for (let i = 1; i < ys.length - 1; i++) {
        const bend = Math.abs(ys[i - 1]! - 2 * ys[i]! + ys[i + 1]!) / (step * step);
        expect(bend).toBeLessThan(4);
      }
    }
  });
});
