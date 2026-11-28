// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { vec2 } from '../vec2';
import { bladeSection, prepareBlade, thicknessAt } from './blade';
import { defaultFinDesign, defaultKeel, defaultSingleFin, defaultTwinFin } from './fin-defaults';
import type { FinDesign } from './fin-design';
import { fairness } from './fairness';
import { finMesh, FIN_MESH_PREVIEW } from './fin-mesh';
import { sliceMesh } from './mesh-slice';
import { splineExtremes, yAtX } from './curve-shape';
import {
  foilWarp,
  smoothBlade,
  smoothMap,
  smoothFoilAt,
  smoothLocate,
  smoothRowAtEta,
  smoothEta,
  smoothSampler,
} from './smooth-blade';
import { moveFoilThickest, sectionShapeAt, sectionThickest, tipFoilOf } from './blade';
import { nacaSection } from './naca';
import { sweepFrame } from './swept-loft';

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
    slices?: { height: number; section: Section }[];
    taper: Row[];
    tipLine?: { start: number; end: number };
    tipSection?: Section;
    thicknessMid?: number;
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
    })),
    taper: spline(file.taper, 1, 0.1),
    ...(file.tipLine ? { tipLine: file.tipLine } : {}),
    ...(file.tipSection ? { tipSection: section(file.tipSection) } : {}),
    ...(file.thicknessMid !== undefined ? { thicknessMid: file.thicknessMid } : {}),
  };
};

/** The fins the gate is held to: the starting fins and the owners', without control sections. */
const FINS: [string, () => FinDesign][] = [
  ['side', () => defaultFinDesign('side', 'left')],
  ['right side', () => defaultFinDesign('side', 'right')],
  ['centre', () => defaultFinDesign('centre')],
  ['keel', () => defaultKeel()],
  ['twin', () => defaultTwinFin()],
  ['single', () => defaultSingleFin()],
  ['TSN 800 single (hooked)', () => ownerFin('tsn_800_single.fin.json')],
  ['hatchet, tip crossing', () => ownerFin('hatchet_tip_crossing.fin.json')],
  ['steep tip line', () => ownerFin('steep_tip_line.fin.json')],
  ['swept-back tip', () => ownerFin('swept_back_tip.fin.json')],
];

