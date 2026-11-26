// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The tab a fin sits on: its base. Two Futures tabs (futures-tab.ts), the FCS single
 * tab that plugs into an FCS 1 style single plug (small canard fins), and the FCS 1
 * base: two such tabs, one for each of the fin's two plugs. FCS II plugs take FCS 1
 * fins too. The US box head: one long block for a longboard's single-fin box,
 * whose length follows the fin. And the legacy Gbox tab: one block with a hole-saw
 * notch in its underside.
 *
 * All share one frame (cm): x from the base's rear end at 0 toward the nose, y up from
 * the tab bottom to its top at `height` (the blade root plane), extruded `thickness`
 * across, centred on its mid-plane. The outline of a fin is in this frame, so it places
 * the fin fore and aft on its base. A base is one or more separate tabs (`parts`).
 */
import type { Spline } from '../bezier-spline';
import { vec2, type Vec2 } from '../vec2';
import {
  FUTURES_TABS,
  futuresTabOutline,
  type FuturesTabKind,
  type TabSegment,
} from './futures-tab';

/** Which tab the fin sits on. */
export type FinBase =
  | 'futures-side'
  | 'futures-centre'
  | 'fcs-single'
  | 'fcs-1'
  | 'us-box'
  | 'gbox'
  | 'modii';

export const FIN_BASES: readonly FinBase[] = [
  'futures-side',
  'futures-centre',
  'fcs-single',
  'fcs-1',
  'us-box',
  'gbox',
  'modii',
];

/** What the designer calls each base. */
export const FIN_BASE_LABEL: Record<FinBase, string> = {
  'futures-side': 'Futures 3/4"',
  'futures-centre': 'Futures 1/2"',
  'fcs-single': 'FCS single',
  'fcs-1': 'FCS 1',
  'us-box': 'US box',
  gbox: 'Gbox',
  modii: 'Modii',
};

/** The Futures tab a base is, or null for one that isn't Futures. */
export const futuresKind = (base: FinBase): FuturesTabKind | null =>
  base === 'futures-side' ? 'side' : base === 'futures-centre' ? 'centre' : null;

/**
 * The FCS single tab (cm): a plain block, held by a grub screw in the side of the plug,
 * so it needs no notch or slot. It drops straight in: no rocking, so no rear clearance
 * and no front grub screw to keep clear of. Cant comes from the plug (0°, 5° or 9°), so
 * the fin itself has none.
 */
export const FCS_SINGLE_TAB = { length: 2.05, height: 1.35, thickness: 0.635 } as const;

/**
 * The FCS 1 base (cm): two tabs the size of the FCS single tab, `gap` apart, their
 * lower corners rounded to `cornerRadius`. Fins are aligned from the back: the
 * trailing-edge root sits `rearBlade` behind the rear tab, so a bigger fin overhangs
 * further at the front. No cant: the plugs carry it. Owner's measurements of a stock
 * FCS 1 fin; aftermarket tabs have no grub-screw hole, so none is modelled.
 */
export const FCS1_BASE = {
  tabLength: 2.05,
  gap: 3.3,
  height: 1.35,
  thickness: 0.635,
  cornerRadius: 0.15,
  rearBlade: 2.05,
} as const;

/**
 * The US box fin head (cm), from the standard US box head drawing: 25 mm deep and
 * 9.1 mm thick (adjusted -0.5 mm from the 9.6 mm drawing for fit), 160–240 mm long.
 * At the front, a 14.1 mm nose half the depth (12.5 mm) carries the 4.5 mm screw hole
 * (8-32 clearance), drilled down through it; behind the nose a 12.7 mm radius scoop
 * curves down to the full depth. The lower rear corner is rounded (radius estimated
 * from the drawing). The head's rear end is fixed at x = 0 and its front follows the
 * fin, `noseAhead` ahead of the leading-edge root (at least `minLength` from the rear),
 * with the screw hole just in front of the blade. So sliding the fin fore and aft
 * slides the blade along the head; a fin starts with its trailing-edge root `rearStub`
 * ahead of the rear end. No cant: centre fins.
 */
