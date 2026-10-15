// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fin designs shared by the fin-design tests. (`@openshaper/export`'s fin-step.test.ts
 * keeps its own copy: test support is not part of the kernel's exports.)
 */
import { splineFromKnots, type Spline } from '../bezier-spline';
import { defaultFinDesign } from '../fin-design/fin-defaults';
import type { FinDesign } from '../fin-design/fin-design';
import { knot } from '../knot';
import { vec2, type Vec2 } from '../vec2';

/** Raised low point (cm): 18 mm behind the tab, 5 mm up. Underside meets the base at 5 mm. */
export const RAISED_LOW = vec2(-1.8, 0.5);
export const RAISED_BASE_END = vec2(0.5, 0);

/**
 * The default right side fin with a long base and a raised rear: down the trailing
 * edge to a sharp low point behind the tab, then forward along the underside to the
 * base, like a keel or twin fin.
 */
export const raisedRearDesign = (): FinDesign => {
  const d = defaultFinDesign('side', 'right');
  const [k0, k1, k2, k3] = d.outline.knots;
  return {
    ...d,
    outline: splineFromKnots([
      k0!,
      k1!,
      k2!,
      knot(k3!.end, k3!.tangentToPrev, vec2(-0.236, 4.857), true),
      knot(RAISED_LOW, vec2(-1.9, 1.8), vec2(-1.2, 0.4), false),
      knot(RAISED_BASE_END, vec2(-0.2, 0.08), RAISED_BASE_END, false),
    ]),
  };
};

/** Every point of the spline (ends and handles) moved through `f`. */
export const mapSpline = (s: Spline, f: (p: Vec2) => Vec2): Spline =>
  splineFromKnots(
    s.knots.map((k) => knot(f(k.end), f(k.tangentToPrev), f(k.tangentToNext), k.continuous)),
  );

/** The design with its outline moved `dx` cm along the tab. */
export const shiftFin = (d: FinDesign, dx: number): FinDesign => ({
  ...d,
  outline: mapSpline(d.outline, (p) => vec2(p.x + dx, p.y)),
});
