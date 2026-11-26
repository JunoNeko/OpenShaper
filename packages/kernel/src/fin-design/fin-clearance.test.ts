// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { value } from '../bezier-curve';
import { DEG_TO_RAD } from '../constants';
import { raisedRearDesign, shiftFin } from '../test-support/fin-designs';
import { defaultFinDesign } from './fin-defaults';
import { FIN_POSITIONS, type FinDesign } from './fin-design';
import {
  clearanceAt,
  clearanceShortfall,
  finClearanceShortfall,
  rearClearance,
} from './fin-clearance';
import { futuresTabOutline, type FuturesTabKind } from './futures-tab';

/** Rock a blade-frame point (x, z) about the rear pin by `deg`, front up. */
const rock = (kind: FuturesTabKind, x: number, z: number, deg: number) => {
  const { spec } = futuresTabOutline(kind);
  const px = spec.slotArcCentreFromEnd;
  const pz = -spec.slotCentreBelowTop;
  const t = deg * DEG_TO_RAD;
  return {
    x: px + (x - px) * Math.cos(t) - (z - pz) * Math.sin(t),
    z: pz + (x - px) * Math.sin(t) + (z - pz) * Math.cos(t),
  };
};

describe.each(['side', 'centre'] as const)('rearClearance(%s)', (kind) => {
  const c = rearClearance(kind);
  const tab = futuresTabOutline(kind);

  it('tilts just far enough for the tab’s bottom-front corner to clear the board', () => {
    const B = rock(kind, tab.front.B.x, tab.front.B.y - tab.spec.height, c.tilt);
    expect(B.z).toBeCloseTo(0, 12);
  });

  it('puts a point on the clearance line exactly on the board at that tilt', () => {
    for (const x of [-0.01, -0.8, -1.8, -4]) {
      expect(rock(kind, x, clearanceAt(c, x), c.tilt).z).toBeCloseTo(0, 12);
      // Higher clears; lower would dig in.
      expect(rock(kind, x, clearanceAt(c, x) + 0.01, c.tilt).z).toBeGreaterThan(0);
    }
  });

  it('matches the agreed figures', () => {
    // docs/design/fin-designer.md, "Insertion clearance".
    const want =
      kind === 'side'
        ? { tilt: 9.39, mm: [0.63, 1.95, 3.61] }
        : { tilt: 6.67, mm: [0.43, 1.36, 2.53] };
    expect(c.tilt).toBeCloseTo(want.tilt, 2);
    [0, -0.8, -1.8].forEach((x, i) => expect(clearanceAt(c, x) * 10).toBeCloseTo(want.mm[i]!, 2));
  });
});

/** Shortfall by brute force: dense samples behind the tab. */
const sampledShortfall = (d: FinDesign): number => {
  const c = rearClearance(d.position === 'side' ? 'side' : 'centre');
  let worst = 0;
  for (const k of d.outline.coeffs) {
    for (let i = 0; i <= 5000; i++) {
      const p = value(k, i / 5000);
      if (p.x < -1e-9) worst = Math.max(worst, clearanceAt(c, p.x) - p.y);
    }
  }
  return worst;
};

describe('clearanceShortfall', () => {
  it.each(FIN_POSITIONS)('passes the default %s fin', (position) => {
    expect(finClearanceShortfall(defaultFinDesign(position))).toBe(0);
  });

  it('passes the raised-rear fin', () => {
    expect(finClearanceShortfall(raisedRearDesign())).toBe(0);
  });

  it.each([0.1, 0.5, 1.5])('is exact for a fin moved %s cm back', (dx) => {
    for (const d of [defaultFinDesign('side'), raisedRearDesign()]) {
      const moved = shiftFin(d, -dx);
      const exact = finClearanceShortfall(moved);
      const sampled = sampledShortfall(moved);
      // Never below what sampling finds, and no more than sampling's resolution above.
      expect(exact).toBeGreaterThanOrEqual(sampled - 1e-12);
      expect(exact - sampled).toBeLessThan(1e-6);
    }
  });

  it('reads a flat base behind the tab as short by the line’s height there', () => {
    // Moved 1 cm back, the default's base reaches x = −1 at height 0.
    const c = rearClearance('side');
    const moved = shiftFin(defaultFinDesign('side'), -1);
    expect(clearanceShortfall(moved.outline, c)).toBeCloseTo(clearanceAt(c, -1), 9);
  });
});
