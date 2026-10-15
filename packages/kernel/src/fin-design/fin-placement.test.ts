// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';
import { bladeSection, prepareBlade } from './blade';
import { defaultFinDesign } from './fin-defaults';
import { FIN_MAX_FRONT_OVERHANG, type FinDesign } from './fin-design';
import {
  lateralOffsetRange,
  leadingRootRange,
  nudgeFore,
  nudgeLateral,
  tabCentreY,
} from './fin-placement';
import { validateFinDesign } from './fin-rules';
import { FUTURES_TABS } from './futures-tab';

const T = FUTURES_TABS.side.thickness;
const le = (d: FinDesign) => d.outline.knots[0]!.end.x;

describe('tabCentreY', () => {
  it('puts the tab flush with a flat inside face', () => {
    // The flat face is the chord line, y = 0 at the root; the tab extends outboard.
    expect(tabCentreY(defaultFinDesign('side', 'right')) - T / 2).toBeCloseTo(0, 15);
    expect(tabCentreY(defaultFinDesign('side', 'left')) + T / 2).toBeCloseTo(0, 15);
    expect(tabCentreY(defaultFinDesign('quad-rear', 'right')) - T / 2).toBeCloseTo(0, 15);
  });

  it('centres the tab under a symmetric foil', () => {
    expect(tabCentreY(defaultFinDesign('centre'))).toBe(0);
  });

  it('moves the tab inboard as the blade moves outboard', () => {
    const d = defaultFinDesign('side', 'right');
    expect(tabCentreY({ ...d, lateralOffset: 0.1 })).toBeCloseTo(T / 2 - 0.1, 15);
    const l = defaultFinDesign('side', 'left');
    expect(tabCentreY({ ...l, lateralOffset: 0.1 })).toBeCloseTo(-T / 2 + 0.1, 15);
  });
});

describe('nudgeFore', () => {
  const d = defaultFinDesign('side', 'right');

  it('moves the whole outline', () => {
    const moved = nudgeFore(d, 0.05);
    moved.outline.knots.forEach((k, i) => {
      expect(k.end.x).toBeCloseTo(d.outline.knots[i]!.end.x + 0.05, 12);
      expect(k.end.y).toBe(d.outline.knots[i]!.end.y);
    });
  });

  it('stops hard 2.5 mm past the tab front', () => {
    let f = d;
    for (let i = 0; i < 100; i++) f = nudgeFore(f, 0.05);
    expect(le(f)).toBeCloseTo(11.3 + FIN_MAX_FRONT_OVERHANG, 12);
    expect(validateFinDesign(f)).toEqual([]);
    expect(nudgeFore(f, 0.05)).toBe(f); // at the stop, nothing changes
  });

  it('stops at the tab rear end going back', () => {
    const f = nudgeFore(d, -100);
    expect(le(f)).toBe(leadingRootRange(f).min);
    expect(validateFinDesign(f)).toEqual([]);
  });
});

/** A strongly cambered foil: a thin outside face, a deep inside curve bulging inboard. */
const cambered = (): FinDesign => {
  const d = defaultFinDesign('side', 'right');
  const scaled = (f: number) =>
    splineFromKnots(
      d.section.outside.knots.map((k) => {
        const m = (p: Vec2) => vec2(p.x, p.y * f);
        return knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous);
      }),
    );
  return { ...d, section: { outside: scaled(0.2), inside: scaled(-1) } };
};

describe('nudgeLateral', () => {
  it('keeps the default fins in range', () => {
    for (const d of [
      defaultFinDesign('side', 'right'),
      defaultFinDesign('side', 'left'),
      defaultFinDesign('centre'),
    ]) {
      const { min, max } = lateralOffsetRange(d);
      expect(min).toBeLessThan(0);
      expect(max).toBeGreaterThan(0);
    }
  });

  it('stops where the tab centre reaches a face of the foil', () => {
    const d = defaultFinDesign('side', 'right');
    const b = prepareBlade(d);
    const root = bladeSection(b, 0, [b.thickestAt]);
    const out = nudgeLateral(d, -10); // blade far inboard: tab under the outside face
    expect(tabCentreY(out)).toBeCloseTo(root.outside[0]!.y, 12);
    const inn = nudgeLateral(d, 10); // blade far outboard: tab under the inside face
    expect(tabCentreY(inn)).toBeCloseTo(root.inside[0]!.y, 12);
    expect(validateFinDesign(out)).toEqual([]);
    expect(validateFinDesign(inn)).toEqual([]);
  });

  it('lets a cambered foil be slid back over the tab', () => {
    const d = cambered();
    // Flush with the chord line, the deep inside curve leaves the tab off the foil.
    expect(validateFinDesign(d).map((i) => i.code)).toEqual(['tab-contact']);
    const fixed = nudgeLateral(d, 0.5);
    expect(fixed.lateralOffset).toBe(0.5);
    expect(validateFinDesign(fixed)).toEqual([]);
  });
});