describe('past the tip line (owner proposal: the thickness path carried on to the profile)', () => {
  const fins: [string, FinDesign][] = [
    ['the starting fin', defaultFinDesign('side', 'left')],
    ['the centre fin', defaultFinDesign('centre')],
    ['a raked tip', ownerFin('raked_tip_corner.fin.json')],
    ['the TSN 800 (hooked)', ownerFin('tsn_800_single.fin.json')],
  ];

  it.each(fins)('closes the sections up to where the path meets the profile: %s', (_, d) => {
    const sb = smoothBlade(d);
    const { tipPoint } = smoothMap(d);
    // On the outline round the tip, and every point of the last row a sliver from it.
    const edge = sweepFrame(d).tipEdge.pts;
    const onEdge = Math.min(
      ...edge.slice(1).map((q, i) => {
        const a = edge[i]!;
        const dx = q.x - a.x;
        const dy = q.y - a.y;
        const l2 = dx * dx + dy * dy || 1;
        const t = Math.min(
          1,
          Math.max(0, ((tipPoint.x - a.x) * dx + (tipPoint.y - a.y) * dy) / l2),
        );
        return Math.hypot(a.x + dx * t - tipPoint.x, a.y + dy * t - tipPoint.y);
      }),
    );
    expect(onEdge).toBeLessThan(0.01);
    for (let k = 0; k <= 10; k++) {
      const q = sb.point(1, k / 10);
      expect(Math.hypot(q.x - tipPoint.x, q.y - tipPoint.y)).toBeLessThan(0.15);
    }
    // The path ends there.
    const end = sb.spine(1);
    expect(Math.hypot(end.x - tipPoint.x, end.y - tipPoint.y)).toBeLessThan(0.05);
  });

  it.each(fins)('carries the path on through the tip line without a corner: %s', (_, d) => {
    const sb = smoothBlade(d);
    const h = 0.01;
    const dir = (a: number, b: number) => {
      const p = sb.spine(a);
      const q = sb.spine(b);
      return Math.atan2(q.y - p.y, q.x - p.x);
    };
    const turn = dir(sb.sTip, sb.sTip + h) - dir(sb.sTip - h, sb.sTip);
    expect(Math.abs(Math.atan2(Math.sin(turn), Math.cos(turn)))).toBeLessThan(0.1);
  });

  it('follows the thickness curve, never thicker for its length than the tip foil', () => {
    // Owner request: near the tip point the rows stayed as thick as the curve said while
    // their length went to nothing, a blunt nub; now the tip foil shrinks whole there.
    const base = defaultFinDesign('side', 'left');
    // A curve ending at 1.5 mm, not the minimum: it would have left the tip blunt.
    const knots = base.taper.knots;
    const end = knots[knots.length - 1]!;
    const up = (p: { x: number; y: number }) => vec2(p.x, Math.max(p.y, 0.15));
    const taper = splineFromKnots([
      ...knots.slice(0, -1),
      knot(vec2(1, 0.15), up(end.tangentToPrev), vec2(1, 0.15), end.continuous),
    ]);
    const d = { ...base, tipLine: undefined, taper };
    const sb = smoothBlade(d);
    const m = sb.blade.minThickness;
    const length = (s: number) => {
      let len = 0;
      for (let j = 1; j <= 64; j++) {
        const a = sb.point(s, (j - 1) / 64);
        const c = sb.point(s, j / 64);
        len += Math.hypot(c.x - a.x, c.y - a.y);
      }
      return len;
    };
    const curveAt = (s: number) => yAtX(d.taper, sb.eta(s)) - m;
    const aspect = sb.scale(sb.sTip) / length(sb.sTip);
    expect(sb.scale(sb.sTip)).toBeCloseTo(curveAt(sb.sTip), 9);
    for (let k = 1; k < 20; k++) {
      const s = sb.sTip + ((1 - sb.sTip) * k) / 20;
      expect(sb.scale(s)).toBeLessThanOrEqual(curveAt(s) + 1e-9);
      expect(sb.scale(s)).toBeLessThanOrEqual(1.25 * aspect * length(s) + 1e-9);
    }
    // At the tip point it stays bounded by the tip foil's own aspect ratio (well below the
    // blunt 1.5 mm curve end), rather than leaving a blunt nub.
    expect(sb.scale(1)).toBeLessThanOrEqual(1.25 * aspect * length(1) + 1e-9);
    expect(sb.scale(1)).toBeLessThan(curveAt(1) / 5);
  });

  it('moves the tip point as the tip line moves', () => {
    const d = ownerFin('raked_tip_corner.fin.json');
    const tip = d.tipLine!;
    const a = smoothMap(d).tipPoint;
    const b = smoothMap({
      ...d,
      tipLine: { start: tip.start - 0.03, end: tip.end - 0.03 },
    }).tipPoint;
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(0.05);
  });

  it('handles a very low tip line and a sharply curving thickness path cleanly', () => {
    const base = defaultFinDesign('side', 'left');
    // Dragged low near the base (small sTip) with a strong mid-fin thickness bend that curls
    // sharply past the tip line, exercising both h clamping and the >π curvature fallback.
    const lowAndCurved: FinDesign = {
      ...base,
      tipLine: { start: 0.08, end: 0.92 },
      thicknessMid: 0.85,
      tipSection: moveFoilThickest(nacaSection('0008'), 0.15),
    };
    const m = smoothMap(lowAndCurved);
    expect(Number.isFinite(m.tipPoint.x)).toBe(true);
    expect(Number.isFinite(m.tipPoint.y)).toBe(true);
    const sb = smoothBlade(lowAndCurved);
    const end = sb.spine(1);
    expect(Math.hypot(end.x - m.tipPoint.x, end.y - m.tipPoint.y)).toBeLessThan(0.1);
  });

  it('pins extreme rows on a hooked fin mesh without losing closure or cutting the hook tip', () => {
    const d = ownerFin('tsn_800_single.fin.json');
    const m = finMesh(d, FIN_MESH_PREVIEW).blade;
    const ex = splineExtremes(d.outline, 'x');
    const ey = splineExtremes(d.outline, 'y');
    let minX = Infinity;
    let maxX = -Infinity;
    let maxZ = -Infinity;
    for (let i = 0; i < m.positions.length; i += 3) {
      minX = Math.min(minX, m.positions[i]!);
      maxX = Math.max(maxX, m.positions[i]!);
      maxZ = Math.max(maxZ, m.positions[i + 2]!);
    }
    // Every outline extremum is reached within 0.05 mm (was cut by up to 0.3 mm before pinning).
    expect(Math.abs(minX - ex.min.point.x)).toBeLessThan(0.005);
    expect(Math.abs(maxX - ex.max.point.x)).toBeLessThan(0.005);
    expect(Math.abs(maxZ - ey.max.point.y)).toBeLessThan(0.005);
  });
});

