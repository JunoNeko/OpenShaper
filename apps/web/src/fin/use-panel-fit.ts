// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * How the fin sits in its panel (kernel panel-fit.ts), for the foil view's and the front
 * view's overlays and the status line. All read one measurement per design: the fin is
 * meshed once, on the design as of the last finished edit, so a drag doesn't re-mesh it
 * on every move.
 */
import {
  bestPanelPose,
  bladeSection,
  finPanelPoints,
  foilAt,
  panelAcross,
  panelOutward,
  panelSpan,
  planHull,
  prepareBlade,
  vec2,
  type FinDesign,
  type FinPanel,
  type PanelPose,
  type Vec2,
  type Vert3,
} from '@openshaper/kernel';
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
/** How far the faces are drawn each way (cm): well past any fin; the canvas clips them. */
const REACH = 100;

/**
 * Where a face of the panel crosses height `z`, across the panel (cm, along
 * {@link panelAcross}): the face is `level` along the panel's normal, and leans with the
 * tilt (panelNormal).
 */
const faceAcrossAt = (fit: PanelFit, level: number, z: number): number =>
  (level + fit.outward * Math.sin(fit.pose.tilt * DEG) * z) / Math.cos(fit.pose.tilt * DEG);

/** The levels of the panel's two faces along its normal: centred on the fin. */
const faceLevels = (fit: PanelFit): [number, number] => {
  const centre = (fit.lo + fit.hi) / 2;
  const half = fit.panel.thickness / 2;
  return [centre - half, centre + half];
};

/** What the foil view draws for the panel, in its own coordinates (chords, shape units). */
export interface PanelOverlay {
  /** The fin seen from above, or null with the panel tilted: then it's the front view's. */
  readonly hull: readonly Vec2[] | null;
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
 * makes the angle look steeper than it is. A tilted panel's faces are drawn where they
 * cross that height.
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
  const z = eta * b.depth;
  const sec = bladeSection(b, z, [0, at, 1]);
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

  // Each face crosses this height on a line along the panel.
  const m = panelAcross(fit.pose.angle);
  const along = vec2(m.y, -m.x);
  const face = (level: number): [Vec2, Vec2] => {
    const c = faceAcrossAt(fit, level, z);
    return [
      toView(vec2(m.x * c - along.x * REACH, m.y * c - along.y * REACH)),
      toView(vec2(m.x * c + along.x * REACH, m.y * c + along.y * REACH)),
    ];
  };
  const [lo, hi] = faceLevels(fit);
  return {
    hull: fit.pose.tilt ? null : planHull(fit.points).map(toView),
    faces: [face(lo), face(hi)],
    fits: fit.fits,
  };
};

/**
 * The panel's faces in the front view (cm): looking along the panel, across it to the
 * right ({@link panelAcross}) and height up, each face a long straight line.
 */
export const frontPanelFaces = (fit: PanelFit): (readonly [Vec2, Vec2])[] =>
  faceLevels(fit).map(
    (level) =>
      [
        vec2(faceAcrossAt(fit, level, -REACH), -REACH),
        vec2(faceAcrossAt(fit, level, REACH), REACH),
      ] as const,
  );
