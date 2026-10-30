// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The foil sweep drawn over the profile (owner proposal, kernel swept-loft.ts): the base
 * line (foil sweep start) and the tip line (foil sweep end), each a soft green band, the
 * thickness path between them, and the handles that move them. The tip line's ends
 * slide along the outline; each thickness path point slides along its own section.
 */
import {
  finReadouts,
  outlineFractionNear,
  sweepAlongNear,
  sweepGrid,
  sweepPointOn,
  sweepSectionLine,
  sweepTipEdge,
  thicknessPathAt,
  thicknessPathOf,
  type FinDesign,
  type Vec2,
} from '@openshaper/kernel';
import type { FinCurveMarker } from '@openshaper/render2d';
import { TIP_FOIL, type FinState } from '@openshaper/store';
import type { StoreApi } from 'zustand/vanilla';

export const SWEEP_LINE = 'rgba(34,197,94,0.95)';
export const SWEEP_BAND = 'rgba(34,197,94,0.22)';
export const PATH_COLOR = 'rgba(245,158,11,0.95)';

export interface SweepOverlay {
  /** Foil sweep start: the base, along the root (and a raised rear's underside). */
  readonly base: readonly Vec2[];
  /** Foil sweep end: the tip line. */
  readonly tip: readonly Vec2[];
  /** The thickness path, base to tip line. */
  readonly path: readonly Vec2[];
  /** The tip past the tip line: its edge round from one end of the tip line to the other. */
  readonly cap: readonly Vec2[];
  /** Whether a horizontal slice sits above the lower end of the tip line: it blends into the tip. */
  readonly sliceIntoTip: boolean;
  readonly markers: readonly FinCurveMarker[];
}

export const sweepOverlay = (d: FinDesign): SweepOverlay => {
  const g = sweepGrid(d);
  const way = thicknessPathOf(d);
  const tip = sweepSectionLine(g, g.tipRow);
  const path = Array.from({ length: 41 }, (_, k) => {
    const t = k / 40;
    return sweepPointOn(g, t * g.tipRow, thicknessPathAt(way, t));
  });
  const depth = finReadouts(d).depth;
  const lowTip = Math.min(tip[0]!.y, tip[tip.length - 1]!.y);
  const handle = (i: 0 | 1 | 2): FinCurveMarker => ({
    id: `path-${i}`,
    at: sweepPointOn(g, (i / 2) * g.tipRow, way[i]),
    color: PATH_COLOR,
    label: [
      'Thickness path at the base',
      'Thickness path halfway',
      'Thickness path at the tip line',
    ][i]!,
  });
  return {
    base: sweepSectionLine(g, 0),
    tip,
    path,
    cap: sweepTipEdge(d),
    sliceIntoTip: d.slices.some((sl) => sl.height * depth > lowTip),
    markers: [
      { id: 'tip-start', at: tip[0]!, color: SWEEP_LINE, label: 'Foil sweep end, front' },
      { id: 'tip-end', at: tip[tip.length - 1]!, color: SWEEP_LINE, label: 'Foil sweep end, back' },
      handle(0),
      handle(1),
      handle(2),
    ],
  };
};

/** FinCurveEditor marker handlers wired to the store: one undo step per drag. */
export const sweepMarkerHandlers = (store: StoreApi<FinState>) => {
  const s = store.getState;
  return {
    onMarkerDragStart: (id: string) =>
      s().beginEdit(id.startsWith('tip') ? 'Move the tip line' : 'Move the thickness path'),
    onMarkerDrag: (id: string, to: Vec2) => {
      const d = s().design;
      if (!d) return;
      if (id === 'tip-start' || id === 'tip-end') {
        s().setTipLineEnd(id === 'tip-start' ? 'start' : 'end', outlineFractionNear(d.outline, to));
        return;
      }
      const i = Number(id.slice('path-'.length)) as 0 | 1 | 2;
      const g = sweepGrid(d);
      s().setThicknessPath(i, sweepAlongNear(g, (i / 2) * g.tipRow, to));
    },
    onMarkerDragEnd: () => s().endEdit(),
  };
};

/** How close (px) a click must come to a sweep line to pick it. */
const PICK_PX = 8;

const distToPolyline = (p: Vec2, pts: readonly Vec2[]): number => {
  let best = Infinity;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1]!;
    const b = pts[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2)) : 0;
    best = Math.min(best, Math.hypot(p.x - a.x - t * dx, p.y - a.y - t * dy));
  }
  return best;
};

/**
 * The sweep line a click at `at` picks, as a foil index (0 the base, TIP_FOIL the tip),
 * or null for neither: the nearer, within a few pixels.
 */
export const pickSweepLine = (o: SweepOverlay, at: Vec2, unitsPerPx: number): number | null => {
  const base = distToPolyline(at, o.base);
  const tip = distToPolyline(at, o.tip);
  const reach = PICK_PX * unitsPerPx;
  if (Math.min(base, tip) > reach) return null;
  return tip < base ? TIP_FOIL : 0;
};
