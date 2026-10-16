// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The thickness taper, editable: the thickness at the foil's thickest point, from the
 * root (left) to the tip (right), as a fraction of the fin's depth
 * (docs/design/fin-designer.md, step 12). Straight then curving toward the tip is the
 * usual shape: the curve is what controls flex. The dashed line is the 0.5 mm
 * minimum; the store stops a point there.
 */
import { FIN_MIN_THICKNESS } from '@openshaper/kernel';
import { FinCurveEditor } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { memo, useCallback, useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { fmtLen, type LengthUnit } from '../format';
import { curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { useFinState } from './use-fin';

const TAPER = '#F59E0B';
const GUIDE = 'rgba(138,155,179,0.7)';
const LIMIT = 'rgba(249,115,22,0.85)';

/**
 * Drawn this many times taller than true. The x axis is a fraction (0 root, 1 tip)
 * and y is thickness in cm, so a 0.8 cm root on a unit-long axis reads well at 1.
 */
export const TAPER_Y_SCALE = 1;

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
  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  const taper = design?.taper;
  const root = taper?.knots[0]?.end.y ?? 0.8;

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
      line({ x: 0, y: 0 }, { x: 1, y: 0 }, GUIDE);
      ctx.setLineDash([5, 4]);
      line({ x: 0, y: FIN_MIN_THICKNESS }, { x: 1.02, y: FIN_MIN_THICKNESS }, LIMIT);
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      ctx.fillStyle = GUIDE;
      const label = (text: string, p: { x: number; y: number }, align: CanvasTextAlign) => {
        const s = toScreen(p);
        ctx.textAlign = align;
        ctx.fillText(text, s.x, s.y);
      };
      label('Root', { x: 0, y: -0.06 }, 'left');
      label('Tip', { x: 1, y: -0.06 }, 'right');
      label('height →', { x: 0.5, y: -0.06 }, 'center');
      ctx.fillStyle = LIMIT;
      label(
        `${fmtLen(FIN_MIN_THICKNESS, units)} minimum`,
        { x: 0.5, y: FIN_MIN_THICKNESS + 0.02 },
        'center',
      );
      ctx.restore();
    },
    [units],
  );

  if (!design || !taper) return null;
  return (
    <FinCurveEditor
      label="Thickness taper"
      layers={layers}
      selection={pickFromSelection(selection, ['taper'])}
      yScale={TAPER_Y_SCALE}
      frameBounds={{ minX: 0, maxX: 1, minY: -0.08, maxY: root * 1.1 }}
      frameKey={`${design.position}-${frameKey}`}
      drawUnder={drawUnder}
      {...handlers}
    />
  );
});
