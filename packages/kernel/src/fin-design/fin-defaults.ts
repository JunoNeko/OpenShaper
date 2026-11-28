// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin each position and template starts from.
 *
 * The starting designs are copied verbatim from the owner-tuned `.fin.json` files in
 * `docs/specs/fins/` (`fin-side-left`, `fin-centre`, `fin-quad-rear-left`,
 * `twin_fin_default`, `keel_default`, `single-fin-centre`), verified by
 * `fin-json.test.ts` and `fin-defaults.test.ts`.
 *
 * `FOIL_OUTLINE`, `FOIL_SECTIONS`, `FOIL_SIZES` (the original FinFoil seeds) and
 * `defaultTaper` remain exported as shared helpers for tests and parametric tools.
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { knot } from '../knot';
import { vec2 } from '../vec2';
import { FCS_SINGLE_TAB } from './fin-tab';
import {
  FIN_MIN_THICKNESS,
  defaultFinBase,
  type FinDesign,
  type FinHand,
  type FinPosition,
  type FinSection,
  type FinTipLine,
} from './fin-design';

/** A `.foil` cubic: control 1, control 2, end — each (x, y). */
export type FoilCubic = readonly [number, number, number, number, number, number];

/** An open Bézier chain as a `.foil` file stores it, start at (0, 0). */
export interface FoilPath {
  readonly cubics: readonly FoilCubic[];
  /** Per node, 1 if the curve is smooth through it. */
  readonly cont: readonly number[];
}

/** Original FinFoil reference outline (retained for reference and source tests). */
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

/** Per position FinFoil reference sizes: depth (m), root thickness (m), cant (rad). */
export const FOIL_SIZES = {
  side: { height: 0.1, thick: 0.008, rx: -0.12217 },
  centre: { height: 0.1, thick: 0.008, rx: 0 },
  'quad-rear': { height: 0.08, thick: 0.007, rx: -0.06981 },
} as const satisfies Record<FinPosition, { height: number; thick: number; rx: number }>;

/** The straight line y = 0 across the chord. */
export const flatFace = (): Spline =>
  splineFromKnots([
    knot(vec2(0, 0), vec2(0, 0), vec2(1 / 3, 0), false),
    knot(vec2(1, 0), vec2(2 / 3, 0), vec2(1, 0), false),
  ]);

/** Fraction of the depth the parametric default taper stays straight for. */
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

/** Knots as [end, handle to previous, handle to next, smooth]; outlines/tapers in mm, foils in chords. */
type KnotRow = readonly [
  readonly [number, number],
  readonly [number, number],
  readonly [number, number],
  boolean,
];

const MM_TO_CM = 0.1;

const rowsToSpline = (rows: readonly KnotRow[], fx: number, fy: number, dx = 0): Spline =>
  splineFromKnots(
    rows.map(([e, p, n, smooth]) => {
      const v = ([x, y]: readonly [number, number]) => vec2(x * fx + dx, y * fy);
      return knot(v(e), v(p), v(n), smooth);
    }),
  );

// --- Shared foils (chords) ---------------------------------------------------

/** Side / twin / keel outside foil, to the precision of the owner's `.fin.json` files. */
const SIDE_OUTSIDE: readonly KnotRow[] = [
  [[0.0, 0.0], [0.0, 0.0], [0.0005226006191950464, 0.05121550679768475], false],
  [
    [0.36508278368555663, 0.11804549737515144],
    [0.15523219814241487, 0.11804549737515144],
    [0.6808722573697671, 0.11804549737515144],
    true,
  ],
  [[1.0, 0.0], [0.9798088571813165, 0.008321442993673442], [1.0, 0.0], false],
];

