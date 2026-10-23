// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The tab a fin sits on: its base. Two Futures tabs (futures-tab.ts), the FCS single
 * tab that plugs into an FCS 1 style single plug (small canard fins), and the FCS 1
 * base: two such tabs, one for each of the fin's two plugs. FCS II plugs take FCS 1
 * fins too.
 *
 * All share one frame (cm): x from the base's rear end at 0 toward the nose, y up from
 * the tab bottom to its top at `height` (the blade root plane), extruded `thickness`
 * across, centred on its mid-plane. The outline of a fin is in this frame, so it places
 * the fin fore and aft on its base. A base is one or more separate tabs (`parts`).
 */
import { vec2, type Vec2 } from '../vec2';
import {
  FUTURES_TABS,
  futuresTabOutline,
  type FuturesTabKind,
  type TabSegment,
} from './futures-tab';

/** Which tab the fin sits on. */
export type FinBase = 'futures-side' | 'futures-centre' | 'fcs-single' | 'fcs-1';

export const FIN_BASES: readonly FinBase[] = [
  'futures-side',
  'futures-centre',
  'fcs-single',
  'fcs-1',
];

/** What the designer calls each base. */
export const FIN_BASE_LABEL: Record<FinBase, string> = {
  'futures-side': 'Futures 3/4"',
  'futures-centre': 'Futures 1/2"',
  'fcs-single': 'FCS single tab',
  'fcs-1': 'FCS 1',
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

/** One tab of a base: its side profile and any holes through it. */
export interface FinTabPart {
  /** Closed, counter-clockwise (material on the left): lines and arcs. */
  readonly segments: readonly TabSegment[];
  /** Through-holes, each closed and clockwise (material outside): the Futures weight-saving slots. */
  readonly holes: readonly (readonly TabSegment[])[];
}

/** A base's tabs and overall size, in the frame above. */
export interface FinTabOutline {
  readonly base: FinBase;
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
  futuresKind(base) ? 0 : base === 'fcs-1' ? -FCS1_BASE.rearBlade : null;

export const finTabOutline = (base: FinBase): FinTabOutline => {
  const kind = futuresKind(base);
  if (kind) {
    const spec = FUTURES_TABS[kind];
    return {
      base,
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
    length: L,
    height: H,
    thickness,
    parts: [{ segments: lineLoop([vec2(0, 0), vec2(L, 0), vec2(L, H), vec2(0, H)]), holes: [] }],
  };
};
