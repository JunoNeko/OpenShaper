// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * How the fin sits in its panel (kernel panel-fit.ts), for the foil view's overlay and
 * the status line. Both read one measurement per design: the fin is meshed once, on the
 * design as of the last finished edit, so a drag doesn't re-mesh it on every move.
 */
import {
  bestPanelAngle,
  bladeSection,
  finPlanHull,
  foilAt,
  panelNormal,
  panelSpan,
  prepareBlade,
  vec2,
  type FinDesign,
  type FinPanel,
  type Vec2,
} from '@openshaper/kernel';
import type { FinState } from '@openshaper/store';
import { useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useSettledDesign } from './use-settled-design';

export interface PanelFit {
  readonly panel: FinPanel;
  /** The fin seen from above (cm), tab and all, as exported. */
  readonly hull: readonly Vec2[];
  /** Where it spans across the panel at the panel's angle (cm, along the panel's normal). */
  readonly lo: number;
  readonly hi: number;
  /** The panel thickness it needs at that angle (cm). */
  readonly width: number;
  readonly fits: boolean;
}

/** Hulls by design, then export minimum: designs are immutable. */
const hulls = new WeakMap<FinDesign, Map<number, Vec2[]>>();

const hullOf = (d: FinDesign, minThickness: number): Vec2[] => {
  let byMin = hulls.get(d);
  if (!byMin) hulls.set(d, (byMin = new Map()));
  let hull = byMin.get(minThickness);
  if (!hull) byMin.set(minThickness, (hull = finPlanHull(d, minThickness)));
  return hull;
};

/** The fit of `d` in its panel, or null with no panel set. */
export const panelFitOf = (d: FinDesign | null, minThickness: number): PanelFit | null => {
  if (!d?.panel) return null;
  const hull = hullOf(d, minThickness);
  const span = panelSpan(hull, d.panel.angle);
  // A hair of slack: a fin exactly as thick as its panel fits.
  return { panel: d.panel, hull, ...span, fits: span.width <= d.panel.thickness + 1e-6 };
};

/** The angle needing the thinnest panel for `d`, as exported at `minThickness`. */
export const bestAngleOf = (d: FinDesign, minThickness: number): number =>
  bestPanelAngle(hullOf(d, minThickness)).angle;

/** {@link panelFitOf} the settled design. */
export function usePanelFit(store: StoreApi<FinState>, minThickness: number): PanelFit | null {
  const design = useSettledDesign(store);
  return useMemo(() => panelFitOf(design, minThickness), [design, minThickness]);
}

/** What the foil view draws for the panel, in its own coordinates (chords, shape units). */
export interface PanelOverlay {
  /** The fin seen from above. */
  readonly hull: readonly Vec2[];
  /** The panel's two faces, each as a long segment. */
  readonly faces: readonly (readonly [Vec2, Vec2])[];
  readonly fits: boolean;
}

/**
 * The panel and the fin from above, mapped into the foil view of foil `foil` (0 the
 * root). The view shows that foil's shape, chord 0 to 1 across, faces in shape units.
 * The real section at that height is laid over it: along the chord from its leading to
 * its trailing edge, and across scaled so its thickest point matches the shape's. That
 * map is affine, so the panel's faces stay straight and parallel; the view's 4× stretch
 * makes the angle look steeper than it is.
 */
export const panelOverlay = (
  d: FinDesign,
  foil: number,
  fit: PanelFit,
  minThickness: number,
): PanelOverlay | null => {
  const b = prepareBlade(d, undefined, minThickness);
  const eta = foil === 0 ? 0 : (d.slices[foil - 1]?.height ?? 0);
  const shape = foilAt(d, eta);
  const at = shape.thickest.at;
  const sec = bladeSection(b, eta * b.depth, [0, at, 1]);
  const mid = (i: number) =>
    vec2((sec.outside[i]!.x + sec.inside[i]!.x) / 2, (sec.outside[i]!.y + sec.inside[i]!.y) / 2);
  const le = mid(0);
  const te = mid(2);
  const len = Math.hypot(te.x - le.x, te.y - le.y);
  if (!(len > 0)) return null;
  const e = vec2((te.x - le.x) / len, (te.y - le.y) / len);
  // Across the chord, toward the outside face.
  let n = vec2(-e.y, e.x);
  const across = (p: { x: number; y: number }) => (p.x - le.x) * n.x + (p.y - le.y) * n.y;
  if (across(sec.outside[1]!) < across(sec.inside[1]!)) n = vec2(e.y, -e.x);
  const wOut = across(sec.outside[1]!);
  const wIn = across(sec.inside[1]!);
  const [sOut, sIn] = shape.shapeAt(at);
  if (!(sOut - sIn > 0) || !(wOut - wIn > 0)) return null;
  const k = (wOut - wIn) / (sOut - sIn); // cm per shape unit
  const w0 = wIn - sIn * k;
  const toView = (p: Vec2): Vec2 =>
    vec2(((p.x - le.x) * e.x + (p.y - le.y) * e.y) / len, (across(p) - w0) / k);

  // The panel's faces, centred on the fin: the band from mid − t/2 to mid + t/2.
  const nrm = panelNormal(fit.panel.angle);
  const along = vec2(nrm.y, -nrm.x);
  const centre = (fit.lo + fit.hi) / 2;
  const reach = 100; // cm: well past any fin; the canvas clips it
  const face = (level: number): [Vec2, Vec2] => {
    const c = vec2(nrm.x * level, nrm.y * level);
    return [
      toView(vec2(c.x - along.x * reach, c.y - along.y * reach)),
      toView(vec2(c.x + along.x * reach, c.y + along.y * reach)),
    ];
  };
  const half = fit.panel.thickness / 2;
  return {
    hull: fit.hull.map(toView),
    faces: [face(centre - half), face(centre + half)],
    fits: fit.fits,
  };
};
