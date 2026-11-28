// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  applyChannels,
  boardChannels,
  defaultChannelParams,
  valueAt,
  type BezierBoard,
} from '@openshaper/kernel';
import { parseBrd } from '@openshaper/io';
import { boardStore } from './store';
import { useChannelEditing } from './use-channel-editing';

const golden = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/specs/golden');
const board = () => boardStore.getState().board!;
const stations = (b: BezierBoard) => b.crossSections.slice(1, -1).map((cs) => cs.position);

beforeEach(() => {
  act(() => {
    boardStore.getState().load(parseBrd(readFileSync(resolve(golden, 'shortboard.brd'), 'utf8')).board); // prettier-ignore
    const b = board();
    const x = b.crossSections[2]!.position;
    const p = { ...defaultChannelParams(b, x), follow: 0 };
    boardStore.getState().setChannels(applyChannels(b, p, stations(b)), 'Apply channels');
  });
});

/** Drag point `id` by `delta`, one undo step, as `SplineEditor` does. */
const drag = (
  onDrag: ReturnType<typeof useChannelEditing>['onChannelKeyDrag'],
  id: string,
  delta: { x: number; y: number },
) =>
  act(() => {
    boardStore.getState().beginEdit('Edit channels');
    onDrag(id, { x: 0, y: 0 }, 'start');
    onDrag(id, delta, 'move');
    boardStore.getState().endEdit();
  });

describe('useChannelEditing', () => {
  it("draws the depth on the rocker with points; applied walls are the outline view's own curves", () => {
    const b = board();
    const { result } = renderHook(() => useChannelEditing(b, b.crossSections[2]!.position));
    // Applied walls are edited as curves of the outline view (`channelTargets`), not
    // drawn or pointed here.
    expect(result.current.linesFor('outline')).toEqual([]);
    expect(result.current.keysFor('outline')).toEqual([]);
    expect(result.current.linesFor('rocker')).toHaveLength(1);
    expect(result.current.keysFor('rocker')!.length).toBeGreaterThan(0);
    expect(result.current.keysFor('crossSection')!.map((k) => k.id)).toContain('cs:o1');
    expect(result.current.sectionCut).not.toBeNull();
  });

  it('moves a wall across on the cross-section, one undo step', () => {
    const b = board();
    const x = b.crossSections[2]!.position;
    const before = valueAt(boardChannels(b)[1]!.outer, x);
    const { result } = renderHook(() => useChannelEditing(b, x));
    drag(result.current.onChannelKeyDrag, 'cs:o1', { x: 1.5, y: 5 });
    const c = boardChannels(board())[1]!;
    expect(valueAt(c.outer, x)).toBeCloseTo(before + 1.5, 6); // across only
    expect(
      boardStore
        .getState()
        .past.map((h) => h.label)
        .slice(-1),
    ).toEqual(['Edit channels']);
  });

  it('deepens every channel from the rocker', () => {
    const b = board();
    const x = b.crossSections[2]!.position;
    const before = boardChannels(b).map((c) => valueAt(c.depth, x));
    const { result } = renderHook(() => useChannelEditing(b, x));
    const key = result.current.keysFor('rocker')!.find((k) => Math.abs(k.p.x - x) < 1e-6)!;
    drag(result.current.onChannelKeyDrag, key.id, { x: 0, y: 0.3 });
    boardChannels(board()).forEach((c, i) => {
      expect(valueAt(c.depth, x)).toBeCloseTo(before[i]! + 0.3, 6);
    });
  });

  it("sets one channel's depth on the cross-section", () => {
    const b = board();
    const x = b.crossSections[2]!.position;
    const before = boardChannels(b).map((c) => valueAt(c.depth, x));
    const { result } = renderHook(() => useChannelEditing(b, x));
    drag(result.current.onChannelKeyDrag, 'cs:d0', { x: 3, y: 0.2 });
    const after = boardChannels(board()).map((c) => valueAt(c.depth, x));
    expect(after[0]).toBeCloseTo(before[0]! + 0.2, 6);
    expect(after[1]).toBeCloseTo(before[1]!, 9);
  });
});
