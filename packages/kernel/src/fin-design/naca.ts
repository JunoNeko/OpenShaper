// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * NACA 4-digit foil presets for the fin designer's section (step 4a of
 * docs/design/fin-designer.md). A preset generates both faces of a {@link FinSection};
 * they stay editable afterwards like any drawn section.
 *
 * NACA MPXX: M = maximum camber (% chord), P = its position (tenths of chord),
 * XX = thickness (% chord). The standard equations, with two choices:
 *
 * - **Closed trailing edge** (the −0.1036 x⁴ coefficient, not −0.1015), so both faces
 *   end on the chord line as the section model requires. The blade's minimum thickness
 *   then blunts the edge. Differs from the open-edge tables by 0.126% chord at the
 *   trailing edge, falling as x⁴.
 * - **Thickness applied square to the chord, not the camber line.** The textbook
 *   construction offsets perpendicular to the camber line, which makes a cambered
 *   outside face curl back past its own leading edge (by 0.008% chord on a 2412), and
 *   a section face must keep moving toward the trailing edge. The difference is at
 *   most 0.16% chord on a 2412 and 0.35% on a 4412, mostly near the leading edge;
 *   symmetric foils are identical either way.
 *
 * The convex (upper) face is the outside face: a cambered side fin's convex side faces
 * the rail. A symmetric 00XX gives `inside: null`, as a centre fin requires.
 *
 * Only the shape matters: the blade scales the section so its thickest point matches
 * the taper, so a 2412 keeps its 2 : 12 camber-to-thickness ratio at any thickness.
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { knot, type Knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';
import type { FinSection } from './fin-design';

export interface Naca4 {
  /** Maximum camber, as a fraction of chord (M / 100). */
  readonly camber: number;
  /** Chordwise position of maximum camber, as a fraction of chord (P / 10). */
  readonly position: number;
  /** Maximum thickness, as a fraction of chord (XX / 100). */
  readonly thickness: number;
}

/** Parse a 4-digit designation such as '2412' or 'NACA 0012'. */
export const parseNaca4 = (code: string): Naca4 => {
  const m = /^\s*(?:NACA\s*)?(\d)(\d)(\d\d)\s*$/i.exec(code);
  if (!m) throw new RangeError(`Not a NACA 4-digit designation: '${code}'`);
  const n = {
    camber: Number(m[1]) / 100,
    position: Number(m[2]) / 10,
    thickness: Number(m[3]) / 100,
  };
  if (n.thickness === 0) throw new RangeError(`NACA '${code}' has no thickness`);
  if (n.camber > 0 && n.position === 0) {
    throw new RangeError(`NACA '${code}' has camber but no camber position`);
  }
  return n;
};

/** Half-thickness at chord fraction x (closed trailing edge), and its slope d/ds, s = √x. */
const halfThickness = (t: number, s: number): { y: number; dyds: number } => {
  const x = s * s;
  return {
    y: 5 * t * (0.2969 * s - 0.126 * x - 0.3516 * x ** 2 + 0.2843 * x ** 3 - 0.1036 * x ** 4),
    dyds: 5 * t * (0.2969 - 0.252 * s - 1.4064 * s ** 3 + 1.7058 * s ** 5 - 0.8288 * s ** 7),
  };
};

/** Camber line height at x and its slope dy/dx. */
const camberLine = (n: Naca4, x: number): { y: number; dydx: number } => {
  const { camber: m, position: p } = n;
  if (m === 0) return { y: 0, dydx: 0 };
  if (x < p) return { y: (m / p ** 2) * (2 * p * x - x * x), dydx: ((2 * m) / p ** 2) * (p - x) };
  const q = (1 - p) ** 2;
  return { y: (m / q) * (1 - 2 * p + 2 * p * x - x * x), dydx: ((2 * m) / q) * (p - x) };
};

/** The outside (+1) or inside (−1) face's offset at chord fraction x, exactly. */
export const naca4Ordinate = (n: Naca4, x: number, face: 1 | -1): number =>
  camberLine(n, x).y + face * halfThickness(n.thickness, Math.sqrt(x)).y;

/** Point and derivative d/ds of a face at s = √x. */
const faceAt = (n: Naca4, s: number, face: 1 | -1): { p: Vec2; d: Vec2 } => {
  const x = s * s;
  const c = camberLine(n, x);
  const h = halfThickness(n.thickness, s);
  return {
    p: vec2(x, c.y + face * h.y),
    d: vec2(2 * s, c.dydx * 2 * s + face * h.dyds),
  };
};

/**
 * Cubic Hermite through the face at the given s stations, handles from the exact
 * derivative: a Bézier chain that matches the face and its tangent at every knot.
 */
const faceSpline = (n: Naca4, stations: readonly number[], face: 1 | -1): Spline => {
  const knots: Knot[] = stations.map((s, i) => {
    const { p, d } = faceAt(n, s, face);
    const back = i > 0 ? (s - stations[i - 1]!) / 3 : 0;
    const fwd = i < stations.length - 1 ? (stations[i + 1]! - s) / 3 : 0;
    const prev = vec2(p.x - d.x * back, p.y - d.y * back);
    const next = vec2(p.x + d.x * fwd, p.y + d.y * fwd);
    // Ends land exactly on the chord line (the closed trailing edge, and the nose).
    const end = i === 0 ? vec2(0, 0) : i === stations.length - 1 ? vec2(1, 0) : p;
    return knot(end, prev, next, i > 0 && i < stations.length - 1);
  });
  return splineFromKnots(knots);
};

/**
 * Default number of Bézier segments per face: 5, so 6 points, few enough to edit by hand
 * (17 was too many, round 1 testing). Worst error 0.011% of chord over the presets
 * (0.012 mm on a 110 mm chord); naca.test.ts pins it.
 */
export const NACA_SEGMENTS = 5;

/**
 * A section from a NACA 4-digit designation or parameters. Knots are evenly spaced in
 * √x, which gathers them at the round leading edge, with one moved onto the maximum
 * camber position, where the camber line's curvature jumps.
 */
export const nacaSection = (naca: Naca4 | string, segments = NACA_SEGMENTS): FinSection => {
  const n = typeof naca === 'string' ? parseNaca4(naca) : naca;
  const s = Array.from({ length: segments + 1 }, (_, i) => i / segments);
  if (n.camber > 0) {
    // Move the nearest interior station onto it, rather than adding a sliver beside it.
    const sp = Math.sqrt(n.position);
    const i = Math.min(segments - 1, Math.max(1, Math.round(sp * segments)));
    s[i] = sp;
  }
  return {
    outside: faceSpline(n, s, 1),
    inside: n.camber === 0 ? null : faceSpline(n, s, -1),
  };
};
