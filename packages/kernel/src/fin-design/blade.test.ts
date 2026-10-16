// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from '../bezier-spline';
import { DEG_TO_RAD, RAD_TO_DEG } from '../constants';
import { knot } from '../knot';
import { lerp, vec2, type Vec2 } from '../vec2';
import {
  FIN_EDGE_BLEND,
  bladeSection,
  padThickness,
  chordAt,
  cosineStations,
  prepareBlade,
  thicknessAt,
  type BladeSection,
} from './blade';
import { defaultFinDesign, defaultTaper } from './fin-defaults';
import { FIN_MIN_THICKNESS, FIN_POSITIONS, type FinDesign } from './fin-design';
import { finReadouts } from './fin-readouts';
import { validateFinDesign } from './fin-rules';

const polyline = (pts: readonly Vec2[]) =>
  splineFromKnots(
    pts.map((p, i) =>
      knot(
        p,
        i > 0 ? lerp(p, pts[i - 1]!, 1 / 3) : p,
        i < pts.length - 1 ? lerp(p, pts[i + 1]!, 1 / 3) : p,
        false,
      ),
    ),
  );

/** Lateral width of a section at each station (cm), measured horizontally. */
const widths = (s: BladeSection): number[] =>
  s.outside.map((o, j) => Math.abs(o.y - s.inside[j]!.y));

const heights = (b: ReturnType<typeof prepareBlade>) =>
  [0, 0.1, 0.25, 0.5, 0.7, 0.85, 0.95, 1].map((f) => f * b.depth);

describe('padThickness', () => {
  const m = FIN_MIN_THICKNESS;
  const k = FIN_EDGE_BLEND;
  const slope = (t: number) => (padThickness(t + 1e-7, k) - padThickness(t - 1e-7, k)) / 2e-7;

  it('leaves the foil alone a blend or more above the minimum', () => {
    expect(padThickness(m + k, k)).toBe(m + k);
    expect(padThickness(0.8, k)).toBe(0.8);
  });

  it('never goes below the minimum', () => {
    for (let t = -0.01; t < m + k; t += 0.001) expect(padThickness(t, k)).toBeGreaterThanOrEqual(m);
  });

  it('has no corner: its slope is continuous everywhere, including at the minimum', () => {
    // A plain max(t, m) jumps from slope 0 to 1 at t = m.
    for (let t = 0; t < m + k + 0.01; t += 0.0005) {
      expect(Math.abs(slope(t + 0.0001) - slope(t))).toBeLessThan(0.02);
    }
  });

  it('falls back to a plain max with no room to blend', () => {
    expect(padThickness(0.02, 0)).toBe(m);
    expect(padThickness(0.07, 0)).toBe(0.07);
  });
});

describe('chordAt', () => {
  // Leading-edge root (10, 0) → tip (4, 6) → trailing-edge root (0, 0).
  const tri = prepareBlade({
    ...defaultFinDesign('side'),
    outline: polyline([vec2(10, 0), vec2(4, 6), vec2(0, 0)]),
  });

  it('crosses straight edges where they should', () => {
    expect(chordAt(tri, 3).leading).toBeCloseTo(7, 12);
    expect(chordAt(tri, 3).trailing).toBeCloseTo(2, 12);
  });

  it('spans the root chord at the tab top and closes at the tip', () => {
    expect(chordAt(tri, 0)).toEqual({ leading: 10, trailing: 0 });
    const tip = chordAt(tri, 6);
    expect(tip.leading).toBeCloseTo(4, 12);
    expect(tip.trailing).toBeCloseTo(4, 12);
  });

  it('refuses heights off the blade', () => {
    expect(() => chordAt(tri, -0.01)).toThrow(RangeError);
    expect(() => chordAt(tri, 6.01)).toThrow(RangeError);
  });

  it.each(FIN_POSITIONS)('matches the root chord of the default %s', (position) => {
    const d = defaultFinDesign(position);
    const { leading, trailing } = chordAt(prepareBlade(d), 0);
    expect(leading - trailing).toBeCloseTo(finReadouts(d).rootChord, 9);
  });
});

describe.each(FIN_POSITIONS)('bladeSection(default %s)', (position) => {
  const d = defaultFinDesign(position, 'left');
  const flat = prepareBlade({ ...d, cant: 0 });

  it('is a valid design to start from', () => {
    expect(validateFinDesign(d)).toEqual([]);
  });

  it('is exactly the taper thickness at the thickest point', () => {
    for (const h of heights(flat)) {
      const s = bladeSection(flat, h, [flat.thickestAt]);
      const t = thicknessAt(flat, h);
      // Padding only applies where the taper itself is under the minimum.
      expect(widths(s)[0]).toBeCloseTo(Math.max(t, FIN_MIN_THICKNESS), 12);
    }
  });

  it('is nowhere thicker than the taper says, nor thinner than the minimum', () => {
    for (const h of heights(flat)) {
      const s = bladeSection(flat, h, cosineStations(200));
      const t = Math.max(thicknessAt(flat, h), FIN_MIN_THICKNESS);
      for (const w of widths(s)) {
        expect(w).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
        expect(w).toBeLessThanOrEqual(t + 1e-12);
      }
    }
  });

  it('runs from the leading edge to the trailing edge', () => {
    const s = bladeSection(flat, flat.depth / 3);
    expect(s.outside[0]!.x).toBe(s.leadingX);
    expect(s.outside[s.outside.length - 1]!.x).toBeCloseTo(s.trailingX, 12);
    expect(s.leadingX).toBeGreaterThan(s.trailingX);
    for (const p of [...s.outside, ...s.inside]) expect(p.z).toBe(flat.depth / 3);
  });

  it('makes a right fin the exact mirror of a left fin', () => {
    const left = prepareBlade(d);
    const right = prepareBlade({ ...d, hand: d.hand === null ? null : 'right' });
    for (const h of heights(left)) {
      const r = bladeSection(left, h);
      const l = bladeSection(right, h);
      if (d.hand === null) {
        expect(l).toEqual(r); // centre: no hand, nothing to mirror
        continue;
      }
      r.outside.forEach((p, j) => {
        expect(l.outside[j]).toEqual({ x: p.x, y: -p.y, z: p.z });
        expect(l.inside[j]).toEqual({ x: r.inside[j]!.x, y: -r.inside[j]!.y, z: p.z });
      });
    }
  });
});