export const US_BOX_HEAD = {
  height: 2.5,
  thickness: 0.91,
  minLength: 16,
  maxLength: 24,
  noseDepth: 1.25,
  /** Key 9.6 mm, hole 4.5 mm, and a 0.5 mm land so the hole stays clear of the scoop. */
  noseAhead: 1.46,
  screwRadius: 0.225,
  /** Screw hole centre, behind the head's front. */
  screwFromFront: 1.185,
  scoopRadius: 1.27,
  rearRadius: 0.6,
  rearStub: 2.5,
} as const;

const INCH = 2.54;

/**
 * The legacy Gbox fin base (cm), from Gbox's drawing "Legacy GBOX FIN BASE Details"
 * (revision 6, 2026-05-07). The drawing is in inches, millimetres rounded beside them;
 * the inch figures are used.
 *
 * One block 2 7/8" long, 17/32" deep and 1/4" thick. A 7/8" hole saw, centred along the
 * tab with its centre 1/8" below the bottom, cuts a notch 5/16" up into the underside.
 * The blade's trailing-edge root sits 13/16" behind the tab's rear end, as drawn. The
 * box carries the cant, so the fin has none.
 *
 * Not modelled: the two screw grooves, cut into the tab's side with a 1/8" flat end mill
 * 1/16" deep, 7/16" long, 3/16" in from each end and 1/4" above the bottom, for the box's
 * screws (2 1/8" apart). They are recorded here for the documentation.
 */
export const GBOX_TAB = {
  length: (2 + 7 / 8) * INCH,
  height: (17 / 32) * INCH,
  thickness: (1 / 4) * INCH,
  notchRadius: (7 / 16) * INCH,
  /** Hole-saw centre, below the tab bottom. */
  notchCentreBelow: (1 / 8) * INCH,
  rearBlade: (13 / 16) * INCH,
  screwSpacing: (2 + 1 / 8) * INCH,
  grooveLength: (7 / 16) * INCH,
  grooveFromEnd: (3 / 16) * INCH,
  grooveAbove: (1 / 4) * INCH,
  grooveWidth: (1 / 8) * INCH,
  grooveDepth: (1 / 16) * INCH,
} as const;

/** How far the Gbox notch reaches up into the tab (cm): 5/16". */
export const gboxNotchHeight = (): number => GBOX_TAB.notchRadius - GBOX_TAB.notchCentreBelow;

/** The Gbox tab's profile: a block with the hole-saw notch arching up from its bottom. */
const gboxTab = (): FinTabOutline => {
  const { length: L, height: H, thickness, notchRadius: r, notchCentreBelow: c } = GBOX_TAB;
  const mid = L / 2;
  const half = Math.sqrt(r * r - c * c); // the notch's half-width at the bottom
  const segments: TabSegment[] = [
    { kind: 'line', from: vec2(0, 0), to: vec2(mid - half, 0) },
    {
      kind: 'arc',
      from: vec2(mid - half, 0),
      to: vec2(mid + half, 0),
      center: vec2(mid, -c),
      radius: r,
      ccw: false,
    },
    { kind: 'line', from: vec2(mid + half, 0), to: vec2(L, 0) },
    { kind: 'line', from: vec2(L, 0), to: vec2(L, H) },
    { kind: 'line', from: vec2(L, H), to: vec2(0, H) },
    { kind: 'line', from: vec2(0, H), to: vec2(0, 0) },
  ];
  return {
    base: 'gbox',
    rear: 0,
    length: L,
    height: H,
    thickness,
    parts: [{ segments, holes: [] }],
  };
};

/**
 * The Modii click-in fin base (cm), measured from `modii_base_Stabilser.stl`: 98.05 mm
 * long, 14.2 mm deep and 6.3 mm thick. Front-first installation: the leading-edge root
 * sits at the front of the tab (`x = length`), with a 4.15 mm open U-slot at the front,
 * two top-open pockets separated by a 3 mm centre post, an 18.14° slanted rear wall,
 * three rounded-rectangle weight-saving through-holes, and two opposing Ø5.83 × 0.5 mm
 * blind side dimples. The box carries the cant (0°, 4° or 8°), so the fin has none.
 */
