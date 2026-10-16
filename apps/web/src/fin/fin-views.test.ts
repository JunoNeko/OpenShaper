// SPDX-License-Identifier: GPL-3.0-or-later
import { afterEach, describe, expect, it } from 'vitest';
import { FIN_VIEWS, readViewOrder, swapIntoMain, writeViewOrder } from './fin-views';

afterEach(() => localStorage.clear());

describe('swapIntoMain', () => {
  it('trades the large view with the chosen small one', () => {
    expect(swapIntoMain(FIN_VIEWS, 3)).toEqual(['3d', 'foil', 'taper', 'outline']);
    expect(swapIntoMain(swapIntoMain(FIN_VIEWS, 3), 3)).toEqual(FIN_VIEWS);
  });

  it('ignores a slot that is not a small pane', () => {
    expect(swapIntoMain(FIN_VIEWS, 0)).toBe(FIN_VIEWS);
    expect(swapIntoMain(FIN_VIEWS, 4)).toBe(FIN_VIEWS);
  });
});

describe('the remembered order', () => {
  it('starts with the profile large', () => {
    expect(readViewOrder()[0]).toBe('outline');
  });

  it('comes back as it was left', () => {
    writeViewOrder(['taper', 'foil', 'outline', '3d']);
    expect(readViewOrder()).toEqual(['taper', 'foil', 'outline', '3d']);
  });

  it('falls back to the default if what is stored is not an order of the four views', () => {
    localStorage.setItem('bs.fin.views', JSON.stringify(['outline', 'outline', 'foil', '3d']));
    expect(readViewOrder()).toEqual(FIN_VIEWS);
  });
});
