// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The section and taper panes, wired to the fin store: real pointer events on the
 * panes' canvases, checked in the store. Picking and drag maths are tested in
 * render2d; the store's clamping in store/fin-store.test.ts.
 */
import { defaultFinDesign, FIN_MIN_THICKNESS } from '@openshaper/kernel';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { lengthUnitByKey } from '../format';
import { MOUSE, installLayoutStubs, pane, removeLayoutStubs } from '../test/spline-editor-harness';
import { FinOutlinePane } from './FinOutlinePane';
import { FinSectionPane, FinSectionTools } from './FinSectionPane';
import { FinTaperPane } from './FinTaperPane';
import { finStore } from './fin-store';

beforeEach(installLayoutStubs);
afterEach(removeLayoutStubs);

const design = () => finStore.getState().design!;

/** Tests that build real geometry (STEP export, many pointer probes): CI runners are slower. */
const HEAVY = 20_000;

describe('FinSectionTools', () => {
  beforeEach(() => act(() => finStore.getState().load(defaultFinDesign('side', 'right'))));

  it('applies a NACA preset to the section', () => {
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: '2412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(design().section.inside).not.toBeNull();
    expect(finStore.getState().past.at(-1)!.label).toBe('NACA 2412');
  });

  it('offers every preset again after one is applied', () => {
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: '2412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    const options = screen.getAllByRole('option').map((o) => o.textContent);
    expect(options).toContain('0010');
    expect(options).toContain('6409');
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: '0010' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(finStore.getState().past.at(-1)!.label).toBe('NACA 0010');
  });

  it('takes any other 4-digit code', () => {
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '3415' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(finStore.getState().past.at(-1)!.label).toBe('NACA 3415');
  });

  it('explains a code it cannot use', () => {
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/NACA 4-digit code/);
    expect(finStore.getState().canUndo()).toBe(false);
  });

  it('keeps a centre fin symmetric', () => {
    act(() => finStore.getState().load(defaultFinDesign('centre')));
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    expect(screen.queryByRole('button', { name: 'Flat inside' })).toBeNull();
    expect(screen.queryByRole('option', { name: '2412' })).toBeNull(); // only 00xx offered
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '2412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/symmetric/);
    expect(design().section.inside).toBeNull();
  });

  it('switches a side fin between symmetric and flat inside', () => {
    render(<FinSectionTools store={finStore} units={lengthUnitByKey('mm')} />);
    fireEvent.click(screen.getByRole('button', { name: 'Symmetric' }));
    expect(design().section.inside).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Flat inside' }));
    expect(design().section.inside).not.toBeNull();
  });
});

