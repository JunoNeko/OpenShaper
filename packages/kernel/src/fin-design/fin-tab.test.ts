// SPDX-License-Identifier: GPL-3.0-or-later
/** The fin's base: Futures tabs and the FCS single tab (fin-tab.ts). */
import { describe, expect, it } from 'vitest';
import type { BoardMesh } from '../tessellate';
import { defaultCanard, defaultFinDesign } from './fin-defaults';
import { finReadouts } from './fin-readouts';
import { finMesh } from './fin-mesh';
import { leadingRootRange, nudgeFore, placeOnBase, tabCentreY } from './fin-placement';
import { validateFinDesign } from './fin-rules';
import { FCS_SINGLE_TAB, FIN_BASES, finTabOutline, futuresKind } from './fin-tab';
import { FUTURES_TABS } from './futures-tab';

/** Every directed edge once, and its reverse once: closed and consistently wound. */
const closedAndOriented = (m: BoardMesh): boolean => {
  const directed = new Map<string, number>();
  for (let i = 0; i < m.indices.length; i += 3) {
    const t = [m.indices[i]!, m.indices[i + 1]!, m.indices[i + 2]!];
    for (let k = 0; k < 3; k++) {
      const key = `${t[k]},${t[(k + 1) % 3]}`;
      directed.set(key, (directed.get(key) ?? 0) + 1);
    }
  }
  for (const [key, count] of directed) {
    const [a, b] = key.split(',');
    if (count !== 1 || directed.get(`${b},${a}`) !== 1) return false;
  }
  return true;
};

const canard = () => placeOnBase(defaultFinDesign('side', 'left'), 'fcs-single');

describe('finTabOutline', () => {
  it('is the Futures tab for a Futures base', () => {
    expect(finTabOutline('futures-side').height).toBe(FUTURES_TABS.side.height);
    expect(finTabOutline('futures-centre').height).toBe(FUTURES_TABS.centre.height);
  });

  it('is a plain 20.5 × 13.5 × 6.35 mm block for the FCS single tab', () => {
    const t = finTabOutline('fcs-single');
    expect([t.length, t.height, t.thickness]).toEqual([2.05, 1.35, 0.635]);
    expect(t.segments).toHaveLength(4);
    // Closed and counter-clockwise: positive signed area, equal to length × height.
    let area = 0;
    for (const s of t.segments) area += s.from.x * s.to.y - s.to.x * s.from.y;
    expect(area / 2).toBeCloseTo(FCS_SINGLE_TAB.length * FCS_SINGLE_TAB.height, 12);
  });

  it('names a Futures kind only for the Futures bases', () => {
    expect(FIN_BASES.map(futuresKind)).toEqual(['side', 'centre', null]);
  });
});

describe('a fin on an FCS single tab', () => {
  it('starts centred over the tab, with no cant, and breaks no rule', () => {
    const d = canard();
    const k = d.outline.knots;
    const mid = (k[0]!.end.x + k[k.length - 1]!.end.x) / 2;
    expect(mid).toBeCloseTo(FCS_SINGLE_TAB.length / 2, 12);
    expect(d.cant).toBe(0);
    expect(validateFinDesign(d)).toEqual([]);
  });

  it('keeps a flat inside face flush with the tab', () => {
    const d = canard();
    expect(tabCentreY(d)).toBeCloseTo(FCS_SINGLE_TAB.thickness / 2, 12); // left fin: +Y
  });

  it('has no cant: the plug carries it', () => {
    const codes = validateFinDesign({ ...canard(), cant: 5 }).map((i) => i.code);
    expect(codes).toContain('cant');
  });

  it('needs the tab wholly under the base, but has no Futures overhang or clearance rule', () => {
    const d = canard();
    const { min, max } = leadingRootRange(d);
    // The leading-edge root may run from the tab's front to a root chord ahead of it.
    expect(min).toBeCloseTo(FCS_SINGLE_TAB.length, 12);
    const k = d.outline.knots;
    expect(max).toBeCloseTo(k[0]!.end.x - k[k.length - 1]!.end.x, 12);
  });

  it('nudges fore and aft only as far as keeps the tab covered', () => {
    let d = canard();
    for (let i = 0; i < 200; i++) d = nudgeFore(d, 0.5);
    const k = () => d.outline.knots;
    expect(k()[k().length - 1]!.end.x).toBeCloseTo(0, 9); // trailing-edge root on the tab's rear end
    expect(validateFinDesign(d)).toEqual([]);
    for (let i = 0; i < 200; i++) d = nudgeFore(d, -0.5);
    expect(k()[0]!.end.x).toBeCloseTo(FCS_SINGLE_TAB.length, 9); // leading-edge root on its front
    expect(validateFinDesign(d)).toEqual([]);
  });

  it('meshes the FCS tab as a closed block under the blade', () => {
    const m = finMesh(canard());
    expect(closedAndOriented(m.tab)).toBe(true);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < m.tab.positions.length; i += 3) {
      lo = Math.min(lo, m.tab.positions[i]!);
      hi = Math.max(hi, m.tab.positions[i]!);
    }
    expect(hi - lo).toBeCloseTo(FCS_SINGLE_TAB.length, 6); // positions are 32-bit
  });

  it('goes back to a Futures tab rear-aligned, cant free again', () => {
    const d = placeOnBase(canard(), 'futures-side');
    const k = d.outline.knots;
    expect(k[k.length - 1]!.end.x).toBeCloseTo(0, 12);
    expect(d.base).toBe('futures-side');
  });
});

describe('the starting canard', () => {
  it.each(['left', 'right'] as const)(
    'is a valid %s fin on the FCS tab, centred, no cant',
    (hand) => {
      const d = defaultCanard(hand);
      expect(validateFinDesign(d)).toEqual([]);
      expect(d.base).toBe('fcs-single');
      expect(d.cant).toBe(0);
      expect(d.hand).toBe(hand);
      const k = d.outline.knots;
      expect((k[0]!.end.x + k[k.length - 1]!.end.x) / 2).toBeCloseTo(FCS_SINGLE_TAB.length / 2, 9);
    },
  );

  it('is the owner’s canard: 69.3 mm at the base, 80.6 mm deep, 8 mm thick at the root', () => {
    const r = finReadouts(defaultCanard());
    expect(r.rootChord * 10).toBeCloseTo(69.26, 1);
    expect(r.depth * 10).toBeCloseTo(80.6, 0);
    expect(defaultCanard().taper.knots[0]!.end.y).toBeCloseTo(0.8, 12);
  });

  it('meshes as closed shells', () => {
    const m = finMesh(defaultCanard('right'));
    expect(closedAndOriented(m.blade)).toBe(true);
    expect(closedAndOriented(m.tab)).toBe(true);
  });
});