describe('section faces', () => {
  it('keeps a flat inside face flat, padding only the outside', () => {
    const b = prepareBlade({ ...defaultFinDesign('side', 'left'), cant: 0 });
    for (const h of heights(b)) {
      for (const p of bladeSection(b, h).inside) expect(p.y).toBe(0);
    }
  });

  it('keeps a symmetric foil symmetric, padding both ways', () => {
    const b = prepareBlade(defaultFinDesign('centre'));
    for (const h of heights(b)) {
      const s = bladeSection(b, h);
      s.outside.forEach((p, j) => expect(s.inside[j]!.y).toBeCloseTo(-p.y, 15));
    }
  });

  it('puts the thickest point where the shape is thickest, at every height', () => {
    // Flat inside face: the section is thickest where the outside face peaks.
    const b = prepareBlade(defaultFinDesign('side'));
    const s = bladeSection(b, b.depth / 4, cosineStations(400));
    const w = widths(s);
    const j = w.indexOf(Math.max(...w));
    expect(Math.abs(s.stations[j]! - b.thickestAt)).toBeLessThan(0.01);
  });

  it('scales a thinner taper without changing the chord', () => {
    const d = defaultFinDesign('side');
    const thin = prepareBlade({ ...d, cant: 0, taper: defaultTaper(0.4) });
    const thick = prepareBlade({ ...d, cant: 0, taper: defaultTaper(0.8) });
    const h = thick.depth * 0.3;
    const a = bladeSection(thin, h, [thin.thickestAt]);
    const c = bladeSection(thick, h, [thick.thickestAt]);
    expect(widths(c)[0]! / widths(a)[0]!).toBeCloseTo(2, 12);
    expect(a.leadingX).toBe(c.leadingX);
    expect(a.trailingX).toBe(c.trailingX);
  });
});

describe('cant', () => {
  const base = defaultFinDesign('side', 'left');

  it.each([0, 4, 7, 12.5, 20])('leans the blade out by %s°', (cant) => {
    const b = prepareBlade({ ...base, cant });
    // A flat inside face is a straight line up the blade: its lean is the cant.
    const j = 10;
    const lo = bladeSection(b, 0.2 * b.depth).inside[j]!;
    const hi = bladeSection(b, 0.6 * b.depth).inside[j]!;
    expect(Math.atan2(hi.y - lo.y, hi.z - lo.z) * RAD_TO_DEG).toBeCloseTo(cant, 10);
  });

  it('leans a right fin the other way', () => {
    const b = prepareBlade({ ...base, hand: 'right', cant: 7 });
    expect(bladeSection(b, b.depth / 2).inside[5]!.y).toBeLessThan(0);
  });

  it.each([7, 20])('keeps the true thickness at the taper value at %s°', (cant) => {
    const b = prepareBlade({ ...base, cant });
    const h = b.depth * 0.4;
    const s = bladeSection(b, h, [b.thickestAt]);
    // Horizontal width × cos(cant) = thickness square to the leaning blade.
    expect(widths(s)[0]! * Math.cos(cant * DEG_TO_RAD)).toBeCloseTo(thicknessAt(b, h), 12);
  });

  it('leaves the root on the tab top whatever the cant', () => {
    const b = prepareBlade({ ...base, cant: 20 });
    const root = bladeSection(b, 0);
    for (const p of [...root.outside, ...root.inside]) expect(p.z).toBe(0);
    // No slide at the root: the flat face starts on the tab's centre plane.
    for (const p of root.inside) expect(p.y).toBe(0);
  });
});

describe('a cambered foil (not symmetric, not flat)', () => {
  // Inside face bulging inboard: mirror of the outside at a third of its offset.
  const d0 = defaultFinDesign('side', 'left');
  const bulge = splineFromKnots(
    d0.section.outside.knots.map((k) => {
      const m = (p: Vec2) => vec2(p.x, -p.y / 3);
      return knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous);
    }),
  );
  const d: FinDesign = { ...d0, cant: 0, section: { outside: d0.section.outside, inside: bulge } };

  it('is valid', () => expect(validateFinDesign(d)).toEqual([]));

  it('pads only the outside, leaving the inside face as drawn', () => {
    const b = prepareBlade(d);
    const near = bladeSection(b, b.depth * 0.999); // all padding up here
    for (const p of near.inside) expect(p.y).toBeLessThanOrEqual(0);
    near.outside.forEach((p, j) =>
      expect(p.y - near.inside[j]!.y).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12),
    );
  });
});