const mm = (n: number): number => n / 10;

export const MODII_TAB = {
  length: mm(98.05),
  height: mm(14.2),
  thickness: mm(6.3),
  rearFootX: mm(4.651),
  rearBottomRadius: mm(2.0),
  frontBottomRadius: mm(1.5),
  slotHeight: mm(4.15),
  slotCentreY: mm(7.545),
  slotArcCentreX: mm(94.17),
  slotMouthRadius: mm(0.5),
  pocketFloorY: mm(2.5),
  pocketRadius: mm(1.6),
  rearPocketRearX: mm(32.95),
  rearPocketFrontX: mm(41.1375),
  frontPocketRearX: mm(44.1375),
  frontPocketTopX: mm(52.325),
  frontPocketFootX: mm(56.03),
  dimpleRadius: mm(5.83 / 2),
  dimpleDepth: mm(0.5),
  dimpleY: mm(7.33),
  rearDimpleX: mm(10.28),
  frontDimpleX: mm(65.59),
} as const;

/** A rounded-rectangle through-hole running clockwise (material outside). */
const roundedHole = (x0: number, x1: number, y0: number, y1: number, r: number): TabSegment[] => {
  const arc = (from: Vec2, to: Vec2, center: Vec2): TabSegment => ({
    kind: 'arc',
    from,
    to,
    center,
    radius: r,
    ccw: false,
  });
  return [
    { kind: 'line', from: vec2(x0 + r, y1), to: vec2(x1 - r, y1) },
    arc(vec2(x1 - r, y1), vec2(x1, y1 - r), vec2(x1 - r, y1 - r)),
    { kind: 'line', from: vec2(x1, y1 - r), to: vec2(x1, y0 + r) },
    arc(vec2(x1, y0 + r), vec2(x1 - r, y0), vec2(x1 - r, y0 + r)),
    { kind: 'line', from: vec2(x1 - r, y0), to: vec2(x0 + r, y0) },
    arc(vec2(x0 + r, y0), vec2(x0, y0 + r), vec2(x0 + r, y0 + r)),
    { kind: 'line', from: vec2(x0, y0 + r), to: vec2(x0, y1 - r) },
    arc(vec2(x0, y1 - r), vec2(x0 + r, y1), vec2(x0 + r, y1 - r)),
  ];
};

