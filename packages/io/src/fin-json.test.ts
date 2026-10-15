// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import {
  defaultFinDesign,
  finReadouts,
  knot,
  knotLock,
  nacaSection,
  nudgeFore,
  splineFromKnots,
  validateFinDesign,
  vec2,
  type FinDesign,
  type Spline,
} from '@openshaper/kernel';
import { FinJsonError, readFinJson, writeFinJson } from './fin-json';

/** A copy of `s` with handle locks on its middle knot, as the editor will set them. */
const withLock = (s: Spline): Spline =>
  splineFromKnots(
    s.knots.map((k, i) =>
      i === 1
        ? knot(
            k.end,
            k.tangentToPrev,
            k.tangentToNext,
            k.continuous,
            k.other,
            knotLock(vec2(-0.6, 0.8), vec2(0.6, -0.8)),
          )
        : k,
    ),
  );

const designs: [string, FinDesign][] = [
  ['side, right', defaultFinDesign('side', 'right')],
  ['side, left', defaultFinDesign('side', 'left')],
  ['quad rear', defaultFinDesign('quad-rear', 'right')],
  ['centre', defaultFinDesign('centre')],
  [
    'edited: NACA 2412, 12.5° cant, nudged, locked handles',
    (() => {
      const d = defaultFinDesign('side', 'left');
      const moved = nudgeFore(d, 0.13);
      return {
        ...moved,
        cant: 12.5,
        lateralOffset: 0.05,
        section: nacaSection('2412'),
        outline: withLock(moved.outline),
        taper: withLock(d.taper),
      };
    })(),
  ],
];

/** Every number of every knot, in order, for comparing designs. */
const numbers = (s: Spline): number[] =>
  s.knots.flatMap((k) => [
    k.end.x,
    k.end.y,
    k.tangentToPrev.x,
    k.tangentToPrev.y,
    k.tangentToNext.x,
    k.tangentToNext.y,
    k.lock?.prev?.x ?? 0,
    k.lock?.prev?.y ?? 0,
    k.lock?.next?.x ?? 0,
    k.lock?.next?.y ?? 0,
  ]);

const expectSameSpline = (a: Spline, b: Spline): void => {
  const x = numbers(a);
  const y = numbers(b);
  expect(y.length).toBe(x.length);
  x.forEach((v, i) => expect(Math.abs(v - y[i]!)).toBeLessThan(1e-12));
  b.knots.forEach((k, i) => {
    expect(k.continuous).toBe(a.knots[i]!.continuous);
    expect(Boolean(k.lock)).toBe(Boolean(a.knots[i]!.lock));
  });
};

describe.each(designs)('.fin.json round trip (%s)', (_, d) => {
  const text = writeFinJson(d, { name: 'Test fin' });
  const { design, metadata } = readFinJson(text);

  it('reads back the same design', () => {
    expect(design.position).toBe(d.position);
    expect(design.hand).toBe(d.hand);
    expect(design.cant).toBe(d.cant);
    expect(Math.abs(design.lateralOffset - d.lateralOffset)).toBeLessThan(1e-15);
    expectSameSpline(d.outline, design.outline);
    expectSameSpline(d.section.outside, design.section.outside);
    expect(design.section.inside === null).toBe(d.section.inside === null);
    if (d.section.inside) expectSameSpline(d.section.inside, design.section.inside!);
    expectSameSpline(d.taper, design.taper);
    expect(metadata).toEqual({ name: 'Test fin' });
  });

  it('reads back with the same readouts and rule results', () => {
    const a = finReadouts(d);
    const b = finReadouts(design);
    expect(b.area).toBeCloseTo(a.area, 10);
    expect(b.sweep).toBeCloseTo(a.sweep, 10);
    expect(validateFinDesign(design).map((i) => i.code)).toEqual(
      validateFinDesign(d).map((i) => i.code),
    );
  });

  it('saves the same bytes again after loading, so autosave does not drift', () => {
    let t = text;
    for (let i = 0; i < 5; i++) t = writeFinJson(readFinJson(t).design, { name: 'Test fin' });
    expect(t).toBe(text);
  });
});

describe('.fin.json units', () => {
  const d = defaultFinDesign('side', 'right');
  const doc = JSON.parse(writeFinJson(d)) as {
    units: string;
    outline: { e: [number, number] }[];
    taper: { e: [number, number] }[];
    section: { outside: { e: [number, number] }[] };
  };

  it('writes lengths in mm', () => {
    expect(doc.units).toBe('mm');
    // The leading-edge root of the default side fin, 101.7 mm from the tab's rear end.
    expect(doc.outline[0]!.e[0]).toBeCloseTo(finReadouts(d).rootChord * 10, 9);
    // Root thickness 8 mm, at height fraction 0.
    expect(doc.taper[0]!.e).toEqual([0, 8]);
  });

  it('keeps unitless curves unitless', () => {
    const last = doc.section.outside[doc.section.outside.length - 1]!;
    expect(last.e).toEqual([1, 0]); // the trailing edge, at chord fraction 1
    expect(doc.taper[doc.taper.length - 1]!.e[0]).toBe(1); // the tip, at height fraction 1
  });
});

describe('.fin.json rejects damaged files', () => {
  const good = (): Record<string, unknown> =>
    JSON.parse(writeFinJson(defaultFinDesign('side', 'right'))) as Record<string, unknown>;
  const read = (doc: unknown) => () => readFinJson(JSON.stringify(doc));

  it.each([
    ['not JSON', () => readFinJson('{')],
    ['a board document', read({ format: 'openshaper', version: 2 })],
    ['a newer version', read({ ...good(), version: 99 })],
    ['an unknown position', read({ ...good(), position: 'nose' })],
    ['a bad hand', read({ ...good(), hand: 'up' })],
    ['a non-numeric cant', read({ ...good(), cant: '7' })],
    ['other units', read({ ...good(), units: 'in' })],
    ['a missing outline', read({ ...good(), outline: undefined })],
    ['a one-point taper', read({ ...good(), taper: [(good().taper as unknown[])[0]] })],
    ['a missing section', read({ ...good(), section: undefined })],
    [
      'a damaged section point',
      read({
        ...good(),
        section: { outside: [{ e: [0, 'x'], p: [0, 0], n: [0, 0] }], inside: null },
      }),
    ],
  ])('%s', (_, load) => {
    expect(load).toThrow(FinJsonError);
  });

  it('loads a design that breaks the fin rules: saving mid-edit is allowed', () => {
    const d = { ...defaultFinDesign('side', 'right'), cant: 30 };
    expect(validateFinDesign(readFinJson(writeFinJson(d)).design).map((i) => i.code)).toEqual([
      'cant',
    ]);
  });
});
