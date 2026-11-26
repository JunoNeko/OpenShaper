// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { board, getRockerAtPos, getWidthAtPos, type BezierBoard } from './board';
import { boardFinMesh } from './fin-board';
import { validateFinDesign } from './fin-design/fin-rules';
import {
  FIN_SIZES,
  defaultBoardFins,
  finLabel,
  finSetOf,
  finSetsFor,
  withFinSet,
  withCanardBox,
  withFinSystem,
  withLibraryFin,
  withOwnFin,
  withPlugCant,
} from './fin-library';
import { defaultFinDesign } from './fin-design/fin-defaults';
import {
  designDepth,
  finGroups,
  resolveFins,
  type FinConfig,
  type FinSetup,
  type FinSystem,
} from './fins';
import { finCavities } from './fin-cavities';
import { bottomZAt } from './surface';
import { parseBrdGeometry } from './test-support/brd-geometry';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);
const withFins = (fins: FinConfig): BezierBoard => {
  const b = shortboard;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, fins);
};

const SETUPS: FinSetup[] = ['single', 'twin', 'thruster', 'quad', '2+1', '5-fin', 'twinzer'];
const SYSTEMS: FinSystem[] = ['futures', 'fcs-ii', 'fcs-x2', 'glass-on'];

describe('fin library', () => {
  it('gives every setup, system and size valid fins, as the designer would accept them', () => {
    for (const setup of SETUPS) {
      for (const system of SYSTEMS) {
        for (const set of finSetsFor(setup)) {
          for (const size of FIN_SIZES) {
            const cfg = withFinSet(defaultBoardFins(setup, system), set.id, size);
            for (const f of cfg.fins) {
              expect(f.design).toBeDefined();
              expect(validateFinDesign(f.design!)).toEqual([]);
              // A fin's hand matches its side, so the 3D view turns it over, not mirrors it.
              if (f.side !== 0) expect(f.design!.hand).toBe(f.side > 0 ? 'right' : 'left');
            }
            expect(finSetOf(cfg)).toEqual({ set, size });
          }
        }
      }
    }
  });

  it('sizes S, M and L: deeper each step', () => {
    const depth = (size: 'S' | 'M' | 'L') =>
      designDepth(withFinSet(defaultBoardFins('thruster', 'futures'), 'thruster', size).fins[0]!.design!); // prettier-ignore
    expect(depth('S')).toBeLessThan(depth('M'));
    expect(depth('M')).toBeLessThan(depth('L'));
    expect(depth('M')).toBeCloseTo(11.2, 1); // 112 mm: a medium thruster side fin
  });

  it('puts each fin on the tab its system takes', () => {
    const tabs = (system: FinSystem) =>
      defaultBoardFins('quad', system).fins.map((f) => f.design!.base);
    expect(tabs('futures')).toEqual(['futures-side', 'futures-side', 'futures-centre', 'futures-centre']); // prettier-ignore
    expect(tabs('fcs-ii')).toEqual(['fcs-1', 'fcs-1', 'fcs-1', 'fcs-1']);
    expect(defaultBoardFins('2+1', 'futures').fins[2]!.design!.base).toBe('us-box');
    // Switching system re-seats them.
    const moved = withFinSystem(defaultBoardFins('thruster', 'futures'), 'fcs-ii');
    expect(moved.fins.map((f) => f.design!.base)).toEqual(['fcs-1', 'fcs-1', 'fcs-1']);
  });

  it('FCS plugs carry the cant: front sides and rears 5 or 9 deg, the centre upright; Futures fins their own', () => {
    const cfg = withPlugCant(defaultBoardFins('thruster', 'fcs-ii'), 'front', 9);
    const fins = resolveFins(withFins(cfg));
    expect(fins.map((f) => f.plugCant)).toEqual([9, 9, 0]);
    expect(fins.map((f) => f.cant)).toEqual([9, 9, 0]); // FCS fins' blades stand straight on the plug
    const quad = resolveFins(withFins(withPlugCant(defaultBoardFins('quad', 'fcs-ii'), 'rear', 9)));
    expect(quad.map((f) => f.plugCant)).toEqual([5, 5, 9, 9]);
    const futures = resolveFins(withFins(defaultBoardFins('thruster', 'futures')));
    expect(futures.map((f) => f.plugCant)).toEqual([0, 0, 0]);
    expect(futures[0]!.cant).toBeGreaterThan(0); // the blade's own lean
  });

  it('mix and match: one fin and its mirror, or one alone when not kept matched', () => {
    const cfg = defaultBoardFins('quad', 'futures');
    const one = withLibraryFin(cfg, 2, 'keel', 'S');
    expect(one.fins.map((f) => f.library?.fin)).toEqual(['thruster-side', 'thruster-side', 'keel', 'keel']); // prettier-ignore
    expect(one.fins[3]!.design!.hand).toBe(one.fins[3]!.side > 0 ? 'right' : 'left');
    const alone = withLibraryFin({ ...cfg, symmetrical: false }, 2, 'keel', 'S');
    expect(alone.fins.map((f) => f.library?.fin)).toEqual(['thruster-side', 'thruster-side', 'keel', 'quad-rear']); // prettier-ignore
    expect(finSetOf(one)).toBeNull();
    expect(finLabel(one.fins[2]!)).toBe('Keel S');
    const own = withOwnFin(cfg, 0, defaultFinDesign('side', 'right'));
    expect(finLabel(own.fins[0]!)).toBe('Own design');
    expect(own.fins.map((f) => f.design!.hand).slice(0, 2)).toEqual(['left', 'right']);
  });

  it('hangs each blade from the bottom at its fin, leaning away from the stringer', () => {
    const b = withFins(defaultBoardFins('thruster', 'futures'));
    for (const fin of resolveFins(b)) {
      const m = boardFinMesh(b, fin);
      const p = m.positions;
      let top = -Infinity;
      let bottom = Infinity;
      let sx = 0;
      let sy = 0;
      let deepY = 0;
      for (let i = 0; i < p.length; i += 3) {
        top = Math.max(top, p[i + 2]!);
        if (p[i + 2]! < bottom) {
          bottom = p[i + 2]!;
          deepY = p[i + 1]!;
        }
        sx += p[i]!;
        sy += p[i + 1]!;
      }
      const n = p.length / 3;
      const surface = bottomZAt(b, fin.center.x, Math.abs(fin.center.y));
      // The root on the bottom, square to it: along the tangent at the base's middle, it
      // touches the bottom and nowhere rises into the board.
      let into = -Infinity;
      for (let i = 0; i < p.length; i += 3) {
        into = Math.max(into, p[i + 2]! - bottomZAt(b, p[i]!, Math.abs(p[i + 1]!)));
      }
      expect(into).toBeLessThan(0.05);
      expect(into).toBeGreaterThan(-0.1);
      void top;
      // As deep as the fin below the bottom, near enough (cant and the bottom's slope).
      let deepest = 0;
      for (let i = 0; i < p.length; i += 3) if (p[i + 2]! < p[deepest + 2]!) deepest = i;
      const under = bottomZAt(b, p[deepest]!, Math.abs(p[deepest + 1]!)) - bottom;
      expect(under).toBeCloseTo(fin.spec.depth, 0);
      void surface;
      expect(Math.abs(sx / n - fin.center.x)).toBeLessThan(fin.spec.base); // at its place along
      expect(Math.abs(sy / n - fin.center.y)).toBeLessThan(1.5); // and across
      if (fin.side !== 0) expect(Math.sign(deepY - fin.center.y)).toBe(fin.side); // tip leans out
    }
  });

  it('places every fin by its fin dot: choosing another fin moves the box, not the dot', () => {
    const twin = defaultBoardFins('twin', 'futures');
    const keel = withLibraryFin(twin, 0, 'keel', 'L');
    const [a, b] = [resolveFins(withFins(twin))[0]!, resolveFins(withFins(keel))[0]!];
    // The dot: the trailing edge's root, at the typed distance and inset.
    expect(b.dot).toEqual(a.dot);
    expect(a.dot.x).toBeCloseTo(twin.fins[0]!.trailingFromTail, 9);
    const half = getWidthAtPos(shortboard, a.dot.x) / 2;
    expect(half - Math.abs(a.dot.y)).toBeCloseTo(twin.fins[0]!.insetFromRail, 9);
    expect(a.baseLine.aft).toEqual(a.dot);
    // The keel's tab sits further ahead of its trailing edge than the twin's: its box
    // moves forward of the dot.
    const back = (f: typeof a) => Math.hypot(f.slot!.rear.x - f.dot.x, f.slot!.rear.y - f.dot.y);
    expect(back(b)).not.toBeCloseTo(back(a), 2);
    expect(b.boxCenter.x).not.toBeCloseTo(a.boxCenter.x, 2);
    // Toe turns the fin about its dot.
    const toed = resolveFins(withFins({ ...twin, fins: twin.fins.map((f) => ({ ...f, toe: 4 })) }))[0]!; // prettier-ignore
    expect(toed.dot).toEqual(a.dot);
    expect(toed.slot!.rear).not.toEqual(a.slot!.rear);
  });

  it('stands each fin square to the bottom: its base along the rocker at the base middle', () => {
    const b = withFins(defaultBoardFins('thruster', 'futures'));
    for (const fin of resolveFins(b)) {
      const h = 0.25;
      const slope = (getRockerAtPos(b, fin.center.x + h) - getRockerAtPos(b, fin.center.x - h)) / (2 * h); // prettier-ignore
      expect(fin.pitch).toBeCloseTo(Math.atan(slope), 2);
      expect(Math.abs(fin.pitch)).toBeGreaterThan(0.01); // a tail kick: not level
    }
  });

  it('twinzer: canards ahead in FCS single plugs, twins on the system chosen', () => {
    const cfg = defaultBoardFins('twinzer', 'futures');
    expect(finGroups('twinzer')).toEqual(['canard', 'canard', 'side', 'side']);
    expect(cfg.fins.map((f) => f.side)).toEqual([-1, 1, -1, 1]);
    expect(cfg.fins.map((f) => f.library?.fin)).toEqual(['canard', 'canard', 'twin', 'twin']);
    expect(cfg.fins.map((f) => f.design!.base)).toEqual(['fcs-single', 'fcs-single', 'futures-side', 'futures-side']); // prettier-ignore
    // The owner's placement: canards 343 mm from the tail, 47 mm in, 4° toe; twins
    // 218 mm, 51 mm in, 2°.
    expect(cfg.fins[0]).toMatchObject({ trailingFromTail: 34.324, insetFromRail: 4.656, toe: 4 });
    expect(cfg.fins[2]).toMatchObject({ trailingFromTail: 21.84, insetFromRail: 5.133, toe: 2 });
    // The canards' single plugs at 9° unless set, on Futures twins too.
    expect(resolveFins(withFins(cfg)).map((f) => f.plugCant)).toEqual([9, 9, 0, 0]);
    expect(resolveFins(withFins(withPlugCant(cfg, 'canard', 5))).map((f) => f.cant)).toEqual([5, 5, 7, 7]); // prettier-ignore
    // Twins on FCS II: their plugs, the canards still on single plugs.
    const fcs = withFinSystem(cfg, 'fcs-ii');
    expect(fcs.fins.map((f) => f.design!.base)).toEqual(['fcs-single', 'fcs-single', 'fcs-1', 'fcs-1']); // prettier-ignore
    expect(resolveFins(withFins(withPlugCant(fcs, 'front', 9))).map((f) => f.plugCant)).toEqual([9, 9, 9, 9]); // prettier-ignore
    expect(resolveFins(withFins(fcs)).map((f) => f.plugCant)).toEqual([9, 9, 5, 5]);
    // No plug cant in a Futures canard box (not known yet).
    expect(resolveFins(withFins(withCanardBox(cfg, 'futures-canard')))[0]!.plugCant).toBe(0);
    expect(finSetOf(fcs)?.set.id).toBe('twinzer');
  });

  it('twinzer cavities: a 26 mm round plug, 20 mm deep, for each canard; the twins by system', () => {
    const b = withFins(defaultBoardFins('twinzer', 'futures'));
    const cav = finCavities(b);
    expect(cav.map((c) => c.kind)).toEqual(['FCS single', 'FCS single', 'Futures F', 'Futures F']); // prettier-ignore
    const plug = cav[0]!.steps[0]!;
    expect(plug.depth).toBeCloseTo(2.0, 9);
    const r = Math.max(...plug.outline.map((p) => Math.hypot(p.x, p.y)));
    expect(r * 2).toBeCloseTo(2.6, 9);
    // The plug sits under the canard's tab.
    const fin = resolveFins(b)[0]!;
    expect(cav[0]!.origin.x).toBeCloseTo(fin.boxCenter.x, 9);
    // Glass-on twins: the canards' plugs alone. Futures' canard box isn't known: none.
    const glass = withFins(withFinSystem(defaultBoardFins('twinzer', 'futures'), 'glass-on'));
    expect(finCavities(glass).map((c) => c.fin)).toEqual([0, 1]);
    const futuresCanard = withFins(withCanardBox(defaultBoardFins('twinzer', 'futures'), 'futures-canard')); // prettier-ignore
    expect(finCavities(futuresCanard).map((c) => c.fin)).toEqual([2, 3]);
  });
});
