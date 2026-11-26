// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Insertion clearance for long-based fins (docs/design/fin-designer.md, "Insertion
 * clearance"; agreed with the owner as a working model).
 *
 * A Futures fin goes in rear first: its rear slot hooks the pin at the back of the
 * box, then the fin rocks down about the pin until the tab seats. While it is
 * tilted, anything behind the tab swings toward the board, so a fin that overhangs
 * the tab's rear end needs a raised rear.
 *
 * Model, in the blade frame (cm): the pivot is the rear slot's arc centre. The fin
 * tilts until the tab's bottom-front corner clears the board (z = 0). At that tilt θ
 * a point behind the tab (x < 0) must stay above the board, which puts it at least
 *
 *     z_min(x) = (−P.z − (x − P.x)·sin θ) / cos θ + P.z
 *
 * above the base: a straight line rising rearward at tan θ. The outline must stay on
 * or above that line wherever it is behind the tab. Points over the tab (x ≥ 0) swing
 * into the box opening and are not limited.
 */
import { RAD_TO_DEG } from '../constants';
import type { Coeffs } from '../bezier-curve';
import type { Spline } from '../bezier-spline';
import { crossings } from './curve-shape';
import type { FinDesign } from './fin-design';
import { futuresKind } from './fin-tab';
import { futuresTabOutline, type FuturesTabKind } from './futures-tab';

export interface RearClearance {
  /** Tilt needed to rock the tab in (deg). */
  readonly tilt: number;
  /** Clearance line z_min = base + slope·(−x), for x < 0 (cm). */
  readonly base: number;
  readonly slope: number;
}

/** The clearance line for a tab kind (see the module comment). */
export const rearClearance = (kind: FuturesTabKind): RearClearance => {
  const tab = futuresTabOutline(kind);
  const { spec } = tab;
  // Blade frame: x along the tab, z up from the tab top.
  const P = { x: spec.slotArcCentreFromEnd, z: -spec.slotCentreBelowTop };
  const B = { x: tab.front.B.x, z: tab.front.B.y - spec.height };
  // Tilt θ: P.z + (B.x − P.x)·sin θ + (B.z − P.z)·cos θ = 0, rising in θ on (0, π/4).
  const lift = (t: number) => P.z + (B.x - P.x) * Math.sin(t) + (B.z - P.z) * Math.cos(t);
  let lo = 0;
  let hi = Math.PI / 4;
  for (let i = 0; i < 80; i++) {
    const mid = (lo + hi) / 2;
    if (lift(mid) < 0) lo = mid;
    else hi = mid;
  }
  const t = (lo + hi) / 2;
  return {
    tilt: t * RAD_TO_DEG,
    base: (-P.z + P.x * Math.sin(t)) / Math.cos(t) + P.z,
    slope: Math.tan(t),
  };
};

/** Minimum height above the base at x (cm), for x < 0. */
export const clearanceAt = (c: RearClearance, x: number): number => c.base - c.slope * x;

/** Behind the tab means x below this (cm); exactly x = 0 is on the tab's rear end. */
const BEHIND = -1e-9;

const pointOn = (k: Coeffs, t: number) => ({
  x: ((k.ax * t + k.bx) * t + k.cx) * t + k.dx,
  y: ((k.ay * t + k.by) * t + k.cy) * t + k.dy,
});

/**
 * How far the outline dips below the clearance line behind the tab (cm), 0 if it
 * never does. Exact: on each segment, height above the line is a cubic in t, so its
 * lowest point is at an end, where the outline crosses x = 0, or where that cubic's
 * slope is zero.
 */
export const clearanceShortfall = (outline: Spline, c: RearClearance): number => {
  const atX0 = crossings(outline, 'x', 0);
  let worst = 0;
  outline.coeffs.forEach((k, seg) => {
    // f(t) = y(t) − (base − slope·x(t)); f'(t) = 3A t² + 2B t + C.
    const A = k.ay + c.slope * k.ax;
    const B = k.by + c.slope * k.bx;
    const C = k.cy + c.slope * k.cx;
    const ts = [0, 1, ...atX0.filter((h) => h.segment === seg).map((h) => h.t)];
    const qa = 3 * A;
    const qb = 2 * B;
    if (Math.abs(qa) > 1e-15) {
      const disc = qb * qb - 4 * qa * C;
      if (disc >= 0)
        ts.push((-qb - Math.sqrt(disc)) / (2 * qa), (-qb + Math.sqrt(disc)) / (2 * qa));
    } else if (Math.abs(qb) > 1e-15) {
      ts.push(-C / qb);
    }
    for (const t of ts) {
      if (t < 0 || t > 1) continue;
      const p = pointOn(k, t);
      if (p.x >= BEHIND) continue;
      worst = Math.max(worst, clearanceAt(c, p.x) - p.y);
    }
  });
  return worst;
};

/**
 * The design's shortfall against its own tab's clearance line (cm). Futures tabs only:
 * an FCS single tab drops straight into its plug, with no rocking.
 */
export const finClearanceShortfall = (d: FinDesign): number => {
  const kind = futuresKind(d.base);
  return kind ? clearanceShortfall(d.outline, rearClearance(kind)) : 0;
};