describe('the export’s sections near the tip point', () => {
  // Owner testing (eggplant.fin.json): the STEP edge jogged near the tip point. A cut's end
  // within 2% of the last row was snapped onto it, and so carried to the tip point, where
  // the rows close up; now it is snapped onto whichever side of the layout it is nearest.
  it('keep both ends of each cut where the outline is, up to the top', () => {
    const d = ownerFin('eggplant_tip.fin.json');
    const b = prepareBlade(d);
    const ys: number[] = [];
    for (let h = 11; h <= b.depth - 0.05; h += 0.05) {
      const sec = bladeSection(b, h);
      ys.push(sec.outside[sec.outside.length - 1]!.y);
    }
    let worst = 0;
    for (let k = 2; k < ys.length; k++) {
      worst = Math.max(worst, Math.abs(ys[k]! - 2 * ys[k - 1]! + ys[k - 2]!));
    }
    // Was 0.33 mm in a step, at 120 mm up; now 0.002 mm.
    expect(worst).toBeLessThan(0.002);
  });
});

describe('the ends of the last row', () => {
  // rmtest.json (owner testing): an upright cut 145 mm back from the leading-edge root
  // runs into the corner where the last row meets the trailing edge carried round the
  // tip. The row's closing and the foil's, multiplied, closed quadratically there: the
  // face eased onto the minimum, a concave neck under the tip edge.
  it('close into the corner, never easing onto the minimum', () => {
    const d = ownerFin('raked_tip_corner.fin.json');
    const mesh = finMesh(d, { rows: 120, stations: 64, tipGap: 0.01, arcTolerance: 0.001 }).blade;
    // The analysis plane 145 mm back from the leading-edge root (87.81 mm forward).
    const cut = sliceMesh(mesh, 'x', 8.781 - 14.5);
    const thick = (z: number) => {
      let lo = Infinity;
      let hi = -Infinity;
      for (let i = 0; i < cut.length; i += 6) {
        const a = cut[i + 2]!;
        const b = cut[i + 5]!;
        if ((a - z) * (b - z) > 0 || a === b) continue;
        const y = cut[i + 1]! + ((cut[i + 4]! - cut[i + 1]!) * (z - a)) / (b - a);
        lo = Math.min(lo, y);
        hi = Math.max(hi, y);
      }
      return hi - lo;
    };
    let top = 0;
    for (let i = 2; i < cut.length; i += 3) top = Math.max(top, cut[i]!);
    // Thickness over the last 1.5 mm, 0.3 mm apart: it falls, and no slower toward the top.
    const t = [5, 4, 3, 2, 1].map((k) => thick(top - 0.03 * k - 1e-6));
    const steps = t.slice(1).map((v, k) => t[k]! - v);
    for (const s of steps) expect(s).toBeGreaterThan(0);
    // As it was, the steps shrank by 28% toward the top (0.097 → 0.070 mm); now they hold.
    expect(steps[steps.length - 1]!).toBeGreaterThan(steps[0]! * 0.95);
  });
});

