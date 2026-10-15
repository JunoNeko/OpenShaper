// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Wires a FinCurveEditor to the fin store. Layer ids are the store's curve names
 * (`outline`, `outside`, `inside`, `taper`), so one set of handlers serves every pane:
 * a pick selects that curve's point, a drag is one undo step of clamped moves, a
 * double-click adds a point.
 */
import type { FinCurvePick } from '@openshaper/render2d';
import type { FinCurve, FinSelection, FinState } from '@openshaper/store';
import type { StoreApi } from 'zustand/vanilla';

/** The store's selection as an editor pick, if it is on one of `curves`. */
export const pickFromSelection = (
  sel: FinSelection | null,
  curves: readonly FinCurve[],
): FinCurvePick | null =>
  sel && curves.includes(sel.curve)
    ? { layer: sel.curve, index: sel.index, kind: sel.kind ?? 'end' }
    : null;

export const curveEditorHandlers = (store: StoreApi<FinState>) => {
  const s = store.getState;
  return {
    onSelect: (p: FinCurvePick | null) =>
      s().select(p && { curve: p.layer as FinCurve, index: p.index, kind: p.kind }),
    onDragStart: () => s().beginEdit('Move control point'),
    onDrag: (p: FinCurvePick, to: { x: number; y: number }) => {
      const curve = p.layer as FinCurve;
      if (p.kind === 'end') s().moveControlPoint(curve, p.index, to);
      else s().moveTangent(curve, p.index, p.kind, to);
    },
    onDragEnd: () => s().endEdit(),
    onAddPoint: (layer: string, at: { x: number; y: number }) => {
      s().addControlPoint(layer as FinCurve, at);
    },
  };
};
