// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fitting a fin in the panel it is machined from (owner request): fins are cut from
 * G10 and similar panels, so the panel's thickness bounds the fin, base and blade
 * together.
 *
 * The panel is a slab of its thickness, and the fin can sit in it two ways besides
 * straight ({@link FinPanel}):
 * - **turned** about an upright axis (`angle`, seen from above): the foil is thickest
 *   across a line that slants from its chord, so turning it can fit a thicker foil;
 * - **tilted** about the panel's length (`tilt`, seen from the front): a canted blade
 *   on an upright tab fits a thinner panel leaning between the two.
 * What the fin needs is its width across the slab, along the slab's normal: the spread
 * of its points along it.
 *
 * Measured on the fin as exported (at the export minimum thickness), from a mesh whose
 * vertices lie on the true surface: between them the surface bulges a little past them,
 * but by far less than a machining tolerance at these spacings. Only the extreme points
 * matter, so the mesh is cut down to them first ({@link panelPoints}).
 */
import type { Vert3 } from '../loft';
import { vec2, type Vec2 } from '../vec2';
import { FIN_PANEL_MAX_ANGLE, finOutward, type FinDesign } from './fin-design';
import { finMesh, type FinMesh } from './fin-mesh';

const DEG = Math.PI / 180;

/** How the fin sits in the panel (deg): {@link FinPanel}'s angle and tilt. */
export interface PanelPose {
  readonly angle: number;
  readonly tilt: number;
}

/**
 * Across the panel, seen from above (unit, in the plan) when the fin is turned `angle`
 * degrees in it: the horizontal axis of the front view along the panel.
 */
export const panelAcross = (angle: number): Vec2 =>
  vec2(-Math.sin(angle * DEG), Math.cos(angle * DEG));

/**
 * The panel's normal (unit) for a pose. Tilting leans the faces toward the fin's
 * outside face (`outward`, {@link finOutward}): seen from the front, a face is the line
 * across·cos(tilt) − outward·z·sin(tilt) = constant.
 */
export const panelNormal = (pose: PanelPose, outward: 1 | -1 = 1): Vert3 => {
  const m = panelAcross(pose.angle);
  const c = Math.cos(pose.tilt * DEG);
  return { x: m.x * c, y: m.y * c, z: -outward * Math.sin(pose.tilt * DEG) };
};

/** Monotone-chain convex hull (counter-clockwise) of points in a plane. */
const hull2 = <P extends { x: number; y: number }>(pts: P[]): P[] => {
  if (pts.length < 3) return pts;
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: P, a: P, b: P) => (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly P[]) => {
    const out: P[] = [];
    for (const p of list) {
      while (out.length >= 2 && cross(out[out.length - 2]!, out[out.length - 1]!, p) <= 0) {
        out.pop();
      }
      out.push(p);
    }
    out.pop();
    return out;
  };
  return [...half(pts), ...half([...pts].reverse())];
};

/**
 * The mesh's points that can touch a panel face, whatever the pose: grouped by height,
 * the convex hull of each group. Blade sections are horizontal rings and the tab is
 * extruded across, so most points share a height with many others; any point that is
 * extreme in some direction is on its height's hull.
 */
export const panelPoints = (mesh: FinMesh): Vert3[] => {
  const byZ = new Map<number, Vert3[]>();
  for (const m of [mesh.blade, mesh.tab]) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) {
      const z = p[i + 2]!;
      let group = byZ.get(z);
      if (!group) byZ.set(z, (group = []));
      group.push({ x: p[i]!, y: p[i + 1]!, z });
    }
  }
  return [...byZ.values()].flatMap((g) => hull2(g));
};

/** The convex hull (counter-clockwise) of points seen from above. */
export const planHull = (pts: readonly { x: number; y: number }[]): Vec2[] =>
  hull2(pts.map((p) => vec2(p.x, p.y)));

/** Where the fin spans across the panel in a pose: `lo` to `hi` along its normal (cm). */
export const panelSpan = (
  pts: readonly Vert3[],
  pose: PanelPose,
  outward: 1 | -1 = 1,
): { lo: number; hi: number; width: number } => {
  const n = panelNormal(pose, outward);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of pts) {
    const d = p.x * n.x + p.y * n.y + p.z * n.z;
    if (d < lo) lo = d;
    if (d > hi) hi = d;
  }
  return { lo, hi, width: hi - lo };
};

/** The minimum of `f` within ±max: a scan every `step`, then a golden-section search. */
const minimise = (f: (a: number) => number, step: number, max: number): number => {
  let best = 0;
  for (let a = -max; a <= max + 1e-9; a += step) if (f(a) < f(best) - 1e-12) best = a;
  let lo = Math.max(-max, best - step);
  let hi = Math.min(max, best + step);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (f(a) <= f(b)) hi = b;
    else lo = a;
  }
  const a = Math.round(((lo + hi) / 2) * 100) / 100; // to a hundredth of a degree
  return f(a) <= f(best) ? a : best;
};

/**
 * The pose within ±{@link FIN_PANEL_MAX_ANGLE} each way that needs the thinnest panel,
 * and that thickness. The width is smooth between hull points, but needn't have a
 * single minimum: a coarse scan of both angles, then each refined in turn.
 */
export const bestPanelPose = (
  pts: readonly Vert3[],
  outward: 1 | -1 = 1,
): PanelPose & { width: number } => {
  const width = (angle: number, tilt: number) => panelSpan(pts, { angle, tilt }, outward).width;
  const max = FIN_PANEL_MAX_ANGLE;
  let angle = 0;
  let tilt = 0;
  for (let a = -max; a <= max + 1e-9; a += 3) {
    for (let t = -max; t <= max + 1e-9; t += 3) {
      if (width(a, t) < width(angle, tilt) - 1e-12) [angle, tilt] = [a, t];
    }
  }
  for (let round = 0; round < 6; round++) {
    const was = [angle, tilt];
    angle = minimise((a) => width(a, tilt), round ? 0.25 : 1.5, max);
    tilt = minimise((t) => width(angle, t), round ? 0.25 : 1.5, max);
    if (was[0] === angle && was[1] === tilt) break;
  }
  return { angle, tilt, width: width(angle, tilt) };
};

/** Mesh resolution for the fit: fine enough to put the points within a few µm of the fin. */
const FIT_MESH = { rows: 60, stations: 64 };

/** The fin's points that can touch a panel, as exported at `minThickness` (cm). */
export const finPanelPoints = (d: FinDesign, minThickness: number): Vert3[] =>
  panelPoints(finMesh(d, { ...FIT_MESH, minThickness }));

/** {@link finOutward} for a design, for {@link panelSpan} and {@link bestPanelPose}. */
export const panelOutward = (d: FinDesign): 1 | -1 => finOutward(d.hand);
