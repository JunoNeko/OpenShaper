// SPDX-License-Identifier: GPL-3.0-or-later
/** The blade as a core under a bagged laminate (FinLaminate in blade.ts). */
import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '../constants';
import { bladeSection, prepareBlade, type BladeSection, type FinLaminate } from './blade';
import { defaultCanard, defaultFinDesign } from './fin-defaults';
import { FIN_MIN_THICKNESS, finOutward, type FinDesign } from './fin-design';
import { finMesh } from './fin-mesh';

const LAM = 0.02; // 0.2 mm: one ply of 200 gsm unidirectional carbon

/** Upright (no cant), so a horizontal width is the thickness square to the blade. */
const side = (hand: 'left' | 'right' = 'left'): FinDesign => ({
  ...defaultFinDesign('side', hand),
  cant: 0,
});

const sectionsOf = (d: FinDesign, laminate?: FinLaminate): BladeSection[] => {
  const b = prepareBlade(d, laminate);
  return [0, 0.25, 0.5, 0.75, 0.95].map((f) => bladeSection(b, b.depth * f));
};

const widths = (s: BladeSection): number[] =>
  s.outside.map((o, j) => Math.abs(o.y - s.inside[j]!.y));

describe('the blade as a laminate core', () => {
  it('is the finished blade when there is no laminate', () => {
    const d = side();
    expect(sectionsOf(d, { outside: 0, inside: 0 })).toEqual(sectionsOf(d));
  });

  it('is thinner by the laminate on both faces wherever there is room', () => {
    const d = side();
    const fin = sectionsOf(d);
    const core = sectionsOf(d, { outside: LAM, inside: LAM });
    fin.forEach((s, i) => {
      const w = widths(s);
      const c = widths(core[i]!);
      w.forEach((wj, j) => {
        if (wj >= FIN_MIN_THICKNESS + 2 * LAM) expect(c[j]).toBeCloseTo(wj - 2 * LAM, 12);
        expect(c[j]).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
      });
    });
  });

  it('keeps the minimum: edges that end at it are left as they are', () => {
    const fin = sectionsOf(side());
    const core = sectionsOf(side(), { outside: LAM, inside: LAM });
    fin.forEach((s, i) => {
      const last = s.outside.length - 1;
      for (const j of [0, last]) {
        expect(core[i]!.outside[j]).toEqual(s.outside[j]);
        expect(core[i]!.inside[j]).toEqual(s.inside[j]);
      }
    });
  });

  it('takes laminate off the inside face only, and moves it outboard', () => {
    const d = side();
    const out = finOutward(d.hand);
    const fin = sectionsOf(d);
    const core = sectionsOf(d, { outside: 0, inside: LAM });
    fin.forEach((s, i) => {
      expect(core[i]!.outside).toEqual(s.outside);
      s.inside.forEach((p, j) => {
        const moved = out * (core[i]!.inside[j]!.y - p.y);
        expect(moved).toBeGreaterThanOrEqual(-1e-12);
        expect(moved).toBeLessThanOrEqual(LAM + 1e-12);
        if (widths(s)[j]! >= FIN_MIN_THICKNESS + LAM) expect(moved).toBeCloseTo(LAM, 12);
      });
    });
  });

  it('takes laminate off the outside face only, and moves it inboard', () => {
    const d = side();
    const out = finOutward(d.hand);
    const fin = sectionsOf(d);
    const core = sectionsOf(d, { outside: LAM, inside: 0 });
    fin.forEach((s, i) => {
      expect(core[i]!.inside).toEqual(s.inside);
      s.outside.forEach((p, j) => {
        const moved = out * (p.y - core[i]!.outside[j]!.y);
        if (widths(s)[j]! >= FIN_MIN_THICKNESS + LAM) expect(moved).toBeCloseTo(LAM, 12);
      });
    });
  });

  it('shares what it takes between the faces where the minimum limits it', () => {
    // A heavy laminate on a canard: near the tip most of the section is under 1 mm + 2 × lam.
    const d = defaultCanard('left');
    const heavy = { outside: 0.1, inside: 0.05 };
    const fin = sectionsOf(d);
    const core = sectionsOf(d, heavy);
    let limited = 0;
    fin.forEach((s, i) => {
      s.outside.forEach((p, j) => {
        const offOut = p.y - core[i]!.outside[j]!.y;
        const offIn = core[i]!.inside[j]!.y - s.inside[j]!.y;
        expect(widths(core[i]!)[j]).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
        if (offOut > 1e-9 && offOut < heavy.outside - 1e-9) {
          limited++;
          expect(offOut / offIn).toBeCloseTo(heavy.outside / heavy.inside, 9);
        }
      });
    });
    expect(limited).toBeGreaterThan(0);
  });

  it('is measured square to a canted blade', () => {
    const d = defaultFinDesign('side', 'left');
    expect(d.cant).toBeGreaterThan(0);
    const widen = 1 / Math.cos(d.cant * DEG_TO_RAD);
    const fin = sectionsOf(d);
    const core = sectionsOf(d, { outside: LAM, inside: LAM });
    const j = Math.round(fin[0]!.stations.length / 3);
    expect(widths(fin[0]!)[j]! - widths(core[0]!)[j]!).toBeCloseTo(2 * LAM * widen, 12);
  });

  it('mirrors from a left fin to a right one', () => {
    const lam = { outside: LAM, inside: 0.025 };
    const l = sectionsOf(side('left'), lam);
    const r = sectionsOf(side('right'), lam);
    l.forEach((s, i) => {
      s.outside.forEach((p, j) => expect(r[i]!.outside[j]!.y).toBeCloseTo(-p.y, 12));
      s.inside.forEach((p, j) => expect(r[i]!.inside[j]!.y).toBeCloseTo(-p.y, 12));
    });
  });

  it('leaves the tab alone: it still has to fit the box', () => {
    const d = side();
    expect(finMesh(d, { laminate: { outside: LAM, inside: LAM } }).tab).toEqual(finMesh(d).tab);
  });
});