const modiiTab = (): FinTabOutline => {
  const m = MODII_TAB;
  const L = m.length;
  const H = m.height;
  const rFB = m.frontBottomRadius;
  const rRB = m.rearBottomRadius;
  const rSM = m.slotMouthRadius;
  const rS = m.slotHeight / 2;
  const slotBot = m.slotCentreY - rS;
  const slotTop = m.slotCentreY + rS;
  const rP = m.pocketRadius;
  const floorY = m.pocketFloorY;

  // Rear slanted wall from (0, H) toward (rearFootX, 0), tangent to the R2.0 bottom corner.
  const rearTheta = Math.atan(m.rearFootX / H);
  const rearCx = m.rearFootX + rRB * Math.tan(Math.PI / 4 - rearTheta / 2);
  const rearTan = vec2(rearCx - rRB * Math.cos(rearTheta), rRB - rRB * Math.sin(rearTheta));

  // Front pocket slanted wall from (frontPocketTopX, H) toward (frontPocketFootX, floorY),
  // tangent to its R1.6 bottom-front fillet.
  const frontTheta = Math.atan((m.frontPocketFootX - m.frontPocketTopX) / (H - floorY));
  const frontCx = m.frontPocketFootX - rP * Math.tan(Math.PI / 4 + frontTheta / 2);
  const frontTan = vec2(
    frontCx + rP * Math.cos(frontTheta),
    floorY + rP + rP * Math.sin(frontTheta),
  );

  const line = (from: Vec2, to: Vec2): TabSegment => ({ kind: 'line', from, to });
  const arc = (from: Vec2, to: Vec2, center: Vec2, radius: number, ccw: boolean): TabSegment => ({
    kind: 'arc',
    from,
    to,
    center,
    radius,
    ccw,
  });

  const segments: TabSegment[] = [
    line(vec2(rearCx, 0), vec2(L - rFB, 0)),
    arc(vec2(L - rFB, 0), vec2(L, rFB), vec2(L - rFB, rFB), rFB, true),
    line(vec2(L, rFB), vec2(L, slotBot - rSM)),
    arc(vec2(L, slotBot - rSM), vec2(L - rSM, slotBot), vec2(L - rSM, slotBot - rSM), rSM, true),
    line(vec2(L - rSM, slotBot), vec2(m.slotArcCentreX, slotBot)),
    arc(
      vec2(m.slotArcCentreX, slotBot),
      vec2(m.slotArcCentreX, slotTop),
      vec2(m.slotArcCentreX, m.slotCentreY),
      rS,
      false,
    ),
    line(vec2(m.slotArcCentreX, slotTop), vec2(L - rSM, slotTop)),
    arc(vec2(L - rSM, slotTop), vec2(L, slotTop + rSM), vec2(L - rSM, slotTop + rSM), rSM, true),
    line(vec2(L, slotTop + rSM), vec2(L, H)),
    line(vec2(L, H), vec2(m.frontPocketTopX, H)),
    line(vec2(m.frontPocketTopX, H), frontTan),
    arc(frontTan, vec2(frontCx, floorY), vec2(frontCx, floorY + rP), rP, false),
    line(vec2(frontCx, floorY), vec2(m.frontPocketRearX + rP, floorY)),
    arc(
      vec2(m.frontPocketRearX + rP, floorY),
      vec2(m.frontPocketRearX, floorY + rP),
      vec2(m.frontPocketRearX + rP, floorY + rP),
      rP,
      false,
    ),
    line(vec2(m.frontPocketRearX, floorY + rP), vec2(m.frontPocketRearX, H)),
    line(vec2(m.frontPocketRearX, H), vec2(m.rearPocketFrontX, H)),
    line(vec2(m.rearPocketFrontX, H), vec2(m.rearPocketFrontX, floorY + rP)),
    arc(
      vec2(m.rearPocketFrontX, floorY + rP),
      vec2(m.rearPocketFrontX - rP, floorY),
      vec2(m.rearPocketFrontX - rP, floorY + rP),
      rP,
      false,
    ),
    line(vec2(m.rearPocketFrontX - rP, floorY), vec2(m.rearPocketRearX + rP, floorY)),
    arc(
      vec2(m.rearPocketRearX + rP, floorY),
      vec2(m.rearPocketRearX, floorY + rP),
      vec2(m.rearPocketRearX + rP, floorY + rP),
      rP,
      false,
    ),
    line(vec2(m.rearPocketRearX, floorY + rP), vec2(m.rearPocketRearX, H)),
    line(vec2(m.rearPocketRearX, H), vec2(0, H)),
    line(vec2(0, H), rearTan),
    arc(rearTan, vec2(rearCx, 0), vec2(rearCx, rRB), rRB, true),
  ];

  const holes: TabSegment[][] = [
    roundedHole(mm(17.05), mm(28.05), mm(2.8), mm(11.2), mm(2.5)),
    roundedHole(mm(72.85), mm(79.15), mm(2.2), mm(12.2), mm(1.6)),
    roundedHole(mm(82.15), mm(88.45), mm(2.2), mm(12.2), mm(1.6)),
  ];

  const pockets: FinTabPocket[] = [
    {
      x: m.rearDimpleX,
      y: m.dimpleY,
      radius: m.dimpleRadius,
      depth: m.dimpleDepth,
      side: 'outside',
    },
    {
      x: m.frontDimpleX,
      y: m.dimpleY,
      radius: m.dimpleRadius,
      depth: m.dimpleDepth,
      side: 'inside',
    },
  ];

  return {
    base: 'modii',
    rear: 0,
    length: L,
    height: H,
    thickness: m.thickness,
    parts: [{ segments, holes, pockets }],
  };
};

