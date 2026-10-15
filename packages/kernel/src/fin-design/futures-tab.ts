// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Futures fin tabs — the part of a fin that sits in a Futures box.
 *
 * The geometry is industry standard and not editable. It is specified, with its
 * provenance, in docs/specs/fins/futures-tabs.md and pinned by the fixture
 * futures-tabs.json beside it. Dimensions there are mm; the kernel works in cm, so every
 * value below is written in mm and converted once.
 *
 * Frame (cm): x from the rear (trailing) end at 0 to the front (leading, grub-screw)
 * end at `length`, so +x is toward the nose like the board; y up from the tab bottom at
 * 0 to the tab top at `height`, which is the blade root plane. The tab is extruded
 * `thickness` across the fin, centred on its mid-plane.
 */
import { DEG_TO_RAD } from '../constants';
import { vec2, type Vec2 } from '../vec2';

/** `centre` serves centre and quad-rear fins; `side` serves side / quad-front fins. */
export type FuturesTabKind = 'side' | 'centre';

export const FUTURES_TAB_KINDS: readonly FuturesTabKind[] = ['side', 'centre'];

/** The drawn dimensions of one tab (cm). See docs/specs/fins/futures-tabs.md. */
export interface FuturesTabSpec {
  readonly length: number;
  readonly height: number;
  readonly thickness: number;
  /** Rear U-slot: open to the rear end, straight sides ending in a semicircle. */
  readonly slotDiameter: number;
  /** Depth of the slot's centreline below the tab top. */
  readonly slotCentreBelowTop: number;
  /** Distance from the rear end to the centre of the slot's semicircle. */
  readonly slotArcCentreFromEnd: number;
  readonly rearBottomCornerRadius: number;
  /** Front V-notch included angle (deg). */
  readonly notchIncludedAngle: number;
  /** Depth of the notch's upper mouth below the top-front corner. */
  readonly notchUpperMouthBelowTop: number;
  /** Horizontal inset of the notch apex behind the top-front corner. */
  readonly notchApexInset: number;
  /** Height of the notch apex above the tab bottom. */
  readonly notchApexHeight: number;
  /** Horizontal inset of the bottom-front corner behind the top-front corner. */
  readonly bottomFrontInset: number;
  /** Angle between the bottom edge and the front face, inside the tab (deg). */
  readonly frontFaceAngle: number;
}

const mm = (n: number): number => n / 10;

const shared = {
  length: mm(113),
  thickness: mm(6.35),
  slotDiameter: mm(4.4),
  slotCentreBelowTop: mm(6.4),
  slotArcCentreFromEnd: mm(3.3),
  rearBottomCornerRadius: mm(1),
  frontFaceAngle: 101,
} as const;

export const FUTURES_TABS: Record<FuturesTabKind, FuturesTabSpec> = {
  side: {
    ...shared,
    height: mm(17.7),
    notchIncludedAngle: 90,
    notchUpperMouthBelowTop: mm(5.5),
    notchApexInset: mm(3.8),
    notchApexHeight: mm(7.7),
    bottomFrontInset: mm(2.1),
  },
  centre: {
    ...shared,
    height: mm(12.7),
    notchIncludedAngle: 100,
    notchUpperMouthBelowTop: mm(4.5),
    notchApexInset: mm(2.0),
    notchApexHeight: mm(6.0),
    bottomFrontInset: mm(0.7),
  },
};

/** One piece of the tab's side profile. Arcs run `ccw` (counter-clockwise) or not. */
export type TabSegment =
  | { readonly kind: 'line'; readonly from: Vec2; readonly to: Vec2 }
  | {
      readonly kind: 'arc';
      readonly from: Vec2;
      readonly to: Vec2;
      readonly center: Vec2;
      readonly radius: number;
      readonly ccw: boolean;
    };

/** The front-notch points named in the spec: T, U, A, D, B from the top down. */
export interface TabFrontPoints {
  /** Top-front corner, the forward-most point of the tab. */
  readonly T: Vec2;
  /** Upper mouth of the V, straight below T. */
  readonly U: Vec2;
  /** Apex of the V. */
  readonly A: Vec2;
  /** Lower mouth of the V, where the lower flank meets the front face. */
  readonly D: Vec2;
  /** Bottom-front corner. */
  readonly B: Vec2;
}

/** The tab's closed side profile, counter-clockwise (material on the left). */
export interface TabOutline {
  readonly kind: FuturesTabKind;
  readonly spec: FuturesTabSpec;
  readonly segments: readonly TabSegment[];
  readonly front: TabFrontPoints;
}

/** Points of the front notch, derived from the drawn dimensions (see the spec). */
export const tabFrontPoints = (spec: FuturesTabSpec): TabFrontPoints => {
  const { length: L, height: H } = spec;
  const T = vec2(L, H);
  const U = vec2(L, H - spec.notchUpperMouthBelowTop);
  const A = vec2(L - spec.notchApexInset, spec.notchApexHeight);
  const B = vec2(L - spec.bottomFrontInset, 0);

  // The lower flank leaves A at (included − upper flank) below horizontal and stops on
  // the front face, the line through B leaning forward by (faceAngle − 90°).
  const upper = Math.atan2(U.y - A.y, U.x - A.x);
  const lower = spec.notchIncludedAngle * DEG_TO_RAD - upper;
  const dx = Math.cos(lower);
  const dy = -Math.sin(lower);
  const lean = Math.tan((spec.frontFaceAngle - 90) * DEG_TO_RAD);
  const u = (B.x + lean * A.y - A.x) / (dx - lean * dy);
  const D = vec2(A.x + u * dx, A.y + u * dy);

  return { T, U, A, D, B };
};

const line = (from: Vec2, to: Vec2): TabSegment => ({ kind: 'line', from, to });

/**
 * The exact side profile of a Futures tab: lines and circular arcs, closed and
 * counter-clockwise, starting at the end of the bottom-rear fillet.
 */
export const futuresTabOutline = (kind: FuturesTabKind): TabOutline => {
  const spec = FUTURES_TABS[kind];
  const front = tabFrontPoints(spec);
  const { T, U, A, D, B } = front;
  const H = spec.height;
  const r = spec.slotDiameter / 2;
  const yc = H - spec.slotCentreBelowTop;
  const sx = spec.slotArcCentreFromEnd;
  const R = spec.rearBottomCornerRadius;

  const slotTop = vec2(sx, yc + r);
  const slotBottom = vec2(sx, yc - r);

  const segments: TabSegment[] = [
    line(vec2(R, 0), B),
    line(B, D),
    line(D, A),
    line(A, U),
    line(U, T),
    line(T, vec2(0, H)),
    line(vec2(0, H), vec2(0, yc + r)),
    line(vec2(0, yc + r), slotTop),
    // Round the far end of the slot; the material is outside the circle.
    { kind: 'arc', from: slotTop, to: slotBottom, center: vec2(sx, yc), radius: r, ccw: false },
    line(slotBottom, vec2(0, yc - r)),
    line(vec2(0, yc - r), vec2(0, R)),
    { kind: 'arc', from: vec2(0, R), to: vec2(R, 0), center: vec2(R, R), radius: R, ccw: true },
  ];

  return { kind, spec, segments, front };
};