/** Symmetric centre / single-fin outside foil (in chords). */
const CENTRE_OUTSIDE: readonly KnotRow[] = [
  [[0.0, 0.0], [0.0, 0.0], [0.0, 0.031100536551020908], false],
  [
    [0.29206827065478647, 0.059943188715433735],
    [0.10296195586200199, 0.059943188715433735],
    [0.5770715482288961, 0.059943188715433735],
    true,
  ],
  [[1.0, 0.0], [0.977445434460657, 0.004855665347544247], [1.0, 0.0], false],
];

/** Quad-rear outside foil (in chords). */
const QUAD_REAR_OUTSIDE: readonly KnotRow[] = [
  [[0.0, 0.0], [0.0, 0.0], [0.0, 0.015201084394153701], false],
  [
    [0.35756718528995757, 0.08841584158415842],
    [0.048363979255068364, 0.08726072607260726],
    [0.5946958981612447, 0.0893022159358793],
    true,
  ],
  [[1.0, 0.0], [0.8172324375294673, 0.04419141914191419], [1.0, 0.0], false],
];

// --- Thruster side, centre, and quad-rear defaults (November 2026) -----------

const SIDE_OUTLINE_MM: readonly KnotRow[] = [
  [
    [113.04667196051525, 0.0],
    [113.04667196051525, 0.0],
    [97.41937499921238, 30.615714680571738],
    false,
  ],
  [
    [-17.78764090283123, 111.15333682074883],
    [49.102553926384694, 107.93990761266778],
    [-33.81730158052853, 111.9234075306467],
    true,
  ],
  [
    [-42.59518593925798, 94.414312303019],
    [-46.80141643943847, 106.64774096975167],
    [-38.70835311326221, 83.10982194893737],
    true,
  ],
  [
    [-6.913100612890732, 60.239127559686395],
    [-21.357037137507028, 81.03484710717298],
    [11.506785545016172, 33.71901747864061],
    true,
  ],
  [[0.0, 0.0], [1.597545811668855, 6.129135483514913], [0.0, 0.0], false],
];

const SIDE_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.23132145635473586, 7.113943713450293], false],
  [
    [0.7020344823379076, 4.832990679824562],
    [0.4687011490045742, 6.166324013157896],
    [0.8020344823379075, 4.26156210839599],
    true,
  ],
  [[1.0, 0.5], [0.9999992882440343, 3.0987755847953222], [1.0, 0.5], false],
];

const SIDE_TIP_LINE: FinTipLine = {
  start: 0.504426253349816,
  end: 0.7019365893641257,
};

const CENTRE_OUTLINE_MM: readonly KnotRow[] = [
  [
    [113.72314117359123, 0.0],
    [113.72314117359123, 0.0],
    [98.0023307536913, 30.798918556091035],
    false,
  ],
  [
    [-17.89408181997932, 111.81847635104978],
    [44.960834075080115, 110.92914439160157],
    [-30.90443210350387, 112.00245720539539],
    true,
  ],
  [
    [-42.85007475122778, 94.9792858174011],
    [-41.08215509543286, 107.87240153922026],
    [-34.23512924619405, 86.58899308630821],
    false,
  ],
  [
    [-6.954468480253963, 60.599597394932125],
    [-17.74756914132228, 76.29891928862904],
    [16.162360563324608, 26.97455182642193],
    true,
  ],
  [[0.0, 0.0], [2.930253573140704, 6.348882741804887], [0.0, 0.0], false],
];

const CENTRE_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.23133342377686714, 7.113943713450293], false],
  [
    [0.7315940768133873, 4.576685855263159],
    [0.49826074348005395, 5.910019188596493],
    [0.8315940768133873, 4.005257283834588],
    true,
  ],
  [[1.0, 0.5], [0.9983326316752364, 2.323579130116959], [1.0, 0.5], false],
];

const CENTRE_TIP_LINE: FinTipLine = {
  start: 0.5087054253690823,
  end: 0.6749811499548745,
};

