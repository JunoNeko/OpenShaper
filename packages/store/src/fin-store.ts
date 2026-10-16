// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin designer's document store (docs/design/fin-designer.md, step 9): the fin
 * being edited, undo/redo, and the edits the UI calls. Shaped like `createBoardStore`
 * (board-store.ts): a vanilla Zustand store, edits as pure functions (fin-edits.ts),
 * every change through `commit(next, label)`, and a drag coalesced into one undo step
 * between `beginEdit` and `endEdit`.
 *
 * The fin's rules (`validateFinDesign`) are enforced here, as the edit happens: an
 * edit may not break a rule the design didn't already break. Drags of points and
 * handles are clamped (the point stops at the boundary, see `clampEdit`), numeric
 * fields are clamped to their range, and anything else that would break a rule is
 * refused, returning false. A design loaded with an issue can still be edited, as long
 * as the edit adds none.
 */
import {
  finReadouts,
  nudgeFore,
  nudgeLateral,
  vec2,
  type FinDesign,
  type FinHand,
  type FinPosition,
  type Vec2,
} from '@openshaper/kernel';
import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  canDeleteKnot,
  deleteKnot,
  insertKnotAt,
  moveKnotEnd,
  moveKnotTangent,
  setKnotContinuous,
} from './edits';
import {
  applyNaca,
  clampEdit,
  constrainKnot,
  getFinCurve,
  newFin,
  newIssues,
  setCant,
  setDepth,
  setHand,
  setInsideFace,
  setRootThickness,
  smoothKnot,
  spanMidpoint,
  withFinCurve,
  type FinCurve,
} from './fin-edits';

/** A selected control point of one of the fin's curves. */
export interface FinSelection {
  curve: FinCurve;
  index: number;
  /** The endpoint or one of its handles. Omitted means the endpoint. */
  kind?: 'end' | 'prev' | 'next';
}

export interface FinHistoryEntry {
  design: FinDesign;
  label: string;
}

export interface FinState {
  design: FinDesign | null;
  past: FinHistoryEntry[];
  future: FinHistoryEntry[];
  /** True during a drag: its moves coalesce into one undo step. */
  editing: boolean;
  selection: FinSelection | null;

  /** Open a design (a file, an autosave): history starts afresh. */
  load: (d: FinDesign) => void;
  /** Start again from a position's default fin (undoable). */
  newFin: (position: FinPosition, hand?: FinHand) => void;
  select: (selection: FinSelection | null) => void;

  beginEdit: (label?: string) => void;
  endEdit: () => void;

  /** Drag a knot's endpoint toward `p`, clamped to the rules. False if it can't move. */
  moveControlPoint: (curve: FinCurve, index: number, p: Vec2) => boolean;
  /** Drag one of a knot's handles toward `p`, clamped to the rules. */
  moveTangent: (curve: FinCurve, index: number, which: 'prev' | 'next', p: Vec2) => boolean;
  addControlPoint: (curve: FinCurve, p: Vec2) => boolean;
  /** The toolbar's add button: a point halfway along the span after knot `index`. */
  addControlPointAfter: (curve: FinCurve, index: number) => boolean;
  deleteControlPoint: (curve: FinCurve, index: number) => boolean;
  setContinuous: (curve: FinCurve, index: number, continuous: boolean) => boolean;

  setCant: (deg: number) => boolean;
  setRootThickness: (cm: number) => boolean;
  setDepth: (cm: number) => boolean;
  setHand: (hand: FinHand) => boolean;
  /** Apply a NACA 4-digit preset to the section ('2412'). */
  applyNaca: (code: string) => boolean;
  setInsideFace: (kind: 'flat' | 'symmetric') => boolean;
  /** Arrow buttons: move the fin along the tab (cm, + toward the nose). */
  nudgeFore: (dx: number) => boolean;
  /** Arrow buttons: slide the blade across the tab (cm, + outboard). */
  nudgeLateral: (dy: number) => boolean;

  undo: () => void;
  redo: () => void;
  canUndo: () => boolean;
  canRedo: () => boolean;
}

const MAX_HISTORY = 200;

/** Keep a selection only while the point it names still exists. */
const validSelection = (d: FinDesign, s: FinSelection | null): FinSelection | null => {
  if (!s) return null;
  const curve = getFinCurve(d, s.curve);
  return curve && s.index < curve.knots.length ? s : null;
};

