// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { boardChannels } from '@openshaper/kernel';
import { parseBrd } from '@openshaper/io';
import { createBoardStore } from '@openshaper/store';
import { ChannelPanel } from './ChannelPanel';
import { LENGTH_UNITS } from './format';
import { longitudinalFor } from './longitudinal';

const golden = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/specs/golden');
const shortboard = () => parseBrd(readFileSync(resolve(golden, 'shortboard.brd'), 'utf8')).board;
const mm = LENGTH_UNITS.find((u) => u.key === 'mm')!;

const setup = (index = 2) => {
  const store = createBoardStore();
  act(() => store.getState().load(shortboard()));
  const longitudinal = longitudinalFor(null, 'x-axis');
  const view = render(
    <ChannelPanel store={store} units={mm} longitudinal={longitudinal} section={{ index }} />,
  );
  return { store, view, longitudinal };
};
const params = (store: ReturnType<typeof createBoardStore>) => {
  const c = store.getState().board!.channels;
  if (c?.from !== 'numbers') throw new Error('no typed-in channels');
  return c.params;
};
const typeInto = (label: RegExp, text: string) => {
  const field = screen.getByLabelText(label);
  fireEvent.change(field, { target: { value: text } });
  fireEvent.blur(field);
};
const add = () => fireEvent.click(screen.getByRole('button', { name: 'Add channels' }));

