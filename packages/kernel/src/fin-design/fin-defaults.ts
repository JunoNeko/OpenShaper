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
 * - The taper is straight to 70% of the depth, then curves to the 1 mm minimum at the
 *   tip, the shape the owner describes. FinFoil's own taper is flat, then rolls off.
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { RAD_TO_DEG } from '../constants';
import { knot, type Knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';
import { splineExtremes } from './curve-shape';
import { FCS_SINGLE_TAB, US_BOX_HEAD } from './fin-tab';
import {
  FIN_MIN_THICKNESS,
  defaultFinBase,
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
 * top few millimetres a uniform minimum-thickness sliver, which reads as a spike (round 1 testing).
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
    base: defaultFinBase(position),
    toe: 0,
    outline: defaultOutline(size.height * M_TO_CM),
    lateralOffset: 0,
    section,
    slices: [],
    taper: defaultTaper(size.thick * M_TO_CM),
  };
};

/**
 * The owner's canard (round 3), as they drew it: a small fin for an FCS 1 style single
 * plug. Knots as [end, handle to previous, handle to next, smooth]; the outline and the
 * taper's thickness in mm, the section in chords.
 */
type KnotRow = [[number, number], [number, number], [number, number], boolean];
const CANARD_OUTLINE_MM: KnotRow[] = [
  [[69.2553, 0.0], [69.2553, 0.0], [55.1969, 27.5422], false],
  [[-8.6879, 80.5759], [24.3397, 78.7106], [-20.3052, 81.232], true],
  [[-23.581, 67.5813], [-29.0498, 77.854], [-18.1455, 57.3712], true],
  [[-4.81225, 34.934], [-12.4714, 50.1523], [0.393592, 24.5903], true],
  [[0.0, 0.0], [2.62041, 5.67755], [0.0, 0.0], false],
];
const CANARD_OUTSIDE: KnotRow[] = [
  [[0.0, 0.0], [0.0, 0.0], [0.000522601, 0.0512155], false],
  [[0.365083, 0.118045], [0.155232, 0.118045], [0.680872, 0.118045], true],
  [[1.0, 0.0], [0.979809, 0.00832144], [1.0, 0.0], false],
];
const CANARD_TAPER_MM: KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.233333, 6.66667], false],
  [[0.7, 4.0], [0.466667, 5.33333], [0.8, 3.42857], true],
  [[1.0, 1.0], [0.952625, 2.33594], [1.0, 1.0], false],
];

const MM_TO_CM = 0.1;

const rowsToSpline = (rows: KnotRow[], fx: number, fy: number, dx = 0): Spline =>
  splineFromKnots(
    rows.map(([e, p, n, smooth]) => {
      const v = ([x, y]: [number, number]) => vec2(x * fx + dx, y * fy);
      return knot(v(e), v(p), v(n), smooth);
    }),
  );

/**
 * The starting canard: the owner's, on an FCS single tab, its base centred over the tab
 * and no cant (the plug carries it). Left and right share the outline; the hand only
 * turns the outside face.
 */
export const defaultCanard = (hand: FinHand = 'left'): FinDesign => {
  const le = CANARD_OUTLINE_MM[0]![0][0];
  const te = CANARD_OUTLINE_MM[CANARD_OUTLINE_MM.length - 1]![0][0];
  // Centre the base over the tab (cm).
  const dx = FCS_SINGLE_TAB.length / 2 - ((le + te) / 2) * MM_TO_CM;
  return {
    position: 'side',
    hand,
    cant: 0,
    base: 'fcs-single',
    toe: 0,
    outline: rowsToSpline(CANARD_OUTLINE_MM, MM_TO_CM, MM_TO_CM, dx),
    lateralOffset: 0,
    section: { outside: rowsToSpline(CANARD_OUTSIDE, 1, 1), inside: flatFace() },
    slices: [],
    taper: rowsToSpline(CANARD_TAPER_MM, 1, MM_TO_CM),
  };
};

/**
 * The starting single fin, for a longboard's US box: an 8" (203.2 mm) deep fin with the
 * outline of the owner's reference photo (a raked longboard fin), traced from the photo
 * and fitted with five knots (within 2 mm of the trace everywhere, about 0.5 mm on
 * average). Mm, the trailing-edge root at 0. A symmetric foil (the centre section), 10 mm
 * thick at the root; no cant. Placed with its trailing-edge root 25 mm ahead of the US
 * box head's rear end.
 */
const SINGLE_OUTLINE_MM: KnotRow[] = [
  [[153.5942, 0.0], [153.5942, 0.0], [129.3788, 13.688], false],
  [[-59.1595, 203.2], [50.6645, 203.2], [-82.584, 203.2], true],
  [[-83.4112, 191.809], [-83.4112, 193.2148], [-83.4112, 185.0783], true],
  [[15.4329, 56.2199], [15.4329, 130.0204], [15.4329, 46.788], true],
  [[0.0, 0.0], [13.4232, 17.5843], [0.0, 0.0], false],
];

/** Root thickness of the starting single fin (cm). */
const SINGLE_ROOT_THICKNESS = 1.0;

export const defaultSingleFin = (): FinDesign => {
  const te = SINGLE_OUTLINE_MM[SINGLE_OUTLINE_MM.length - 1]![0][0] * MM_TO_CM;
  // The trailing-edge root the usual stub ahead of the head's rear end.
  const rear = te - US_BOX_HEAD.rearStub;
  return {
    position: 'centre',
    hand: null,
    cant: 0,
    base: 'us-box',
    toe: 0,
    outline: rowsToSpline(SINGLE_OUTLINE_MM, MM_TO_CM, MM_TO_CM, -rear),
    lateralOffset: 0,
    section: { outside: sectionFace(FOIL_SECTIONS.centre), inside: null },
    slices: [],
    taper: defaultTaper(SINGLE_ROOT_THICKNESS),
  };
};
