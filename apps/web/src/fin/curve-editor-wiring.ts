// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Wires a FinCurveEditor to the fin store. Layer ids are the store's curve names
 * (`outline`, `outside`, `inside`, `taper`), so one set of handlers serves every pane:
 * a pick selects that curve's point, a drag is one undo step of clamped moves, a
 * double-click adds a point.
 */
import type { FinCurvePick } from '@openshaper/render2d';
import { selectedEnds, type FinCurve, type FinSelection, type FinState } from '@openshaper/store';
import type { StoreApi } from 'zustand/vanilla';

/** The store's selection as an editor pick, if it is on one of `curves`. */
export const pickFromSelection = (
  sel: FinSelection | null,
  curves: readonly FinCurve[],
): FinCurvePick | null =>
  sel && curves.includes(sel.curve)
    ? { layer: sel.curve, index: sel.index, kind: sel.kind ?? 'end' }
    : null;

const NONE: readonly number[] = [];

/** Endpoints selected along with the selection, if it is on one of `curves`. */
export const alsoFromSelection = (
  sel: FinSelection | null,
  curves: readonly FinCurve[],
): readonly number[] => (sel && curves.includes(sel.curve) ? (sel.also ?? NONE) : NONE);

export const curveEditorHandlers = (store: StoreApi<FinState>) => {
  const s = store.getState;
  return {
    onSelect: (p: FinCurvePick | null, extend?: boolean) => {
      const sel = p && { curve: p.layer as FinCurve, index: p.index, kind: p.kind };
      if (sel && extend) s().toggleSelect(sel);
      else s().select(sel);
    },
    onDragStart: () => s().beginEdit('Move control point'),
    onDrag: (p: FinCurvePick, to: { x: number; y: number }) => {
      const curve = p.layer as FinCurve;
      if (p.kind !== 'end') return void s().moveTangent(curve, p.index, p.kind, to);
      // The dragged point and any selected with it; one shift-clicked out stays put.
      const sel = s().selection;
      const ends = sel?.curve === curve ? selectedEnds(sel) : [];
      if (!ends.includes(p.index)) return;
      s().moveControlPoints(curve, ends, p.index, to);
    },
    onDragEnd: () => s().endEdit(),
    onAddPoint: (layer: string, at: { x: number; y: number }) => {
      s().addControlPoint(layer as FinCurve, at);
    },
  };
};
