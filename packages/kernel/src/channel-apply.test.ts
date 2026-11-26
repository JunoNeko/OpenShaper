// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots, valueAt } from './bezier-spline';
import { knotFromArray } from './knot';
import { vec2 } from './vec2';
import { board, type BezierBoard } from './board';
import {
  applyChannels,
  channelDepthKeys,
  channelDepthLine,
  channelPlanKeys,
  channelPlanLines,
  moveChannelDepths,
  moveChannelKey,
  resetChannels,
} from './channel-apply';
import {
  boardChannelProblems,
  boardChannels,
  type BoardChannels,
  type ChannelParams,
} from './channel-layout';
import { channelDepthAt } from './channels';
import { channelKeys } from './loft';
import { tessellateBoard } from './tessellate';
import { parseBrdGeometry } from './test-support/brd-geometry';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);
const withChannels = (channels: BoardChannels): BezierBoard => {
  const b = shortboard;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins, channels); // prettier-ignore
};

const P: ChannelParams = {
  count: 4,
  wall: { shape: 'step', radius: 0, lip: 0.2 },
  width: 4,
  depth: 0.5,
  inner: 3,
  follow: 0.6,
  start: 15,
  end: 120,
  station: 40,
  fullFrom: 20,
  fullTo: 70,
};
/** The golden shortboard's real cross-sections inside the channels. */
const stations = shortboard.crossSections.slice(1, -1).map((cs) => cs.position);
const inside = stations.filter((x) => x > P.start && x < P.end);
const typed = withChannels({ from: 'numbers', params: P });
const applied = withChannels(applyChannels(typed, P, stations));

describe('applying typed-in channels', () => {
  it('has cross-sections to put keys on', () => {
    expect(inside.length).toBeGreaterThanOrEqual(2);
  });

  it('cuts the same channels, the walls within 0.3 mm', () => {
    const a = boardChannels(typed);
    const c = boardChannels(applied);
    let worst = 0;
    for (let x = 15; x <= 120; x += 2.5) {
      for (let y = 0; y <= 13; y += 0.25) {
        worst = Math.max(worst, Math.abs(channelDepthAt(a, x, y) - channelDepthAt(c, x, y)));
      }
    }
    // Walls that follow the outline are rebuilt through the keys: a wall a fraction of a
    // millimetre off moves the cut by the full depth right at it, so the walls themselves
    // are what to compare.
    for (let x = 15; x <= 120; x += 2.5) {
      for (const [ca, cc] of a.map((ch, i) => [ch, c[i]!] as const)) {
        expect(Math.abs(valueAt(ca.outer, x) - valueAt(cc.outer, x))).toBeLessThan(0.03);
      }
    }
    expect(worst).toBeLessThanOrEqual(0.5);
    expect(boardChannelProblems(applied)).toEqual([]);
  });

  it('puts a key on every wall and depth at each cross-section inside them', () => {
    for (const c of boardChannels(applied)) {
      const xs = (s: typeof c.outer) => s.knots.map((k) => k.end.x);
      for (const x of inside) {
        expect(xs(c.outer)).toContain(x);
        expect(xs(c.depth)).toContain(x);
        if (c.inner) expect(xs(c.inner)).toContain(x);
      }
    }
  });

  it('keeps the numbers, so reset goes back to them', () => {
    expect(resetChannels(applied.channels!)).toEqual({ from: 'numbers', params: P });
    expect(resetChannels(typed.channels!)).toBeNull();
  });
});

describe('channel keys at a cross-section', () => {
  const x = inside[0]!;

  it("are a point on each wall and at each channel's deepest, side-by-side walls shared", () => {
    const keys = channelKeys(applied, x);
    expect(keys.map((k) => k.id)).toEqual(['i0', 'o0', 'd0', 'o1', 'd1']);
    expect(keys.find((k) => k.id === 'o0')!.joined).toBe(1);
    const c = boardChannels(applied)[1]!;
    expect(keys.find((k) => k.id === 'o1')!.value).toBeCloseTo(valueAt(c.outer, x), 9);
    expect(keys.find((k) => k.id === 'd1')!.value).toBeCloseTo(valueAt(c.depth, x), 9);
    expect(channelKeys(typed, x)).toEqual([]); // apply first
  });

  it('move a shared wall: both channels follow, easing out to the cross-sections either side', () => {
    const cs = boardChannels(applied);
    const o0 = valueAt(cs[0]!.outer, x);
    const moved = moveChannelKey(cs, x, 0, 'outer', o0 + 1, stations, 1);
    const shift = (v: number) => valueAt(moved[0]!.outer, v) - valueAt(cs[0]!.outer, v);
    expect(shift(x)).toBeCloseTo(1, 9);
    expect(valueAt(moved[1]!.inner!, x)).toBeCloseTo(o0 + 1, 9);
    // Out to the next cross-section (or the start), easing smoothly.
    const before = Math.max(P.start, ...stations.filter((v) => v < x));
    const after = inside[1]!;
    expect(shift(before)).toBeCloseTo(0, 9);
    expect(shift(after)).toBeCloseTo(0, 9);
    expect(shift(after + 5)).toBeCloseTo(0, 9);
    const steps = 20;
    let last = 1;
    for (let j = 1; j < steps; j++) {
      const s = shift(x + ((after - x) * j) / steps);
      expect(s).toBeLessThanOrEqual(last + 1e-3);
      expect(s).toBeGreaterThan(-1e-3);
      last = s;
    }
    expect(shift((x + after) / 2)).toBeGreaterThan(0.3);
    expect(shift((x + after) / 2)).toBeLessThan(0.7);
  });

  it('move a depth, adding a key where a cross-section has none yet', () => {
    const cs = boardChannels(applied);
    const at = (inside[0]! + inside[1]!) / 2;
    const moved = moveChannelKey(cs, at, 1, 'depth', 0.8, stations);
    expect(valueAt(moved[1]!.depth, at)).toBeCloseTo(0.8, 9);
    expect(valueAt(moved[0]!.depth, at)).toBeCloseTo(valueAt(cs[0]!.depth, at), 9);
    const b = withChannels({ from: 'drawn', channels: moved, params: P });
    const mesh = tessellateBoard(b, { lengthSteps: 40, ringSteps: 40 });
    expect(mesh.positions.every(Number.isFinite)).toBe(true);
  });
});

