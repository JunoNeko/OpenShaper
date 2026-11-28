// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { board, type BezierBoard } from './board';
import { DEFAULT_CAVITY_SETTINGS, finCavities } from './fin-cavities';
import { defaultFinConfig, resolveFins, type FinSetup, type FinSystem } from './fins';
import { bottomZAt } from './surface';
import { parseBrdGeometry } from './test-support/brd-geometry';
import type { Vec2 } from './vec2';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);
const withFins = (setup: FinSetup, system: FinSystem): BezierBoard => {
  const b = shortboard;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, defaultFinConfig(setup, system)); // prettier-ignore
};
const size = (o: readonly Vec2[]) => {
  const xs = o.map((p) => p.x);
  const ys = o.map((p) => p.y);
  return [Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)];
};
const area = (o: readonly Vec2[]) =>
  o.reduce((s, p, i) => s + (p.x * o[(i + 1) % o.length]!.y - o[(i + 1) % o.length]!.x * p.y) / 2, 0); // prettier-ignore

describe('fin box cavities', () => {
  it('a Futures thruster: a flange step and a body each, X box in the centre, F at the sides', () => {
    const cs = finCavities(withFins('thruster', 'futures'));
    expect(cs).toHaveLength(3);
    const centre = cs.find((c) => resolveFins(withFins('thruster', 'futures'))[c.fin]!.side === 0)!;
    expect(centre.kind).toBe('Futures X');
    expect(cs.filter((c) => c.kind === 'Futures F')).toHaveLength(2);
    const [flange, body] = centre.steps;
    // What the Futures jig routes: the flange 155 × 31.5 mm, the body 129.5 × 12.5 mm.
    expect(size(flange!.outline)[0]).toBeCloseTo(15.5, 0);
    expect(size(flange!.outline)[1]).toBeCloseTo(3.15, 1);
    expect(size(body!.outline)[0]).toBeCloseTo(12.95, 1);
    expect(size(body!.outline)[1]).toBeCloseTo(1.25, 1);
    expect(flange!.depth).toBeCloseTo(0.24, 9); // the 1.587 mm flange plus resin
    expect(body!.depth).toBeCloseTo(1.35, 9); // an X box: 1/2" plus resin
    expect(cs.find((c) => c.kind === 'Futures F')!.steps[1]!.depth).toBeCloseTo(1.985, 9);
    // Anticlockwise outlines, so a solid extruded from them faces out.
    for (const c of cs) for (const s of c.steps) expect(area(s.outline)).toBeGreaterThan(0);
  });

  it('a quad: the rear pair are X boxes, the front pair F', () => {
    const b = withFins('quad', 'futures');
    const fins = resolveFins(b);
    for (const c of finCavities(b)) {
      const f = fins[c.fin]!;
      const front = fins.some((g) => g.side === f.side && g.center.x < f.center.x - 1);
      expect(c.kind).toBe(front ? 'Futures F' : 'Futures X');
    }
  });

  it('FCS II: one plug-shaped step, 18.5 mm deep, 110.6 × 36.9 mm', () => {
    const cs = finCavities(withFins('thruster', 'fcs-ii'));
    expect(cs).toHaveLength(3);
    for (const c of cs) {
      expect(c.kind).toBe('FCS II');
      expect(c.steps).toHaveLength(1);
      expect(c.steps[0]!.depth).toBeCloseTo(1.85, 9);
      const [l, w] = size(c.steps[0]!.outline);
      expect(l).toBeCloseTo(11.06, 1);
      expect(w).toBeCloseTo(3.69, 1);
    }
  });

  it('sit on the bottom under each fin, along its base, square to the bottom', () => {
    const b = withFins('thruster', 'futures');
    const fins = resolveFins(b);
    for (const c of finCavities(b)) {
      const f = fins[c.fin]!;
      expect(c.origin.x).toBeCloseTo(f.center.x, 6);
      expect(Math.abs(c.origin.y)).toBeCloseTo(Math.abs(f.center.y), 6);
      expect(c.origin.z).toBeCloseTo(bottomZAt(b, c.origin.x, Math.abs(c.origin.y)), 9);
      expect(Math.hypot(c.along.x, c.along.y)).toBeCloseTo(1, 9);
      expect(c.along.x).toBeGreaterThan(0.95); // toward the nose, toed a few degrees
      expect(Math.hypot(c.axis.x, c.axis.y, c.axis.z)).toBeCloseTo(1, 9);
      expect(c.axis.z).toBeGreaterThan(0.95);
    }
  });

  it("mirror exactly: a left fin's cavity sits as deep as its right twin (owner report)", () => {
    for (const setup of ['thruster', 'quad'] as const) {
      const b = withFins(setup, 'futures');
      const cs = finCavities(b);
      for (const c of cs.filter((q) => q.origin.y < -1e-6)) {
        const twin = cs.find((q) => Math.abs(q.origin.y + c.origin.y) < 1e-6 && Math.abs(q.origin.x - c.origin.x) < 1e-6)!; // prettier-ignore
        expect(twin).toBeDefined();
        expect(c.origin.z).toBeCloseTo(twin.origin.z, 9);
        expect(c.origin.z).toBeCloseTo(bottomZAt(b, c.origin.x, -c.origin.y), 9);
        expect(c.axis.x).toBeCloseTo(twin.axis.x, 9);
        expect(c.axis.y).toBeCloseTo(-twin.axis.y, 9);
        expect(c.axis.z).toBeCloseTo(twin.axis.z, 9);
      }
    }
  });

  it('take the depths and clearance given, and nothing for glass-on fins or FCS X-2', () => {
    const s = { ...DEFAULT_CAVITY_SETTINGS, fcs2Depth: 2, clearance: 0.05 };
    const c = finCavities(withFins('twin', 'fcs-ii'), s)[0]!;
    expect(c.steps[0]).toMatchObject({ depth: 2, grow: 0.05 });
    expect(finCavities(withFins('thruster', 'glass-on'))).toEqual([]);
    expect(finCavities(withFins('thruster', 'fcs-x2'))).toEqual([]);
  });
});
