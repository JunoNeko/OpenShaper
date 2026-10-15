// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  FIN_MAX_FRONT_OVERHANG,
  FIN_MIN_THICKNESS,
  defaultFinDesign,
  finReadouts,
  validateFinDesign,
  vec2,
  type FinDesign,
} from '@openshaper/kernel';
import { createFinStore } from './fin-store';

const storeWith = (d: FinDesign = defaultFinDesign('side', 'right')) => {
  const s = createFinStore();
  s.getState().load(d);
  return s;
};
const design = (s: ReturnType<typeof storeWith>) => s.getState().design!;
const knotAt = (s: ReturnType<typeof storeWith>, i: number) => design(s).outline.knots[i]!.end;

describe('fin store: history', () => {
  it('starts with a default fin and no history', () => {
    const s = createFinStore();
    s.getState().newFin('centre');
    expect(design(s).position).toBe('centre');
    expect(s.getState().canUndo()).toBe(false);
  });

  it('undoes and redoes an edit', () => {
    const s = storeWith();
    const before = design(s);
    expect(s.getState().setCant(10)).toBe(true);
    expect(design(s).cant).toBe(10);
    s.getState().undo();
    expect(design(s)).toBe(before);
    s.getState().redo();
    expect(design(s).cant).toBe(10);
  });

  it('records a whole drag as one undo step', () => {
    const s = storeWith();
    const before = design(s);
    const p = knotAt(s, 2);
    s.getState().beginEdit('Move control point');
    for (let i = 1; i <= 5; i++)
      s.getState().moveControlPoint('outline', 2, vec2(p.x + 0.02 * i, p.y));
    s.getState().endEdit();
    expect(s.getState().past).toHaveLength(1);
    s.getState().undo();
    expect(design(s)).toBe(before);
  });

  it('leaves no undo step for a drag that moved nothing', () => {
    const s = storeWith();
    s.getState().beginEdit();
    s.getState().endEdit();
    expect(s.getState().canUndo()).toBe(false);
  });

  it('makes starting a new fin undoable', () => {
    const s = storeWith();
    s.getState().newFin('quad-rear', 'left');
    expect(design(s).position).toBe('quad-rear');
    s.getState().undo();
    expect(design(s).position).toBe('side');
  });

  it('drops a selection whose point an undo removed', () => {
    const s = storeWith();
    expect(s.getState().addControlPoint('outline', vec2(8, 5))).toBe(true);
    const sel = s.getState().selection!;
    expect(sel.curve).toBe('outline');
    s.getState().undo();
    expect(s.getState().selection === null || sel.index < design(s).outline.knots.length).toBe(
      true,
    );
  });
});

describe('fin store: drags stay inside the rules', () => {
  it('keeps the outline roots on the base', () => {
    const s = storeWith();
    const le = knotAt(s, 0);
    s.getState().moveControlPoint('outline', 0, vec2(le.x - 0.5, 2));
    expect(knotAt(s, 0)).toEqual(vec2(le.x - 0.5, 0));
  });

  it('stops the leading-edge root at the 2.5 mm front overhang', () => {
    const s = storeWith();
    const le = knotAt(s, 0);
    s.getState().moveControlPoint('outline', 0, vec2(20, 0)); // far past the tab front
    const r = finReadouts(design(s));
    expect(r.frontOverhang).toBeLessThanOrEqual(FIN_MAX_FRONT_OVERHANG + 1e-9);
    // Clamped at the boundary, not refused: it moved nearly all the way there.
    expect(r.frontOverhang).toBeGreaterThan(FIN_MAX_FRONT_OVERHANG - 0.01);
    expect(knotAt(s, 0).x).toBeGreaterThan(le.x);
  });

  it('pins a section face to the leading and trailing edges', () => {
    const s = storeWith();
    const before = design(s);
    expect(s.getState().moveControlPoint('outside', 0, vec2(0.2, 0.1))).toBe(false);
    expect(s.getState().moveControlPoint('outside', 2, vec2(0.8, 0.1))).toBe(false);
    expect(design(s)).toBe(before); // nothing changed, and no undo step
    expect(s.getState().canUndo()).toBe(false);
  });

  it('keeps the taper ends at the root and the tip, and above the minimum', () => {
    const s = storeWith();
    const tip = design(s).taper.knots.length - 1;
    s.getState().moveControlPoint('taper', tip, vec2(0.7, 0));
    const end = design(s).taper.knots[tip]!.end;
    expect(end.x).toBe(1);
    expect(end.y).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS - 1e-9);
  });

  it('will not drag an outline into a dip, only up to it', () => {
    const s = storeWith();
    const before = design(s);
    // Drag a leading-edge point far above the tip: the edge would no longer rise.
    const p = knotAt(s, 1);
    s.getState().moveControlPoint('outline', 1, vec2(p.x, p.y + 50));
    expect(validateFinDesign(design(s))).toEqual([]);
    expect(design(s)).not.toBe(before);
  });

  it('refuses a deletion that would break a rule, and allows one that would not', () => {
    const s = storeWith();
    const n = design(s).outline.knots.length;
    // Every default outline knot can go except the ends; the result must stay valid.
    const ok = s.getState().deleteControlPoint('outline', 2);
    expect(ok).toBe(validateFinDesign(design(s)).length === 0);
    if (ok) expect(design(s).outline.knots).toHaveLength(n - 1);
    expect(s.getState().deleteControlPoint('outline', 0)).toBe(false);
  });

  it('lets a design that already breaks a rule be edited without adding another', () => {
    const s = storeWith({ ...defaultFinDesign('side', 'right'), cant: 30 });
    expect(validateFinDesign(design(s)).map((i) => i.code)).toEqual(['cant']);
    expect(s.getState().setRootThickness(0.7)).toBe(true);
    expect(s.getState().setCant(12)).toBe(true); // and fixing it is fine
    expect(validateFinDesign(design(s))).toEqual([]);
  });
});

