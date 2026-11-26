// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  board,
  defaultFinConfig,
  hasTailCutout,
  knotFromArray,
  splineFromKnots,
  tessellateBoard,
  tessellationSteps,
  type BezierBoard,
  type FinSetup,
  type FinSystem,
} from '@openshaper/kernel';
import { makeTestBoard } from './fixture.test-helper';
import { exportPrintBlank } from './print-blank';

const base = makeTestBoard();
const withFins = (setup: FinSetup, system: FinSystem): BezierBoard => {
  const b = base;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, defaultFinConfig(setup, system)); // prettier-ignore
};

/** Triangles of a binary STL. */
const trianglesOf = (stl: Uint8Array): number[][][] => {
  const dv = new DataView(stl.buffer, stl.byteOffset, stl.byteLength);
  const n = dv.getUint32(80, true);
  const out: number[][][] = [];
  for (let t = 0; t < n; t++) {
    const o = 84 + t * 50 + 12;
    out.push([0, 1, 2].map((k) => [0, 1, 2].map((c) => dv.getFloat32(o + k * 12 + c * 4, true))));
  }
  return out;
};
/** Signed volume (cm³) enclosed by triangles wound outward. */
const volume = (tris: number[][][]) =>
  tris.reduce((s, [a, b, c]) => {
    const [ax, ay, az] = a!;
    const [bx, by, bz] = b!;
    const [cx, cy, cz] = c!;
    return s + (ax! * (by! * cz! - bz! * cy!) - ay! * (bx! * cz! - bz! * cx!) + az! * (bx! * cy! - by! * cx!)) / 6; // prettier-ignore
  }, 0);
/** Edges not shared by exactly two triangles (exact coordinates). */
const openEdges = (tris: number[][][]) => {
  const edges = new Map<string, number>();
  for (const t of tris) {
    for (let e = 0; e < 3; e++) {
      const a = t[e]!.join();
      const b = t[(e + 1) % 3]!.join();
      if (a === b) continue;
      const k = a < b ? `${a}|${b}` : `${b}|${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  return [...edges.values()].filter((n) => n !== 2).length;
};
/** Area (cm²) of a closed outline. */
const area = (o: readonly { x: number; y: number }[]) =>
  Math.abs(o.reduce((s, p, i) => s + (p.x * o[(i + 1) % o.length]!.y - o[(i + 1) % o.length]!.x * p.y) / 2, 0)); // prettier-ignore

describe('the board as a blank to print', () => {
  it('is a closed solid with each Futures box cavity cut, flange step and body', async () => {
    // One centre fin, well inside the test board's narrow tail.
    const b = withFins('single', 'futures');
    const { stl, cavities, warnings } = await exportPrintBlank(b);
    expect(cavities).toHaveLength(1);
    expect(warnings).toEqual([]);
    const tris = trianglesOf(stl);
    expect(openEdges(tris)).toBe(0);
    // The volume taken out is what the cavities hold: the flange step, then the body
    // below it.
    const steps = tessellationSteps(b, 0.5);
    const mesh = tessellateBoard(b, steps);
    const hull: number[][][] = [];
    for (let t = 0; t < mesh.indices.length; t += 3) {
      hull.push([0, 1, 2].map((k) => { const i = mesh.indices[t + k]! * 3; return [mesh.positions[i]!, mesh.positions[i + 1]!, mesh.positions[i + 2]!]; })); // prettier-ignore
    }
    const removed = volume(hull) - volume(tris);
    const expected = cavities.reduce((s, c) => {
      const [flange, body] = c.steps;
      return s + area(flange!.outline) * flange!.depth + area(body!.outline) * (body!.depth - flange!.depth); // prettier-ignore
    }, 0);
    // A cavity's floor is flat and square to the bottom at its centre, as a router
    // jig sitting on the board cuts it, so where the bottom curves up toward its ends
    // it is a little shallower: this test board's rocker is steep (4 cm in 50).
    expect(removed / expected).toBeGreaterThan(0.9);
    expect(removed / expected).toBeLessThan(1.02);
  }, 60000);

  it('cuts FCS II plug cavities, 18.5 mm deep, and nothing for glass-on fins', async () => {
    const fcs = await exportPrintBlank(withFins('twin', 'fcs-ii'));
    expect(fcs.cavities.map((c) => c.kind)).toEqual(['FCS II', 'FCS II']);
    expect(openEdges(trianglesOf(fcs.stl))).toBe(0);
    const glass = await exportPrintBlank(withFins('thruster', 'glass-on'));
    expect(glass.cavities).toEqual([]);
    expect(openEdges(trianglesOf(glass.stl))).toBe(0);
  }, 60000);

  it('cuts a swallow tail too: its halves are welded into one closed solid', async () => {
    const b0 = withFins('single', 'futures');
    const third = (ax: number, ay: number, bx: number, by: number): [number, number] => [ax + (bx - ax) / 3, ay + (by - ay) / 3]; // prettier-ignore
    // A swallow tail on the test board, its notch 10 cm deep.
    const swallow = splineFromKnots([
      knotFromArray([10, 0, 10, 0, ...third(10, 0, 0, 6)], false, false),
      knotFromArray([0, 6, ...third(0, 6, 10, 0), ...third(0, 6, 50, 25)], false, false),
      knotFromArray([50, 25, ...third(50, 25, 0, 6), ...third(50, 25, 100, 0)], false, false),
      knotFromArray([100, 0, ...third(100, 0, 50, 25), 100, 0], false, false),
    ]);
    const b = board(swallow, b0.bottom, b0.deck, b0.crossSections, b0.interpolationType, b0.fins);
    expect(hasTailCutout(b.outline)).toBe(true);
    const { stl, cavities } = await exportPrintBlank(b);
    expect(cavities).toHaveLength(1);
    expect(openEdges(trianglesOf(stl))).toBe(0);
  }, 60000);

  it('warns when a cavity leaves too little board above it', async () => {
    const b = withFins('thruster', 'fcs-ii');
    const { warnings } = await exportPrintBlank(b, {
      cavities: { futuresFlangeDepth: 0.24, futuresSideDepth: 2, futuresCentreDepth: 1.35, fcs2Depth: 9, fcsSingleDepth: 2, clearance: 0 }, // prettier-ignore
    });
    // One per cavity (it may also warn of a side box near the rail: `cavityProblems`).
    const deck = warnings.filter((w) => /FCS II box leaves .* mm of board above it/.test(w));
    expect(deck.length).toBe(3);
  }, 60000);
});
