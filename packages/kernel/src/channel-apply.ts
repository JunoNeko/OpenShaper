// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Applying typed-in channels, and reshaping them a cross-section at a time (print
 * version, owner request 2026-11).
 *
 * **Apply** turns channels typed in as numbers into drawn ones. Each wall becomes a curve
 * with few points, to reshape in the outline view by its points and handles: a straight
 * wall its two ends, a curved one a point at each cross-section it passes. Each
 * channel's depth gets a key at every cross-section the channels pass (and at their
 * ends, where full depth begins and ends, and in between where the cross-sections are
 * far apart). The numbers are kept with
 * them, so **Reset** can go back.
 *
 * A key is a point the curve passes through with a slope; the curve runs through the
 * keys, each handle a third of the way to its neighbour (a Hermite curve as Bézier).
 * Moving the key at a cross-section moves the keys between it and the cross-sections
 * either side by an eased share, so the channel changes smoothly from one cross-section
 * to the next and nowhere else.
 *
 * The cut itself is unchanged: drawn channels go through the same loft as typed-in ones
 * (`loft.ts`), walls kept crisp between stations. Nothing is written into the
 * cross-section curves, which the loft blends point by point and would smear.
 */
import { curveFromPoints, splitCurve, tForX, xDeriv, xValue } from './bezier-curve';
import { findSegment, splineFromKnots, valueAt, type Spline } from './bezier-spline';
import type { BezierBoard } from './board';
import {
  channelDepthShare,
  layoutChannels,
  type BoardChannels,
  type ChannelParams,
} from './channel-layout';
import { channelFullDepth, splineSpan, type BottomChannel } from './channels';
import { knot } from './knot';
import { vec2, type Vec2 } from './vec2';

/** A point a curve passes through, and its slope there. */
interface Key {
  readonly x: number;
  readonly y: number;
  readonly slope: number;
}

/** How far (cm) an applied wall may stray from the laid-out one before it gets another point. */
const WALL_FIT = 0.02;

/** Keys closer than this along the board are the same key (cm). */
const SAME_X = 1e-6;
/** Step for slopes taken numerically (cm). */
const SLOPE_STEP = 1e-3;

/** The curve through `keys` (ascending x), each handle a third of the way to its neighbour. */
const through = (keys: readonly Key[]): Spline =>
  splineFromKnots(
    keys.map((k, i) => {
      const hp = i > 0 ? (k.x - keys[i - 1]!.x) / 3 : 0;
      const hn = i < keys.length - 1 ? (keys[i + 1]!.x - k.x) / 3 : 0;
      return knot(
        vec2(k.x, k.y),
        vec2(k.x - hp, k.y - k.slope * hp),
        vec2(k.x + hn, k.y + k.slope * hn),
        true,
      );
    }),
  );

/** The keys of a curve made by {@link through} (or any curve running along x). */
const keysOf = (s: Spline): Key[] =>
  s.knots.map((k) => {
    const n = k.tangentToNext;
    const p = k.tangentToPrev;
    const dn = n.x - k.end.x;
    const dp = k.end.x - p.x;
    const slope =
      Math.abs(dn) > 1e-12 ? (n.y - k.end.y) / dn : Math.abs(dp) > 1e-12 ? (k.end.y - p.y) / dp : 0;
    return { x: k.end.x, y: k.end.y, slope };
  });

/** The slope of `f` at `x`, taken inside [a, b]. */
const slopeOf = (f: (x: number) => number, x: number, a: number, b: number): number => {
  const lo = Math.max(a, x - SLOPE_STEP);
  const hi = Math.min(b, x + SLOPE_STEP);
  return hi > lo ? (f(hi) - f(lo)) / (hi - lo) : 0;
};

/** The keys of `f` at `xs` (ascending, duplicates dropped), slopes taken inside [a, b]. */
const keysAt = (f: (x: number) => number, xs: readonly number[], a: number, b: number): Key[] => {
  const out: Key[] = [];
  for (const x of [...xs].sort((p, q) => p - q)) {
    if (x < a - SAME_X || x > b + SAME_X) continue;
    if (out.length && Math.abs(out[out.length - 1]!.x - x) < SAME_X) continue;
    out.push({ x, y: f(x), slope: slopeOf(f, x, a, b) });
  }
  return out;
};

/**
 * `s` with its value at `x` set to `y` (a key added there if it had none), the change
 * easing out to nothing at the cross-sections either side of `x` (or the curve's ends):
 * every key between them moves by its share, so the curve changes smoothly from one
 * cross-section to the next, not just between the keys nearest `x`.
 */
