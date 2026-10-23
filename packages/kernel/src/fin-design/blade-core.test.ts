// SPDX-License-Identifier: GPL-3.0-or-later
/** The blade as a core under a bagged laminate (FinLaminate in blade.ts). */
import { describe, expect, it } from 'vitest';
import { DEG_TO_RAD } from '../constants';
import { bladeSection, prepareBlade, type BladeSection, type FinLaminate } from './blade';
import { defaultCanard, defaultFinDesign } from './fin-defaults';
import { FIN_MIN_THICKNESS, finOutward, type FinDesign } from './fin-design';
import { finMesh } from './fin-mesh';
import { tabFacesY } from './fin-placement';
import { finTabOutline } from './fin-tab';

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

  it('keeps the minimum: with equal laminate, edges that end at it are left as they are', () => {
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

  it.each([
    ['inside', { outside: 0, inside: LAM }],
    ['outside', { outside: LAM, inside: 0 }],
  ] as const)('pulls a laminated %s face in by the whole laminate, edges included', (face, lam) => {
    const d = side();
    const out = finOutward(d.hand);
    const fin = sectionsOf(d);
    const core = sectionsOf(d, lam);
    fin.forEach((s, i) => {
      const c = core[i]!;
      s.inside.forEach((p, j) => {
        // Toward the core: outboard for the inside face, inboard for the outside.
        const inMoved = out * (c.inside[j]!.y - p.y);
        const outMoved = -out * (c.outside[j]!.y - s.outside[j]!.y);
        const [laminated, bare] = face === 'inside' ? [inMoved, outMoved] : [outMoved, inMoved];
        expect(laminated).toBeCloseTo(LAM, 12);
        // The bare face only gives way, where the core would be under the minimum.
        const short = Math.max(0, FIN_MIN_THICKNESS - (widths(s)[j]! - LAM));
        expect(bare).toBeCloseTo(-short, 12);
        expect(widths(c)[j]).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
      });
    });
  });

  it('makes up the minimum on the face with less laminate', () => {
    // A heavy laminate on a canard: near the tip most of the section is under 1 mm + lam.
    const d = defaultCanard('left');
    const heavy = { outside: 0.1, inside: 0.05 };
    const fin = sectionsOf(d);
    const core = sectionsOf(d, heavy);
    let limited = 0;
    fin.forEach((s, i) => {
      s.outside.forEach((p, j) => {
        const giveOut = heavy.outside - (p.y - core[i]!.outside[j]!.y);
        const giveIn = heavy.inside - (core[i]!.inside[j]!.y - s.inside[j]!.y);
        expect(widths(core[i]!)[j]).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
        if (giveOut > 1e-9) {
          limited++;
          expect(widths(core[i]!)[j]).toBeCloseTo(FIN_MIN_THICKNESS, 12);
          expect(giveIn / giveOut).toBeCloseTo(heavy.outside / heavy.inside, 9);
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

  describe('wrapping the tab', () => {
    const d = side();
    const t = finTabOutline(d.base, d.outline).thickness;
    const out = finOutward(d.hand);
    const insideOf = (faces: readonly [number, number]) => (out > 0 ? faces[0] : faces[1]);
    const outsideOf = (faces: readonly [number, number]) => (out > 0 ? faces[1] : faces[0]);

    it('leaves the tab alone unless asked to', () => {
      expect(tabFacesY(d, { outside: LAM, inside: LAM })).toEqual(tabFacesY(d));
      const [lo, hi] = tabFacesY(d);
      expect(hi - lo).toBeCloseTo(t, 12);
    });

    it('pulls in only the laminated faces', () => {
      const plain = tabFacesY(d);
      const inner = tabFacesY(d, { outside: 0, inside: LAM, tab: true });
      expect(outsideOf(inner)).toBe(outsideOf(plain));
      expect(out * (insideOf(inner) - insideOf(plain))).toBeCloseTo(LAM, 12);
      const both = tabFacesY(d, { outside: LAM, inside: LAM, tab: true });
      expect(both[1] - both[0]).toBeCloseTo(t - 2 * LAM, 12);
    });

    it('keeps a flat inside face flush with the tab right to the edges', () => {
      // Upright, so the blade's inside face and the tab's meet square on.
      const lam = { outside: 0, inside: LAM, tab: true };
      const root = bladeSection(prepareBlade(d, lam), 0);
      const tabInside = insideOf(tabFacesY(d, lam));
      for (const p of root.inside) expect(p.y).toBeCloseTo(tabInside, 12);
    });

    it('meshes the thinner tab', () => {
      const lam = { outside: LAM, inside: LAM, tab: true };
      const ys = (m: ReturnType<typeof finMesh>) => {
        const v: number[] = [];
        for (let i = 1; i < m.tab.positions.length; i += 3) v.push(m.tab.positions[i]!);
        return Math.max(...v) - Math.min(...v);
      };
      expect(ys(finMesh(d, { laminate: lam }))).toBeCloseTo(t - 2 * LAM, 6);
    });
  });
});
