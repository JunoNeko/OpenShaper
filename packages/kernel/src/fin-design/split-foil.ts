// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A foil split between its faces by share of thickness, the way shapers describe them:
 * 70/30 is 70% of the thickness above the chord line (outside) and 30% below (inside).
 *
 * Built as the owner draws it: each face is a leading-edge radius, its height that face's
 * share of the thickness, then a straight line from the radius to the trailing edge, on
 * the tangent. The radius reads round in the foil view, which draws thickness 4×
 * ({@link SPLIT_NOSE_ASPECT}). A point halfway round each radius, and one where it meets the line, so
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

/**
 * How much longer than tall each leading-edge radius is, in true proportions: the foil
 * view draws thickness 4× (SECTION_Y_SCALE in the web app), so this is what reads as a
 * round radius there, as the owner draws it. In the fin it is a fine elliptical nose,
 * putting the thickest point about a sixth of the way back.
 */
export const SPLIT_NOSE_ASPECT = 4;

/** A radius reaches at most this far back along the chord, so the line can reach the trailing edge. */
const MAX_NOSE_LENGTH = 0.3;

/** Handle length for a circular arc of `sweep` radians on radius `r`, as a cubic. */
const arcHandle = (r: number, sweep: number): number => (4 / 3) * Math.tan(sweep / 4) * r;

/**
 * One face: a leading-edge radius `r` (chords, its height above the chord line) for
 * `side` 1, below for −1, then a straight tangent line to the trailing edge. Flat for no
 * radius. The radius is `aspect` times longer than tall in true proportions, so it reads
 * round in the foil view; 1 is a true circle.
 */
export const radiusFace = (r: number, side: 1 | -1, aspect = SPLIT_NOSE_ASPECT): Spline => {
  if (!(r > 0)) return flatFace();
  const rr = Math.min(MAX_NOSE_LENGTH / aspect, r);
  // Built as a circle with the chord squashed by `aspect` (the trailing edge at 1/aspect),
  // then stretched back: a cubic stretched is the stretched cubic, so the arcs and the
  // tangent line stay exact. The circle touches the leading edge: centre (r, 0). Angles
  // from its centre, counter-clockwise for the outside face; the inside face mirrors it.
  const end = 1 / aspect;
  const at = (a: number): Vec2 => vec2(rr + rr * Math.cos(a), side * rr * Math.sin(a));
  // Direction of travel round the circle (angle decreasing), mirrored for the inside.
  const along = (a: number): Vec2 => vec2(Math.sin(a), -side * Math.cos(a));
  // Where the line from the trailing edge touches the circle.
  const tangent = Math.acos(rr / (end - rr));
  const mid = (Math.PI + tangent) / 2;
  const h = arcHandle(rr, (Math.PI - tangent) / 2);
  const off = (p: Vec2, d: Vec2, k: number) => vec2(p.x + d.x * k, p.y + d.y * k);
  const le = vec2(0, 0); // exactly, not cos/sin rounding
  const m = at(mid);
  const t = at(tangent);
  const te = vec2(end, 0);
  const third = (a: Vec2, b: Vec2, f: number) => vec2(a.x + (b.x - a.x) * f, a.y + (b.y - a.y) * f);
  const s = (p: Vec2) => vec2(p.x * aspect, p.y);
  const k = (e: Vec2, prev: Vec2, next: Vec2, smooth: boolean) =>
    knot(s(e), s(prev), s(next), smooth);
  return splineFromKnots([
    k(le, le, off(le, along(Math.PI), h), false),
    k(m, off(m, along(mid), -h), off(m, along(mid), h), true),
    k(t, off(t, along(tangent), -h), third(t, te, 1 / 3), true),
    knot(vec2(1, 0), s(third(t, te, 2 / 3)), vec2(1, 0), false),
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
