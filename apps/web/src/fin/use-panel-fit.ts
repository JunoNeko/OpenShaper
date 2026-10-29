// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * How the fin sits in its panel (kernel panel-fit.ts), for the 3D view's panel fit and
 * the status line. Both read one measurement per design: the fin is
 * meshed once, on the design as of the last finished edit, so a drag doesn't re-mesh it
 * on every move.
 */
import {
  bestPanelPose,
  finPanelPoints,
  panelAcross,
  panelOutward,
  panelSpan,
  vec2,
  type FinDesign,
  type FinPanel,
  type PanelPose,
  type Vert3,
} from '@openshaper/kernel';
import type { FinPanelOutline } from '@openshaper/render3d';
import type { FinState } from '@openshaper/store';
import { useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useSettledDesign } from './use-settled-design';

export interface PanelFit {
  readonly panel: FinPanel;
  /** How the fin sits in it (deg), tilt 0 when the panel has none. */
  readonly pose: PanelPose;
  /** Which way the fin's outside face points (finOutward): the tilt leans that way. */
  readonly outward: 1 | -1;
  /** The fin's points that can touch a face (cm), tab and all, as exported. */
  readonly points: readonly Vert3[];
  /** Where it spans across the panel in that pose (cm, along the panel's normal). */
  readonly lo: number;
  readonly hi: number;
  /** The panel thickness it needs in that pose (cm). */
  readonly width: number;
  readonly fits: boolean;
}

/** Points by design, then export minimum: designs are immutable. */
const cache = new WeakMap<FinDesign, Map<number, Vert3[]>>();

const pointsOf = (d: FinDesign, minThickness: number): Vert3[] => {
  let byMin = cache.get(d);
  if (!byMin) cache.set(d, (byMin = new Map()));
  let pts = byMin.get(minThickness);
  if (!pts) byMin.set(minThickness, (pts = finPanelPoints(d, minThickness)));
  return pts;
};

/** The fit of `d` in its panel, or null with no panel set. */
export const panelFitOf = (d: FinDesign | null, minThickness: number): PanelFit | null => {
  if (!d?.panel) return null;
  const points = pointsOf(d, minThickness);
  const pose = { angle: d.panel.angle, tilt: d.panel.tilt ?? 0 };
  const outward = panelOutward(d);
  const span = panelSpan(points, pose, outward);
  // A hair of slack: a fin exactly as thick as its panel fits.
  return {
    panel: d.panel,
    pose,
    outward,
    points,
    ...span,
    fits: span.width <= d.panel.thickness + 1e-6,
  };
};

/** The turn and tilt needing the thinnest panel for `d`, as exported at `minThickness`. */
export const bestPoseOf = (d: FinDesign, minThickness: number): PanelPose => {
  const { angle, tilt } = bestPanelPose(pointsOf(d, minThickness), panelOutward(d));
  return { angle, tilt };
};

/** {@link panelFitOf} the settled design. */
export function usePanelFit(store: StoreApi<FinState>, minThickness: number): PanelFit | null {
  const design = useSettledDesign(store);
  return useMemo(() => panelFitOf(design, minThickness), [design, minThickness]);
}

const DEG = Math.PI / 180;

/**
 * The panel's outline for the 3D view's panel fit (fin frame, cm): its cross-section
 * round the fin, seen from behind along the panel. Across, its two faces, centred on the
 * fin; along them, from the fin's lowest point to its highest. Leaning with the tilt
 * (panelNormal): a face is the line across·cos(tilt) − outward·z·sin(tilt) = level.
 */
export const panelOutline = (fit: PanelFit): FinPanelOutline => {
  const m = panelAcross(fit.pose.angle);
  const along = vec2(m.y, -m.x);
  const t = fit.pose.tilt * DEG;
  // In the view (across, up): the faces' normal and their direction.
  const nu = Math.cos(t);
  const nz = -fit.outward * Math.sin(t);
  const fu = -nz;
  const fz = nu;
  let sLo = Infinity;
  let sHi = -Infinity;
  let mid = 0;
  for (const p of fit.points) {
    const s = (p.x * m.x + p.y * m.y) * fu + p.z * fz;
    if (s < sLo) sLo = s;
    if (s > sHi) sHi = s;
    mid += p.x * along.x + p.y * along.y;
  }
  // Drawn through the fin's middle along the panel: the view is all but flat anyway.
  mid /= Math.max(1, fit.points.length);
  const centre = (fit.lo + fit.hi) / 2;
  const half = fit.panel.thickness / 2;
  const corner = (level: number, s: number): [number, number, number] => {
    const u = level * nu + s * fu;
    const z = level * nz + s * fz;
    return [m.x * u + along.x * mid, m.y * u + along.y * mid, z];
  };
  return {
    angle: fit.pose.angle,
    corners: [
      corner(centre - half, sLo),
      corner(centre + half, sLo),
      corner(centre + half, sHi),
      corner(centre - half, sHi),
    ],
    fits: fit.fits,
  };
};
