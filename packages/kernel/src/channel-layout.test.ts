// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots, valueAt } from './bezier-spline';
import { board, getLength, getWidthAtPos, type BezierBoard } from './board';
import { knot, knotFromArray } from './knot';
import { vec2 } from './vec2';
import {
  boardChannelProblems,
  boardChannels,
  defaultChannelParams,
  layoutChannels,
  scaleBoardChannels,
  type ChannelParams,
} from './channel-layout';
import { SQUARE_WALL_GAP, channelAnchors, channelDepthAt } from './channels';
import { channelCut, loftPoint, loftRing, loftSection } from './loft';
import { tessellateBoard } from './tessellate';
import { parseBrdGeometry } from './test-support/brd-geometry';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);

const P: ChannelParams = {
  count: 4,
  wall: { shape: 'square' },
  width: 4,
  depth: 0.5,
  inner: 3,
  follow: 0,
  start: 15,
  end: 70,
  station: 30,
  fullFrom: 25,
  fullTo: 40,
};
const typed = (p: Partial<ChannelParams> = {}): BezierBoard => {
  const b = shortboard;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins, {
    from: 'numbers',
    params: { ...P, ...p },
  });
};
const half = (x: number) => getWidthAtPos(shortboard, x) / 2;
const wallsAt = (b: BezierBoard, x: number) =>
  boardChannels(b).map((c) => [c.inner && valueAt(c.inner, x), valueAt(c.outer, x)]);

describe('typed-in channels', () => {
  it('lie side by side from the stringer offset, each as wide as asked', () => {
    const w = wallsAt(typed(), 30) as [number, number][];
    expect(w).toHaveLength(2);
    expect(w[0]![0]).toBeCloseTo(3, 9);
    expect(w[0]![1]).toBeCloseTo(7, 9);
    expect(w[1]![0]).toBeCloseTo(7, 9);
    expect(w[1]![1]).toBeCloseTo(11, 9);
  });

  it('put an odd one on the stringer, as wide as the others', () => {
    const cs = boardChannels(typed({ count: 5 }));
    expect(cs).toHaveLength(3);
    expect(cs[0]!.inner).toBeNull();
    expect(2 * valueAt(cs[0]!.outer, 30)).toBeCloseTo(4, 9);
    expect(valueAt(cs[1]!.inner!, 30)).toBeCloseTo(2, 9);
    expect(valueAt(cs[2]!.outer, 30)).toBeCloseTo(10, 9);
  });

  it('run parallel to the stringer, follow the outline, or blend the two', () => {
    const outer = (follow: number, x: number) => wallsAt(typed({ follow }), x)[1]![1] as number;
    expect(outer(0, 60)).toBeCloseTo(11, 9);
    expect(outer(0, 15)).toBeCloseTo(11, 9);
    // Following it, each wall keeps its share of the half-width at the station.
    const share = 11 / half(30);
    expect(outer(1, 60) / half(60)).toBeCloseTo(share, 2);
    expect(outer(1, 15) / half(15)).toBeCloseTo(share, 2);
    expect(outer(0.5, 60)).toBeCloseTo((outer(0, 60) + outer(1, 60)) / 2, 2);
  });

  it('are full depth between the blend handles, fading smoothly to nothing at each end', () => {
    const cs = boardChannels(typed());
    const d = (x: number) => channelDepthAt(cs, x, 5);
    expect(d(25)).toBeCloseTo(0.5, 3);
    expect(d(32)).toBeCloseTo(0.5, 3);
    expect(d(40)).toBeCloseTo(0.5, 3);
    expect(d(15.01)).toBeCloseTo(0, 2);
    expect(d(69.99)).toBeCloseTo(0, 2);
    expect(d(55)).toBeCloseTo(0.25, 2); // halfway down the nose fade
    expect(d(14)).toBe(0);
    expect(d(71)).toBe(0);
    for (let x = 40; x < 70; x += 1) expect(d(x + 1)).toBeLessThanOrEqual(d(x) + 1e-6);
    for (let x = 15; x < 25; x += 1) expect(d(x + 1)).toBeGreaterThanOrEqual(d(x) - 1e-6);
  });

  it('with a blend handle at an end, run full depth out through it', () => {
    const cs = boardChannels(typed({ start: 0, fullFrom: 0 }));
    expect(channelDepthAt(cs, 0.5, 5)).toBeCloseTo(0.5, 3);
    expect(channelDepthAt(cs, 20, 5)).toBeCloseTo(0.5, 3);
  });

  it('say when they run off the bottom, or have no length', () => {
    expect(boardChannelProblems(typed({ count: 8, width: 6 })).join()).toMatch(
      /runs off the bottom/,
    );
    expect(boardChannelProblems(typed({ end: 5 }))[0]).toMatch(/end further up/);
  });

  it('start sensibly from a cross-section, with no problems', () => {
    const b = shortboard;
    const p = defaultChannelParams(b, 40);
    expect(p.station).toBe(40);
    // The golden shortboard comes to a point: the defaults start where it has width.
    expect(p.start).toBeGreaterThan(0);
    expect(p.wall).toEqual({ shape: 'step', radius: 0, lip: 0.5 });
    const withDefaults = board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins, { from: 'numbers', params: p }); // prettier-ignore
    expect(boardChannelProblems(withDefaults)).toEqual([]);
    expect(boardChannels(withDefaults)).toHaveLength(2);
  });

  it('cut the same hull as the same curves drawn', () => {
    const b = typed({ follow: 0.4 });
    const drawn = board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins, { from: 'drawn', channels: layoutChannels(b, b.channels!.from === 'numbers' ? b.channels!.params : P) }); // prettier-ignore
    const opts = { lengthSteps: 30, ringSteps: 32 };
    expect(tessellateBoard(drawn, opts).positions).toEqual(tessellateBoard(b, opts).positions);
  });

  it('scale with the board', () => {
    const s = scaleBoardChannels({ from: 'numbers', params: P }, 2, 1.5, 0.5);
    expect(s).toEqual({
      from: 'numbers',
      params: { ...P, width: 6, depth: 0.25, inner: 4.5, start: 30, end: 140, station: 60, fullFrom: 50, fullTo: 80 }, // prettier-ignore
    });
  });
});