const withKeyAt = (s: Spline, x: number, y: number, stations: readonly number[]): Spline => {
  const keys = keysOf(s);
  const [a, b] = splineSpan(s);
  if (!keys.some((k) => Math.abs(k.x - x) < SAME_X)) {
    const at = (v: number) => valueAt(s, v);
    keys.push({ x, y: at(x), slope: slopeOf(at, x, a, b) });
    keys.sort((p, q) => p.x - q.x);
  }
  const here = keys.find((k) => Math.abs(k.x - x) < SAME_X)!;
  const delta = y - here.y;
  const lo = Math.max(a, ...stations.filter((v) => v < x - SAME_X));
  const hi = Math.min(b, ...stations.filter((v) => v > x + SAME_X));
  return through(
    keys.map((k) => {
      if (Math.abs(k.x - x) < SAME_X) return { ...k, y };
      if (k.x <= lo || k.x >= hi) return k;
      // Smoothstep from the neighbour (0) to here (1), and its slope along the board.
      const before = k.x < x;
      const t = before ? (k.x - lo) / (x - lo) : (hi - k.x) / (hi - x);
      const w = t * t * (3 - 2 * t);
      const dw = ((6 * t * (1 - t)) / (before ? x - lo : hi - x)) * (before ? 1 : -1);
      return { x: k.x, y: Math.max(0, k.y + delta * w), slope: k.slope + delta * dw };
    }),
  );
};

/** The longest stretch left between keys (cm): a wall following the outline stays true. */
const MAX_KEY_GAP = 8;

/** `xs` sorted, with keys added evenly wherever two are more than {@link MAX_KEY_GAP} apart. */
const filled = (xs: readonly number[]): number[] => {
  const sorted = [...xs].sort((a, b) => a - b);
  const out: number[] = [];
  sorted.forEach((x, i) => {
    if (i > 0) {
      const prev = sorted[i - 1]!;
      const n = Math.ceil((x - prev) / MAX_KEY_GAP);
      for (let j = 1; j < n; j++) out.push(prev + ((x - prev) * j) / n);
    }
    out.push(x);
  });
  return out;
};

/**
 * Typed-in channels `p` on board `b`, applied: drawn, with a key on every wall and
 * depth curve at each of `stations` (the cross-sections' positions) inside the
 * channels, and the numbers kept for {@link resetChannels}.
 */
export const applyChannels = (
  b: BezierBoard,
  p: ChannelParams,
  stations: readonly number[],
): BoardChannels => {
  const laid = layoutChannels(b, p);
  const inside = stations.filter((x) => x > p.start + SAME_X && x < p.end - SAME_X);
  const wallXs = [p.start, ...inside, p.end];
  const depthXs = filled([p.start, p.fullFrom, p.fullTo, p.end, ...inside]);
  const depthAt = (x: number) => p.depth * channelDepthShare(p, x);
  // Walls get few points, to reshape in the outline view with their handles: a straight
  // wall its two ends, one that follows the outline a point at each cross-section it
  // passes (or midway, if none).
  const wall = (s: Spline): Spline => {
    const y0 = s.knots[0]?.end.y ?? 0;
    const straight = s.knots.every((k) => Math.abs(k.end.y - y0) < 1e-9);
    const xs = straight
      ? [p.start, p.end]
      : inside.length
        ? wallXs
        : [p.start, (p.start + p.end) / 2, p.end];
    const f = (x: number) => valueAt(s, x);
    // Midway points only where the curve through the others strays from the laid-out
    // wall: few points, the wall kept true.
    let keys = keysAt(f, xs, p.start, p.end);
    for (let pass = 0; pass < 6 && !straight; pass++) {
      const fit = through(keys);
      const extra: number[] = [];
      for (let i = 1; i < keys.length; i++) {
        const [a, z] = [keys[i - 1]!.x, keys[i]!.x];
        const off = Math.max(...[1, 2, 3, 4, 5, 6, 7].map((j) => { const x = a + ((z - a) * j) / 8; return Math.abs(valueAt(fit, x) - f(x)); })); // prettier-ignore
        if (off > WALL_FIT) extra.push((a + z) / 2);
      }
      if (!extra.length) break;
      keys = keysAt(f, [...keys.map((k) => k.x), ...extra], p.start, p.end);
    }
    return through(keys);
  };
  return {
    from: 'drawn',
    params: p,
    channels: laid.map((c) => ({
      inner: c.inner && wall(c.inner),
      outer: wall(c.outer),
      depth: through(keysAt(depthAt, depthXs, p.start, p.end)),
      wall: c.wall,
    })),
  };
};

/** Applied channels back to the numbers they were applied from, every edit dropped. */
export const resetChannels = (c: BoardChannels): BoardChannels | null =>
  c.from === 'drawn' && c.params ? { from: 'numbers', params: c.params } : null;