describe('fin store: fin-wide edits', () => {
  it('clamps cant, and keeps a centre fin upright', () => {
    const s = storeWith();
    s.getState().setCant(35);
    expect(design(s).cant).toBe(20);
    s.getState().setCant(-4);
    expect(design(s).cant).toBe(0);
    const c = storeWith(defaultFinDesign('centre'));
    expect(c.getState().setCant(5)).toBe(false);
    expect(design(c).cant).toBe(0);
  });

  it('sets the root thickness, keeping the taper’s shape and minimum', () => {
    const s = storeWith();
    s.getState().setRootThickness(0.6);
    const t = design(s).taper.knots;
    expect(t[0]!.end.y).toBeCloseTo(0.6, 12);
    expect(t[t.length - 1]!.end.y).toBeGreaterThanOrEqual(FIN_MIN_THICKNESS);
  });

  it('sets the depth over the same base', () => {
    const s = storeWith();
    const chord = finReadouts(design(s)).rootChord;
    s.getState().setDepth(11.5);
    expect(finReadouts(design(s)).depth).toBeCloseTo(11.5, 9);
    expect(finReadouts(design(s)).rootChord).toBeCloseTo(chord, 12);
  });

  it('applies NACA presets, symmetric only on a centre fin', () => {
    const s = storeWith();
    expect(s.getState().applyNaca('2412')).toBe(true);
    expect(design(s).section.inside).not.toBeNull();
    expect(s.getState().past.at(-1)!.label).toBe('NACA 2412');
    const c = storeWith(defaultFinDesign('centre'));
    expect(c.getState().applyNaca('2412')).toBe(false);
    expect(c.getState().applyNaca('0010')).toBe(true);
    expect(c.getState().applyNaca('nope')).toBe(false);
  });

  it('switches a side fin between flat-inside and symmetric', () => {
    const s = storeWith();
    expect(s.getState().setInsideFace('symmetric')).toBe(true);
    expect(design(s).section.inside).toBeNull();
    expect(s.getState().setInsideFace('flat')).toBe(true);
    expect(storeWith(defaultFinDesign('centre')).getState().setInsideFace('flat')).toBe(false);
  });

  it('sets the hand of a side fin only', () => {
    const s = storeWith();
    expect(s.getState().setHand('left')).toBe(true);
    expect(design(s).hand).toBe('left');
    expect(storeWith(defaultFinDesign('centre')).getState().setHand('left')).toBe(false);
  });

  it('nudges along the tab, stopping at the front and at insertion clearance', () => {
    const s = storeWith();
    expect(s.getState().nudgeFore(0.05)).toBe(true);
    for (let i = 0; i < 40; i++) s.getState().nudgeFore(0.05);
    expect(finReadouts(design(s)).frontOverhang).toBeCloseTo(FIN_MAX_FRONT_OVERHANG, 9);
    expect(s.getState().nudgeFore(0.05)).toBe(false); // at the stop: nothing to undo
    // Back to rear-aligned, then no further: the flat base would hit the board.
    for (let i = 0; i < 60; i++) s.getState().nudgeFore(-0.05);
    expect(s.getState().nudgeFore(-0.05)).toBe(false);
  });

  it('nudges across the tab within range', () => {
    const s = storeWith();
    expect(s.getState().nudgeLateral(0.05)).toBe(true);
    expect(design(s).lateralOffset).toBeCloseTo(0.05, 12);
    for (let i = 0; i < 100; i++) s.getState().nudgeLateral(0.05);
    expect(validateFinDesign(design(s))).toEqual([]);
  });
});