describe('the smooth blade', () => {
  it.each(FINS)('passes the smoothness gate: %s', (_, make) => {
    // Every one of these creases on the sweep (docs/design/fin-designer.md, stage 1).
    const d = { ...make(), slices: [] };
    const f = fairness(smoothSampler(d));
    expect(f.creases.slice(0, 3)).toEqual([]);
  });

  it('runs edge to edge along the outline, the tip edge included', () => {
    const d = ownerFin('tsn_800_single.fin.json');
    const sb = smoothBlade(d);
    const f = sweepFrame(d);
    /** Distance from p to the polyline through `pts`. */
    const near = (p: { x: number; y: number }, pts: readonly { x: number; y: number }[]) => {
      let m = Infinity;
      for (let i = 1; i < pts.length; i++) {
        const a = pts[i - 1]!;
        const b = pts[i]!;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const t = Math.max(
          0,
          Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1)),
        );
        m = Math.min(m, Math.hypot(a.x + dx * t - p.x, a.y + dy * t - p.y));
      }
      return m;
    };
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      // Within 0.01 mm of the outline.
      // The edges run on past the tip line, round the tip.
      expect(near(sb.point(t, 0), [...f.leading.pts, ...f.tipEdge.pts])).toBeLessThan(0.001);
      expect(near(sb.point(t, 1), [...f.trailing.pts, ...f.tipEdge.pts])).toBeLessThan(0.001);
      expect(near(sb.point(1, t), f.tipEdge.pts)).toBeLessThan(0.001);
      expect(sb.point(0, t).y).toBeCloseTo(0, 9);
    }
  });

  it('is as thick as the thickness curve at the base, and the minimum at every edge', () => {
    const d = defaultFinDesign('side', 'left');
    const sb = smoothBlade(d);
    const m = sb.blade.minThickness;
    let thickest = 0;
    for (let k = 0; k <= 400; k++) {
      const [o, n] = sb.offsets(0, k / 400);
      thickest = Math.max(thickest, o - n);
    }
    expect(thickest).toBeCloseTo(thicknessAt(prepareBlade(d), 0), 3);
    for (let k = 0; k <= 10; k++) {
      for (const [s, u] of [
        [k / 10, 0],
        [k / 10, 1],
        [1, k / 10],
      ] as const) {
        const [o, n] = sb.offsets(s, u);
        expect(o - n).toBeCloseTo(m, 9);
      }
    }
  });

  it('lays each foil with its thickest point on the path, its nose still round', () => {
    // The warp puts the foil's thickest fraction at the path's, and keeps the ends' slopes finite.
    expect(foilWarp(0.4, 0.4, 0.3)).toBeCloseTo(0.3, 12);
    expect(foilWarp(0, 0.4, 0.3)).toBe(0);
    expect(foilWarp(1, 0.4, 0.3)).toBe(1);
    const slope0 = foilWarp(1e-7, 0.4, 0.3) / 1e-7;
    expect(slope0).toBeGreaterThan(0.2);
    expect(slope0).toBeLessThan(5);
  });

  it('meshes as a closed shell, wound outward, either hand and round a hook', () => {
    for (const [d, lo, hi] of [
      [defaultFinDesign('side', 'left'), 38, 48],
      [defaultFinDesign('side', 'right'), 38, 48],
      [ownerFin('tsn_800_single.fin.json'), 100, 140],
    ] as const) {
      const m = finMesh(d, FIN_MESH_PREVIEW).blade;
      const edges = new Map<string, number>();
      // Wound one way throughout: each edge is run once each way by the two triangles on it.
      // (Round the hook's tip, where rows run up and down, quads judged one by one from the
      // ring's direction seen from above came out flipped.)
      const directed = new Set<string>();
      let flipped = 0;
      let volume = 0;
      const P = m.positions;
      for (let t = 0; t < m.indices.length; t += 3) {
        const v = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!];
        for (let e = 0; e < 3; e++) {
          const [a, b] = [v[e]!, v[(e + 1) % 3]!].sort((p, q) => p - q);
          edges.set(`${a}-${b}`, (edges.get(`${a}-${b}`) ?? 0) + 1);
          const key = `${v[e]}>${v[(e + 1) % 3]}`;
          if (directed.has(key)) flipped++;
          directed.add(key);
        }
        const [a, b, c] = v.map((i) => [P[3 * i]!, P[3 * i + 1]!, P[3 * i + 2]!]) as [
          number[],
          number[],
          number[],
        ];
        volume +=
          (a[0]! * (b[1]! * c[2]! - b[2]! * c[1]!) -
            a[1]! * (b[0]! * c[2]! - b[2]! * c[0]!) +
            a[2]! * (b[0]! * c[1]! - b[1]! * c[0]!)) /
          6;
      }
      expect([...edges.values()].every((n) => n === 2)).toBe(true);
      expect(flipped).toBe(0);
      // Wound outward, and about as big as the sweep's blade (28 cm³ for the side fin).
      expect(volume).toBeGreaterThan(lo);
      expect(volume).toBeLessThan(hi);
    }
  });

  describe('control sections', () => {
    const d0 = defaultFinDesign('side', 'left');

    it('show their foil as drawn, on their row', () => {
      // A fuller foil than the fin's, halfway up.
      const fuller = nacaSection('0016');
      const d = { ...d0, slices: [{ height: 0.5, section: fuller }] };
      const sb = smoothBlade(d);
      const t = sectionThickest(fuller).thickness;
      for (const x of [0.05, 0.2, 0.4, 0.7, 0.95]) {
        const [o, n] = sb.foil(0.5 * sb.sTip, x);
        const [so, si] = sectionShapeAt(fuller, x);
        expect(o).toBeCloseTo(so / t, 9);
        expect(n).toBeCloseTo(si / t, 9);
      }
    });

    it('start as the fin’s own foil, changing it by less than the fit’s 2%', () => {
      const d = ownerFin('tsn_800_single.fin.json');
      const without = { ...d, slices: [] };
      const added = { ...without, slices: [{ height: 0.5, section: smoothFoilAt(without, 0.5) }] };
      const a = smoothBlade(without);
      const b = smoothBlade(added);
      let worst = 0;
      let thickest = 0;
      for (let i = 1; i < 20; i++) {
        for (let j = 1; j < 20; j++) {
          const [o0, n0] = a.offsets(i / 20, j / 20);
          const [o1, n1] = b.offsets(i / 20, j / 20);
          worst = Math.max(worst, Math.abs(o1 - o0), Math.abs(n1 - n0));
          thickest = Math.max(thickest, o0 - n0);
        }
      }
      expect(worst / thickest).toBeLessThan(0.02);
    });

    it.each([
      'tsn_800_single.fin.json',
      'hatchet_tip_crossing.fin.json',
      'steep_tip_line.fin.json',
    ])('leave owners’ fins smooth: %s', (name) => {
      expect(fairness(smoothSampler(ownerFin(name))).creases.slice(0, 3)).toEqual([]);
    });
  });

  describe('the tip line', () => {
    const base = defaultFinDesign('side', 'left');
    const fins: [string, FinDesign][] = [
      ['the starting fin', base],
      [
        'NACA 0008, thickest moved back',
        { ...base, tipSection: moveFoilThickest(nacaSection('0008'), 0.5) },
      ],
      ['the TSN 800, its sections just under it', ownerFin('tsn_800_single.fin.json')],
    ];
    it.each(fins)('is one row, with the tip foil along it as drawn: %s', (_, d) => {
      // Owner testing: cut there, the foil came out far lower toward the ends than drawn,
      // even concave, the straight line crossing rows that thinned toward the tip.
      const sb = smoothBlade(d);
      const f = sweepFrame(d);
      const sec = tipFoilOf(d);
      const t0 = sectionThickest(sec).thickness;
      const m = sb.blade.minThickness;
      const k = sb.scale(sb.sTip);
      for (let i = 1; i < 40; i++) {
        const t = i / 40;
        const at = smoothLocate(
          d,
          f.tipStart.x + (f.tipEnd.x - f.tipStart.x) * t,
          f.tipStart.y + (f.tipEnd.y - f.tipStart.y) * t,
        )!;
        expect(at.s).toBeCloseTo(sb.sTip, 5);
        const [o, n] = sb.offsets(at.s, at.u);
        const [so, si] = sectionShapeAt(sec, t);
        // Within 0.01 mm of the foil drawn, scaled to the one thickness of the row.
        expect(Math.abs(o - n - ((so - si) / t0) * k - m)).toBeLessThan(0.001);
      }
    });
  });

  it('finds a profile point’s row, and the row along the fin', () => {
    const d = ownerFin('tsn_800_single.fin.json');
    const sb = smoothBlade(d);
    for (const [s, u] of [
      [0.2, 0.3],
      [0.7, 0.8],
      [0.95, 0.5],
    ] as const) {
      const p = sb.point(s, u);
      const at = smoothLocate(d, p.x, p.y)!;
      expect(at.s).toBeCloseTo(s, 6);
      expect(at.u).toBeCloseTo(u, 6);
      expect(smoothRowAtEta(d, smoothEta(d, s))).toBeCloseTo(s, 6);
    }
    expect(smoothLocate(d, 100, 100)).toBeNull();
  });
});