/** What a key on a channel moves: a wall across the board, or the depth. */
export type ChannelKeyPart = 'inner' | 'outer' | 'depth';

/**
 * `channels` with channel `k`'s `part` set to `value` at station `x` (cm out from the
 * stringer for a wall, cm deep for the depth), a key added there if it had none, the
 * change easing out to nothing at the `stations` (cross-sections) either side. A wall
 * that another channel shares (`joined`: the next one's inner wall on this one's outer)
 * moves with it, so channels side by side stay side by side.
 */
export const moveChannelKey = (
  channels: readonly BottomChannel[],
  x: number,
  k: number,
  part: ChannelKeyPart,
  value: number,
  stations: readonly number[],
  joined?: number,
): BottomChannel[] => {
  const v = Math.max(0, value);
  // Walls are bent in place, keeping the points and handles drawn in the outline view;
  // the depth, which has no handles to keep, is re-keyed.
  const set = (s: Spline) => bendAt(s, x, v, stations);
  return channels.map((c, i) => {
    if (i === k) {
      if (part === 'depth') return { ...c, depth: withKeyAt(c.depth, x, v, stations) };
      if (part === 'outer') return { ...c, outer: set(c.outer) };
      return c.inner ? { ...c, inner: set(c.inner) } : c;
    }
    if (i === joined && c.inner && part === 'outer') return { ...c, inner: set(c.inner) };
    return c;
  });
};

/** `s` with a point at `x` (its x span inside), splitting the curve there: its shape unchanged. */
const withPointAt = (s: Spline, x: number): Spline => {
  if (s.knots.some((k) => Math.abs(k.end.x - x) < SAME_X)) return s;
  const i = findSegment(s, x);
  if (i < 0) return s;
  const a = s.knots[i]!;
  const z = s.knots[i + 1]!;
  const c = s.coeffs[i]!;
  // To the last bit, so the new point lands on the cross-section itself.
  let t = tForX(c, x);
  for (let n = 0; n < 8 && Math.abs(x - xValue(c, t)) > 1e-12 && xDeriv(c, t) !== 0; n++) {
    t += (x - xValue(c, t)) / xDeriv(c, t);
  }
  if (!(t > 0 && t < 1)) return s;
  const cut = splitCurve(curveFromPoints(a.end, a.tangentToNext, z.tangentToPrev, z.end), t);
  return splineFromKnots([
    ...s.knots.slice(0, i),
    { ...a, tangentToNext: cut.startTangentToNext },
    knot(vec2(x, cut.mid.end.y), cut.mid.tangentToPrev, cut.mid.tangentToNext, true),
    { ...z, tangentToPrev: cut.endTangentToPrev },
    ...s.knots.slice(i + 2),
  ]);
};

/**
 * `s` bent so it passes through `y` at `x`, the bend easing out to nothing at the
 * cross-sections either side (or the curve's ends): each point moves by its eased share,
 * and its handles with it, tilted by the bend's slope there, so a smooth point stays
 * smooth. The points and handles drawn in the outline view are kept; a point is added
 * at `x` if there is none (the curve split there, unchanged).
 */
const bendAt = (s0: Spline, x: number, y: number, stations: readonly number[]): Spline => {
  const s = withPointAt(s0, x);
  const [a, b] = splineSpan(s);
  const delta = y - valueAt(s, x);
  const lo = Math.max(a, ...stations.filter((v) => v < x - SAME_X));
  const hi = Math.min(b, ...stations.filter((v) => v > x + SAME_X));
  /** The bend at `v` and its slope: smoothstep from each neighbour (0) to `x` (1). */
  const bend = (v: number): [number, number] => {
    if (Math.abs(v - x) < SAME_X) return [delta, 0];
    if (v <= lo || v >= hi) return [0, 0];
    const before = v < x;
    const span = before ? x - lo : hi - x;
    const t = before ? (v - lo) / span : (hi - v) / span;
    return [delta * t * t * (3 - 2 * t), ((delta * 6 * t * (1 - t)) / span) * (before ? 1 : -1)];
  };
  return splineFromKnots(
    s.knots.map((k) => {
      const [d, slope] = bend(k.end.x);
      if (d === 0 && slope === 0) return k;
      const move = (p: Vec2) => vec2(p.x, p.y + d + slope * (p.x - k.end.x));
      return { ...k, end: vec2(k.end.x, Math.max(0, k.end.y + d)), tangentToPrev: move(k.tangentToPrev), tangentToNext: move(k.tangentToNext) }; // prettier-ignore
    }),
  );
};

