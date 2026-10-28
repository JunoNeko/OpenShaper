// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin's side profile, editable, drawn over its tab: the base line and the tab
 * itself, and on a Futures tab the 4 mm front-overhang limit and the
 * insertion-clearance line behind the tab (fin-clearance.ts). An FCS single tab drops
 * straight into its plug, so it has neither. Points are dragged through the fin store, which clamps
 * every move to the fin's rules.
 */
import {
  FIN_MAX_FRONT_OVERHANG,
  clearanceAt,
  finTabOutline,
  futuresKind,
  rearClearance,
  tabProfilePoints,
  type FinBase,
  type Spline,
} from '@openshaper/kernel';
import { FinCurveEditor, boundsOf, sampleSpline, type Viewport } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { memo, useCallback, useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import type { LengthUnit } from '../format';
import { alsoFromSelection, curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { sliceGuideHandlers, sliceGuides } from './slice-guides';
import { useFinState } from './use-fin';

const TAB_FILL = 'rgba(138,155,179,0.18)';
const TAB_LINE = 'rgba(138,155,179,0.7)';
const LIMIT = 'rgba(249,115,22,0.85)';

/** Each tab's profile and its holes in the blade frame (tab top at y = 0), for drawing. */
const tabPolygons = (base: FinBase, outline?: Spline) => {
  const tab = finTabOutline(base, outline);
  const ring = (segs: Parameters<typeof tabProfilePoints>[0]) =>
    tabProfilePoints(segs, 0.002).map((p) => ({ x: p.x, y: p.y - tab.height }));
  return tab.parts.flatMap((part) => [ring(part.segments), ...part.holes.map(ring)]);
};

export const FinOutlinePane = memo(function FinOutlinePane({
  store,
  units,
  onViewport,
  frameKey = '',
  gridStep,
}: {
  store: StoreApi<FinState>;
  units: LengthUnit;
  onViewport?: (vp: Viewport) => void;
  /** Change it to re-fit the view (the pane moving large or small). */
  frameKey?: string;
  /** The grid's spacing (cm, File settings); fits the zoom if unset. */
  gridStep?: number;
}) {
  const design = useFinState(store, (s) => s.design);
  const selection = useFinState(store, (s) => s.selection);
  const activeFoil = useFinState(store, (s) => s.activeFoil);
  const position = design?.position ?? 'side';
  const guides = useMemo(
    () => (design ? sliceGuides(design, activeFoil, units, 'y') : []),
    [design, activeFoil, units],
  );
  const guideHandlers = useMemo(() => sliceGuideHandlers(store, 'y'), [store]);

  const base = design?.base ?? 'futures-side';
  // A US box head follows the fin; every other base is fixed.
  const follows = base === 'us-box' ? design?.outline : undefined;
  const tab = useMemo(() => tabPolygons(base, follows), [base, follows]);
  const kind = futuresKind(base);
  const { rear: tabRear, length: tabLen, height: tabHeight } = finTabOutline(base, follows);
  const frameBounds = useMemo(
    () => ({ minX: tabRear, maxX: tabRear + tabLen, minY: -tabHeight, maxY: 0 }),
    [tabRear, tabLen, tabHeight],
  );

  const layers = useMemo(
    () => (design ? [{ id: 'outline', spline: design.outline, editable: true }] : []),
    [design],
  );

  const drawUnder = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _vp: Viewport,
      toScreen: (p: { x: number; y: number }) => { x: number; y: number },
    ) => {
      if (!design) return;
      // The tab, with its weight-saving holes cut out.
      ctx.beginPath();
      for (const ring of tab) {
        ring.forEach((p, i) => {
          const s = toScreen(p);
          if (i === 0) ctx.moveTo(s.x, s.y);
          else ctx.lineTo(s.x, s.y);
        });
        ctx.closePath();
      }
      ctx.fillStyle = TAB_FILL;
      ctx.fill('evenodd');
      ctx.strokeStyle = TAB_LINE;
      ctx.lineWidth = 1;
      ctx.stroke();

      const line = (a: { x: number; y: number }, b: { x: number; y: number }, color: string) => {
        const sa = toScreen(a);
        const sb = toScreen(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.strokeStyle = color;
        ctx.stroke();
      };
      ctx.save();
      ctx.setLineDash([5, 4]);
      // The base: the board's bottom surface, across the whole view.
      const rear = Math.min(-3, boundsOf(sampleSpline(design.outline)).minX - 1);
      line({ x: rear, y: 0 }, { x: tabLen + 3, y: 0 }, TAB_LINE);
      if (kind) {
        // Front-overhang limit.
        const front = tabLen + FIN_MAX_FRONT_OVERHANG;
        line({ x: front, y: -0.6 }, { x: front, y: 1.2 }, LIMIT);
        // Insertion clearance behind the tab.
        const c = rearClearance(kind);
        line({ x: 0, y: clearanceAt(c, 0) }, { x: rear, y: clearanceAt(c, rear) }, LIMIT);
      }
      ctx.restore();
    },
    [design, tab, tabLen, kind],
  );

  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  return (
    <FinCurveEditor
      gridStep={gridStep}
      label="Fin outline"
      layers={layers}
      selection={pickFromSelection(selection, ['outline'])}
      alsoSelected={alsoFromSelection(selection, ['outline'])}
      frameBounds={frameBounds}
      frameKey={`${position}-${base}-${frameKey}`}
      drawUnder={drawUnder}
      onViewport={onViewport}
      guides={guides}
      {...guideHandlers}
      {...handlers}
    />
  );
});
