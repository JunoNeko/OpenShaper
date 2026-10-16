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
import { FinSectionPane, FinSectionTools } from './FinSectionPane';
import { FinTaperPane } from './FinTaperPane';
import { finStore } from './fin-store';

beforeEach(installLayoutStubs);
afterEach(removeLayoutStubs);

const design = () => finStore.getState().design!;

describe('FinSectionTools', () => {
  beforeEach(() => act(() => finStore.getState().load(defaultFinDesign('side', 'right'))));

  it('applies a NACA preset to the section', () => {
    render(<FinSectionTools store={finStore} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: '2412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(design().section.inside).not.toBeNull();
    expect(finStore.getState().past.at(-1)!.label).toBe('NACA 2412');
  });

  it('offers every preset again after one is applied', () => {
    render(<FinSectionTools store={finStore} />);
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
    render(<FinSectionTools store={finStore} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '3415' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(finStore.getState().past.at(-1)!.label).toBe('NACA 3415');
  });

  it('explains a code it cannot use', () => {
    render(<FinSectionTools store={finStore} />);
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '24' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/NACA 4-digit code/);
    expect(finStore.getState().canUndo()).toBe(false);
  });

  it('keeps a centre fin symmetric', () => {
    act(() => finStore.getState().load(defaultFinDesign('centre')));
    render(<FinSectionTools store={finStore} />);
    expect(screen.queryByRole('button', { name: 'Flat inside' })).toBeNull();
    expect(screen.queryByRole('option', { name: '2412' })).toBeNull(); // only 00xx offered
    fireEvent.change(screen.getByLabelText('NACA preset'), { target: { value: 'other' } });
    fireEvent.change(screen.getByLabelText('NACA 4-digit code'), { target: { value: '2412' } });
    fireEvent.click(screen.getByRole('button', { name: 'Apply' }));
    expect(screen.getByRole('alert').textContent).toMatch(/symmetric/);
    expect(design().section.inside).toBeNull();
  });

  it('switches a side fin between symmetric and flat inside', () => {
    render(<FinSectionTools store={finStore} />);
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

  it('drags a taper point and stops it at the minimum thickness', () => {
    render(<FinTaperPane store={finStore} units={lengthUnitByKey('mm')} />);
    const canvas = screen.getByRole('img', { name: 'Thickness taper' });
    const i = 1; // the knot where the straight run turns into the curve
    const at = grab(canvas, 'taper', i);
    fireEvent.pointerMove(canvas, { ...MOUSE, clientX: at.clientX, clientY: at.clientY + 2000 });
    fireEvent.pointerUp(canvas, { ...MOUSE, clientX: at.clientX, clientY: at.clientY + 2000 });
    const k = design().taper.knots[i]!.end;
    expect(k.y).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-9);
    expect(k.y).toBeLessThan(0.4); // it moved down, as far as the rules allow
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