/** Where a curve can be dragged along the board: its ends and the cross-sections inside it. */
const editableXs = (s: Spline, stations: readonly number[]): number[] => {
  const [a, b] = splineSpan(s);
  return [a, ...stations.filter((x) => x > a + SAME_X && x < b - SAME_X), b];
};

/** A point on a channel wall in plan, to drag across the board in the outline view. */
export interface ChannelPlanKey {
  /** Stable for the board: `o1@30.48`. */
  readonly id: string;
  readonly k: number;
  readonly part: 'inner' | 'outer';
  /** The next channel, whose inner wall is this outer one: it moves too. */
  readonly joined?: number;
  readonly x: number;
  /** The wall's distance from the stringer (cm). */
  readonly value: number;
}

/**
 * The points of drawn channels' walls in plan: at each end and at every cross-section
 * (`stations`) the wall passes, side-by-side walls sharing one.
 */
export const channelPlanKeys = (
  channels: readonly BottomChannel[],
  stations: readonly number[],
): ChannelPlanKey[] => {
  const out: ChannelPlanKey[] = [];
  const near = (a: number, b: number) => Math.abs(a - b) < 1e-6;
  channels.forEach((c, k) => {
    const next = channels[k + 1];
    const prev = channels[k - 1];
    for (const x of editableXs(c.outer, stations)) {
      const yo = Math.max(0, valueAt(c.outer, x));
      if (c.inner) {
        const yi = Math.max(0, valueAt(c.inner, x));
        const shared = prev && near(Math.max(0, valueAt(prev.outer, x)), yi);
        if (!shared) out.push({ id: `i${k}@${x}`, k, part: 'inner', x, value: yi });
      }
      const joined = next?.inner && near(Math.max(0, valueAt(next.inner, x)), yo) ? k + 1 : undefined; // prettier-ignore
      out.push({ id: `o${k}@${x}`, k, part: 'outer', ...(joined !== undefined ? { joined } : {}), x, value: yo }); // prettier-ignore
    }
  });
  return out;
};

/** A point on the channels' depth along the board, to drag in the rocker view. */
export interface ChannelDepthKey {
  readonly id: string;
  readonly x: number;
  /** The deepest of the channels there (cm). */
  readonly value: number;
}

/** The depth points of drawn channels: at the ends and every cross-section they pass. */
export const channelDepthKeys = (
  channels: readonly BottomChannel[],
  stations: readonly number[],
): ChannelDepthKey[] => {
  const xs = new Map<string, number>();
  for (const c of channels) for (const x of editableXs(c.depth, stations)) xs.set(x.toFixed(6), x);
  return [...xs.values()]
    .sort((a, b) => a - b)
    .map((x) => ({
      id: `d@${x}`,
      x,
      value: Math.max(0, ...channels.map((c) => channelFullDepth(c, x))),
    }));
};

/**
 * `channels` with every channel's depth at `x` changed by `delta` (cm), each from its
 * own, easing out to the cross-sections either side: the rocker view's depth drag.
 */
export const moveChannelDepths = (
  channels: readonly BottomChannel[],
  x: number,
  delta: number,
  stations: readonly number[],
): BottomChannel[] =>
  channels.map((c) => {
    const [a, b] = splineSpan(c.depth);
    if (x < a - SAME_X || x > b + SAME_X) return c;
    return { ...c, depth: withKeyAt(c.depth, x, Math.max(0, valueAt(c.depth, x) + delta), stations) }; // prettier-ignore
  });

/** Points along each wall in plan, from end to end (for drawing). */
export const channelPlanLines = (channels: readonly BottomChannel[], n = 48): Vec2[][] => {
  const line = (s: Spline) => {
    const [a, b] = splineSpan(s);
    return Array.from({ length: n + 1 }, (_, i) => {
      const x = a + ((b - a) * i) / n;
      return vec2(x, Math.max(0, valueAt(s, x)));
    });
  };
  return channels.flatMap((c) => (c.inner ? [line(c.inner), line(c.outer)] : [line(c.outer)]));
};

/**
 * The channels' depth along the board as a line above the bottom rocker `bottom(x)`,
 * the deepest of them at each x (for drawing in the rocker view). Empty without depth.
 */
export const channelDepthLine = (
  channels: readonly BottomChannel[],
  bottom: (x: number) => number,
  n = 120,
): Vec2[] => {
  if (!channels.length) return [];
  const spans = channels.map((c) => splineSpan(c.depth));
  const a = Math.min(...spans.map((s) => s[0]));
  const b = Math.max(...spans.map((s) => s[1]));
  return Array.from({ length: n + 1 }, (_, i) => {
    const x = a + ((b - a) * i) / n;
    return vec2(x, bottom(x) + Math.max(0, ...channels.map((c) => channelFullDepth(c, x))));
  });
};
