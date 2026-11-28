// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  closestT,
  coeffsOf,
  curveFromPoints,
  curveLength,
  splitCurve,
  tangent,
  tForX,
  value,
  xValue,
  yForX,
} from './bezier-curve';
import { distance, vec2 } from './vec2';

// A straight diagonal y = x, parameterized so x = 3t.
const diagonal = coeffsOf(curveFromPoints(vec2(0, 0), vec2(1, 1), vec2(2, 2), vec2(3, 3)));

describe('bezier-curve (straight diagonal)', () => {
  it('evaluates the Horner form', () => {
    expect(xValue(diagonal, 0.5)).toBeCloseTo(1.5, 12);
    expect(value(diagonal, 0.5)).toEqual({ x: 1.5, y: 1.5 });
  });

  it('solves tForX and yForX', () => {
    expect(tForX(diagonal, 1.5)).toBeCloseTo(0.5, 6);
    expect(yForX(diagonal, 2.25)).toBeCloseTo(2.25, 6);
  });

  it('measures arc length (linear case = chord)', () => {
    expect(curveLength(diagonal)).toBeCloseTo(Math.hypot(3, 3), 9);
  });
});

describe('bezier-curve (curved)', () => {
  // Endpoints (0,0)->(10,0) with handles pulling up: a symmetric arch.
  const arch = coeffsOf(curveFromPoints(vec2(0, 0), vec2(3, 6), vec2(7, 6), vec2(10, 0)));

  it('is symmetric about the midpoint', () => {
    expect(value(arch, 0.5)).toEqual({ x: 5, y: 4.5 });
    expect(xValue(arch, 0.25)).toBeCloseTo(10 - xValue(arch, 0.75), 9);
  });

  it('round-trips tForX within tolerance', () => {
    const x = 3.7;
    const t = tForX(arch, x);
    expect(xValue(arch, t)).toBeCloseTo(x, 2);
  });

  it('uses the legacy atan2(dx,dy) tangent convention', () => {
    // At the apex (t=0.5) the curve is horizontal: dy=0, dx>0 => atan2(dx,0)=+pi/2.
    expect(tangent(arch, 0.5)).toBeCloseTo(Math.PI / 2, 9);
  });
});

describe('splitCurve (de Casteljau subdivision)', () => {
  const c = curveFromPoints(vec2(0, 0), vec2(3, 6), vec2(7, 6), vec2(10, 0));
  const orig = coeffsOf(c);

  it('preserves the curve shape — sub-curves trace the original', () => {
    for (const t of [0.2, 0.5, 0.8]) {
      const s = splitCurve(c, t);
      const left = coeffsOf(
        curveFromPoints(c.p0, s.startTangentToNext, s.mid.tangentToPrev, s.mid.end),
      );
      const right = coeffsOf(
        curveFromPoints(s.mid.end, s.mid.tangentToNext, s.endTangentToPrev, c.p3),
      );
      for (const u of [0, 0.25, 0.5, 0.75, 1]) {
        // left(u) == orig(u*t); right(u) == orig(t + u*(1-t))
        expect(distance(value(left, u), value(orig, u * t))).toBeLessThan(1e-9);
        expect(distance(value(right, u), value(orig, t + u * (1 - t)))).toBeLessThan(1e-9);
      }
    }
  });

  it('places the new knot exactly on the original curve at t', () => {
    for (const t of [0.1, 0.37, 0.9]) {
      expect(distance(splitCurve(c, t).mid.end, value(orig, t))).toBeLessThan(1e-9);
    }
  });
});

describe('closestT', () => {
  const arch = coeffsOf(curveFromPoints(vec2(0, 0), vec2(3, 6), vec2(7, 6), vec2(10, 0)));

  it('recovers a point on the curve for an on-curve query', () => {
    // Second-half params refine past the early-termination quirk; the recovered
    // point sits within ~0.01mm of the query (units are cm). Plenty for inserting.
    for (const t of [0.6, 0.75, 0.9]) {
      const q = value(arch, t);
      const found = value(arch, closestT(arch, q.x, q.y));
      expect(distance(found, q)).toBeLessThan(5e-3);
    }
  });

  it('lands on the exact sample at the midpoint', () => {
    expect(closestT(arch, 5, 4.5)).toBeCloseTo(0.5, 6);
  });
});

describe('yForX on a steep curve (owner report: crinkles at the nose)', () => {
  // The last outline segment of a real board, running into the nose: 12 cm of x for
  // 6 cm of y, near vertical at the end.
  const nose = coeffsOf(
    curveFromPoints(vec2(160.31, 6.42), vec2(161.85, 4.32), vec2(162.56, 1.93), vec2(162.56, 0)),
  );
  /** y at x by bisection on t, to the last bit: x(t) rises monotonically here. */
  const exact = (x: number): number => {
    let lo = 0;
    let hi = 1;
    for (let i = 0; i < 80; i++) {
      const mid = (lo + hi) / 2;
      if (xValue(nose, mid) < x) lo = mid;
      else hi = mid;
    }
    return value(nose, (lo + hi) / 2).y;
  };

  it('reads y exactly, not to the legacy 0.03 mm in x times the slope', () => {
    let worst = 0;
    for (let x = 160.32; x < 162.55; x += 0.01) worst = Math.max(worst, Math.abs(yForX(nose, x) - exact(x))); // prettier-ignore
    // The legacy solver was out by up to 0.29 mm here, stepping as x moved.
    expect(worst).toBeLessThan(1e-7);
  });
});
