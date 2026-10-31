// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import type { BoardMesh } from '../tessellate';
import { cosineStations } from './blade';
import { vec2 } from '../vec2';
import {
  FIN_SLICE_REACH,
  bladeSection,
  chordAt,
  moveFoilThickest,
  prepareBlade,
  sectionThickest,
  sliceWeight,
  thicknessAt,
  thicknessPathOf,
  tipLineEta,
} from './blade';
import { defaultFinDesign, defaultKeel, defaultSingleFin, defaultTwinFin } from './fin-defaults';
import type { FinDesign, FinTwist } from './fin-design';
import { finMesh } from './fin-mesh';
import {
  defaultTipLine,
  outlineAtFraction,
  sweepFrame,
  sweepGrid,
  sweepPointOn,
  sweepTipEdge,
  tipLineOf,
} from './swept-loft';

const here = dirname(fileURLToPath(import.meta.url));

/** An owner's fin from docs/specs/fins (mm → cm), slices and twist included. */
const ownerFin = (name: string): FinDesign => {
  type Row = { e: [number, number]; p: [number, number]; n: [number, number]; c: boolean };
  type Section = { outside: Row[]; inside: Row[] | null };
  const file = JSON.parse(
    readFileSync(resolve(here, '../../../../docs/specs/fins', name), 'utf8'),
  ) as {
    hand: 'left' | 'right';
    cant?: number;
    outline: Row[];
    section: Section;
    slices?: { height: number; section: Section; twist?: FinTwist }[];
    taper: Row[];
  };
  const spline = (rows: Row[], fx: number, fy: number) =>
    splineFromKnots(
      rows.map((k) =>
        knot(
          vec2(k.e[0] * fx, k.e[1] * fy),
          vec2(k.p[0] * fx, k.p[1] * fy),
          vec2(k.n[0] * fx, k.n[1] * fy),
          k.c,
        ),
      ),
    );
  const section = (sec: Section) => ({
    outside: spline(sec.outside, 1, 1),
    inside: sec.inside ? spline(sec.inside, 1, 1) : null,
  });
  return {
    ...defaultFinDesign('side', file.hand),
    cant: file.cant ?? 0,
    outline: spline(file.outline, 0.1, 0.1),
    section: section(file.section),
    slices: (file.slices ?? []).map((sl) => ({
      height: sl.height,
      section: section(sl.section),
      ...(sl.twist ? { twist: sl.twist } : {}),
    })),
    taper: spline(file.taper, 1, 0.1),
  };
};

const FINS: [string, () => FinDesign][] = [
  ['side', () => defaultFinDesign('side', 'left')],
  ['right side', () => defaultFinDesign('side', 'right')],
  ['centre', () => defaultFinDesign('centre')],
  ['keel', () => defaultKeel()],
  ['twin', () => defaultTwinFin()],
  ['single', () => defaultSingleFin()],
  ['hatchet', () => ownerFin('hatchet_hook.fin.json')],
  ['A4C', () => ownerFin('a4c_raised_rear.fin.json')],
  ['corner test fin', () => ownerFin('corner_creases.fin.json')],
];

const volume = ({ positions: P, indices: I }: BoardMesh): number => {
  let v = 0;
  for (let i = 0; i < I.length; i += 3) {
    const [a, b, c] = [I[i]! * 3, I[i + 1]! * 3, I[i + 2]! * 3];
    v +=
      P[a]! * (P[b + 1]! * P[c + 2]! - P[b + 2]! * P[c + 1]!) -
      P[a + 1]! * (P[b]! * P[c + 2]! - P[b + 2]! * P[c]!) +
      P[a + 2]! * (P[b]! * P[c + 1]! - P[b + 1]! * P[c]!);
  }
  return v / 6;
};