const QUAD_REAR_OUTLINE_MM: readonly KnotRow[] = [
  [
    [81.35843266178341, 0.0],
    [81.35843266178341, 0.0],
    [70.11164082384299, 22.033789390117274],
    false,
  ],
  [
    [-12.801567348311185, 79.99582041673936],
    [32.16533551365244, 79.35958531463034],
    [-22.109274614615142, 80.12744177185552],
    true,
  ],
  [
    [-30.655281635939513, 67.94893061952949],
    [-29.390497962334532, 77.17276735521222],
    [-24.492081635278762, 61.94644898623292],
    false,
  ],
  [
    [-4.97528163318643, 43.353430208729414],
    [-12.69675102176933, 54.5848489854437],
    [11.562680295117156, 19.29780725104845],
    true,
  ],
  [[0.0, 0.0], [2.0963265308369916, 4.5420408168134685], [0.0, 0.0], false],
];

const QUAD_REAR_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 7.000000000000001], [0.0, 7.000000000000001], [0.2333333333333333, 5.833333333333334], false], // prettier-ignore
  [
    [0.7, 3.5000000000000004],
    [0.4666666666666666, 4.666666666666667],
    [0.7999999999999999, 3.0000000000000004],
    true,
  ],
  [[1.0, 0.5], [0.9999997880723743, 1.890744731800766], [1.0, 0.5], false],
];

const QUAD_REAR_TIP_LINE: FinTipLine = {
  start: 0.502999433659049,
  end: 0.6713646572900285,
};

const POSITION_SPEC: Record<
  FinPosition,
  {
    readonly cant: number;
    readonly outline: readonly KnotRow[];
    readonly outside: readonly KnotRow[];
    readonly taper: readonly KnotRow[];
    readonly tipLine: FinTipLine;
  }
> = {
  side: {
    cant: 7,
    outline: SIDE_OUTLINE_MM,
    outside: SIDE_OUTSIDE,
    taper: SIDE_TAPER_MM,
    tipLine: SIDE_TIP_LINE,
  },
  centre: {
    cant: 0,
    outline: CENTRE_OUTLINE_MM,
    outside: CENTRE_OUTSIDE,
    taper: CENTRE_TAPER_MM,
    tipLine: CENTRE_TIP_LINE,
  },
  'quad-rear': {
    cant: 4,
    outline: QUAD_REAR_OUTLINE_MM,
    outside: QUAD_REAR_OUTSIDE,
    taper: QUAD_REAR_TAPER_MM,
    tipLine: QUAD_REAR_TIP_LINE,
  },
};

/** The fin a position starts from. `hand` applies to side and quad-rear fins only. */
export const defaultFinDesign = (position: FinPosition, hand: FinHand = 'left'): FinDesign => {
  const spec = POSITION_SPEC[position];
  const centre = position === 'centre';
  const section: FinSection = {
    outside: rowsToSpline(spec.outside, 1, 1),
    inside: centre ? null : flatFace(),
  };
  return {
    position,
    hand: centre ? null : hand,
    cant: spec.cant,
    base: defaultFinBase(position),
    toe: 0,
    outline: rowsToSpline(spec.outline, MM_TO_CM, MM_TO_CM),
    lateralOffset: 0,
    section,
    slices: [],
    taper: rowsToSpline(spec.taper, 1, MM_TO_CM),
    tipLine: spec.tipLine,
  };
};

// --- Canard ------------------------------------------------------------------

/**
 * The owner's canard (round 3), as they drew it: a small fin for an FCS 1 style single
 * plug. Knots as [end, handle to previous, handle to next, smooth]; the outline and the
 * taper's thickness in mm, the section in chords.
 */
