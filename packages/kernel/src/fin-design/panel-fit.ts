// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fitting a fin in the panel it is machined from (owner request): fins are cut from
 * G10 and similar panels, so the panel's thickness bounds the fin, base and blade
 * together.
 *
 * Seen from above, the fin, tab and all, is a shape in the plan (x along the tab, y
 * across it); the panel is a band of the panel's thickness. Turning the fin in the
 * panel (about an upright axis, {@link FinPanel.angle}) can fit a thicker foil than
 * lying it straight, as the foil is thickest across a line that slants from its chord.
 * What it needs is the shape's width across the band, measured over its convex hull,
 * which is all that a straight-sided band can touch.
 *
 * Measured on the fin as exported (at the export minimum thickness), from a mesh whose
 * vertices lie on the true surface: between them the surface bulges a little past the
 * hull, but by far less than a machining tolerance at these spacings.
 *
 * Cant tilts the blade out of the plan, so a canted fin is wide from above whatever the
 * angle; the panel would be tilted for it instead (not handled here yet).
 */
import { vec2, type Vec2 } from '../vec2';
import { FIN_PANEL_MAX_ANGLE, type FinDesign } from './fin-design';
import { finMesh, type FinMesh } from './fin-mesh';

const DEG = Math.PI / 180;

/** Across the panel (unit, in the plan) when the fin is turned `angle` degrees in it. */
export const panelNormal = (angle: number): Vec2 =>
  vec2(-Math.sin(angle * DEG), Math.cos(angle * DEG));

/** The convex hull (counter-clockwise) of the fin seen from above: blade and tab. */
export const planHull = (mesh: FinMesh): Vec2[] => {
  const pts: Vec2[] = [];
  for (const m of [mesh.blade, mesh.tab]) {
    const p = m.positions;
    for (let i = 0; i < p.length; i += 3) pts.push(vec2(p[i]!, p[i + 1]!));
  }
  // Monotone chain.
  pts.sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: Vec2, a: Vec2, b: Vec2) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const half = (list: readonly Vec2[]) => {
    const out: Vec2[] = [];
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

/** Where the fin spans across the panel at `angle`: `lo` to `hi` along the normal (cm). */
export const panelSpan = (
  hull: readonly Vec2[],
  angle: number,
): { lo: number; hi: number; width: number } => {
  const n = panelNormal(angle);
  let lo = Infinity;
  let hi = -Infinity;
  for (const p of hull) {
    const d = p.x * n.x + p.y * n.y;
    lo = Math.min(lo, d);
    hi = Math.max(hi, d);
  }
  return { lo, hi, width: hi - lo };
};

/**
 * The angle within ±{@link FIN_PANEL_MAX_ANGLE} at which the fin needs the thinnest
 * panel, and that thickness: a scan every half degree, then a golden-section search
 * around the best (the width is smooth between hull vertices).
 */
export const bestPanelAngle = (hull: readonly Vec2[]): { angle: number; width: number } => {
  const width = (a: number) => panelSpan(hull, a).width;
  let best = 0;
  for (let a = -FIN_PANEL_MAX_ANGLE; a <= FIN_PANEL_MAX_ANGLE + 1e-9; a += 0.5) {
    if (width(a) < width(best) - 1e-12) best = a;
  }
  let lo = Math.max(-FIN_PANEL_MAX_ANGLE, best - 0.5);
  let hi = Math.min(FIN_PANEL_MAX_ANGLE, best + 0.5);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let i = 0; i < 40; i++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (width(a) <= width(b)) hi = b;
    else lo = a;
  }
  const angle = Math.round(((lo + hi) / 2) * 100) / 100; // to a hundredth of a degree
  return width(angle) <= width(best)
    ? { angle, width: width(angle) }
    : { angle: best, width: width(best) };
};

/** Mesh resolution for the fit: fine enough to put the hull within a few µm of the fin. */
const FIT_MESH = { rows: 60, stations: 64 };

/** The fin seen from above, as exported at `minThickness` (cm). */
export const finPlanHull = (d: FinDesign, minThickness: number): Vec2[] =>
  planHull(finMesh(d, { ...FIT_MESH, minThickness }));
