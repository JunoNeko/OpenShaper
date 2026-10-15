// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultFinDesign, finReadouts } from '@openshaper/kernel';
import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { FinApp } from './FinApp';
import { finStore } from './fin-store';

beforeEach(() => {
  act(() => finStore.getState().load(defaultFinDesign('side', 'left')));
});

const measurements = () => within(screen.getByLabelText('Fin measurements'));
const overhang = () => finReadouts(finStore.getState().design!).frontOverhang;

describe('FinApp', () => {
  it('shows the fin’s measurements in mm', () => {
    render(<FinApp />);
    expect(screen.getByRole('heading', { name: 'Fin designer' })).toBeTruthy();
    expect(measurements().getByText(/mm²$/)).toBeTruthy();
    expect(measurements().getByText('49.8°')).toBeTruthy(); // the default sweep
  });

  it('starts a new fin from the picker, undoably', () => {
    render(<FinApp />);
    fireEvent.change(screen.getByLabelText('Start a new fin'), { target: { value: '4' } }); // Centre
    expect(finStore.getState().design!.position).toBe('centre');
    expect(screen.queryByLabelText(/Cant/)).toBeNull(); // a centre fin has no cant
    fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
    expect(finStore.getState().design!.position).toBe('side');
  });

  it('switches the side', () => {
    render(<FinApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Right' }));
    expect(finStore.getState().design!.hand).toBe('right');
    expect(screen.getByRole('button', { name: 'Right' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('nudges the fin with the arrow buttons and the arrow keys', () => {
    render(<FinApp />);
    const before = overhang();
    fireEvent.click(screen.getByRole('button', { name: 'Move the fin forward' }));
    expect(overhang()).toBeCloseTo(before + 0.05, 9);
    fireEvent.keyDown(window, { key: 'ArrowRight' });
    expect(overhang()).toBeCloseTo(before + 0.1, 9);
    fireEvent.keyDown(window, { key: 'ArrowUp' });
    expect(finStore.getState().design!.lateralOffset).toBeCloseTo(0.01, 12);
    fireEvent.keyDown(window, { key: 'z', metaKey: true });
    expect(finStore.getState().design!.lateralOffset).toBe(0);
  });

  it('clamps the cant field to the allowed range', () => {
    render(<FinApp />);
    const field = screen.getByLabelText(/Cant/);
    fireEvent.change(field, { target: { value: '35' } });
    fireEvent.keyDown(field, { key: 'Enter' });
    expect(finStore.getState().design!.cant).toBe(20);
  });

  it('lists the rules the design breaks', () => {
    act(() => finStore.getState().load({ ...defaultFinDesign('side', 'left'), cant: 30 }));
    render(<FinApp />);
    expect(screen.getByRole('status').textContent).toMatch(/Cant must be 0–20°/);
  });
});