const CANARD_OUTLINE_MM: readonly KnotRow[] = [
  [[69.2553, 0.0], [69.2553, 0.0], [55.1969, 27.5422], false],
  [[-8.6879, 80.5759], [24.3397, 78.7106], [-20.3052, 81.232], true],
  [[-23.581, 67.5813], [-29.0498, 77.854], [-18.1455, 57.3712], true],
  [[-4.81225, 34.934], [-12.4714, 50.1523], [0.393592, 24.5903], true],
  [[0.0, 0.0], [2.62041, 5.67755], [0.0, 0.0], false],
];
const CANARD_OUTSIDE: readonly KnotRow[] = [
  [[0.0, 0.0], [0.0, 0.0], [0.000522601, 0.0512155], false],
  [[0.365083, 0.118045], [0.155232, 0.118045], [0.680872, 0.118045], true],
  [[1.0, 0.0], [0.979809, 0.00832144], [1.0, 0.0], false],
];
const CANARD_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.233333, 6.66667], false],
  [[0.7, 4.0], [0.466667, 5.33333], [0.8, 3.42857], true],
  [[1.0, 0.5], [0.952625, 2.33594], [1.0, 0.5], false],
];

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

// --- Twin fin and keel (November 2026) ---------------------------------------

/**
 * The owner's twin fin and keel, as they drew them: side fins on the Futures 3/4" tab,
 * 7° cant, rear-aligned, each with a raised rear overhanging behind the tab. Left and
 * right share the outline; the hand only turns the outside face.
 */
const TWIN_OUTLINE_MM: readonly KnotRow[] = [
  [
    [116.99999276099497, 0.0],
    [116.99999276099497, 0.0],
    [102.94150296356945, 37.1820195958229],
    false,
  ],
  [
    [-27.626223628711436, 135.6281120658242],
    [42.14784889383955, 136.95023123506354],
    [-47.44295068101927, 135.25261334889075],
    true,
  ],
  [
    [-55.07813726692455, 112.9792094722385],
    [-56.05262923871095, 125.71170903315766],
    [-51.24412457938158, 110.04437077332979],
    false,
  ],
  [
    [-10.502752135511361, 55.208070215218896],
    [-15.691718211820936, 88.8655331986564],
    [-7.03218977521546, 32.69677943868578],
    true,
  ],
  [
    [-14.614184834761321, 4.087931710516571],
    [-11.996403842834397, 15.73405621585357],
    [-4.814798265666375, 1.5071639151127767],
    false,
  ],
  [[0.0, 0.0], [-1.567644313855769, 1.031756990767494], [0.0, 0.0], false],
];

const TWIN_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.2333333333333333, 6.666666666666669], false],
  [
    [0.6985347820881227, 4.198733798311944],
    [0.46520144875478936, 5.532067131645278],
    [0.7985347820881227, 3.627305226883373],
    true,
  ],
  [[1.0, 1.0], [0.9999995308360834, 2.5890362327608205], [1.0, 1.0], false],
];

const TWIN_TIP_LINE: FinTipLine = {
  start: 0.4688833453297482,
  end: 0.6769477516183864,
};

const KEEL_OUTLINE_MM: readonly KnotRow[] = [
  [
    [116.99999276099497, 0.0],
    [116.99999276099497, 0.0],
    [93.6302776029457, 39.76544692357337],
    false,
  ],
  [
    [-42.54981796236179, 123.15102307921643],
    [24.00580794317579, 123.74218057385363],
    [-56.19371144052175, 123.02983588014939],
    true,
  ],
  [
    [-73.14243687963844, 112.95982102387583],
    [-68.39159015855229, 119.78483590466551],
    [-75.63636609658984, 109.37706935525581],
    true,
  ],
  [
    [-73.60025148741553, 99.27779307478147],
    [-77.97509783448366, 103.4973287430475],
    [-67.0674510667459, 92.97691249479216],
    true,
  ],
  [
    [-38.90051018773946, 64.17190700360482],
    [-46.80119531225473, 88.00073676307527],
    [-30.84726487056596, 39.88294868545475],
    true,
  ],
  [
    [-44.313466111162505, 16.5535202790884],
    [-39.80619063668576, 25.001001140648164],
    [-36.95298877982103, 5.108120243966843],
    false,
  ],
  [[0.0, 0.0], [-2.3472160136134317, 0.511499809676722], [0.0, 0.0], false],
];

