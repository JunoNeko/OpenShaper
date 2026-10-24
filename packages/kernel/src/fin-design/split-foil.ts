// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A foil split between its faces by share of thickness, the way shapers describe them:
 * 70/30 is 70% of the thickness above the chord line (outside) and 30% below (inside).
 *
 * Built as the owner draws it: each face is a leading-edge radius, its size that face's
 * share of the thickness, then a straight line from the radius to the trailing edge, on
 * the tangent. A point halfway round each radius, and one where it meets the line, so
 * the face stays easy to reshape by hand.
 *
 * Section faces are in chords, so the radius needs the foil's true proportions: `tc`,
 * its thickness over its chord (a 10 mm fin root on a 150 mm chord is 0.067). The blade
 * then scales the foil to the taper as it does any other (blade.ts).
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';
import type { FinSection } from './fin-design';
import { splineExtremes } from './curve-shape';
import { flatFace } from './fin-defaults';

/** A radius is at most this much of the chord, so a line from it can reach the trailing edge. */
const MAX_RADIUS = 0.3;

/** Handle length for a circular arc of `sweep` radians on radius `r`, as a cubic. */
const arcHandle = (r: number, sweep: number): number => (4 / 3) * Math.tan(sweep / 4) * r;

/**
 * One face: a leading-edge radius `r` (chords) above the chord line for `side` 1, below
 * for −1, then a straight tangent line to the trailing edge. Flat for no radius.
 */
export const radiusFace = (r: number, side: 1 | -1): Spline => {
  if (!(r > 0)) return flatFace();
  const rr = Math.min(MAX_RADIUS, r);
  // The circle touches the leading edge: centre (r, 0). Angles measured from its centre,
  // counter-clockwise for the outside face; the inside face is its mirror.
  const at = (a: number): Vec2 => vec2(rr + rr * Math.cos(a), side * rr * Math.sin(a));
  // Direction of travel round the circle (angle decreasing), mirrored for the inside.
  const along = (a: number): Vec2 => vec2(Math.sin(a), -side * Math.cos(a));
  // Where the line from the trailing edge (1, 0) touches the circle.
  const tangent = Math.acos(rr / (1 - rr));
  const mid = (Math.PI + tangent) / 2;
  const h = arcHandle(rr, (Math.PI - tangent) / 2);
  const off = (p: Vec2, d: Vec2, k: number) => vec2(p.x + d.x * k, p.y + d.y * k);
  const le = vec2(0, 0); // exactly, not cos/sin rounding
  const m = at(mid);
  const t = at(tangent);
  const te = vec2(1, 0);
  const third = (a: Vec2, b: Vec2, f: number) => vec2(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
  return splineFromKnots([
    knot(le, le, off(le, along(Math.PI), h), false),
    knot(m, off(m, along(mid), -h), off(m, along(mid), h), true),
    knot(t, off(t, along(tangent), -h), third(t, te, 1 / 3), true),
    knot(te, third(t, te, 2 / 3), te, false),
  ]);
};

/**
 * The foil split `outside` : 1 − `outside` (a share, 0 to 1) of a thickness `tc` chords:
 * a leading-edge radius of each face's share, and straight lines to the trailing edge.
 */
export const splitFoil = (outside: number, tc: number): FinSection => {
  const share = Math.min(1, Math.max(0, outside));
  return { outside: radiusFace(share * tc, 1), inside: radiusFace((1 - share) * tc, -1) };
};

/**
 * How a foil's thickness is shared between its faces: the outside face's greatest
 * height over the total of both faces' (0 to 1). A symmetric foil is 0.5.
 */
export const foilShare = (sec: FinSection): number => {
  const up = Math.max(0, splineExtremes(sec.outside, 'y').max.point.y);
  const down = sec.inside ? Math.max(0, -splineExtremes(sec.inside, 'y').min.point.y) : up;
  return up + down > 0 ? up / (up + down) : 0.5;
};
