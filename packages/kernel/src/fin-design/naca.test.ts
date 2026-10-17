// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { value } from '../bezier-curve';
import type { Spline } from '../bezier-spline';
import { bladeSection, foilRange, prepareBlade } from './blade';
import { yAtX } from './curve-shape';
import { defaultFinDesign } from './fin-defaults';
import { FIN_MIN_THICKNESS } from './fin-design';
import { validateFinDesign } from './fin-rules';
import { naca4Ordinate, nacaSection, parseNaca4 } from './naca';

/**
 * NACA 0012 ordinates (% chord), Abbott & von Doenhoff, Theory of Wing Sections,
 * Appendix I. Open trailing edge, so they sit 0.126·x⁴ % above the closed-edge form.
 */
const NACA_0012: readonly [number, number][] = [
  [0, 0],
  [1.25, 1.894],
  [2.5, 2.615],
  [5, 3.555],
  [7.5, 4.2],
  [10, 4.683],
  [15, 5.345],
  [20, 5.737],
  [25, 5.941],
  [30, 6.002],
  [40, 5.803],
  [50, 5.294],
  [60, 4.563],
  [70, 3.664],
  [80, 2.623],
  [90, 1.448],
  [95, 0.807],
  [100, 0.126],
];

/** Worst |spline − exact| over the face, sampled along each Bézier segment. */
const fitError = (face: Spline, exact: (x: number) => number): number => {
  let worst = 0;
  for (const k of face.coeffs) {
    for (let i = 0; i <= 200; i++) {
      const p = value(k, i / 200);
      if (p.x < 0 || p.x > 1) return Infinity;
      worst = Math.max(worst, Math.abs(p.y - exact(p.x)));
    }
  }
  return worst;
};

describe('parseNaca4', () => {
  it('reads the digits', () => {
    expect(parseNaca4('2412')).toEqual({ camber: 0.02, position: 0.4, thickness: 0.12 });
    expect(parseNaca4('NACA 0012')).toEqual({ camber: 0, position: 0, thickness: 0.12 });
  });

  it.each(['24', '24120', 'abcd', '2400', '2012'])('rejects %s', (code) => {
    expect(() => parseNaca4(code)).toThrow(RangeError);
  });
});

describe('naca4Ordinate', () => {
  it('matches the published NACA 0012 table', () => {
    const n = parseNaca4('0012');
    for (const [xp, yp] of NACA_0012) {
      const x = xp / 100;
      // Table rounding is 0.0005 %; the closed edge sits 0.126·x⁴ % lower.
      const diff = yp / 100 - naca4Ordinate(n, x, 1);
      expect(Math.abs(diff - 0.00126 * x ** 4)).toBeLessThan(1e-5);
    }
  });

  it('puts the maximum camber where the digits say', () => {
    const n = parseNaca4('2412');
    const camber = (x: number) => (naca4Ordinate(n, x, 1) + naca4Ordinate(n, x, -1)) / 2;
    expect(camber(0.4)).toBeCloseTo(0.02, 15);
    expect(camber(0.3)).toBeLessThan(0.02);
    expect(camber(0.5)).toBeLessThan(0.02);
  });

  it('is 12% thick at its thickest', () => {
    const n = parseNaca4('0012');
    let max = 0;
    for (let i = 0; i <= 10000; i++) max = Math.max(max, 2 * naca4Ordinate(n, i / 10000, 1));
    expect(max).toBeCloseTo(0.12, 3);
  });
});

describe.each(['0012', '0008', '2412', '4412', '6409', '2408'])('nacaSection(%s)', (code) => {
  const n = parseNaca4(code);
  const s = nacaSection(code);

  it('runs both faces from the leading edge to the trailing edge on the chord line', () => {
    for (const face of [s.outside, s.inside ?? s.outside]) {
      expect(face.knots[0]!.end).toEqual({ x: 0, y: 0 });
      expect(face.knots[face.knots.length - 1]!.end).toEqual({ x: 1, y: 0 });
    }
  });

  it('follows the exact foil to within 0.015% of chord, with 6 points per face', () => {
    expect(s.outside.knots).toHaveLength(6);
    expect(fitError(s.outside, (x) => naca4Ordinate(n, x, 1))).toBeLessThan(1.5e-4);
    if (s.inside) expect(fitError(s.inside, (x) => naca4Ordinate(n, x, -1))).toBeLessThan(1.5e-4);
  });

  it('is symmetric exactly when it has no camber', () => {
    expect(s.inside === null).toBe(n.camber === 0);
  });

  it('makes a valid side fin, and a valid centre fin when symmetric', () => {
    const side = { ...defaultFinDesign('side', 'right'), section: s };
    expect(validateFinDesign(side)).toEqual([]);
    const centre = { ...defaultFinDesign('centre'), section: s };
    expect(validateFinDesign(centre).map((i) => i.code)).toEqual(
      n.camber === 0 ? [] : ['section-symmetry'],
    );
  });

  it('keeps the camber-to-thickness ratio when the blade scales it', () => {
    // Uniform scaling to the taper: camber / thickness at the root equals M / XX.
    if (n.camber === 0) return;
    // A left fin: its outside face is on +Y, so offsets read directly.
    const d = { ...defaultFinDesign('side', 'left'), cant: 0, section: s };
    const b = prepareBlade(d);
    // Stations where the foil's fractions fall (the smoothed edges can trim it).
    const r = foilRange(b, 0);
    const station = (f: number) => (f - r.from) / (r.to - r.from);
    // The minimum is added to the outside face, so measure the foil above it.
    const m = FIN_MIN_THICKNESS;
    const at = bladeSection(b, 0, [station(n.position)]);
    const camber = (at.outside[0]!.y - m + at.inside[0]!.y) / 2;
    const thickest = bladeSection(b, 0, [station(b.thickestAt)]);
    const t = thickest.outside[0]!.y - thickest.inside[0]!.y - m;
    expect(camber / t).toBeCloseTo(n.camber / n.thickness, 3);
    expect(yAtX(s.outside, n.position)).toBeGreaterThan(0);
  });
});
