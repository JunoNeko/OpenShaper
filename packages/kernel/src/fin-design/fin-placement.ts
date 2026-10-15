// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Where the fin sits on its tab, and the nudges that move it (the designer's arrow
 * buttons).
 *
 * - **Fore and aft** is the outline's own x, in the tab frame. Defaults are
 *   rear-aligned, the usual convention: the trailing-edge root on the tab's rear end.
 *   Forward stops hard when the leading edge overhangs the tab front by
 *   {@link FIN_MAX_FRONT_OVERHANG} (the grub screw). Back stops when the leading-edge
 *   root reaches the tab's rear end, beyond which the fin would be off the tab.
 * - **Across** is {@link FinDesign.lateralOffset}. By default:
 *   - a symmetric foil is centred on the tab;
 *   - any other foil has its chord line flush with the tab's inboard face, so a flat
 *     inside face is flush with the tab, the usual convention.
 *
 *   A curved inside face (most NACA foils) then overhangs the tab inboard. Sliding
 *   the blade sideways corrects that, as far as the tab stays under the foil: its
 *   centre plane between the root section's two faces at their thickest point.
 *
 * The frame is blade.ts's: the blade is fixed and the tab is placed under it.
 */
import { bladeSection, prepareBlade } from './blade';
import { FIN_MAX_FRONT_OVERHANG, finTabKind, type FinDesign } from './fin-design';
import { FUTURES_TABS } from './futures-tab';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';

/** +1 when the outside face points to +Y (right and centre fins), −1 for a left fin. */
const outwardOf = (d: FinDesign): 1 | -1 => (d.hand === 'left' ? -1 : 1);

/** The tab's centre plane (blade-frame Y, cm) before any lateral offset. */
const defaultTabCentreY = (d: FinDesign): number =>
  d.section.inside === null
    ? 0
    : (outwardOf(d) * FUTURES_TABS[finTabKind(d.position)].thickness) / 2;

/** The tab's centre plane (blade-frame Y, cm): its default, less the blade's offset. */
export const tabCentreY = (d: FinDesign): number =>
  defaultTabCentreY(d) - outwardOf(d) * d.lateralOffset;

/**
 * The lateral offsets (cm) that keep the tab under the foil: its centre plane between
 * the root section's inside and outside faces where the foil is thickest.
 */
export const lateralOffsetRange = (d: FinDesign): { min: number; max: number } => {
  const b = prepareBlade(d);
  const s = bladeSection(b, 0, [b.thickestAt]);
  const c0 = defaultTabCentreY(d);
  const w = outwardOf(d);
  // Centre c = c0 − w·offset, so offset = w·(c0 − c) for each face's y.
  const a = w * (c0 - s.inside[0]!.y);
  const o = w * (c0 - s.outside[0]!.y);
  return { min: Math.min(a, o), max: Math.max(a, o) };
};

/** Fore-aft limits on the leading-edge root's x (cm), from the design's tab. */
export const leadingRootRange = (d: FinDesign): { min: number; max: number } => ({
  min: 0,
  max: FUTURES_TABS[finTabKind(d.position)].length + FIN_MAX_FRONT_OVERHANG,
});

const shiftOutline = (d: FinDesign, dx: number): FinDesign => {
  const m = (p: Vec2) => vec2(p.x + dx, p.y);
  return {
    ...d,
    outline: splineFromKnots(
      d.outline.knots.map((k) =>
        knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous, k.other, k.lock),
      ),
    ),
  };
};

/**
 * Move the fin `dx` cm toward the nose (negative: toward the tail), stopping hard at
 * the front-overhang limit and at the tab's rear end.
 */
export const nudgeFore = (d: FinDesign, dx: number): FinDesign => {
  const le = d.outline.knots[0]!.end.x;
  const { min, max } = leadingRootRange(d);
  const to = Math.min(max, Math.max(min, le + dx));
  return to === le ? d : shiftOutline(d, to - le);
};

/** Slide the blade `dy` cm outboard across the tab (negative: inboard), within range. */
export const nudgeLateral = (d: FinDesign, dy: number): FinDesign => {
  const { min, max } = lateralOffsetRange(d);
  const to = Math.min(max, Math.max(min, d.lateralOffset + dy));
  return to === d.lateralOffset ? d : { ...d, lateralOffset: to };
};
