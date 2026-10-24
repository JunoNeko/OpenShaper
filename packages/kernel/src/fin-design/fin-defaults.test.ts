// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { valueAt } from '../bezier-spline';
import { splineExtremes } from './curve-shape';
import {
  FOIL_OUTLINE,
  FOIL_SECTIONS,
  FOIL_SIZES,
  defaultFinDesign,
  defaultKeel,
  defaultTwinFin,
  type FoilPath,
} from './fin-defaults';
import { FIN_MIN_THICKNESS, FIN_POSITIONS, type FinPosition } from './fin-design';
import { validateFinDesign } from './fin-rules';

const here = dirname(fileURLToPath(import.meta.url));

const SOURCE: Record<FinPosition, string> = {
  side: 'side.foil',
  centre: 'center.foil',
  'quad-rear': 'quad_back.foil',
};

interface FoilJsonPath {
  cont: number[];
  path: [string, ...number[]][];
}
const readFoil = (file: string) =>
  (
    JSON.parse(readFileSync(resolve(here, '../../../../docs/specs/fins', file), 'utf8')) as {
      foil: {
        outline: { height: number; path: FoilJsonPath };
        profile: { topProfile: FoilJsonPath };
        thick: number;
        base: { rx: number };
      };
    }
  ).foil;

/** A `.foil` path in the form fin-defaults.ts copies it. */
const asFoilPath = ({ cont, path }: FoilJsonPath): FoilPath => {
  expect(path[0]).toEqual(['M', 0, 0]);
  return {
    cont,
    cubics: path.slice(1).map(([op, ...xy]) => {
      expect(op).toBe('C');
      return xy as unknown as FoilPath['cubics'][number];
    }),
  };
};

describe('fin defaults are copied verbatim from the FinFoil sources', () => {
  it.each(FIN_POSITIONS)('%s', (position) => {
    const foil = readFoil(SOURCE[position]);
    expect(asFoilPath(foil.outline.path)).toEqual(FOIL_OUTLINE);
    expect(asFoilPath(foil.profile.topProfile)).toEqual(FOIL_SECTIONS[position]);
    expect({ height: foil.outline.height, thick: foil.thick, rx: foil.base.rx }).toEqual(
      FOIL_SIZES[position],
    );
  });
});

describe.each(FIN_POSITIONS)('defaultFinDesign(%s)', (position) => {
  const d = defaultFinDesign(position);
  const size = FOIL_SIZES[position];

  it('breaks no rule', () => {
    expect(validateFinDesign(d)).toEqual([]);
    expect(validateFinDesign(defaultFinDesign(position, 'right'))).toEqual([]);
  });

  it('is as deep as the source', () => {
    expect(splineExtremes(d.outline, 'y').max.point.y).toBeCloseTo(size.height * 100, 12);
  });

  it('is rear-aligned: the trailing-edge root on the tab rear end', () => {
    const k = d.outline.knots;
    const te = k[k.length - 1]!.end;
    expect(te.x).toBeCloseTo(0, 12);
    expect(te.y).toBe(-0);
    expect(k[0]!.end.y).toBe(-0);
    expect(d.lateralOffset).toBe(0);
  });

  it('keeps the source aspect: root chord / depth = 232.86 / outline peak', () => {
    const k = d.outline.knots;
    const chord = k[0]!.end.x - k[k.length - 1]!.end.x;
    const depth = splineExtremes(d.outline, 'y').max.point.y;
    expect(chord / depth).toBeCloseTo(232.86 / 229.0, 2);
  });

  it('tapers from the source root thickness to the minimum', () => {
    expect(valueAt(d.taper, 0)).toBeCloseTo(size.thick * 100, 12);
    expect(valueAt(d.taper, 1)).toBeCloseTo(FIN_MIN_THICKNESS, 12);
    // Straight to 70%: halfway there it is three quarters of the root thickness.
    expect(valueAt(d.taper, 0.35)).toBeCloseTo(size.thick * 100 * 0.75, 4);
  });

  it('is still thinning at the tip, never below the minimum on the way', () => {
    // Levelling off at the minimum left the top few mm a uniform sliver.
    expect(valueAt(d.taper, 0.99) - valueAt(d.taper, 1)).toBeGreaterThan(0.005);
    for (let f = 0; f <= 1; f += 0.005) {
      expect(valueAt(d.taper, f)).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-12);
    }
  });

  it('takes its cant from the source', () => {
    expect(d.cant).toBe(position === 'side' ? 7 : position === 'quad-rear' ? 4 : 0);
  });
});

describe('default sections', () => {
  it('centre is symmetric', () => {
    expect(defaultFinDesign('centre').section.inside).toBeNull();
    expect(defaultFinDesign('centre').hand).toBeNull();
  });

  it.each(['side', 'quad-rear'] as const)('%s has a flat inside face and a side', (position) => {
    const d = defaultFinDesign(position, 'right');
    expect(d.hand).toBe('right');
    const inside = d.section.inside!;
    for (const k of inside.knots) {
      for (const p of [k.end, k.tangentToPrev, k.tangentToNext]) expect(p.y).toBe(0);
    }
  });

  it.each(FIN_POSITIONS)('%s outside face has the source thickness ratio', (position) => {
    const face = defaultFinDesign(position).section.outside;
    const path = FOIL_SECTIONS[position];
    const chord = path.cubics[path.cubics.length - 1]![4];
    // The shared knot between the two cubics is the source's thickest drawn point.
    expect(face.knots[1]!.end.y).toBeCloseTo(-path.cubics[0][5] / chord, 12);
  });
});

describe('the owner’s twin fin and keel', () => {
  it.each([
    ['twin fin', defaultTwinFin],
    ['keel', defaultKeel],
  ] as const)('the %s breaks no rule, on either side', (_, make) => {
    for (const hand of ['left', 'right'] as const) {
      const d = make(hand);
      expect(validateFinDesign(d)).toEqual([]);
      expect([d.position, d.hand, d.cant, d.base]).toEqual(['side', hand, 7, 'futures-side']);
    }
  });

  it('runs the rear out behind the tab: the trailing edge reaches back past its root', () => {
    for (const d of [defaultTwinFin(), defaultKeel()]) {
      const xs = d.outline.knots.map((k) => k.end.x);
      expect(Math.min(...xs.slice(1, -1))).toBeLessThan(0); // behind the tab's rear end
      expect(d.outline.knots.at(-1)!.end.x).toBe(0); // rear-aligned
    }
  });
});
