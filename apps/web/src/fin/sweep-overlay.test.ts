// SPDX-License-Identifier: GPL-3.0-or-later
import {
  chordAt,
  defaultFinDesign,
  prepareBlade,
  sweepGrid,
  sweepPointOn,
  thicknessAt,
  tipLineOf,
} from '@openshaper/kernel';
import { createFinStore } from '@openshaper/store';
import { describe, expect, it } from 'vitest';
import { foilTrueScale } from './FinSectionPane';
import { sweepMarkerHandlers, sweepOverlay, thicknessPathOf } from './sweep-overlay';

describe('the foil sweep over the profile', () => {
  it('draws the base, the tip line and the thickness path between them, with handles', () => {
    const d = defaultFinDesign('side', 'left');
    const o = sweepOverlay(d);
    // The base starts at the leading-edge root, on the tab top.
    expect(o.base[0]!.y).toBeCloseTo(0, 9);
    // The path runs from the base up to the tip line.
    expect(o.path[0]!.y).toBeCloseTo(0, 6);
    const tipMid = o.tip[Math.floor(o.tip.length / 2)]!;
    expect(o.path[o.path.length - 1]!.y).toBeGreaterThan(0.8 * tipMid.y);
    expect(o.markers.map((m) => m.id)).toEqual([
      'tip-start',
      'tip-end',
      'path-0',
      'path-1',
      'path-2',
    ]);
    expect(o.sliceIntoTip).toBe(false);
  });

  it('shades the tip when a slice sits above the tip line', () => {
    const d = defaultFinDesign('side', 'left');
    const high = { ...d, slices: [{ height: 0.97, section: d.section }] };
    expect(sweepOverlay(high).sliceIntoTip).toBe(true);
  });

  it('moves the tip line and the thickness path by dragging, one undo step each', () => {
    const store = createFinStore();
    store.getState().load(defaultFinDesign('side', 'left'));
    const h = sweepMarkerHandlers(store);
    const d0 = store.getState().design!;
    const before = tipLineOf(d0);
    // Drag the tip line's front end down the leading edge.
    const g0 = sweepGrid(d0);
    const lower = sweepPointOn(g0, g0.tipRow * 0.85, 0);
    h.onMarkerDragStart('tip-start');
    h.onMarkerDrag('tip-start', lower);
    h.onMarkerDragEnd();
    expect(store.getState().design!.tipLine!.start).toBeLessThan(before.start);
    expect(store.getState().past.at(-1)!.label).toBe('Move the tip line');
    // Drag the base point of the thickness path toward the leading edge.
    const d1 = store.getState().design!;
    const g1 = sweepGrid(d1);
    h.onMarkerDragStart('path-0');
    h.onMarkerDrag('path-0', sweepPointOn(g1, 0, 0.25));
    h.onMarkerDragEnd();
    expect(thicknessPathOf(store.getState().design!)[0]).toBeCloseTo(0.25, 2);
    expect(store.getState().past.at(-1)!.label).toBe('Move the thickness path');
  });
});

describe('the foil view, true to scale', () => {
  it('draws the root foil as thick for its chord as the taper makes it', () => {
    const d = defaultFinDesign('side', 'left');
    const b = prepareBlade(d);
    const { leading, trailing } = chordAt(b, 0);
    // The drawn shape, stretched by the scale, has the root's real thickness over chord.
    const k = foilTrueScale(d, 0);
    expect(k * b.shapeThickness).toBeCloseTo(thicknessAt(b, 0) / (leading - trailing), 9);
  });
});