/**
 * A round hole straight down through a tab (along the blade's height), between two of
 * its flat horizontal faces: the US box head's screw hole.
 */
export interface FinTabBore {
  /** Centre, along the base (cm, frame above). */
  readonly x: number;
  readonly radius: number;
  /** Bottom and top of the hole (cm, frame above); each is a horizontal profile line. */
  readonly from: number;
  readonly to: number;
}

/**
 * A shallow blind circular recess in one side face of a tab (the Modii side dimples).
 * `side` is relative to the fin's outward direction (`'outside'` = +Y on a left/centre
 * fin), so a right fin mirrors a left fin across Y = 0.
 */
export interface FinTabPocket {
  /** Centre along the base (cm, frame above). */
  readonly x: number;
  /** Centre height above the tab bottom (cm, frame above). */
  readonly y: number;
  readonly radius: number;
  /** Depth inward from the tab's side face (cm). */
  readonly depth: number;
  readonly side: 'outside' | 'inside';
}

/** One tab of a base: its side profile and any holes through it. */
export interface FinTabPart {
  /** Closed, counter-clockwise (material on the left): lines and arcs. */
  readonly segments: readonly TabSegment[];
  /** Through-holes, each closed and clockwise (material outside): the Futures weight-saving slots. */
  readonly holes: readonly (readonly TabSegment[])[];
  /** Holes straight down through it, centred across its thickness. */
  readonly bores?: readonly FinTabBore[];
  /** Shallow blind circular recesses in one side face (Modii locking dimples). */
  readonly pockets?: readonly FinTabPocket[];
}

/** A base's tabs and overall size, in the frame above. */
export interface FinTabOutline {
  readonly base: FinBase;
  /** Where the rearmost tab starts (cm): 0, except on a US box, whose head follows the fin. */
  readonly rear: number;
  /** From the rear of the rearmost tab to the front of the foremost. */
  readonly length: number;
  readonly height: number;
  readonly thickness: number;
  /** The separate tabs, rearmost first. */
  readonly parts: readonly FinTabPart[];
}

const lineLoop = (corners: readonly Vec2[]): TabSegment[] =>
  corners.map((from, i) => ({
    kind: 'line' as const,
    from,
    to: corners[(i + 1) % corners.length]!,
  }));

/** A block from x0 to x1, `h` tall, its two lower corners rounded to `r`. */
const roundedBlock = (x0: number, x1: number, h: number, r: number): TabSegment[] => {
  const arc = (from: Vec2, to: Vec2, center: Vec2): TabSegment => ({
    kind: 'arc',
    from,
    to,
    center,
    radius: r,
    ccw: true,
  });
  return [
    { kind: 'line', from: vec2(x0 + r, 0), to: vec2(x1 - r, 0) },
    arc(vec2(x1 - r, 0), vec2(x1, r), vec2(x1 - r, r)),
    { kind: 'line', from: vec2(x1, r), to: vec2(x1, h) },
    { kind: 'line', from: vec2(x1, h), to: vec2(x0, h) },
    { kind: 'line', from: vec2(x0, h), to: vec2(x0, r) },
    arc(vec2(x0, r), vec2(x0 + r, 0), vec2(x0 + r, r)),
  ];
};

/**
 * Where a base puts a fin's trailing-edge root (cm, x in the frame above) when the fin
 * is moved onto it, or null where the fin is centred over the tab instead.
 */
export const baseTrailingRoot = (base: FinBase): number | null =>
  futuresKind(base)
    ? 0
    : base === 'fcs-1'
      ? -FCS1_BASE.rearBlade
      : base === 'gbox'
        ? -GBOX_TAB.rearBlade
        : null;

