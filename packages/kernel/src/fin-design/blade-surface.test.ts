// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { knotMultiplicities } from '../bspline-surface';
import { prepareBlade } from './blade';
import {
  BLADE_CI_TOLERANCE,
  BLADE_DEFAULTS,
  bladeSurfaceDeviation,
  fitBladeSurface,
} from './blade-surface';
import { defaultFinDesign } from './fin-defaults';
import { FIN_POSITIONS, type FinDesign } from './fin-design';

const designs: [string, FinDesign][] = [
  ...FIN_POSITIONS.map((p): [string, FinDesign] => [p, defaultFinDesign(p, 'right')]),
  ['left side', defaultFinDesign('side', 'left')],
  ['side at 20° cant', { ...defaultFinDesign('side', 'right'), cant: 20 }],
];

describe.each(designs)('fitBladeSurface(%s)', (_, d) => {
  const m = fitBladeSurface(d);
  const s = m.surface;

  it('meets its own accuracy target', () => {
    expect(m.deviation).toBeLessThanOrEqual(BLADE_DEFAULTS.tolerance);
  });

  it('follows the blade when measured on different slices than the fit used', () => {
    const b = prepareBlade(d);
    expect(bladeSurfaceDeviation(b, s, m.topZ, 31, 211)).toBeLessThanOrEqual(BLADE_CI_TOLERANCE);
    // Everything but the last 0.5% under the tip holds the fit target itself.
    expect(bladeSurfaceDeviation(b, s, m.topZ, 31, 211, 0.995)).toBeLessThanOrEqual(
      BLADE_DEFAULTS.tolerance,
    );
  });

  it('closes on its seam exactly', () => {
    expect(s.ctrl[s.ctrl.length - 1]).toEqual(s.ctrl[0]);
  });

  it('sits its root on the tab top and its top just under the tip', () => {
    for (const row of s.ctrl) {
      expect(Math.abs(row[0]!.z)).toBeLessThan(1e-12);
      expect(Math.abs(row[row.length - 1]!.z - m.topZ)).toBeLessThan(1e-12);
    }
    expect(m.topZ).toBeCloseTo(prepareBlade(d).depth - BLADE_DEFAULTS.tipGap, 12);
  });

  it('creases at the four section corners and nowhere else around', () => {
    const { mults } = knotMultiplicities(s.uKnots);
    // Three interior corners; the fourth is the seam at u = 0 / 1.
    expect(mults.slice(1, -1).filter((k) => k === s.uDegree)).toHaveLength(3);
    expect(m.corners).toHaveLength(3);
  });

  it('stays smooth up the blade past the outline corner', () => {
    // The FinFoil outline has one sharp knot, on the trailing edge near the tip. The foil
    // is laid over smoothed edges, so it no longer creases the blade all the way round.
    const { mults } = knotMultiplicities(s.vKnots);
    expect(mults.slice(1, -1).filter((k) => k === s.vDegree)).toHaveLength(0);
  });
});

describe('bladeSurfaceDeviation', () => {
  it('notices a fit that is too coarse', () => {
    // Guards the metric itself: a 4-row, 4-station grid cannot follow the blade.
    const d = defaultFinDesign('side');
    const m = fitBladeSurface(d, { rows: 4, stations: 4, maxRefinements: 0 });
    expect(m.deviation).toBeGreaterThan(10 * BLADE_DEFAULTS.tolerance);
  });
});
