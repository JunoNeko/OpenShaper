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
import { bladeSection, prepareBlade, sliceWeight, tipLineEta } from './blade';
import { defaultFinDesign, defaultKeel, defaultSingleFin, defaultTwinFin } from './fin-defaults';
import type { FinDesign, FinTwist } from './fin-design';
import { finMesh } from './fin-mesh';
import { defaultTipLine, outlineAtFraction, sweepFrame, sweepGrid, tipLineOf } from './swept-loft';

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
    expect(thickestAt({ ...d, thicknessPath: [0.45, 0.4, 0.4] })).toBeCloseTo(0.45, 2);
    expect(thickestAt({ ...d, thicknessPath: [0.25, 0.4, 0.4] })).toBeCloseTo(0.25, 2);
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
});