describe('the cut on a cross-section', () => {
  it('lifts the bottom by the channels, with a point on each wall, and none where they fade out', () => {
    const b = typed({ wall: { shape: 'step', radius: 0, lip: 0.2 } });
    const cut = channelCut(b, 30)!;
    expect(cut.points).toHaveLength(channelAnchors(boardChannels(b), 30).length);
    const s = loftSection(b, 30)!;
    // The uncut bottom on the stringer; at the step's wall, full depth above it.
    expect(cut.curve[0]!.y).toBeCloseTo(loftPoint(s, 0).y, 6);
    // The points reach the full depth: one stands at the top of each wall.
    const cs = boardChannels(b);
    const lift = Math.max(...cut.points.map((p) => channelDepthAt(cs, 30, p.x)));
    expect(lift).toBeCloseTo(0.5, 3);
    expect(channelCut(b, 75)).toBeNull();
  });
});

describe('the default channels', () => {
  it('run out through a tail wide enough, at full depth', () => {
    const L = getLength(shortboard);
    const third = (ax: number, ay: number, bx: number, by: number): [number, number] => [
      ax + (bx - ax) / 3,
      ay + (by - ay) / 3,
    ];
    // A swallow 18 cm wide at the tips: wide enough for channels to run out.
    const swallow = splineFromKnots([
      knotFromArray([18, 0, 18, 0, ...third(18, 0, 0, 9)], false, false),
      knotFromArray([0, 9, ...third(0, 9, 18, 0), ...third(0, 9, 90, 23.5)], false, false),
      knotFromArray([90, 23.5, ...third(90, 23.5, 0, 9), ...third(90, 23.5, L, 0)], false, false),
      knotFromArray([L, 0, ...third(L, 0, 90, 23.5), L, 0], false, false),
    ]);
    const s = shortboard;
    // The golden deck meets the bottom at the tail; a real tail is a couple of cm thick.
    const deck = splineFromKnots(
      s.deck.knots.map((k) =>
        knot(
          vec2(k.end.x, k.end.y + 2),
          vec2(k.tangentToPrev.x, k.tangentToPrev.y + 2),
          vec2(k.tangentToNext.x, k.tangentToNext.y + 2),
          k.continuous,
        ),
      ),
    );
    const fish = board(swallow, s.bottom, deck, s.crossSections, s.interpolationType, s.fins);
    const p = defaultChannelParams(fish, 30);
    expect(p.start).toBe(0);
    expect(p.fullFrom).toBe(0); // full depth out through the tail
    const cut = board(swallow, s.bottom, deck, s.crossSections, s.interpolationType, s.fins, { from: 'numbers', params: p }); // prettier-ignore
    expect(boardChannelProblems(cut)).toEqual([]);
    const mesh = tessellateBoard(cut, { lengthSteps: 40, ringSteps: 40 });
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });
});