describe('the swept loft', () => {
  it.each(FINS)('never folds its sections over each other: %s', (_, make) => {
    const g = sweepGrid(make());
    // Every cell of the base-to-tip-line sweep turns the same way round.
    const sign = (i: number, j: number) => {
      const k = i * g.cols + j;
      const ax = g.x[k + g.cols]! - g.x[k]!;
      const az = g.z[k + g.cols]! - g.z[k]!;
      const bx = g.x[k + 1]! - g.x[k]!;
      const bz = g.z[k + 1]! - g.z[k]!;
      return Math.sign(ax * bz - az * bx);
    };
    const s0 = sign(1, 1);
    for (let i = 0; i < g.tipRow; i++) {
      for (let j = 0; j < g.cols - 1; j++) expect(sign(i, j)).toBe(s0);
    }
  });

  it.each(FINS)('meshes a closed blade: %s', (_, make) => {
    const mesh = finMesh(make()).blade;
    const edges = new Map<string, number>();
    const I = mesh.indices;
    for (let i = 0; i < I.length; i += 3) {
      for (let k = 0; k < 3; k++) {
        const key = `${I[i + k]},${I[i + ((k + 1) % 3)]}`;
        edges.set(key, (edges.get(key) ?? 0) + 1);
      }
    }
    for (const [key, n] of edges) {
      const [a, b] = key.split(',');
      expect(n).toBe(1);
      expect(edges.get(`${b},${a}`)).toBe(1);
    }
    expect(volume(mesh)).toBeGreaterThan(0);
    for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
  });

  it.each(FINS)('puts the default tip line across the tip, on the outline: %s', (_, make) => {
    const d = make();
    const [a, b] = defaultTipLine(d);
    const depth = prepareBlade(d).depth;
    for (const p of [a, b]) expect(p.y).toBeGreaterThan(0.6 * depth);
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeLessThan(0.35 * depth);
    expect(sweepFrame(d).base.pts[0]!.y).toBeCloseTo(0, 9);
  });

  it('follows a tip line the user has moved', () => {
    const d = defaultFinDesign('side', 'left');
    const line = { start: 0.35, end: 0.6 };
    expect(tipLineOf({ ...d, tipLine: line }).start).toBeCloseTo(0.35, 3);
    const f = sweepFrame({ ...d, tipLine: line });
    const want = outlineAtFraction(d.outline, 0.35);
    expect(f.tipStart.x).toBeCloseTo(want.x, 9);
    expect(f.tipStart.y).toBeCloseTo(want.y, 9);
  });

  it('puts the root’s thickest point on the thickness path', () => {
    const d = defaultFinDesign('side', 'left');
    const thickestAt = (dd: FinDesign) => {
      const s = bladeSection(prepareBlade(dd), 0, cosineStations(400));
      const w = s.outside.map((p, j) => p.y - s.inside[j]!.y);
      return s.stations[w.indexOf(Math.max(...w))]!;
    };
    // The path's base end is the base foil's thickest point: reshape the foil, it moves.
    expect(thickestAt({ ...d, section: moveFoilThickest(d.section, 0.45) })).toBeCloseTo(0.45, 2);
    expect(thickestAt({ ...d, section: moveFoilThickest(d.section, 0.25) })).toBeCloseTo(0.25, 2);
  });

  it('blends from the base foil to the tip foil, each section thickest on the path', () => {
    const d = defaultFinDesign('side', 'left');
    const tip = moveFoilThickest(d.section, 0.25);
    const path = thicknessPathOf({ ...d, tipSection: tip });
    expect(path[0]).toBeCloseTo(sectionThickest(d.section).at, 9);
    expect(path[2]).toBeCloseTo(0.25, 2);
    expect(path[1]).toBeCloseTo((path[0] + path[2]) / 2, 9);
    expect(thicknessPathOf({ ...d, tipSection: tip, thicknessMid: 0.5 })[1]).toBe(0.5);
  });

  it('moves a foil’s thickest point, keeping its ends', () => {
    const d = defaultFinDesign('side', 'left');
    for (const to of [0.2, 0.3, 0.5, 0.6]) {
      const m = moveFoilThickest(d.section, to);
      expect(sectionThickest(m).at).toBeCloseTo(to, 2);
      expect(m.outside.knots[0]!.end).toEqual(d.section.outside.knots[0]!.end);
      expect(m.outside.knots.at(-1)!.end).toEqual(d.section.outside.knots.at(-1)!.end);
    }
  });

  it('rounds the tip off past the tip line, to the minimum at the edge', () => {
    const d = defaultKeel();
    const b = prepareBlade(d);
    const near = bladeSection(b, b.depth * 0.995, cosineStations(200));
    const widest = Math.max(...near.outside.map((p, j) => p.y - near.inside[j]!.y));
    expect(widest).toBeLessThan(2 * b.minThickness);
  });

  it('hands the slices back to the sweep at the base and the tip line', () => {
    const d = ownerFin('a4c_raised_rear.fin.json');
    const b = prepareBlade(d);
    const tip = tipLineEta(b);
    expect(sliceWeight(d, 0, tip)).toBe(0);
    expect(sliceWeight(d, d.slices[0]!.height, tip)).toBe(1);
    expect(sliceWeight(d, tip, tip)).toBe(0);
  });

  it.each(FINS)('thins to the minimum right round the tip’s edge, not square: %s', (_, make) => {
    // Owner testing: straight rows across the tip left the outline's bulge beyond them as
    // thick as the row nearest it, a square end in a cut through the tip.
    const d = make();
    const b = prepareBlade(d);
    const f = sweepFrame(d);
    const mid = { x: (f.tipStart.x + f.tipEnd.x) / 2, y: (f.tipStart.y + f.tipEnd.y) / 2 };
    const edge = sweepTipEdge(d);
    for (let k = 1; k < 10; k++) {
      const e = edge[Math.round((k / 10) * (edge.length - 1))]!;
      const len = Math.hypot(mid.x - e.x, mid.y - e.y);
      if (!(len > 0.05)) continue;
      // A tenth of a millimetre in from the edge, toward the tip line's middle: the tip
      // rounds off like a nose, so further in it is still most of its thickness.
      const q = { x: e.x + ((mid.x - e.x) * 0.01) / len, y: e.y + ((mid.y - e.y) * 0.01) / len };
      if (!(q.y > 0 && q.y < b.depth)) continue;
      const c = chordAt(b, q.y);
      const u = (q.x - c.leading) / (c.trailing - c.leading);
      if (!(u > 0 && u < 1)) continue;
      const s = bladeSection(b, q.y, [u]);
      const t = Math.abs(s.outside[0]!.y - s.inside[0]!.y);
      expect(t).toBeLessThan(0.4 * thicknessAt(b, f.tipStart.y) + 2 * b.minThickness);
    }
  });

  it('keeps a slice’s foil to around its height', () => {
    const d = {
      ...defaultFinDesign('side', 'left'),
      slices: [{ height: 0.8, section: defaultFinDesign('centre').section }],
    };
    const tip = tipLineEta(prepareBlade(d));
    expect(sliceWeight(d, 0.8, tip)).toBe(1);
    expect(sliceWeight(d, 0.8 - FIN_SLICE_REACH, tip)).toBe(0);
    expect(sliceWeight(d, 0.3, tip)).toBe(0); // a third of the way up: untouched
    expect(sliceWeight(d, 0.8 - FIN_SLICE_REACH / 2, tip)).toBeCloseTo(0.5, 9);
  });

  it.each(FINS)(
    'only thins going out from the tip foil’s high point to the tip edge: %s',
    (_, make) => {
      // The owner's tip loft: spokes from the high point out to the edge, each thinning
      // all the way (a slope cap on the thickness near the edge left a divot).
      const d = make();
      const b = prepareBlade(d);
      const g = sweepGrid(d);
      const high = sweepPointOn(g, g.tipRow, thicknessPathOf(d)[2]);
      const edge = sweepTipEdge(d);
      const at = (x: number, z: number): number | null => {
        if (!(z > 0 && z < b.depth)) return null;
        const c = chordAt(b, z);
        const u = (x - c.leading) / (c.trailing - c.leading);
        if (!(u > 0 && u < 1)) return null;
        const s = bladeSection(b, z, [u]);
        // As a share of the thickness curve at that height: the curve sets how thick each
        // height is, the tip loft only closes it off.
        return Math.abs(s.outside[0]!.y - s.inside[0]!.y) / thicknessAt(b, z);
      };
      for (let k = 1; k < 12; k++) {
        const e = edge[Math.round((k / 12) * (edge.length - 1))]!;
        let last = Infinity;
        for (let j = 1; j < 20; j++) {
          const t = j / 20;
          const v = at(high.x + (e.x - high.x) * t, high.y + (e.y - high.y) * t);
          if (v === null) continue;
          expect(v).toBeLessThanOrEqual(last + 2e-3);
          last = v;
        }
      }
    },
  );

  it.each(FINS)('has no divot in an upright cut through the tip: %s', (_, make) => {
    // Owner testing: cuts across the tip went thin, thick, thin again. Up any upright
    // line through the tip the blade now thickens to one peak and thins after it.
    const d = make();
    const b = prepareBlade(d);
    const f = sweepFrame(d);
    const low = Math.min(f.tipStart.y, f.tipEnd.y) - 1;
    const x0 = Math.min(...f.tipEdge.pts.map((p) => p.x));
    const x1 = Math.max(f.tipStart.x, f.tipEnd.x);
    for (let k = 1; k < 8; k++) {
      const x = x0 + ((x1 - x0) * k) / 8;
      const ts: number[] = [];
      for (let z = Math.max(0.01, low); z < b.depth; z += 0.02) {
        const c = chordAt(b, z);
        if (!(x < c.leading && x > c.trailing)) {
          if (ts.length) break;
          continue;
        }
        const s = bladeSection(b, z, [(x - c.leading) / (c.trailing - c.leading)]);
        ts.push(Math.abs(s.outside[0]!.y - s.inside[0]!.y));
      }
      // No dip: never down and then up again by more than 0.03 mm (the grid reads to a
      // few thousandths; an outline corner right at the tip line adds a little more).
      let fell = false;
      for (let i = 1; i < ts.length; i++) {
        if (ts[i]! < ts[i - 1]! - 3e-3) fell = true;
        else if (fell) expect(ts[i]!).toBeLessThanOrEqual(ts[i - 1]! + 3e-3);
      }
    }
  });
});
