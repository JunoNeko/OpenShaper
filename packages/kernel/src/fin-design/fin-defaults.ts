// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin each position starts from, seeded from the FinFoil (https://finfoil.io)
 * reference fins in docs/specs/fins: `side.foil`, `center.foil` and `quad_back.foil`.
 *
 * The Bézier data below is copied verbatim from those files (fin-defaults.test.ts reads
 * them and checks), so the defaults are an exact conversion, not a fit. In a `.foil`
 * file, y is negative upward, and units are arbitrary: the outline is scaled to the
 * file's `height` (the fin's depth, in metres) and the section to its own chord.
 *
 * Taken from the sources:
 * - depth: 100 mm side and centre, 80 mm quad rear (`outline.height`);
 * - root thickness: 8 mm, and 7 mm for the quad rear (`thick`);
 * - cant: 7° side, 4° quad rear (`base.rx`);
 * - the section's outside face (`profile.topProfile`).
 *
 * Chosen here:
 * - Rear-aligned: the trailing-edge root sits on the tab's rear end, the usual
 *   convention. The tab sits flush with a flat inside face, centred under a symmetric
 *   foil (fin-placement.ts).
 * - Side and quad-rear inside faces are flat, per the owner. The sources' inside curves
 *   are not used.
 * - The taper is straight to 70% of the depth, then curves to the 0.5 mm minimum at the
 *   tip, the shape the owner describes. FinFoil's own taper is flat, then rolls off.
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { RAD_TO_DEG } from '../constants';
import { knot, type Knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';
import { splineExtremes } from './curve-shape';
import {
  FIN_MIN_THICKNESS,
  type FinDesign,
  type FinHand,
  type FinPosition,
  type FinSection,
} from './fin-design';

/** A `.foil` cubic: control 1, control 2, end — each (x, y). */
export type FoilCubic = readonly [number, number, number, number, number, number];

/** An open Bézier chain as a `.foil` file stores it, start at (0, 0). */
export interface FoilPath {
  readonly cubics: readonly FoilCubic[];
  /** Per node, 1 if the curve is smooth through it. */
  readonly cont: readonly number[];
}

/** Shared by all three sources. */
export const FOIL_OUTLINE: FoilPath = {
  cont: [0, 1, 0, 1, 0],
  cubics: [
    [32.19, -63.064, 140.798, -227.139, 269.5, -228.96],
    [296.14005, -229.33672, 316.98, -220.88, 320.6, -194.48],
    [302.96, -177.3, 269.2, -156.23, 247.1, -124.084],
    [199.76588, -55.23321, 226.86, -13, 232.86, 0],
  ],
};

export const FOIL_SECTIONS = {
  side: {
    cont: [0, 1, 0],
    cubics: [
      [0.19412, -19.024, 57.661, -43.848, 135.61, -43.848],
      [252.91, -43.848, 363.95, -3.091, 371.45, 0],
    ],
  },
  centre: {
    cont: [0, 1, 0],
    cubics: [
      [0, -12.81, 42.409, -24.69, 120.3, -24.69],
      [237.69, -24.69, 402.6, -2, 411.89, 0],
    ],
  },
  'quad-rear': {
    cont: [0, 1, 0],
    cubics: [
      [0, -6.4483, 20.516, -37.016, 151.68, -37.506],
      [252.27, -37.882, 346.67, -18.746, 424.2, 0],
    ],
  },
} as const satisfies Record<FinPosition, FoilPath>;

/** Per position: depth (m) as `.foil` `height`, root thickness (m) as `thick`, cant (rad) as `base.rx`. */
export const FOIL_SIZES = {
  side: { height: 0.1, thick: 0.008, rx: -0.12217 },
  centre: { height: 0.1, thick: 0.008, rx: 0 },
  'quad-rear': { height: 0.08, thick: 0.007, rx: -0.06981 },
} as const satisfies Record<FinPosition, { height: number; thick: number; rx: number }>;

/** The knots of a `.foil` chain, each point mapped through `map`. */
const foilKnots = (path: FoilPath, map: (x: number, y: number) => Vec2): Knot[] => {
  const ends: Vec2[] = [map(0, 0), ...path.cubics.map((c) => map(c[4], c[5]))];
  return ends.map((end, i) => {
    const into = path.cubics[i - 1];
    const out = path.cubics[i];
    return knot(
      end,
      into ? map(into[2], into[3]) : end,
      out ? map(out[0], out[1]) : end,
      path.cont[i] === 1,
    );
  });
};

const M_TO_CM = 100;

/** `.foil` stores cant in radians to 5 decimals (7° → 0.12217); back to whole-ish degrees. */
const cantDeg = (rx: number): number => Math.round(Math.abs(rx) * RAD_TO_DEG * 100) / 100;

/**
 * The outline scaled to `depth` (cm), rear-aligned: its trailing-edge root on the
 * tab's rear end (x = 0).
 */
const defaultOutline = (depth: number): Spline => {
  // `.foil` x runs from the leading-edge root toward the trailing edge, so it flips.
  const raw = splineFromKnots(foilKnots(FOIL_OUTLINE, (x, y) => vec2(-x, -y)));
  const s = depth / splineExtremes(raw, 'y').max.point.y;
  const chord = FOIL_OUTLINE.cubics[FOIL_OUTLINE.cubics.length - 1]![4] * s;
  return splineFromKnots(foilKnots(FOIL_OUTLINE, (x, y) => vec2(chord - x * s, -y * s)));
};

/** A face normalised to unit chord, outside offsets positive. */
const sectionFace = (path: FoilPath): Spline => {
  const chord = path.cubics[path.cubics.length - 1]![4];
  return splineFromKnots(foilKnots(path, (x, y) => vec2(x / chord, -y / chord)));
};

/** The straight line y = 0 across the chord. */
export const flatFace = (): Spline =>
  splineFromKnots([
    knot(vec2(0, 0), vec2(0, 0), vec2(1 / 3, 0), false),
    knot(vec2(1, 0), vec2(2 / 3, 0), vec2(1, 0), false),
  ]);

/** Fraction of the depth the default taper stays straight for. */
const TAPER_STRAIGHT_TO = 0.7;

/**
 * Thickness `root` (cm) falling in a straight line to half of it at
 * {@link TAPER_STRAIGHT_TO}, then curving down to {@link FIN_MIN_THICKNESS} at the tip.
 * It reaches the tip still falling: a curve that levels off at the minimum leaves the
 * top few millimetres a uniform 0.5 mm sliver, which reads as a spike (round 1 testing).
 * The control points fall steadily, so the curve never dips below the minimum.
 */
export const defaultTaper = (root: number): Spline => {
  const f = TAPER_STRAIGHT_TO;
  const mid = root / 2;
  const slope = (mid - root) / f;
  return splineFromKnots([
    knot(vec2(0, root), vec2(0, root), vec2(f / 3, root + (slope * f) / 3), false),
    // Smooth into the curve: the outgoing handle continues the straight line.
    knot(
      vec2(f, mid),
      vec2((2 * f) / 3, root + (slope * 2 * f) / 3),
      vec2(f + 0.1, mid + slope * 0.1),
    ),
    knot(
      vec2(1, FIN_MIN_THICKNESS),
      vec2(0.9, FIN_MIN_THICKNESS + (mid - FIN_MIN_THICKNESS) / 4),
      vec2(1, FIN_MIN_THICKNESS),
      false,
    ),
  ]);
};

/** The fin a position starts from. `hand` applies to side and quad-rear fins only. */
export const defaultFinDesign = (position: FinPosition, hand: FinHand = 'left'): FinDesign => {
  const size = FOIL_SIZES[position];
  const centre = position === 'centre';
  const section: FinSection = {
    outside: sectionFace(FOIL_SECTIONS[position]),
    inside: centre ? null : flatFace(),
  };
  return {
    position,
    hand: centre ? null : hand,
    cant: cantDeg(size.rx),
    outline: defaultOutline(size.height * M_TO_CM),
    lateralOffset: 0,
    section,
    taper: defaultTaper(size.thick * M_TO_CM),
  };
};
