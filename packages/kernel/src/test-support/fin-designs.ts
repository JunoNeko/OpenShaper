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

/**
 * The owner's round 2 test fin: a hooked tip whose trailing edge runs back to 54 mm
 * behind the tab, then turns sharply forward and down 97 mm up (cm, from their
 * `.fin.json`). Horizontal slices stretched edge to edge creased right across the blade
 * at that turn.
 */
export const hookedTipDesign = (): FinDesign => {
  const d = defaultFinDesign('side', 'left');
  const k = (e: [number, number], p: [number, number], n: [number, number], c: boolean) =>
    knot(vec2(e[0] / 10, e[1] / 10), vec2(p[0] / 10, p[1] / 10), vec2(n[0] / 10, n[1] / 10), c);
  return {
    ...d,
    outline: splineFromKnots([
      k([115.5, 0], [115.5, 0], [87.73, 55.95], false),
      k([-25.05, 119.11], [31.16, 119.5], [-51.9, 118.92], true),
      k([-54.18, 97.41], [-55.35, 97.6], [-21.38, 92.12], true),
      k([-11.93, 58.06], [-13.88, 69.38], [-8.26, 36.9], true),
      k([-34.17, 9.61], [-22.02, 21.86], [-21.47, 5.19], false),
      k([0, 0], [-8.9, 2.41], [0, 0], false),
    ]),
  };
};
