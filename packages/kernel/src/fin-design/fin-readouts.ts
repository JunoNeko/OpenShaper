// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The numbers the fin designer shows for a design: area, depth, sweep, root chord and
 * front overhang. All exact for the Bézier outline. Area integrates each cubic in closed
 * form, and the tip comes from the derivative's roots.
 *
 * Units: cm, cm² and degrees, like the rest of the kernel; the UI shows mm.
 */
import type { Coeffs } from '../bezier-curve';
import { RAD_TO_DEG } from '../constants';
import type { Vec2 } from '../vec2';
import { splineExtremes } from './curve-shape';
import type { FinDesign } from './fin-design';
import { finTabOutline } from './fin-tab';

export interface FinReadouts {
  /** Area of the blade's side profile above the tab top (cm²); the tab is excluded. */
  readonly area: number;
  /** Height of the tip above the tab top (cm). */
  readonly depth: number;
  /** The highest point of the outline. */
  readonly tip: Vec2;
  /**
   * Angle of the line from the leading-edge root to the tip, measured from vertical
   * (deg). 0 is upright; positive leans the tip back toward the tail.
   */
  readonly sweep: number;
  /** Distance between the leading- and trailing-edge roots along the tab top (cm). */
  readonly rootChord: number;
  /**
   * How far the leading-edge root sits in front of the tab's top-front corner (cm);
   * negative when it is set back.
   */
  readonly frontOverhang: number;
}

/**
 * ∫₀¹ (x·y′ − y·x′) dt / 2 for one cubic: its share of the enclosed area by Green's
 * theorem. With x = ax t³ + bx t² + cx t + dx (same for y), the integrand is a
 * polynomial, integrated term by term.
 */
const cubicGreen = (k: Coeffs): number => {
  const x = [k.dx, k.cx, k.bx, k.ax];
  const y = [k.dy, k.cy, k.by, k.ay];
  const dx = [k.cx, 2 * k.bx, 3 * k.ax];
  const dy = [k.cy, 2 * k.by, 3 * k.ay];
  let sum = 0;
  for (let i = 0; i < 4; i++) {
    for (let j = 0; j < 3; j++) sum += (x[i]! * dy[j]! - y[i]! * dx[j]!) / (i + j + 1);
  }
  return sum / 2;
};

/**
 * Area enclosed by the outline and the root line between its two ends. The root line
 * lies on y = 0, so it adds nothing to the Green's integral. The outline runs
 * leading-edge root → tip → trailing-edge root, front to back over the top, which is
 * counter-clockwise; `abs` keeps a reversed chain from reading negative.
 */
export const finArea = (d: FinDesign): number =>
  Math.abs(d.outline.coeffs.reduce((sum, k) => sum + cubicGreen(k), 0));

export const finReadouts = (d: FinDesign): FinReadouts => {
  const knots = d.outline.knots;
  const le = knots[0]!.end;
  const te = knots[knots.length - 1]!.end;
  const tip = splineExtremes(d.outline, 'y').max.point;
  const tabFront = finTabOutline(d.base, d.outline).length;
  return {
    area: finArea(d),
    depth: tip.y,
    tip,
    sweep: Math.atan2(le.x - tip.x, tip.y) * RAD_TO_DEG,
    rootChord: le.x - te.x,
    frontOverhang: le.x - tabFront,
  };
};
