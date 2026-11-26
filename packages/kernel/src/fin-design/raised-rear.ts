// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A raised rear: the end of the outline, walked back from the trailing-edge root, while
 * it runs backward and rises gently (the owner's keel and A4C). The swept loft counts
 * it as part of the base (swept-loft.ts), so its underside keeps the foil's thickness.
 */
import type { Spline } from '../bezier-spline';
import { value, xDeriv, yDeriv } from '../bezier-curve';
import { splineExtremes } from './curve-shape';

/**
 * The underside of a raised rear: the end of the outline, walking back from the
 * trailing-edge root, while it runs backward and rises at under 45° (after a steep
 * lead-in off the root, if it has one: see {@link REAR_LEAD}). Steeper than that it is
 * the trailing edge. Where it ends (`corner`) the trailing edge proper starts: the
 * swept loft's base runs along the underside up to it (swept-loft.ts).
 */
export interface RaisedRear {
  readonly cornerX: number;
  readonly cornerZ: number;
}

/** Samples per segment when walking the underside. */
const REAR_SAMPLES = 64;

/**
 * How high (cm) the outline may always rise steeply off the trailing-edge root before
 * its underside starts: a root handle pulled up (the owner's twin fin) leaves the root
 * steeply for a millimetre or two, then turns back along the underside. A taller
 * lead-in still counts if the underside then runs back further than the lead-in rose
 * (the owner's A4C: 6.9 mm up, then 30 mm back); otherwise it is a trailing edge rising
 * from the root, like a side fin's that only sweeps back shallowly near the tip.
 */
const REAR_LEAD = 0.3;

/**
 * How high (a fraction of the fin's depth) a raised rear's corner may be: an underside
 * is a low thing, next to the tab. The owners' sit 3–13% up. Higher, a trailing edge
 * that leaves the root steeply and then sweeps back gently to a hooked tip read as an
 * underside all the way up, and the base ran up the trailing edge almost to the tip
 * (owner testing: a section standing almost upright from the base).
 */
export const FIN_RAISED_REAR_MAX = 0.25;

const isUnderside = (dx: number, dz: number): boolean => dx < 0 && dz >= 0 && dz < -dx;

/** The raised rear of an outline (see {@link RaisedRear}), or null if it has none. */
export const findRaisedRear = (outline: Spline): RaisedRear | null => {
  const k = outline.coeffs;
  const top = splineExtremes(outline, 'y').max;
  // Walking back along the outline from its end, the direction is minus the derivative.
  // Kept just inside the segment: a handle pulled onto its end point has no direction there.
  const dir = (seg: number, t: number) => {
    const tt = Math.min(1 - 1e-6, Math.max(1e-6, t));
    return { x: -xDeriv(k[seg]!, tt), z: -yDeriv(k[seg]!, tt) };
  };
  let lastGood: { seg: number; t: number } | null = null;
  // Where the underside starts: the top of the steep lead-in, if there is one.
  let start: { x: number; y: number } | null = null;
  const corner = (x: number, z: number): RaisedRear | null =>
    z > 0 &&
    z <= FIN_RAISED_REAR_MAX * top.point.y &&
    start &&
    (start.y <= REAR_LEAD || start.x - x > start.y)
      ? { cornerX: x, cornerZ: z }
      : null;
  for (let seg = k.length - 1; seg >= 0; seg--) {
    for (let j = REAR_SAMPLES; j >= 0; j--) {
      const t = j / REAR_SAMPLES;
      if (seg < top.segment || (seg === top.segment && t <= top.t)) return null; // to the tip
      const d = dir(seg, t);
      if (isUnderside(d.x, d.z)) {
        if (!lastGood) start = value(k[seg]!, t);
        lastGood = { seg, t };
        continue;
      }
      // Steep at the root: a lead-in, judged once the underside's length is known.
      if (!lastGood) continue;
      // The corner is between the last sample that was underside and this one.
      let lo = lastGood.seg === seg ? lastGood.t : 0; // underside side (higher t)
      let hi = t; // trailing-edge side
      if (lastGood.seg !== seg) {
        // The previous sample was the start of the segment after: the corner is the knot.
        const at = value(k[seg]!, 1);
        return corner(at.x, at.y);
      }
      for (let i = 0; i < 50; i++) {
        const mid = (lo + hi) / 2;
        const m = dir(seg, mid);
        if (isUnderside(m.x, m.z)) lo = mid;
        else hi = mid;
      }
      const turn = value(k[seg]!, hi);
      // An underside that curls up into a sharp point (the owner's keel) turns steep a
      // little short of it: the point is the corner, where the edge really changes
      // direction. Without this the point's kink lands in the trailing edge above the
      // corner and creases the blade across at its height.
      const knot = outline.knots[seg]!;
      if (
        !knot.continuous &&
        knot.end.x < turn.x &&
        knot.end.y > turn.y &&
        knot.end.y - turn.y <= REAR_LEAD
      ) {
        return corner(knot.end.x, knot.end.y);
      }
      return corner(turn.x, turn.y);
    }
  }
  return null;
};