describe('channels out through a square tail', () => {
  it.each([
    ['leaning a touch aft (the cutout path)', [-0.2, 7]],
    ['drawn dead vertical (no width at the tip itself)', [0, 7]],
  ] as const)(
    'are left open at the tail, its edge %s: the cap covers the notched outline only',
    (_, corner) => {
      const L = getLength(shortboard);
      const third = (ax: number, ay: number, bx: number, by: number): [number, number] => [
        ax + (bx - ax) / 3,
        ay + (by - ay) / 3,
      ];
      // A square tail 21 cm across, like the owner's board.
      const square = splineFromKnots([
        knotFromArray([0, 0, 0, 0, ...third(0, 0, 0, 10.5)], false, false),
        knotFromArray([0, 10.5, ...corner, ...third(0, 10.5, 90, 23.5)], false, false),
        knotFromArray(
          [90, 23.5, ...third(90, 23.5, 0, 10.5), ...third(90, 23.5, L, 0)],
          false,
          false,
        ),
        knotFromArray([L, 0, ...third(L, 0, 90, 23.5), L, 0], false, false),
      ]);
      const s = shortboard;
      const deck = splineFromKnots(
        s.deck.knots.map((k) =>
          knot(
            vec2(k.end.x, k.end.y + 2),
            vec2(k.tangentToPrev.x, k.tangentToPrev.y + 2),
            vec2(k.tangentToNext.x, k.tangentToNext.y + 2),
            k.continuous,
          ),
        ),
      );
      const params: ChannelParams = { ...P, wall: { shape: 'step', radius: 0, lip: 0 }, width: 4.8, inner: 0, start: 0, fullFrom: 0, fullTo: 30, end: 60, station: 30 }; // prettier-ignore
      const b = board(square, s.bottom, deck, s.crossSections, s.interpolationType, s.fins, { from: 'numbers', params }); // prettier-ignore
      expect(boardChannelProblems(b).join(' | ')).toBe('');
      expect(getWidthAtPos(b, 0.1) / 2).toBeGreaterThan(10);
      // The outer wall, 9.6 cm out on a tail 10.5 across the half (as the owner's, 10 on
      // 10.85): close to the rail but on the bottom, so exact right to the tail, a vertical pair a micron apart (owner's
      // Triangles_missing: a band too wide moved it, and the hull folded at the corner).
      for (const x of [0.2, 0.5, 1]) {
        const ys = loftRing(b, x, 48)!.map((v) => v.y);
        for (const y of [9.6 - SQUARE_WALL_GAP, 9.6 + SQUARE_WALL_GAP]) {
          expect(Math.min(...ys.map((v) => Math.abs(v - y)))).toBeLessThan(1e-6);
        }
      }
      const mesh = tessellateBoard(b, { lengthSteps: 40, ringSteps: 48 });
      const P3 = (i: number) => ({ x: mesh.positions[i * 3]!, y: mesh.positions[i * 3 + 1]!, z: mesh.positions[i * 3 + 2]! }); // prettier-ignore
      // The cap: the triangles in the first ring's plane (the loft has none exactly on the
      // tail's dummy station).
      let x0 = Infinity;
      for (let i = 0; i < mesh.positions.length; i += 3) x0 = Math.min(x0, mesh.positions[i]!);
      expect(x0).toBeLessThan(0.5);
      const cap: number[][] = [];
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const tri = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
        if (tri.every((i) => Math.abs(P3(i).x - x0) < 1e-6)) cap.push(tri);
      }
      const signed = (tri: number[]) => {
        const [a, c, d] = tri.map(P3) as [ReturnType<typeof P3>, ReturnType<typeof P3>, ReturnType<typeof P3>]; // prettier-ignore
        return ((c.y - a.y) * (d.z - a.z) - (c.z - a.z) * (d.y - a.y)) / 2;
      };
      // Its outline has notches deeper than 3 mm: the channels' mouths.
      const zs = [...new Set(cap.flat())].map((i) => P3(i));
      const bottom = Math.min(...zs.map((p) => p.z));
      expect(zs.some((p) => Math.abs(p.y) < 9 && p.z > bottom + 0.3 && p.z < bottom + 1)).toBe(
        true,
      );
      // Covered exactly: every triangle wound the same way (a fan across a notch folds back
      // over it), and no hub point added.
      // (Slivers along a step's straight floor, ~1e-7 cm², take either sign in float32; a
      // fan's web is a tenth of a square centimetre or more.)
      const areas = cap.map(signed).filter((a) => Math.abs(a) > 1e-5);
      expect(areas.every((a) => a > 0) || areas.every((a) => a < 0)).toBe(true);
      // No hub: every point of the cap is a point of the hull's first ring too.
      const capSet = new Set(cap.map((t) => t.join()));
      const hull = new Set<number>();
      for (let t = 0; t < mesh.indices.length; t += 3) {
        const tri = [mesh.indices[t]!, mesh.indices[t + 1]!, mesh.indices[t + 2]!];
        if (!capSet.has(tri.join())) tri.forEach((i) => hull.add(i));
      }
      expect(cap.flat().every((i) => hull.has(i))).toBe(true);
    },
  );
});