export const createFinStore = (): StoreApi<FinState> =>
  createStore<FinState>((set, get) => {
    /** Apply an edited design, recording a labelled step unless mid-drag. */
    const commit = (next: FinDesign, label: string): boolean => {
      const { design, editing, past } = get();
      if (!design || next === design) return false;
      if (editing) {
        const last = past[past.length - 1];
        set({
          design: next,
          past:
            last && last.label !== label
              ? [...past.slice(0, -1), { design: last.design, label }]
              : past,
        });
      } else {
        set({
          design: next,
          past: [...past, { design, label }].slice(-MAX_HISTORY),
          future: [],
        });
      }
      return true;
    };

    /** Commit `next` only if it breaks no rule the current design didn't. */
    const commitChecked = (next: FinDesign | null, label: string): boolean => {
      const { design } = get();
      if (!design || !next || next === design) return false;
      if (newIssues(design, next).length > 0) return false;
      return commit(next, label);
    };

    /** A drag from the knot's current spot toward `target`, clamped along the way. */
    const drag = (
      label: string,
      from: Vec2,
      target: Vec2,
      apply: (p: Vec2) => FinDesign | null,
    ): boolean => {
      const { design } = get();
      if (!design) return false;
      const along = (t: number) =>
        apply(vec2(from.x + (target.x - from.x) * t, from.y + (target.y - from.y) * t)) ?? design;
      const next = clampEdit(design, along);
      return next ? commit(next, label) : false;
    };

    const editCurve = (
      curve: FinCurve,
      label: string,
      fn: (s: NonNullable<ReturnType<typeof getFinCurve>>) => FinDesign | null,
    ): boolean => {
      const { design } = get();
      const s = design && getFinCurve(design, curve);
      if (!design || !s) return false;
      return commitChecked(fn(s), label);
    };

    return {
      design: null,
      past: [],
      future: [],
      editing: false,
      selection: null,

      load: (d) => set({ design: d, past: [], future: [], editing: false, selection: null }),
      newFin: (position, hand) => {
        if (!get().design) {
          get().load(newFin(position, hand));
          return;
        }
        if (commit(newFin(position, hand), 'New fin')) set({ selection: null });
      },
      select: (selection) => set({ selection }),

      beginEdit: (label = 'Edit') => {
        const { design, past, editing } = get();
        if (!design || editing) return;
        set({ editing: true, past: [...past, { design, label }].slice(-MAX_HISTORY), future: [] });
      },
      endEdit: () => {
        const { editing, past, design } = get();
        if (!editing) return;
        // A drag that changed nothing leaves no undo step.
        const last = past[past.length - 1];
        set(
          last && last.design === design
            ? { editing: false, past: past.slice(0, -1) }
            : { editing: false },
        );
      },

      moveControlPoint: (curve, index, p) => {
        const s = get().design && getFinCurve(get().design!, curve);
        if (!s || !s.knots[index]) return false;
        const from = s.knots[index]!.end;
        // Constrain the target, not each step: every constraint is a line or a point, so
        // the straight drag to a constrained target stays on it.
        const to = constrainKnot(s, curve, index, p);
        if (to.x === from.x && to.y === from.y) return false;
        return drag('Move control point', from, to, (q) =>
          withFinCurve(get().design!, curve, moveKnotEnd(s, index, q)),
        );
      },

      moveTangent: (curve, index, which, p) => {
        const s = get().design && getFinCurve(get().design!, curve);
        const k = s?.knots[index];
        if (!s || !k) return false;
        const from = which === 'prev' ? k.tangentToPrev : k.tangentToNext;
        return drag('Move handle', from, p, (q) =>
          withFinCurve(get().design!, curve, moveKnotTangent(s, index, which, q)),
        );
      },

      addControlPoint: (curve, p) => {
        const { design } = get();
        const s = design && getFinCurve(design, curve);
        if (!design || !s) return false;
        const r = insertKnotAt(s, p);
        if (!r) return false;
        const ok = commitChecked(withFinCurve(design, curve, r.spline), 'Add control point');
        if (ok) set({ selection: { curve, index: r.index, kind: 'end' } });
        return ok;
      },

      addControlPointAfter: (curve, index) => {
        const { design } = get();
        const s = design && getFinCurve(design, curve);
        const at = s && spanMidpoint(s, index);
        return at ? get().addControlPoint(curve, at) : false;
      },

      deleteControlPoint: (curve, index) => {
        const { design } = get();
        const s = design && getFinCurve(design, curve);
        if (!design || !s || !canDeleteKnot(s, index)) return false;
        if (get().editing) set({ editing: false });
        const ok = commitChecked(
          withFinCurve(design, curve, deleteKnot(s, index)),
          'Delete control point',
        );
        if (ok) set({ selection: null });
        return ok;
      },

      setContinuous: (curve, index, continuous) =>
        editCurve(curve, continuous ? 'Smooth control point' : 'Corner control point', (s) =>
          withFinCurve(
            get().design!,
            curve,
            continuous ? smoothKnot(s, index) : setKnotContinuous(s, index, false),
          ),
        ),

      setCant: (deg) => {
        const d = get().design;
        return d ? commitChecked(setCant(d, deg), 'Set cant') : false;
      },
      setRootThickness: (cm) => {
        const d = get().design;
        return d ? commitChecked(setRootThickness(d, cm), 'Set thickness') : false;
      },
      setDepth: (cm) => {
        const d = get().design;
        return d ? commitChecked(setDepth(d, cm, finReadouts(d).depth), 'Set depth') : false;
      },
      setHand: (hand) => {
        const d = get().design;
        return d ? commitChecked(setHand(d, hand), 'Set side') : false;
      },
      applyNaca: (code) => {
        const d = get().design;
        return d ? commitChecked(applyNaca(d, code), `NACA ${code.trim()}`) : false;
      },
      setInsideFace: (kind) => {
        const d = get().design;
        return d
          ? commitChecked(
              setInsideFace(d, kind),
              kind === 'flat' ? 'Flat inside' : 'Symmetric foil',
            )
          : false;
      },
      nudgeFore: (dx) => {
        const d = get().design;
        return d ? commitChecked(nudgeFore(d, dx), 'Nudge fin') : false;
      },
      nudgeLateral: (dy) => {
        const d = get().design;
        return d ? commitChecked(nudgeLateral(d, dy), 'Nudge fin') : false;
      },

      undo: () => {
        const { past, future, design, selection } = get();
        if (past.length === 0 || !design) return;
        const prev = past[past.length - 1]!;
        set({
          design: prev.design,
          past: past.slice(0, -1),
          future: [{ design, label: prev.label }, ...future],
          editing: false,
          selection: validSelection(prev.design, selection),
        });
      },
      redo: () => {
        const { past, future, design, selection } = get();
        if (future.length === 0 || !design) return;
        const next = future[0]!;
        set({
          design: next.design,
          past: [...past, { design, label: next.label }],
          future: future.slice(1),
          editing: false,
          selection: validSelection(next.design, selection),
        });
      },
      canUndo: () => get().past.length > 0,
      canRedo: () => get().future.length > 0,
    };
  });