describe('dragging in the panes', () => {
  beforeEach(() => act(() => finStore.getState().load(defaultFinDesign('side', 'right'))));

  /**
   * Find a data point's client position by clicking candidates until the store
   * selects it: the panes don't expose their view, and a test that re-derives the
   * fit would only check the fit against itself.
   */
  const grab = (canvas: HTMLElement, curve: string, index: number) => {
    for (let y = 0; y < pane.h; y += 4) {
      for (let x = 0; x < pane.w; x += 4) {
        fireEvent.pointerDown(canvas, { ...MOUSE, clientX: x, clientY: y });
        const sel = finStore.getState().selection;
        if (sel?.curve === curve && sel.index === index && (sel.kind ?? 'end') === 'end') {
          return { clientX: x, clientY: y };
        }
        fireEvent.pointerUp(canvas, { ...MOUSE, clientX: x, clientY: y });
      }
    }
    throw new Error(`could not grab ${curve} ${index}`);
  };

  it(
    'stands the taper upright: root at the bottom, tip at the top',
    () => {
      render(<FinTaperPane store={finStore} units={lengthUnitByKey('mm')} />);
      const canvas = screen.getByRole('img', { name: 'Thickness taper' });
      const last = design().taper.knots.length - 1;
      const root = grab(canvas, 'taper', 0);
      fireEvent.pointerUp(canvas, { ...MOUSE, clientX: root.clientX, clientY: root.clientY });
      const tip = grab(canvas, 'taper', last);
      fireEvent.pointerUp(canvas, { ...MOUSE, clientX: tip.clientX, clientY: tip.clientY });
      expect(root.clientY).toBeGreaterThan(tip.clientY);
      expect(root.clientX).toBeGreaterThan(tip.clientX); // the root is the thicker end
    },
    HEAVY,
  );

  it('drags a taper point and stops it at the minimum thickness', () => {
    render(<FinTaperPane store={finStore} units={lengthUnitByKey('mm')} />);
    const canvas = screen.getByRole('img', { name: 'Thickness taper' });
    const i = 1; // the knot where the straight run turns into the curve
    const at = grab(canvas, 'taper', i);
    // The pane stands upright: thickness runs across, so thinner is to the left.
    fireEvent.pointerMove(canvas, { ...MOUSE, clientX: at.clientX - 2000, clientY: at.clientY });
    fireEvent.pointerUp(canvas, { ...MOUSE, clientX: at.clientX - 2000, clientY: at.clientY });
    const k = design().taper.knots[i]!.end;
    expect(k.y).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-9);
    expect(k.y).toBeLessThan(0.4); // it got thinner, as far as the rules allow
    expect(finStore.getState().past).toHaveLength(1); // one drag, one undo step
  });

  it('drags the outside face of the foil', () => {
    render(<FinSectionPane store={finStore} />);
    const canvas = screen.getByRole('img', { name: 'Foil section' });
    const before = design().section.outside.knots[1]!.end;
    const at = grab(canvas, 'outside', 1);
    fireEvent.pointerMove(canvas, { ...MOUSE, clientX: at.clientX + 20, clientY: at.clientY });
    fireEvent.pointerUp(canvas, { ...MOUSE, clientX: at.clientX + 20, clientY: at.clientY });
    const after = design().section.outside.knots[1]!.end;
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});

describe('selecting several points in a pane', () => {
  beforeEach(() => act(() => finStore.getState().load(defaultFinDesign('side', 'right'))));

  /** Where a point is on screen: clicked until selected, as in `grab` above. */
  const find = (canvas: HTMLElement, index: number) => {
    for (let y = 0; y < pane.h; y += 4) {
      for (let x = 0; x < pane.w; x += 4) {
        fireEvent.pointerDown(canvas, { ...MOUSE, clientX: x, clientY: y });
        fireEvent.pointerUp(canvas, { ...MOUSE, clientX: x, clientY: y });
        const sel = finStore.getState().selection;
        if (sel?.curve === 'outline' && sel.index === index && (sel.kind ?? 'end') === 'end') {
          return { clientX: x, clientY: y };
        }
      }
    }
    throw new Error(`could not find outline point ${index}`);
  };

  it(
    'shift-clicks a second point, then drags both the same way',
    () => {
      render(<FinOutlinePane store={finStore} units={lengthUnitByKey('mm')} />);
      const canvas = screen.getByRole('img', { name: 'Fin outline' });
      const b = find(canvas, 2);
      const a = find(canvas, 1); // selected on its own
      const shift = { ...MOUSE, shiftKey: true };
      fireEvent.pointerDown(canvas, { ...shift, ...b });
      fireEvent.pointerUp(canvas, { ...shift, ...b });
      expect(finStore.getState().selection).toMatchObject({ index: 2, also: [1] });
      // A shift-click on empty space keeps the selection.
      fireEvent.pointerDown(canvas, { ...shift, clientX: 1, clientY: 1 });
      fireEvent.pointerUp(canvas, { ...shift, clientX: 1, clientY: 1 });
      expect(finStore.getState().selection).toMatchObject({ index: 2, also: [1] });
      const before = design().outline.knots.map((k) => k.end);
      const pastBefore = finStore.getState().past.length;
      // Grab the first point (no shift: the group stays) and drag it.
      fireEvent.pointerDown(canvas, { ...MOUSE, ...a });
      fireEvent.pointerMove(canvas, { ...MOUSE, clientX: a.clientX + 12, clientY: a.clientY - 8 });
      fireEvent.pointerUp(canvas, { ...MOUSE, clientX: a.clientX + 12, clientY: a.clientY - 8 });
      const after = design().outline.knots.map((k) => k.end);
      const d1 = { x: after[1]!.x - before[1]!.x, y: after[1]!.y - before[1]!.y };
      const d2 = { x: after[2]!.x - before[2]!.x, y: after[2]!.y - before[2]!.y };
      expect(Math.hypot(d1.x, d1.y)).toBeGreaterThan(0);
      expect(d2.x).toBeCloseTo(d1.x, 9);
      expect(d2.y).toBeCloseTo(d1.y, 9);
      expect(after[3]).toEqual(before[3]); // not selected: left alone
      expect(finStore.getState().past).toHaveLength(pastBefore + 1); // one drag, one step
    },
    HEAVY,
  );
});

describe('foil slices in the panes', () => {
  beforeEach(() =>
    act(() => {
      finStore.getState().load(defaultFinDesign('side', 'left'));
      finStore.getState().addSlice(0.5);
      finStore.getState().setActiveFoil(0);
    }),
  );

  it('drags a slice line in the profile up the blade, picking its foil', () => {
    render(<FinOutlinePane store={finStore} units={lengthUnitByKey('mm')} />);
    const canvas = screen.getByRole('img', { name: 'Fin outline' });
    // Find the line by probing down the middle of the pane.
    let hit: { clientX: number; clientY: number } | null = null;
    for (let y = 0; y < pane.h && !hit; y += 2) {
      fireEvent.pointerDown(canvas, { ...MOUSE, clientX: pane.w / 2, clientY: y });
      if (finStore.getState().activeFoil === 1) hit = { clientX: pane.w / 2, clientY: y };
      else fireEvent.pointerUp(canvas, { ...MOUSE, clientX: pane.w / 2, clientY: y });
    }
    expect(hit).not.toBeNull();
    fireEvent.pointerMove(canvas, { ...MOUSE, clientX: hit!.clientX, clientY: hit!.clientY - 40 });
    fireEvent.pointerUp(canvas, { ...MOUSE, clientX: hit!.clientX, clientY: hit!.clientY - 40 });
    expect(design().slices[0]!.height).toBeGreaterThan(0.5);
    expect(finStore.getState().past.at(-1)!.label).toBe('Move foil slice');
  });
});
