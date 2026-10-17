// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultFinDesign, finReadouts } from '@openshaper/kernel';
import { writeFinJson } from '@openshaper/io';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FinApp } from './FinApp';

// No WebGL under jsdom: the preview is checked in a real browser instead.
vi.mock('@openshaper/render3d', () => ({ FinPreview3D: () => null }));
import { finStore } from './fin-store';

beforeEach(() => {
  act(() => finStore.getState().load(defaultFinDesign('side', 'left')));
});

const measurements = () => within(screen.getByLabelText('Fin measurements'));
const overhang = () => finReadouts(finStore.getState().design!).frontOverhang;

/** Tests that build real geometry (STEP export, many pointer probes): CI runners are slower. */
const HEAVY = 20_000;

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

  it('swaps a small view into the large pane, bringing its controls with it', () => {
    localStorage.removeItem('bs.fin.views');
    render(<FinApp />);
    const pane = (name: string) => screen.getByRole('region', { name });
    expect(screen.getByLabelText(/^Depth/)).toBeTruthy(); // the profile is large
    expect(screen.queryByLabelText(/^Root thickness/)).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Show Thickness in the large pane' }));
    expect(screen.getByLabelText(/^Root thickness/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Depth/)).toBeNull();
    // The profile took the thickness view's place among the small panes.
    expect(pane('Thickness').dataset.slot).toBe('main');
    expect(pane('Profile').dataset.slot).toBe('small-2');
    expect(within(pane('Profile')).getByRole('button', { name: /in the large pane/ })).toBeTruthy();
    localStorage.removeItem('bs.fin.views');
  });

  it('keeps the 3D view’s controls under it when it is small', () => {
    localStorage.removeItem('bs.fin.views');
    render(<FinApp />);
    const threeD = within(screen.getByRole('region', { name: '3D' }));
    expect(threeD.getByRole('button', { name: 'Move the fin forward' })).toBeTruthy();
    expect(threeD.getByLabelText(/Cant/)).toBeTruthy();
  });

  it('adds, deletes and smooths points from the toolbar', () => {
    localStorage.removeItem('bs.fin.views');
    render(<FinApp />);
    const tools = within(screen.getByRole('region', { name: 'Profile' })).getByRole('group', {
      name: 'Point tools',
    });
    const button = (name: string) => within(tools).getByRole('button', { name });
    // Nothing selected: greyed out.
    expect((button('Add a point') as HTMLButtonElement).disabled).toBe(true);
    const n = finStore.getState().design!.outline.knots.length;
    act(() => finStore.getState().select({ curve: 'outline', index: 1, kind: 'end' }));
    fireEvent.click(button('Add a point'));
    expect(finStore.getState().design!.outline.knots).toHaveLength(n + 1);
    expect(finStore.getState().selection!.index).toBe(2); // the new point
    fireEvent.click(button('Corner'));
    expect(finStore.getState().design!.outline.knots[2]!.continuous).toBe(false);
    expect(button('Corner').getAttribute('aria-pressed')).toBe('true');
    fireEvent.click(button('Smooth'));
    expect(finStore.getState().design!.outline.knots[2]!.continuous).toBe(true);
    fireEvent.click(button('Delete the point'));
    expect(finStore.getState().design!.outline.knots).toHaveLength(n);
  });

  it('won’t delete or smooth a curve’s end point', () => {
    localStorage.removeItem('bs.fin.views');
    render(<FinApp />);
    act(() => finStore.getState().select({ curve: 'outline', index: 0, kind: 'end' }));
    const tools = within(screen.getByRole('region', { name: 'Profile' }));
    expect(
      (tools.getByRole('button', { name: 'Delete the point' }) as HTMLButtonElement).disabled,
    ).toBe(true);
    expect((tools.getByRole('button', { name: 'Smooth' }) as HTMLButtonElement).disabled).toBe(
      true,
    );
    expect((tools.getByRole('button', { name: 'Add a point' }) as HTMLButtonElement).disabled).toBe(
      false,
    );
  });

  it('adds a foil slice from the profile, edits it from its tab, and removes it', () => {
    localStorage.removeItem('bs.fin.views');
    render(<FinApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Add slice' }));
    const d = () => finStore.getState().design!;
    expect(d().slices).toHaveLength(1);
    expect(d().slices[0]!.height).toBe(0.5); // halfway up: the biggest gap
    // The foil view's tools come with it into the large pane.
    fireEvent.click(screen.getByRole('button', { name: 'Show Foil section in the large pane' }));
    const tabs = within(screen.getByRole('tablist', { name: 'Foil' }));
    expect(tabs.getAllByRole('tab').map((t) => t.textContent)).toEqual(['Root', '50.0 mm']);
    expect(tabs.getByRole('tab', { name: '50.0 mm' }).getAttribute('aria-selected')).toBe('true');
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: '0008' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(d().slices[0]!.section.inside).toBeNull(); // the slice took the NACA foil
    expect(d().section.inside).not.toBeNull(); // the root kept its flat inside
    fireEvent.click(tabs.getByRole('tab', { name: 'Root' }));
    expect(finStore.getState().activeFoil).toBe(0);
    fireEvent.click(tabs.getByRole('tab', { name: '50.0 mm' }));
    fireEvent.click(screen.getByRole('button', { name: 'Remove slice' }));
    expect(d().slices).toHaveLength(0);
    expect(screen.queryByRole('tablist', { name: 'Foil' })).toBeNull();
    localStorage.removeItem('bs.fin.views');
  });

  it('moves a fin onto the FCS single tab: centred, cant set by the plug', () => {
    render(<FinApp />);
    fireEvent.change(screen.getByLabelText('Base'), { target: { value: 'fcs-single' } });
    const d = finStore.getState().design!;
    expect(d.base).toBe('fcs-single');
    expect(d.cant).toBe(0);
    expect((screen.getByLabelText(/^Cant/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.getByText(/on FCS single tab \(20\.5 mm × 13\.5 mm\)/)).toBeTruthy();
    expect(screen.queryByRole('status')).toBeNull(); // no rule broken
    fireEvent.change(screen.getByLabelText('Base'), { target: { value: 'futures-side' } });
    expect((screen.getByLabelText(/^Cant/) as HTMLInputElement).disabled).toBe(false);
  });

  it('starts a canard on the FCS single tab', () => {
    render(<FinApp />);
    const menu = screen.getByLabelText('Start a new fin') as HTMLSelectElement;
    const i = [...menu.options].findIndex((o) => o.text === 'Canard, right (FCS single tab)');
    fireEvent.change(menu, { target: { value: String(i - 1) } }); // after the disabled prompt
    const d = finStore.getState().design!;
    expect(d.base).toBe('fcs-single');
    expect(d.hand).toBe('right');
    expect((screen.getByLabelText(/^Cant/) as HTMLInputElement).disabled).toBe(true);
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('lists the rules the design breaks', () => {
    act(() => finStore.getState().load({ ...defaultFinDesign('side', 'left'), cant: 30 }));
    render(<FinApp />);
    expect(screen.getByRole('status').textContent).toMatch(/Cant must be 0–20°/);
  });
});

describe('FinApp: files', () => {
  afterEach(() => vi.restoreAllMocks());

  it('saves the fin to a .fin.json download, from the button and ⌘S', () => {
    URL.createObjectURL = vi.fn(() => 'blob:fin');
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    render(<FinApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    fireEvent.keyDown(window, { key: 's', metaKey: true });
    expect(names).toEqual(['fin-side-left.fin.json', 'fin-side-left.fin.json']);
  });

  it('opens a .fin.json file, replacing the fin', async () => {
    render(<FinApp />);
    const file = new File([writeFinJson(defaultFinDesign('centre'))], 'centre.fin.json');
    fireEvent.change(screen.getByLabelText('Open a fin file'), { target: { files: [file] } });
    await waitFor(() => expect(finStore.getState().design!.position).toBe('centre'));
    expect(finStore.getState().canUndo()).toBe(false); // opening starts a fresh history
  });

  it('explains a file it cannot open', async () => {
    render(<FinApp />);
    const file = new File(['{"format":"openshaper","version":2}'], 'board.board.json');
    fireEvent.change(screen.getByLabelText('Open a fin file'), { target: { files: [file] } });
    await waitFor(() =>
      expect(screen.getByRole('alert').textContent).toMatch(/can't be opened as a fin/),
    );
    expect(finStore.getState().design!.position).toBe('side');
  });
});

describe('FinApp: export', () => {
  afterEach(() => vi.restoreAllMocks());

  const captureDownloads = () => {
    URL.createObjectURL = vi.fn(() => 'blob:fin');
    URL.revokeObjectURL = vi.fn();
    const names: string[] = [];
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
      this: HTMLAnchorElement,
    ) {
      names.push(this.download);
    });
    return names;
  };

  it('exports STEP and STL, named after the fin', async () => {
    const names = captureDownloads();
    render(<FinApp />);
    fireEvent.click(screen.getByRole('button', { name: 'Export STL' }));
    await waitFor(() => expect(names).toEqual(['fin-side-left.stl']));
    fireEvent.click(screen.getByRole('button', { name: 'Export STEP' }));
    await waitFor(() => expect(names).toEqual(['fin-side-left.stl', 'fin-side-left.step']), {
      timeout: 10_000,
    });
  }, 20_000);

  it(
    'is unavailable while the fin breaks a rule',
    () => {
      act(() => finStore.getState().load({ ...defaultFinDesign('side', 'left'), cant: 30 }));
      render(<FinApp />);
      expect(
        (screen.getByRole('button', { name: 'Export STEP' }) as HTMLButtonElement).disabled,
      ).toBe(true);
      expect(
        (screen.getByRole('button', { name: 'Export STL' }) as HTMLButtonElement).disabled,
      ).toBe(true);
    },
    HEAVY,
  );
});