const KEEL_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 8.0], [0.0, 8.0], [0.22886056286549708, 6.873231721497717], false],
  [
    [0.702362024853801, 4.619695164493145],
    [0.4690286915204676, 5.95302849782648],
    [0.8023620248538009, 4.048266593064574],
    true,
  ],
  [[1.0, 1.0], [0.9999999107673154, 2.778957014701478], [1.0, 1.0], false],
];

const KEEL_TIP_LINE: FinTipLine = {
  start: 0.48529175297437943,
  end: 0.6594787319318559,
};

const ownerSideFin = (
  outline: readonly KnotRow[],
  taper: readonly KnotRow[],
  tipLine: FinTipLine,
  hand: FinHand,
): FinDesign => ({
  position: 'side',
  hand,
  cant: 7,
  base: defaultFinBase('side'),
  toe: 0,
  outline: rowsToSpline(outline, MM_TO_CM, MM_TO_CM),
  lateralOffset: 0,
  section: { outside: rowsToSpline(SIDE_OUTSIDE, 1, 1), inside: flatFace() },
  slices: [],
  taper: rowsToSpline(taper, 1, MM_TO_CM),
  tipLine,
});

/** The starting twin fin: tall and raked, its rear overhanging behind the tab. */
export const defaultTwinFin = (hand: FinHand = 'left'): FinDesign =>
  ownerSideFin(TWIN_OUTLINE_MM, TWIN_TAPER_MM, TWIN_TIP_LINE, hand);

/** The starting keel: long and low, its raised rear running well back behind the tab. */
export const defaultKeel = (hand: FinHand = 'left'): FinDesign =>
  ownerSideFin(KEEL_OUTLINE_MM, KEEL_TAPER_MM, KEEL_TIP_LINE, hand);

// --- Single fin (US box, November 2026) --------------------------------------

/**
 * The starting single fin, for a longboard's US box: an 8" (203.2 mm) deep raked fin,
 * symmetric foil, 10 mm thick at the root, no cant, with its trailing-edge root 25 mm
 * ahead of the US box head's rear end.
 */
const SINGLE_OUTLINE_MM: readonly KnotRow[] = [
  [[178.5942, 0.0], [178.5942, 0.0], [154.3788, 13.688000000000002], false],
  [[-34.15950000000001, 203.2], [75.6645, 203.2], [-57.584, 203.2], true],
  [[-58.4112, 191.80900000000003], [-58.4112, 193.21480000000003], [-58.4112, 185.0783], true],
  [[40.4329, 56.2199], [40.4329, 130.0204], [40.4329, 46.788], true],
  [[25.0, 0.0], [38.4232, 17.5843], [25.0, 0.0], false],
];

const SINGLE_TAPER_MM: readonly KnotRow[] = [
  [[0.0, 10.0], [0.0, 10.0], [0.2333333333333333, 8.333333333333334], false],
  [
    [0.7, 5.0],
    [0.4666666666666666, 6.666666666666668],
    [0.7999999999999999, 4.285714285714286],
    true,
  ],
  [[1.0, 0.5], [0.999999998953065, 2.8208088613589832], [1.0, 0.5], false],
];

export const defaultSingleFin = (): FinDesign => ({
  position: 'centre',
  hand: null,
  cant: 0,
  base: 'us-box',
  toe: 0,
  outline: rowsToSpline(SINGLE_OUTLINE_MM, MM_TO_CM, MM_TO_CM),
  lateralOffset: 0,
  section: { outside: rowsToSpline(CENTRE_OUTSIDE, 1, 1), inside: null },
  slices: [],
  taper: rowsToSpline(SINGLE_TAPER_MM, 1, MM_TO_CM),
});
