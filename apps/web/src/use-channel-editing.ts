// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Bottom channels in the 2D views (print version): what each pane draws of them and the
 * points it lets the person drag, once they are applied (`channel-apply.ts`).
 *
 * - **Cross-section:** the cut, and a point on each wall and at each channel's deepest.
 *   Dragging a wall point moves the wall across; a depth point sets that channel's depth.
 * - **Outline:** the walls in plan, with a point at each end and every cross-section.
 *   Dragging one moves the wall across there: curved channels, drawn in plan.
 * - **Rocker:** the depth along the board above the bottom, with a point at each end and
 *   every cross-section. Dragging one deepens every channel there.
 *
 * Every edit eases out to the cross-sections either side. A drag is worked from the
 * channels as it found them, so moves never accumulate error, and is one undo step
 * (`SplineEditor` brackets it).
 */
import {
  boardChannels,
  channelCut,
  channelDepthKeys,
  channelDepthLine,
  channelKeys,
  channelPlanLines,
  moveChannelDepths,
  moveChannelKey,
  valueAt,
  type BezierBoard,
  type BoardChannels,
  type ChannelKeyPart,
  type Vec2,
} from '@openshaper/kernel';
import { useCallback, useMemo, useRef } from 'react';
import { boardStore } from './store';

type Pane = 'outline' | 'rocker' | 'crossSection';
type Drawn = Extract<BoardChannels, { from: 'drawn' }>;
type Key = { id: string; p: Vec2 };

/** What a drag holds on to: the channels as it found them and what it is moving. */
type Held =
  | {
      kind: 'wall' | 'depth1';
      channels: Drawn;
      x: number;
      k: number;
      part: ChannelKeyPart;
      joined?: number;
      value: number;
      /** Which way of the pointer's movement changes the value. */
      axis: 'x' | 'y';
    }
  | { kind: 'depthAll'; channels: Drawn; x: number };

/** The real cross-sections' positions (not the end dummies). */
const stationsOf = (b: BezierBoard) => b.crossSections.slice(1, -1).map((cs) => cs.position);

export function useChannelEditing(board: BezierBoard | null, sectionX: number | null) {
  const applied = board?.channels?.from === 'drawn' ? board.channels : null;

  const sectionCut = useMemo(
    () => (board && sectionX !== null ? channelCut(board, sectionX) : null),
    [board, sectionX],
  );

  const lines = useMemo(() => {
    const cs = board ? boardChannels(board) : [];
    if (!board || !cs.length) return null;
    return {
      // Applied walls are drawn and edited in the outline view as curves of their own
      // (`channelTargets`): lines only for channels still typed in.
      outline: applied ? [] : channelPlanLines(cs),
      rocker: [channelDepthLine(cs, (x) => valueAt(board.bottom, x))],
    };
  }, [board, applied]);

  const keys = useMemo(() => {
    if (!board || !applied) return null;
    const cs = applied.channels;
    const stations = stationsOf(board);
    const out: Record<Pane, Key[]> = {
      crossSection:
        sectionX === null
          ? []
          : channelKeys(board, sectionX).map((k) => ({ id: `cs:${k.id}`, p: k.p })),
      // Walls in plan are edited with points and handles, as targets of the outline view.
      outline: [],
      rocker: channelDepthKeys(cs, stations).map((k) => ({
        id: `rk:${k.id}`,
        p: { x: k.x, y: valueAt(board.bottom, k.x) + k.value },
      })),
    };
    return out;
  }, [board, applied, sectionX]);

  const sectionXRef = useRef(sectionX);
  sectionXRef.current = sectionX;
  const held = useRef<Held | null>(null);

  const onChannelKeyDrag = useCallback(
    (id: string, delta: { x: number; y: number }, phase: 'start' | 'move') => {
      const b = boardStore.getState().board;
      if (!b || b.channels?.from !== 'drawn') {
        held.current = null;
        return;
      }
      const stations = stationsOf(b);
      if (phase === 'start') {
        held.current = grab(b, b.channels, id, stations, sectionXRef.current);
        return;
      }
      const h = held.current;
      if (!h) return;
      const channels =
        h.kind === 'depthAll'
          ? moveChannelDepths(h.channels.channels, h.x, delta.y, stations)
          : moveChannelKey(
              h.channels.channels,
              h.x,
              h.k,
              h.part,
              h.value + delta[h.axis],
              stations,
              h.joined,
            );
      boardStore.getState().setChannels({ ...h.channels, channels });
    },
    [],
  );

  return {
    sectionCut,
    linesFor: (pane: Pane) =>
      pane === 'outline' ? lines?.outline : pane === 'rocker' ? lines?.rocker : undefined,
    keysFor: (pane: Pane) => keys?.[pane],
    onChannelKeyDrag,
  };
}

/** What the point `id` is, on the board as a drag starts. */
const grab = (
  b: BezierBoard,
  channels: Drawn,
  id: string,
  stations: readonly number[],
  sectionX: number | null,
): Held | null => {
  const [pane, key] = [id.slice(0, 3), id.slice(3)];
  if (pane === 'cs:') {
    if (sectionX === null) return null;
    const k = channelKeys(b, sectionX).find((q) => q.id === key);
    if (!k) return null;
    return {
      kind: k.part === 'depth' ? 'depth1' : 'wall',
      channels,
      x: sectionX,
      k: k.k,
      part: k.part,
      ...(k.joined !== undefined ? { joined: k.joined } : {}),
      value: k.value,
      axis: k.part === 'depth' ? 'y' : 'x',
    };
  }
  if (pane === 'rk:') {
    const k = channelDepthKeys(channels.channels, stations).find((q) => q.id === key);
    return k ? { kind: 'depthAll', channels, x: k.x } : null;
  }
  return null;
};
