// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from './bezier-spline';
import { board, getLength, type BezierBoard } from './board';
import { knotFromArray } from './knot';
import { tessellateBoard, tessellationSteps } from './tessellate';
import { parseBrdGeometry } from './test-support/brd-geometry';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);
const L = getLength(shortboard);
const third = (ax: number, ay: number, bx: number, by: number): [number, number] => [
  ax + (bx - ax) / 3,
  ay + (by - ay) / 3,
];
const outlineBoard = (knots: ReturnType<typeof knotFromArray>[]) => {
  const s = shortboard;
  return board(splineFromKnots(knots), s.bottom, s.deck, s.crossSections, s.interpolationType, s.fins); // prettier-ignore
};

/**
 * Directed edges, points welded where they coincide: in a closed, consistently wound
 * solid each runs once each way. (Swallow and fish tails take the cutout path, which
 * repeats points where its halves meet; the print-blank export checks those, through
 * the solid modeller's own merge.)
 */
const winding = (b: BezierBoard) => {
  const m = tessellateBoard(b, tessellationSteps(b, 1));
  const key = (i: number) => [0, 1, 2].map((k) => Math.round(m.positions[i * 3 + k]! * 1e6)).join();
  const dir = new Map<string, number>();
  for (let t = 0; t < m.indices.length; t += 3) {
    const v = [m.indices[t]!, m.indices[t + 1]!, m.indices[t + 2]!].map(key);
    if (new Set(v).size < 3) continue;
    for (let e = 0; e < 3; e++) {
      const k = `${v[e]}>${v[(e + 1) % 3]}`;
      dir.set(k, (dir.get(k) ?? 0) + 1);
    }
  }
  let twice = 0;
  let unmatched = 0;
  for (const [k, n] of dir) {
    if (n > 1) twice++;
    const [a, c] = k.split('>');
    if (!dir.has(`${c}>${a}`)) unmatched++;
  }
  return { twice, unmatched };
};

describe('the mesh is a closed, consistently wound solid (what a solid modeller needs)', () => {
  it('on a board pointed at both ends: the caps wound against their bands', () => {
    expect(winding(shortboard)).toEqual({ twice: 0, unmatched: 0 });
  });

  it('on a square tail drawn dead vertical: the flat cap too', () => {
    const square = [
      knotFromArray([0, 0, 0, 0, ...third(0, 0, 0, 10.5)], false, false),
      knotFromArray([0, 10.5, 0, 7, ...third(0, 10.5, 90, 23.5)], false, false),
      knotFromArray(
        [90, 23.5, ...third(90, 23.5, 0, 10.5), ...third(90, 23.5, L, 0)],
        false,
        false,
      ),
      knotFromArray([L, 0, ...third(L, 0, 90, 23.5), L, 0], false, false),
    ];
    expect(winding(outlineBoard(square))).toEqual({ twice: 0, unmatched: 0 });
  });
});