describe('<ChannelPanel />', () => {
  it('adds four channels laid out from the selected cross-section, one undo step', () => {
    const { store } = setup();
    add();
    const b = store.getState().board!;
    expect(params(store).count).toBe(4);
    expect(params(store).station).toBe(b.crossSections[2]!.position);
    expect(boardChannels(b)).toHaveLength(2);
    expect(screen.queryByRole('alert')).toBeNull();
    expect(store.getState().past.map((h) => h.label)).toEqual(['Add channels']);
  });

  it('takes lengths in the chosen unit and recuts the channels', () => {
    const { store } = setup();
    add();
    typeInto(/^Depth/, '3');
    expect(params(store).depth).toBeCloseTo(0.3, 9);
    typeInto(/^Width/, '40');
    expect(params(store).width).toBeCloseTo(4, 9);
    fireEvent.change(screen.getByTitle('How many channels, across the whole board'), {
      target: { value: '5' },
    });
    expect(boardChannels(store.getState().board!)).toHaveLength(3);
    // An odd count starts on the stringer: no offset to set.
    expect((screen.getByLabelText(/^Stringer offset/) as HTMLInputElement).disabled).toBe(true);
  });

  it("sets a step's two radii, and has none for a wave", () => {
    const { store } = setup();
    add();
    typeInto(/^Radius top/, '2');
    typeInto(/^Radius bottom/, '1');
    expect(params(store).wall).toEqual({ shape: 'step', radius: 0.2, lip: 0.1 });
    fireEvent.click(screen.getByRole('radio', { name: 'Wave' }));
    expect(params(store).wall).toEqual({ shape: 'wave' });
    expect((screen.getByLabelText(/^Radius top/) as HTMLInputElement).disabled).toBe(true);
    // Back to a step: a wave had no radii to keep, so a fresh one.
    fireEvent.click(screen.getByRole('radio', { name: 'Step, deepest at the rail side' }));
    expect(params(store).wall).toEqual({ shape: 'step', radius: 0, lip: 0.5 });
  });

  it('turns a step round to the stringer, keeping its radii, and back', () => {
    const { store } = setup();
    add();
    typeInto(/^Radius top/, '2');
    fireEvent.click(screen.getByRole('radio', { name: 'Step, deepest at the stringer side' }));
    expect(params(store).wall).toEqual({ shape: 'step', radius: 0.2, lip: 0.5, deepAt: 'stringer' }); // prettier-ignore
    expect(screen.getByRole('radio', { name: 'Step, deepest at the stringer side' }).getAttribute('aria-checked')).toBe('true'); // prettier-ignore
    expect((screen.getByLabelText(/^Radius top/) as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByRole('radio', { name: 'Step, deepest at the rail side' }));
    expect(params(store).wall).toEqual({ shape: 'step', radius: 0.2, lip: 0.5 });
  });

  it('moves the ends and the blend with the keyboard, one undo step a press', () => {
    const { store } = setup();
    add();
    const before = params(store);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'End' }), { key: 'ArrowLeft' });
    expect(params(store).end).toBeLessThan(before.end);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Follow the rail' }), { key: 'ArrowLeft', shiftKey: true }); // prettier-ignore
    expect(params(store).follow).toBeCloseTo(Math.max(0, before.follow - 0.05), 9);
    fireEvent.keyDown(screen.getByRole('slider', { name: 'Full depth to' }), { key: 'ArrowLeft' });
    expect(params(store).fullTo).toBeLessThan(before.fullTo);
    expect(store.getState().past.map((h) => h.label)).toEqual([
      'Add channels',
      'Edit channels',
      'Edit channels',
      'Edit channels',
    ]);
  });

  it("draws the depth blend over the channels' length, full depth between its handles", () => {
    const { store } = setup();
    add();
    const p = params(store);
    const share = (x: number) => Math.round(((x - p.start) / (p.end - p.start)) * 100);
    const from = screen.getByRole('slider', { name: 'Full depth from' });
    const to = screen.getByRole('slider', { name: 'Full depth to' });
    // The default runs full depth out through the start: that handle sits at the bar's end.
    expect(from.getAttribute('aria-valuenow')).toBe('0');
    expect(to.getAttribute('aria-valuenow')).toBe(String(share(p.fullTo)));
    expect(screen.getByTestId('slider-band').getAttribute('style')).toMatch(/linear-gradient/);
    // The handles can't pass each other.
    for (let i = 0; i < 40; i++) fireEvent.keyDown(from, { key: 'ArrowRight', shiftKey: true });
    expect(params(store).fullFrom).toBe(params(store).fullTo);
  });

  it('keeps full depth inside the channels as their ends move', () => {
    const { store } = setup();
    add();
    const end = screen.getByRole('slider', { name: 'End' });
    for (let i = 0; i < 60; i++) fireEvent.keyDown(end, { key: 'ArrowLeft', shiftKey: true });
    const p = params(store);
    expect(p.fullTo).toBeLessThanOrEqual(p.end);
    expect(p.fullFrom).toBe(p.start); // still full depth out through the start
  });

  it('offers to lay them out from the cross-section on show', () => {
    const { store, view, longitudinal } = setup();
    add();
    view.rerender(
      <ChannelPanel store={store} units={mm} longitudinal={longitudinal} section={{ index: 1 }} />,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Lay out from cross-section 1' }));
    expect(params(store).station).toBe(store.getState().board!.crossSections[1]!.position);
  });

  it('applies them as editable, shows them at the cross-section, and resets to the numbers', () => {
    const { store } = setup();
    add();
    const numbers = store.getState().board!.channels;
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const applied = store.getState().board!.channels;
    expect(applied?.from).toBe('drawn');
    // The numbers' fields give way to what the channels are at the cross-section on show.
    expect(screen.queryByLabelText(/^Width/)).toBeNull();
    const rows = screen.getAllByRole('row');
    expect(rows).toHaveLength(3); // a header and two channels a side
    expect(rows[1]!.textContent).toMatch(/^1/);
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(store.getState().board!.channels).toEqual(numbers);
    expect(store.getState().past.map((h) => h.label)).toEqual([
      'Add channels',
      'Apply channels',
      'Reset channels',
    ]);
  });

  it('says what is wrong, and removes them', () => {
    const { store } = setup();
    add();
    typeInto(/^Width/, '200');
    expect(screen.getByRole('alert').textContent).toMatch(/runs off the bottom/);
    fireEvent.click(screen.getByRole('button', { name: 'Remove channels' }));
    expect(store.getState().board!.channels).toBeUndefined();
    expect(screen.getByRole('button', { name: 'Add channels' })).toBeTruthy();
  });
});
