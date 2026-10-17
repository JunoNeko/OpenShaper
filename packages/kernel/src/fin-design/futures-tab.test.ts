// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { RAD_TO_DEG } from '../constants';
import type { Vec2 } from '../vec2';
import {
  FUTURES_TABS,
  FUTURES_TAB_KINDS,
  futuresTabOutline,
  type FuturesTabKind,
  type TabSegment,
} from './futures-tab';

const here = dirname(fileURLToPath(import.meta.url));

type Pt = [number, number];
interface FixtureTab {
  usedBy: string[];
  length: number;
  height: number;
  rearSlot: { diameter: number; centreBelowTop: number; arcCentreFromEnd: number };
  rearBottomCornerRadius: number;
  frontNotch: { includedAngleDeg: number };
  derived: Record<'T' | 'U' | 'A' | 'D' | 'B', Pt> & {
    upperFlankDeg: number;
    lowerFlankDeg: number;
  };
}
interface Fixture {
  units: 'mm';
  thickness: number;
  frontFaceAngleDeg: number;
  tolerance: number;
  tabs: Record<FuturesTabKind, FixtureTab>;
}

const fixture = JSON.parse(
  readFileSync(resolve(here, '../../../../docs/specs/fins/futures-tabs.json'), 'utf8'),
) as Fixture;

/** Kernel cm → fixture mm. */
const toMm = (cm: number): number => cm * 10;
const TOL = fixture.tolerance;

const expectNear = (actualCm: number, expectedMm: number): void => {
  expect(Math.abs(toMm(actualCm) - expectedMm)).toBeLessThanOrEqual(TOL);
};
const expectPoint = (p: Vec2, [x, y]: Pt): void => {
  expectNear(p.x, x);
  expectNear(p.y, y);
};

const sweep = (s: Extract<TabSegment, { kind: 'arc' }>): number => {
  const a0 = Math.atan2(s.from.y - s.center.y, s.from.x - s.center.x);
  const a1 = Math.atan2(s.to.y - s.center.y, s.to.x - s.center.x);
  let d = a1 - a0;
  if (s.ccw && d <= 0) d += 2 * Math.PI;
  if (!s.ccw && d >= 0) d -= 2 * Math.PI;
  return d;
};

/** Signed area enclosed by the segments (Green's theorem, exact for arcs). */
const signedArea = (segments: readonly TabSegment[]): number =>
  segments.reduce((sum, s) => {
    const chord = s.from.x * s.to.y - s.to.x * s.from.y;
    if (s.kind === 'line') return sum + chord / 2;
    // Arc = chord term about the centre, plus the circular sector it sweeps.
    const { center: c, radius: r } = s;
    const aboutCentre = c.x * (s.to.y - s.from.y) - c.y * (s.to.x - s.from.x);
    return sum + (aboutCentre + r * r * sweep(s)) / 2;
  }, 0);

const shoelace = (pts: readonly Pt[]): number =>
  pts.reduce((sum, [x, y], i) => {
    const [nx, ny] = pts[(i + 1) % pts.length]!;
    return sum + (x * ny - nx * y) / 2;
  }, 0);

