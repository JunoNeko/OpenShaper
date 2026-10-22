// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The thickness taper, editable: the thickness at the foil's thickest point, from the
 * root (bottom) to the tip (top), standing upright like the profile and the 3D view
 * (docs/design/fin-designer.md, step 12; round 1, R6). The taper's data is (fraction of
 * the depth, thickness); it is drawn with height up at the fin's true depth, so it lines
 * up with the profile, and thickness across, stretched so it reads. Straight then
 * curving toward the tip is the usual shape: the curve is what controls flex. The
 * dashed line is the 1 mm minimum; the store stops a point there.
 */
import { FIN_MIN_THICKNESS, finReadouts } from '@openshaper/kernel';
import { FinCurveEditor, type ViewMap } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { memo, useCallback, useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { fmtLen, type LengthUnit } from '../format';
import { alsoFromSelection, curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { sliceGuideHandlers, sliceGuides } from './slice-guides';
import { useFinState } from './use-fin';

const TAPER = '#F59E0B';
const GUIDE = 'rgba(138,155,179,0.7)';
const LIMIT = 'rgba(249,115,22,0.85)';

/** Thickness is drawn this many times wider than true; height is true to scale. */
export const TAPER_ACROSS = 4;

/** Data (fraction of depth, thickness) to view (thickness across, height up). */
export const taperView = (depth: number): ViewMap => ({ a: 0, b: TAPER_ACROSS, c: depth, d: 0 });

export const FinTaperPane = memo(function FinTaperPane({
  store,
  units,
  frameKey = '',
}: {
  store: StoreApi<FinState>;
  units: LengthUnit;
  /** Change it to re-fit the view (the pane moving large or small). */
  frameKey?: string;
}) {
  const design = useFinState(store, (s) => s.design);
  const selection = useFinState(store, (s) => s.selection);
  const activeFoil = useFinState(store, (s) => s.activeFoil);
  const guides = useMemo(
    () => (design ? sliceGuides(design, activeFoil, units, 'x') : []),
    [design, activeFoil, units],
  );
  const guideHandlers = useMemo(() => sliceGuideHandlers(store, 'x'), [store]);
  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  const taper = design?.taper;
  const root = taper?.knots[0]?.end.y ?? 0.8;
  const depth = useMemo(() => (design ? finReadouts(design).depth : 10), [design]);
  const view = useMemo(() => taperView(depth), [depth]);

  const layers = useMemo(
    () => (taper ? [{ id: 'taper', spline: taper, editable: true, color: TAPER }] : []),
    [taper],
  );

  const drawUnder = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _vp: unknown,
      toScreen: (p: { x: number; y: number }) => { x: number; y: number },
    ) => {
      // Points are taper data: x the fraction of the depth, y the thickness.
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
      ctx.lineWidth = 1;
      line({ x: 0, y: 0 }, { x: 1, y: 0 }, GUIDE); // zero thickness, root to tip
      line({ x: 0, y: 0 }, { x: 0, y: root * 1.1 }, GUIDE); // the root
      ctx.setLineDash([5, 4]);
      line({ x: 0, y: FIN_MIN_THICKNESS }, { x: 1.02, y: FIN_MIN_THICKNESS }, LIMIT);
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      // Labels are offset in pixels, so they read the same in a small pane.
      const label = (
        text: string,
        p: { x: number; y: number },
        dx: number,
        dy: number,
        align: CanvasTextAlign,
      ) => {
        const s = toScreen(p);
        ctx.textAlign = align;
        ctx.fillText(text, s.x + dx, s.y + dy);
      };
      ctx.fillStyle = GUIDE;
      label('Root', { x: 0, y: 0 }, -6, 4, 'right');
      label('Tip', { x: 1, y: 0 }, -6, 4, 'right');
      label('thickness →', { x: 0, y: root * 0.55 }, 0, 16, 'center');
      ctx.fillStyle = LIMIT;
      label(
        `${fmtLen(FIN_MIN_THICKNESS, units)} min`,
        { x: 1.02, y: FIN_MIN_THICKNESS },
        0,
        -6,
        'center',
      );
      ctx.restore();
    },
    [units, root],
  );

  if (!design || !taper) return null;
  return (
    <FinCurveEditor
      label="Thickness taper"
      layers={layers}
      selection={pickFromSelection(selection, ['taper'])}
      alsoSelected={alsoFromSelection(selection, ['taper'])}
      yScale={view}
      frameBounds={{ minX: -0.04, maxX: 1.06, minY: -0.12, maxY: root * 1.15 }}
      frameKey={`${design.position}-${frameKey}`}
      drawUnder={drawUnder}
      guides={guides}
      {...guideHandlers}
      {...handlers}
    />
  );
});
