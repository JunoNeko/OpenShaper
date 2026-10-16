// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin's side profile, editable, drawn over its Futures tab: the base line, the
 * tab itself, the 2.5 mm front-overhang limit and the insertion-clearance line behind
 * the tab (fin-clearance.ts). Points are dragged through the fin store, which clamps
 * every move to the fin's rules.
 */
import {
  FIN_MAX_FRONT_OVERHANG,
  FUTURES_TABS,
  clearanceAt,
  finTabKind,
  futuresTabOutline,
  rearClearance,
  tabProfilePoints,
  type FinPosition,
} from '@openshaper/kernel';
import { FinCurveEditor, boundsOf, sampleSpline, type Viewport } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { memo, useCallback, useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { useFinState } from './use-fin';

const TAB_FILL = 'rgba(138,155,179,0.18)';
const TAB_LINE = 'rgba(138,155,179,0.7)';
const LIMIT = 'rgba(249,115,22,0.85)';

/** The tab profile in the blade frame (tab top at y = 0), for drawing. */
const tabPolygon = (position: FinPosition) => {
  const tab = futuresTabOutline(finTabKind(position));
  return tabProfilePoints(tab.segments, 0.002).map((p) => ({ x: p.x, y: p.y - tab.spec.height }));
};

export const FinOutlinePane = memo(function FinOutlinePane({
  store,
  onViewport,
  frameKey = '',
}: {
  store: StoreApi<FinState>;
  onViewport?: (vp: Viewport) => void;
  /** Change it to re-fit the view (the pane moving large or small). */
  frameKey?: string;
}) {
  const design = useFinState(store, (s) => s.design);
  const selection = useFinState(store, (s) => s.selection);
  const position = design?.position ?? 'side';

  const tab = useMemo(() => tabPolygon(position), [position]);
  const kind = finTabKind(position);
  const tabLen = FUTURES_TABS[kind].length;
  const frameBounds = useMemo(
    () => ({ minX: 0, maxX: tabLen, minY: -FUTURES_TABS[kind].height, maxY: 0 }),
    [tabLen, kind],
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
      // The tab.
      ctx.beginPath();
      tab.forEach((p, i) => {
        const s = toScreen(p);
        if (i === 0) ctx.moveTo(s.x, s.y);
        else ctx.lineTo(s.x, s.y);
      });
      ctx.closePath();
      ctx.fillStyle = TAB_FILL;
      ctx.fill();
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
      // Front-overhang limit.
      const front = tabLen + FIN_MAX_FRONT_OVERHANG;
      line({ x: front, y: -0.6 }, { x: front, y: 1.2 }, LIMIT);
      // Insertion clearance behind the tab.
      const c = rearClearance(kind);
      line({ x: 0, y: clearanceAt(c, 0) }, { x: rear, y: clearanceAt(c, rear) }, LIMIT);
      ctx.restore();
    },
    [design, tab, tabLen, kind],
  );

  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  return (
    <FinCurveEditor
      label="Fin outline"
      layers={layers}
      selection={pickFromSelection(selection, ['outline'])}
      frameBounds={frameBounds}
      frameKey={`${position}-${frameKey}`}
      drawUnder={drawUnder}
      onViewport={onViewport}
      {...handlers}
    />
  );
});