describe('channel points in plan and along the board', () => {
  const cs = boardChannels(applied);

  it('put a point on each wall at its ends and every cross-section, shared walls once', () => {
    const keys = channelPlanKeys(cs, stations);
    const xs = [P.start, ...inside, P.end];
    // Channel 0: inner and outer (shared with channel 1's inner); channel 1: outer.
    expect(keys).toHaveLength(xs.length * 3);
    const shared = keys.filter((k) => k.k === 0 && k.part === 'outer');
    expect(shared.every((k) => k.joined === 1)).toBe(true);
    expect(keys.some((k) => k.k === 1 && k.part === 'inner')).toBe(false);
    const k = keys.find((q) => q.k === 1 && q.part === 'outer' && q.x === inside[0])!;
    expect(k.value).toBeCloseTo(valueAt(cs[1]!.outer, inside[0]!), 9);
  });

  it('move a wall at its tail end, easing out to the first cross-section', () => {
    const before = valueAt(cs[1]!.outer, P.start);
    const moved = moveChannelKey(cs, P.start, 1, 'outer', before + 2, stations);
    expect(valueAt(moved[1]!.outer, P.start)).toBeCloseTo(before + 2, 9);
    expect(valueAt(moved[1]!.outer, inside[0]!)).toBeCloseTo(valueAt(cs[1]!.outer, inside[0]!), 9);
  });

  it('bend a wall shaped with handles in place: its points and handles kept, smooth where moved', () => {
    // A wall reshaped in the outline view: a point added midway, its handles pulled.
    const w = cs[1]!.outer;
    const [a, z] = [w.knots[0]!, w.knots[w.knots.length - 1]!];
    const mid = (a.end.x + z.end.x) / 2;
    const shaped = splineFromKnots([
      { ...a, tangentToNext: vec2(a.end.x + 5, a.end.y + 1) },
      knotFromArray(
        [mid, a.end.y + 3, mid - 8, a.end.y + 3.5, mid + 8, a.end.y + 2.5],
        true,
        false,
      ),
      { ...z, tangentToPrev: vec2(z.end.x - 5, z.end.y) },
    ]);
    const x = inside.find((v) => v > a.end.x && v < mid)!;
    const target = valueAt(shaped, x) + 1;
    const moved = moveChannelKey([{ ...cs[1]!, outer: shaped }], x, 0, 'outer', target, stations)[0]!.outer; // prettier-ignore
    expect(valueAt(moved, x)).toBeCloseTo(target, 9);
    // One point added, at the cross-section; the others where they were drawn, those past
    // the neighbouring cross-sections untouched, handles and all.
    expect(moved.knots).toHaveLength(4);
    // (Splitting the curve at the cross-section shortens the handles either side: the
    // same shape.)
    expect(moved.knots[0]!.end).toEqual(shaped.knots[0]!.end);
    const hi = Math.min(...stations.filter((v) => v > x), z.end.x);
    for (const k of shaped.knots.filter((q) => q.end.x >= hi))
      expect(moved.knots).toContainEqual(k);
    // The new point is smooth: its handles in line.
    const p = moved.knots.find((k) => Math.abs(k.end.x - x) < 1e-6)!;
    const cross = (p.tangentToPrev.x - p.end.x) * (p.tangentToNext.y - p.end.y) - (p.tangentToPrev.y - p.end.y) * (p.tangentToNext.x - p.end.x); // prettier-ignore
    expect(Math.abs(cross)).toBeLessThan(1e-9);
  });

  it("put a depth point at the ends and each cross-section, and move every channel's", () => {
    const keys = channelDepthKeys(cs, stations);
    expect(keys.map((k) => k.x)).toEqual([P.start, ...inside, P.end]);
    const x = inside[0]!;
    const moved = moveChannelDepths(cs, x, 0.2, stations);
    for (let i = 0; i < cs.length; i++) {
      expect(valueAt(moved[i]!.depth, x)).toBeCloseTo(valueAt(cs[i]!.depth, x) + 0.2, 9);
    }
  });

  it('draw the walls in plan and the depth above the bottom', () => {
    const lines = channelPlanLines(cs);
    expect(lines).toHaveLength(4);
    expect(lines[0]![0]!.x).toBeCloseTo(P.start, 9);
    const line = channelDepthLine(cs, () => 10);
    const mid = line.find((p) => p.x >= 40)!;
    expect(mid.y).toBeCloseTo(10.5, 3); // full depth over a flat bottom at 10
    expect(channelDepthLine([], () => 0)).toEqual([]);
  });
});
