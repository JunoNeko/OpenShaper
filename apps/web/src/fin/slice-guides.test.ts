// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultFinDesign, finReadouts } from '@openshaper/kernel';
import { createFinStore } from '@openshaper/store';
import { describe, expect, it } from 'vitest';
import { sliceGuideHandlers } from './slice-guides';

describe('sliceGuideHandlers', () => {
  it('keeps dragging the same slice after it passes another and is renumbered', () => {
    const store = createFinStore();
    store.getState().load(defaultFinDesign('side', 'right'));
    store.getState().addSlice(0.3);
    store.getState().applyNaca('0008'); // its own foil, to tell it from the other
    store.getState().addSlice(0.7);
    store.getState().setActiveFoil(0);
    const depth = finReadouts(store.getState().design!).depth;
    const on = sliceGuideHandlers(store, 'y');
    // The editor reports the guide it grabbed ('1') for the whole drag.
    on.onGuideSelect('1');
    on.onGuideDragStart();
    on.onGuideDrag('1', 0.8 * depth); // past the slice at 0.7: now the second slice
    on.onGuideDrag('1', 0.9 * depth);
    on.onGuideDragEnd();
    const slices = store.getState().design!.slices;
    expect(slices.map((sl) => sl.height)).toEqual([0.7, 0.9]);
    // The slice grabbed, not the one it passed: its symmetric 0008 went with it.
    expect(slices[1]!.section.inside).toBeNull();
    expect(slices[0]!.section.inside).not.toBeNull();
    expect(store.getState().activeFoil).toBe(2);
  });
});
