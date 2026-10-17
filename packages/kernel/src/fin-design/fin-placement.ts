// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Where the fin sits on its tab, and the nudges that move it (the designer's arrow
 * buttons).
 *
 * - **Fore and aft** is the outline's own x, in the tab frame. Defaults are
 *   rear-aligned, the usual convention: the trailing-edge root on the tab's rear end.
 *   Forward stops hard when the leading edge overhangs the tab front by
 *   {@link FIN_MAX_FRONT_OVERHANG} (the grub screw). Back stops where the part behind
 *   the tab would hit the board while the fin rocks onto the rear pin
 *   (fin-clearance.ts), and in any case at the tab's rear end.
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
import { prepareBlade, rootThickestFaces } from './blade';
import { clearanceShortfall, rearClearance } from './fin-clearance';
import { FIN_MAX_FRONT_OVERHANG, finOutward, finTabKind, type FinDesign } from './fin-design';
import { FUTURES_TABS } from './futures-tab';
import { splineFromKnots } from '../bezier-spline';
import { knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';

const outwardOf = (d: FinDesign): 1 | -1 => finOutward(d.hand);

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
  const faces = rootThickestFaces(prepareBlade(d));
  const c0 = defaultTabCentreY(d);
  const w = outwardOf(d);
  // Centre c = c0 − w·offset, so offset = w·(c0 − c) for each face's y.
  const a = w * (c0 - faces.inside);
  const o = w * (c0 - faces.outside);
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
 * Move the fin `dx` cm toward the nose (negative: toward the tail). Forward stops hard
 * at the front-overhang limit. Back stops at the tab's rear end, or sooner where the
 * part behind the tab would hit the board as the fin rocks in (fin-clearance.ts). A
 * fin already short of clearance cannot be moved further back.
 */
export const nudgeFore = (d: FinDesign, dx: number): FinDesign => {
  const le = d.outline.knots[0]!.end.x;
  const { min, max } = leadingRootRange(d);
  let to = Math.min(max, Math.max(min, le + dx));
  if (to < le) {
    const c = rearClearance(finTabKind(d.position));
    const clear = (x: number) => clearanceShortfall(shiftOutline(d, x - le).outline, c) <= 1e-9;
    if (!clear(le)) to = le;
    else if (!clear(to)) {
      // Moving back only adds shortfall, so bisect for the last clear position.
      let ok = le;
      let bad = to;
      for (let i = 0; i < 50; i++) {
        const mid = (ok + bad) / 2;
        if (clear(mid)) ok = mid;
        else bad = mid;
      }
      // Under a micron is rounding at the tab's rear end, not a move.
      to = le - ok < 1e-4 ? le : ok;
    }
  }
  return to === le ? d : shiftOutline(d, to - le);
};

/** Slide the blade `dy` cm outboard across the tab (negative: inboard), within range. */
export const nudgeLateral = (d: FinDesign, dy: number): FinDesign => {
  const { min, max } = lateralOffsetRange(d);
  const to = Math.min(max, Math.max(min, d.lateralOffset + dy));
  return to === d.lateralOffset ? d : { ...d, lateralOffset: to };
};