describe.each(FUTURES_TAB_KINDS)('futuresTabOutline(%s)', (kind) => {
  const tab = fixture.tabs[kind];
  const outline = futuresTabOutline(kind);
  const { spec, segments, front } = outline;

  it('has the fixture size', () => {
    expectNear(spec.length, tab.length);
    expectNear(spec.height, tab.height);
    expectNear(spec.thickness, fixture.thickness);
  });

  it('reproduces the derived front-notch points', () => {
    for (const name of ['T', 'U', 'A', 'D', 'B'] as const)
      expectPoint(front[name], tab.derived[name]);
  });

  it('splits the notch into the derived flank angles', () => {
    const { U, A, D } = front;
    const upper = Math.atan2(U.y - A.y, U.x - A.x) * RAD_TO_DEG;
    const lower = Math.atan2(A.y - D.y, D.x - A.x) * RAD_TO_DEG;
    expect(upper).toBeCloseTo(tab.derived.upperFlankDeg, 3);
    expect(lower).toBeCloseTo(tab.derived.lowerFlankDeg, 3);
    expect(upper + lower).toBeCloseTo(tab.frontNotch.includedAngleDeg, 9);
  });

  it('meets the bottom edge at the front-face angle', () => {
    const { B, D } = front;
    // Interior angle at B, between the bottom edge (toward the rear) and B→D.
    const toRear = Math.atan2(0, -1);
    const up = Math.atan2(D.y - B.y, D.x - B.x);
    expect((toRear - up) * RAD_TO_DEG).toBeCloseTo(fixture.frontFaceAngleDeg, 9);
  });

  it('is a closed chain', () => {
    segments.forEach((s, i) => {
      const next = segments[(i + 1) % segments.length]!;
      expect(next.from).toEqual(s.to);
    });
  });

  it('puts every arc end on its circle', () => {
    for (const s of segments) {
      if (s.kind !== 'arc') continue;
      for (const p of [s.from, s.to]) {
        expect(Math.hypot(p.x - s.center.x, p.y - s.center.y)).toBeCloseTo(s.radius, 12);
      }
    }
  });

  it('cuts the rear slot and corner to the drawn sizes', () => {
    const arcs = segments.filter((s) => s.kind === 'arc');
    expect(arcs).toHaveLength(2);
    const [slot, corner] = arcs as Extract<TabSegment, { kind: 'arc' }>[];
    expectNear(slot!.radius, tab.rearSlot.diameter / 2);
    expectPoint(slot!.center, [
      tab.rearSlot.arcCentreFromEnd,
      tab.height - tab.rearSlot.centreBelowTop,
    ]);
    // The slot ends in a half circle, rounded away from the rear end.
    expect(sweep(slot!)).toBeCloseTo(-Math.PI, 12);
    expectNear(corner!.radius, tab.rearBottomCornerRadius);
    expect(sweep(corner!)).toBeCloseTo(Math.PI / 2, 12);
  });

  it('encloses the area of the rectangle less the slot, corner and notch', () => {
    const L = tab.length;
    const H = tab.height;
    const r = tab.rearSlot.diameter / 2;
    const R = tab.rearBottomCornerRadius;
    const slot = 2 * r * tab.rearSlot.arcCentreFromEnd + (Math.PI * r * r) / 2;
    const corner = R * R - (Math.PI * R * R) / 4;
    const d = tab.derived;
    // The region between the profile's front (T→U→A→D→B) and the line x = L. Down the
    // profile, back along the bottom, up x = L: counter-clockwise, so positive.
    const notch = shoelace([d.T, d.U, d.A, d.D, d.B, [L, 0]]);
    expect(notch).toBeGreaterThan(0);
    const expectedMm2 = L * H - slot - corner - notch;
    expect(signedArea(segments) * 100).toBeCloseTo(expectedMm2, 2);
  });

  it('runs counter-clockwise', () => {
    expect(signedArea(segments)).toBeGreaterThan(0);
  });
});

describe('weight-saving holes', () => {
  // The owner's measurements (mm): four slots 16 long, 8 tall, round-ended, 6.5 apart,
  // the first 13 behind the front; centred on a 3/4" tab, level with the rear slot on a
  // 1/2" tab.
  const span = (h: readonly TabSegment[]) => {
    const xs = h.flatMap((s) => [s.from.x, s.to.x]);
    const ys = h.flatMap((s) => [s.from.y, s.to.y]);
    // Arc ends bulge past the straight edges by the radius.
    const r = (h.find((s) => s.kind === 'arc') as { radius: number }).radius;
    return {
      x0: Math.min(...xs) - r,
      x1: Math.max(...xs) + r,
      y0: Math.min(...ys),
      y1: Math.max(...ys),
    };
  };

  it.each(['side', 'centre'] as const)(
    'cuts four 16 × 8 mm slots, 6.5 mm apart, on the %s tab',
    (kind) => {
      const { holes, spec } = futuresTabOutline(kind);
      expect(holes).toHaveLength(4);
      const spans = holes.map(span).sort((a, b) => b.x1 - a.x1); // front first
      expect(spec.length - spans[0]!.x1).toBeCloseTo(1.3, 12);
      spans.forEach((s, i) => {
        expect(s.x1 - s.x0).toBeCloseTo(1.6, 12);
        expect(s.y1 - s.y0).toBeCloseTo(0.8, 12);
        if (i > 0) expect(spans[i - 1]!.x0 - s.x1).toBeCloseTo(0.65, 12);
      });
      // Clear of the rear slot (5.5 mm deep from the rear end).
      expect(spans[3]!.x0).toBeGreaterThan(spec.slotArcCentreFromEnd + spec.slotDiameter / 2);
    },
  );

  it('centres them on a 3/4" tab, and levels them with the rear slot on a 1/2" tab', () => {
    const mid = (kind: 'side' | 'centre') => {
      const s = span(futuresTabOutline(kind).holes[0]!);
      return (s.y0 + s.y1) / 2;
    };
    expect(mid('side')).toBeCloseTo(FUTURES_TABS.side.height / 2, 12);
    const c = FUTURES_TABS.centre;
    expect(mid('centre')).toBeCloseTo(c.height - c.slotCentreBelowTop, 12);
  });

  it('runs each hole clockwise: material outside it', () => {
    for (const h of futuresTabOutline('side').holes) {
      let a = 0;
      for (const s of h) a += s.from.x * s.to.y - s.to.x * s.from.y;
      expect(a).toBeLessThan(0);
    }
  });
});