/**
 * The US box head's length (cm) under a fin whose leading-edge root is at `le`: from its
 * rear end at 0 to the nose ahead of the leading edge, and never under the minimum. Over
 * the maximum is a broken rule (fin-rules.ts), not clamped, so the nose stays in place.
 */
export const usBoxHeadLength = (le: number): number =>
  Math.max(US_BOX_HEAD.minLength, le + US_BOX_HEAD.noseAhead);

/** The US box head under a fin whose leading-edge root is at `le`. */
const usBoxHead = (le: number): FinTabOutline => {
  const h = US_BOX_HEAD;
  const length = usBoxHeadLength(le);
  const front = length;
  const rear = 0;
  const body = le; // where the scoop leaves the nose
  const r = h.rearRadius;
  const s = h.scoopRadius;
  // The scoop's centre sits just below the bottom, so it meets the nose's underside
  // level and the bottom square, as drawn (12.7 mm radius over a 12.5 mm drop).
  const cy = h.noseDepth - s;
  const scoopFoot = body - Math.sqrt(s * s - cy * cy);
  const H = h.height;
  const segments: TabSegment[] = [
    { kind: 'line', from: vec2(rear + r, 0), to: vec2(scoopFoot, 0) },
    {
      kind: 'arc',
      from: vec2(scoopFoot, 0),
      to: vec2(body, h.noseDepth),
      center: vec2(body, cy),
      radius: s,
      ccw: false,
    },
    { kind: 'line', from: vec2(body, h.noseDepth), to: vec2(front, h.noseDepth) },
    { kind: 'line', from: vec2(front, h.noseDepth), to: vec2(front, H) },
    { kind: 'line', from: vec2(front, H), to: vec2(rear, H) },
    { kind: 'line', from: vec2(rear, H), to: vec2(rear, r) },
    {
      kind: 'arc',
      from: vec2(rear, r),
      to: vec2(rear + r, 0),
      center: vec2(rear + r, r),
      radius: r,
      ccw: true,
    },
  ];
  return {
    base: 'us-box',
    rear,
    length,
    height: H,
    thickness: h.thickness,
    parts: [
      {
        segments,
        holes: [],
        bores: [{ x: front - h.screwFromFront, radius: h.screwRadius, from: h.noseDepth, to: H }],
      },
    ],
  };
};

/**
 * A base's tabs. A US box head's front follows its fin, so it needs the fin's
 * `outline`; without one it is a nominal 200 mm head from x = 0.
 */
export const finTabOutline = (base: FinBase, outline?: Spline): FinTabOutline => {
  if (base === 'us-box') {
    const k = outline?.knots;
    return usBoxHead(k && k.length ? k[0]!.end.x : 20 - US_BOX_HEAD.noseAhead);
  }
  if (base === 'gbox') return gboxTab();
  if (base === 'modii') return modiiTab();
  const kind = futuresKind(base);
  if (kind) {
    const spec = FUTURES_TABS[kind];
    return {
      base,
      rear: 0,
      length: spec.length,
      height: spec.height,
      thickness: spec.thickness,
      parts: [{ segments: futuresTabOutline(kind).segments, holes: futuresTabOutline(kind).holes }],
    };
  }
  if (base === 'fcs-1') {
    const { tabLength: l, gap, height: H, thickness, cornerRadius: r } = FCS1_BASE;
    const front = l + gap;
    return {
      base,
      rear: 0,
      length: front + l,
      height: H,
      thickness,
      parts: [
        { segments: roundedBlock(0, l, H, r), holes: [] },
        { segments: roundedBlock(front, front + l, H, r), holes: [] },
      ],
    };
  }
  const { length: L, height: H, thickness } = FCS_SINGLE_TAB;
  return {
    base,
    rear: 0,
    length: L,
    height: H,
    thickness,
    parts: [{ segments: lineLoop([vec2(0, 0), vec2(L, 0), vec2(L, H), vec2(0, H)]), holes: [] }],
  };
};
