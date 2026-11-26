// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { hasTailCutout, swallowSize } from '@openshaper/kernel';
import { parseBrd } from '@openshaper/io';
import { createBoardStore } from '@openshaper/store';
import { LENGTH_UNITS } from './format';
import { SwallowPanel } from './SwallowPanel';

const golden = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/specs/golden');
const shortboard = parseBrd(readFileSync(resolve(golden, 'shortboard.brd'), 'utf8')).board;
const mm = LENGTH_UNITS.find((u) => u.key === 'mm')!;

const open = () => {
  const store = createBoardStore();
  store.getState().load(shortboard);
  render(<SwallowPanel store={store} units={mm} />);
  return store;
};
const type = (label: RegExp | string, value: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value } });
  fireEvent.blur(field);
};

describe('<SwallowPanel />', () => {
  it('Apply notches the tail as typed, with the wall chosen', () => {
    const store = open();
    expect(screen.queryByRole('button', { name: 'Remove' })).toBeNull();
    type(/^Width/, '120');
    type(/^Depth/, '90');
    fireEvent.click(screen.getByRole('radio', { name: 'Rounded' }));
    type('Roundness', '60');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const b = store.getState().board!;
    expect(swallowSize(b.outline)!.width).toBeCloseTo(12, 6);
    expect(swallowSize(b.outline)!.depth).toBeCloseTo(9, 6);
    expect(b.swallow).toEqual({ kind: 'round', size: 0.6 });
    // The fields show the board's notch now, and it can be filled in again.
    expect((screen.getByLabelText(/^Depth/) as HTMLInputElement).value).toBe('90.0');
    fireEvent.click(screen.getByRole('button', { name: 'Remove' }));
    expect(hasTailCutout(store.getState().board!.outline)).toBe(false);
  });

  it('follows a drag of the deck line: the wall the board has', () => {
    const store = open();
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect((screen.getByLabelText('Bevel angle') as HTMLInputElement).value).toBe('45');
    act(() => store.getState().setSwallowWall({ kind: 'bevel', angle: 52.5 }));
    expect((screen.getByLabelText('Bevel angle') as HTMLInputElement).value).toBe('52.5');
  });

  it('says so when the notch is wider than the board', () => {
    open();
    type(/^Width/, '900');
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/never that wide/);
  });
});
