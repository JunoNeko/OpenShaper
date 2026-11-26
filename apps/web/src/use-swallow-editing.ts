// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A swallow tail in the outline view (print version): the deck line, dashed, and its
 * point on the stringer to drag.
 *
 * The notch is the outline's own points (the stringer point sets the depth, the tip's
 * handle curves it), so only the deck line is drawn here. Dragging its point along the
 * stringer sets the inside wall's angle or roundness that puts it there
 * (`wallForDeckApex`). A drag is worked from the board as it found it, and is one undo
 * step (`SplineEditor` brackets it).
 */
import {
  swallowDeckApex,
  swallowDeckLine,
  swallowSize,
  wallForDeckApex,
  type BezierBoard,
  type Vec2,
} from '@openshaper/kernel';
import { useCallback, useMemo, useRef } from 'react';
import { boardStore } from './store';

/** The id of the deck line's point among the outline's draggable keys. */
export const SWALLOW_KEY = 'sw:deck';
/**
 * Closer than this (cm) to the stringer point, the deck line's point isn't offered: it
 * would cover that point, which sets the depth. An upright wall is set from the panel.
 */
const MIN_KEY_GAP = 0.3;

export function useSwallowEditing(board: BezierBoard | null) {
  const outline = board?.outline;
  const deck = board?.deck;
  const bottom = board?.bottom;
  const wall = board?.swallow;

  const drawn = useMemo(() => {
    if (!outline || !deck || !bottom || !wall) return null;
    const b = { outline, deck, bottom, swallow: wall };
    const apex = swallowDeckApex(b);
    const depth = swallowSize(outline)?.depth;
    if (apex === null || depth === undefined) return null;
    const keys: { id: string; p: Vec2; square: boolean }[] =
      apex - depth >= MIN_KEY_GAP ? [{ id: SWALLOW_KEY, p: { x: apex, y: 0 }, square: true }] : [];
    return { line: swallowDeckLine(b), keys };
  }, [outline, deck, bottom, wall]);

  const held = useRef<{ board: BezierBoard; apex: number } | null>(null);

  const onSwallowKeyDrag = useCallback((delta: Vec2, phase: 'start' | 'move') => {
    const b = boardStore.getState().board;
    if (phase === 'start') {
      const apex = b?.swallow ? swallowDeckApex(b) : null;
      held.current = b && apex !== null ? { board: b, apex } : null;
      return;
    }
    const h = held.current;
    if (!h) return;
    const next = wallForDeckApex(h.board, h.apex + delta.x);
    if (next) boardStore.getState().setSwallowWall(next);
  }, []);

  return {
    dashedLines: drawn ? [drawn.line] : undefined,
    keys: drawn?.keys,
    onSwallowKeyDrag,
  };
}
