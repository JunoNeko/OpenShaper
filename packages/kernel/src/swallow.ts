// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Swallow tail (print version): the notch, its inside wall, and the line where that wall
 * meets the deck.
 *
 * The notch itself is the outline (`outline-cutout.ts`): it folds back from the notch
 * bottom on the stringer to the tip, and the person shapes it with the outline's own
 * points and handles. What the outline can't say is how the inside wall climbs from the
 * bottom to the deck. That is the board's `swallow` setting:
 *
 * - **Beveled:** a straight wall leaning out by `angle` from upright. At height `h` of a
 *   wall `t` high it stands `h·tan(angle)` back from the bottom's edge.
 * - **Rounded:** upright from the bottom, then a quarter round into the deck of radius
 *   `size·t`: a rail on the notch's inside.
 *
 * Every height of the wall is the notch line offset in plan, into the foam, by that
 * amount. The top of the wall is the deck line, drawn dashed in the outline view. Past
 * the notch bottom the offsets still meet on the stringer, further forward the higher
 * they are, so the deck is notched a little further than the bottom: a V that runs out
 * at the deck line's point. A board without the setting keeps the upright wall it
 * always had.
 *
 * The thickness `t` is the board's at the stringer at that station (deck less bottom).
 * Near the tip, where the foam between the notch and the rail runs out, every offset is
 * eased under 60 % of what is left, so the wall never reaches the rail.
 */
import { splineFromKnots, valueAt, type Spline } from './bezier-spline';
import { splitCurve } from './bezier-curve';
import { knot, withHandles, type Knot } from './knot';
import { cachedOutlineSegments, hasTailCutout, yInOut } from './outline-cutout';
import { vec2, type Vec2 } from './vec2';

/** How the inside wall climbs from the bottom to the deck. */
export type SwallowWall =
  | { readonly kind: 'bevel'; /** Degrees from upright. */ readonly angle: number }
  | {
      readonly kind: 'round';
      /** Radius as a share of the thickness, 0–1. */ readonly size: number;
    };

/** The steepest lean a beveled wall may take, in degrees from upright. */
export const MAX_BEVEL = 75;
export const DEFAULT_SWALLOW_WALL: SwallowWall = { kind: 'bevel', angle: 45 };
/** The notch a new swallow gets (cm): 100 mm across the mouth, 100 mm deep. */
export const DEFAULT_SWALLOW_SIZE = { width: 10, depth: 10 } as const;
/** Share of the foam left between the notch and the rail the wall may take. */
const WALL_ROOM = 0.6;
/** The deck line's half-width (cm) under which the V ends. */
const V_END = 0.02;
/** Points on the inside wall at each station, below the deck's edge. */
export const SWALLOW_WALL_POINTS = 12;

/** The wall's setting, kept in range. */
export const clampWall = (w: SwallowWall): SwallowWall =>
  w.kind === 'bevel'
    ? { kind: 'bevel', angle: Math.min(MAX_BEVEL, Math.max(0, w.angle)) }
    : { kind: 'round', size: Math.min(1, Math.max(0, w.size)) };

/** How far back (plan) the wall stands from the bottom's edge at height `h` of `t`. */
export const wallOffset = (w: SwallowWall, h: number, t: number): number => {
  if (!(t > 0)) return 0;
  const hh = Math.min(t, Math.max(0, h));
  if (w.kind === 'bevel') return hh * Math.tan((w.angle * Math.PI) / 180);
  const r = w.size * t;
  const below = hh - (t - r);
  return below <= 0 ? 0 : r - Math.sqrt(Math.max(0, r * r - below * below));
};

/** The height at which the wall stands `o` back: the inverse of `wallOffset`. */
const heightForOffset = (w: SwallowWall, o: number, t: number): number => {
  // A rounded wall stands upright to t − r: the highest height still not set back.
  if (o <= 0) return w.kind === 'bevel' ? 0 : t - w.size * t;
  if (w.kind === 'bevel') {
    const k = Math.tan((w.angle * Math.PI) / 180);
    return k > 0 ? o / k : t;
  }
  const r = w.size * t;
  if (o >= r) return t;
  return t - r + Math.sqrt(Math.max(0, r * r - (r - o) * (r - o)));
};

/** The notch line in plan, from the notch bottom to the tip. */
interface NotchLine {
  readonly pts: readonly Vec2[];
  readonly tangents: readonly Vec2[];
  /** Where the wall `o` back meets the stringer: `x0 + o·k`. */
  readonly x0: number;
  readonly k: number;
  /** Which way the notch line is carried on across the stringer (toward the tip). */
  readonly d0: Vec2;
  /** The notch bottom (largest x of the bottom's notch). */
  readonly apex: number;
}

const unit = (v: Vec2): Vec2 => {
  const l = Math.hypot(v.x, v.y);
  return l > 0 ? vec2(v.x / l, v.y / l) : vec2(0, 1);
};

const LINE_CACHE = new WeakMap<Spline, NotchLine | null>();

const notchLine = (outline: Spline): NotchLine | null => {
  if (LINE_CACHE.has(outline)) return LINE_CACHE.get(outline)!;
  let line: NotchLine | null = null;
  if (hasTailCutout(outline)) {
    const pts = cachedOutlineSegments(outline).tailInner.map((p) => vec2(p.x, Math.abs(p.y)));
    if (pts.length >= 2) {
      const n = pts.length;
      const tangents = pts.map(
        (_, i) =>
        unit(vec2(pts[Math.min(n - 1, i + 1)]!.x - pts[Math.max(0, i - 1)]!.x, pts[Math.min(n - 1, i + 1)]!.y - pts[Math.max(0, i - 1)]!.y)), // prettier-ignore
      );
      const t0 = tangents[0]!;
      // Leaving the stringer at a shallow angle would carry the deck's V far forward.
      const d0 = unit(vec2(t0.x, Math.max(t0.y, 0.25)));
      const p0 = pts[0]!;
      line = {
        pts,
        tangents,
        x0: p0.x - (p0.y * d0.x) / d0.y,
        k: 1 / d0.y,
        d0,
        apex: pts.reduce((m, p) => Math.max(m, p.x), -Infinity),
      };
    }
  }
  LINE_CACHE.set(outline, line);
  return line;
};

/** The notch line's direction where it crosses station `x` (blended between its samples). */
const tangentAt = (line: NotchLine, x: number): Vec2 => {
  const { pts, tangents } = line;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i]!;
    const b = pts[i + 1]!;
    if ((x <= a.x && x >= b.x) || (x >= a.x && x <= b.x)) {
      const f = b.x === a.x ? 0 : (x - a.x) / (b.x - a.x);
      const ta = tangents[i]!;
      const tb = tangents[i + 1]!;
      return unit(vec2(ta.x + (tb.x - ta.x) * f, ta.y + (tb.y - ta.y) * f));
    }
  }
  return tangents[tangents.length - 1]!;
};

/** The flattest a notch line is taken to cross a station (|cos| of its angle to it). */
const MIN_CROSSING = 1e-3;

/**
 * Half-width at `x` of the wall `o` back from the notch line, unclamped: `o` across the
 * line, measured along the station (so `o / |t.x|` out from the bottom's edge `from`,
 * `t` the line's direction there). Where the line turns to run across the board, as it
 * does round a curled tip, this grows smoothly and the room left (`swallowStation`)
 * eases it in. (Measured as a true distance or square to the line, it jumped where the
 * line came within `o` of the whole station: a step across the deck and a ragged deck
 * line behind it, owner report 2026-11.) Past the notch bottom, the line carried
 * straight on across the stringer: the two sides meet there in a sharp V.
 */
const offsetY = (line: NotchLine, o: number, x: number, from: number): number => {
  if (!(o > 0)) return from;
  if (x >= line.apex) {
    const run = Math.abs(line.d0.x);
    const ahead = line.x0 + o * line.k - x;
    if (ahead <= 0) return 0;
    return run < MIN_CROSSING ? from + o / MIN_CROSSING : (ahead * line.d0.y) / run;
  }
  return from + o / Math.max(Math.abs(tangentAt(line, x).x), MIN_CROSSING);
};

/** A smooth minimum of two non-negative numbers. */
const smin = (a: number, b: number): number =>
  a <= 0 || b <= 0 ? 0 : (a * b) / Math.pow(a ** 4 + b ** 4, 0.25);

/** The board's thickness at the stringer at `x` (deck less bottom). */
export const stringerThicknessAt = (b: { deck: Spline; bottom: Spline }, x: number): number =>
  Math.max(0, valueAt(b.deck, x) - valueAt(b.bottom, x));

type SwallowBoard = { outline: Spline; deck: Spline; bottom: Spline; swallow?: SwallowWall };

/** Samples of the wall's profile when spacing its points along it. */
const PROFILE_SAMPLES = 64;

/**
 * `points` heights (shares of `t`) from just under the top down to `u0`, evenly spaced
 * along the wall's profile in its section (`offset` against height).
 */
const profileStations = (
  offset: (h: number) => number,
  t: number,
  u0: number,
  points: number,
): number[] => {
  const us: number[] = [];
  const len: number[] = [0];
  let prev = { o: offset(t), h: t };
  for (let i = 1; i <= PROFILE_SAMPLES; i++) {
    const u = 1 - ((1 - u0) * i) / PROFILE_SAMPLES;
    const q = { o: offset(u * t), h: u * t };
    len.push(len[i - 1]! + Math.hypot(q.o - prev.o, q.h - prev.h));
    prev = q;
  }
  const total = len[PROFILE_SAMPLES]!;
  for (let k = 1; k <= points; k++) {
    if (k === points || !(total > 0)) {
      us.push(1 - ((1 - u0) * k) / points);
      continue;
    }
    const target = (total * k) / points;
    let i = 1;
    while (i < PROFILE_SAMPLES && len[i]! < target) i++;
    const f = (target - len[i - 1]!) / (len[i]! - len[i - 1]! || 1);
    us.push(1 - ((1 - u0) * (i - 1 + f)) / PROFILE_SAMPLES);
  }
  return us;
};

/** How far in from the notch's edge (cm) its squeeze reaches across a station, at least. */
export const SQUEEZE_REACH = 4;

/** A smooth minimum, never more than either, rounding the corner over about `soft`. */
const softMin = (a: number, b: number, soft: number): number =>
  (a + b - Math.sqrt((a - b) * (a - b) + soft * soft)) / 2;

/** A smooth maximum, rounding the corner over about `soft`. */
const smax = (a: number, b: number, soft: number): number =>
  (a + b + Math.sqrt((a - b) * (a - b) + soft * soft)) / 2;

/**
 * Where profile point `px` (0 at the stringer, `yOut` at the rail) goes on a station
 * notched to `edge`: the foam squeezed into [edge, yOut] within a reach of the edge,
 * `edge·(1 − px/reach)^k` added, and nothing past it moved. Squeezed evenly out to the
 * rail instead, the whole section moved with the notch, and where the notch closes onto
 * the stringer that motion stopped dead: a faint crease right across the deck and rail
 * (owner report, 2026-11). The reach is {@link SQUEEZE_REACH}, or 2.5 notches' width
 * where that is more, up to the rail; `k` (2 near the stringer) eases to 1, the even
 * squeeze, only where the notch takes most of the width (near a tip), so the squeeze is
 * never steeper than 0.9 and never folds. Strictly increasing in `px`, smooth along the
 * board.
 */
export const notchSqueeze =
  (edge: number, yOut: number) =>
  (px: number): number => {
    if (!(edge > 0)) return px;
    if (!(yOut > 0)) return edge;
    // Every limit rounded (a hard one turns the squeeze sharply along the board: a crease).
    const reach = softMin(yOut, smax(SQUEEZE_REACH, 2.5 * edge, 0.5), 1);
    const k = Math.max(1, softMin(2, (0.9 * reach) / edge, 0.3));
    return px < reach ? px + edge * (1 - px / reach) ** k : px;
  };

/** The profile point `notchSqueeze(edge, yOut)` puts at `y` (clamped into the station). */
export const notchUnsqueeze = (edge: number, yOut: number, y: number): number => {
  const m = notchSqueeze(edge, yOut);
  if (y <= m(0)) return 0;
  if (y >= yOut) return yOut;
  let lo = 0;
  let hi = yOut;
  for (let i = 0; i < 50; i++) {
    const mid = (lo + hi) / 2;
    if (m(mid) < y) lo = mid;
    else hi = mid;
  }
  return (lo + hi) / 2;
};

/** The inside wall at one station. */
export interface SwallowStation {
  /** Half-width of the bottom's notch edge (0 forward of the notch bottom). */
  readonly yB: number;
  /** Half-width of the deck's notch edge: the deck line. */
  readonly yD: number;
  /**
   * The wall below the deck's edge, top down: half-width and height as a share of the
   * thickness. The last point is the bottom's edge, or on the stringer where the V
   * between the notch bottom and the deck line closes.
   */
  readonly wall: readonly { y: number; u: number }[];
}

/**
 * The inside wall at station `x`, or null where the deck isn't notched (forward of the
 * deck line's point, or a board with an upright wall).
 */
export const swallowStation = (
  b: SwallowBoard,
  x: number,
  points = SWALLOW_WALL_POINTS,
): SwallowStation | null => {
  const w = b.swallow;
  const line = w ? notchLine(b.outline) : null;
  if (!w || !line) return null;
  const segments = cachedOutlineSegments(b.outline);
  const bounds = yInOut(segments, x);
  // Not rounded to the stringer near the notch bottom (as an upright wall's mesh is):
  // the wall would close onto the bottom there and pinch the two halves together.
  const yB = bounds.yIn > 1e-9 ? bounds.yIn : 0;
  const yOut = Math.max(bounds.yOut, yB);
  const t = stringerThicknessAt(b, x);
  const room = WALL_ROOM * (yOut - yB);
  const yAt = (o: number): number =>
    o <= 0 ? yB : yB + smin(Math.max(0, offsetY(line, o, x, yB) - yB), room);
  const top = wallOffset(w, t, t);
  // Height where the wall leaves the stringer: 0 inside the bottom's notch.
  const need = (x - line.x0) / line.k;
  if (yB === 0 && !(need < top)) return null;
  // The V's last sliver, before the deck line's point, would only make slivers of mesh.
  if (yB === 0 && yAt(top) < V_END) return null;
  // Short of room (toward a tip), the wall is made smaller whole, about its top: a round
  // stays round, a bevel keeps its angle, upright below. Squeezed only across, it stood
  // steep with a pinched corner at the deck, a nob on each tip (owner report, 2026-11).
  // In the V there is room enough: as it was.
  const full = offsetY(line, top, x, yB) - yB;
  const scale = yB > 0 && full > 0 ? smin(full, room) / full : 1;
  const offset = (h: number): number => scale * wallOffset(w, t - (t - Math.min(t, h)) / scale, t);
  const h0 = yB > 0 ? 0 : heightForOffset(w, Math.max(0, need), t);
  const u0 = t > 0 ? h0 / t : 0;
  // Evenly along the wall's profile, not its height: a rounded wall turns into the deck
  // over its last few millimetres of height, which even heights left as one long facet
  // (a crease along the deck line; owner report, 2026-11).
  // Spaced on the full-size wall and carried onto the smaller one, so they stay on its
  // round as it shrinks (respaced on the smaller wall, they slid between the round and
  // the upright part below from station to station: a sawtooth); the last on the bottom.
  const us = profileStations((h) => wallOffset(w, h, t), t, u0, points).map((u, k) =>
    k === points - 1 ? u0 : 1 - (1 - u) * scale,
  );
  const yOf = (o: number): number => (yB > 0 ? (o <= 0 ? yB : offsetY(line, o, x, yB)) : yAt(o));
  const wall = us.map((u, k) => ({
    y: k === points - 1 && yB === 0 ? 0 : yOf(offset(u * t)),
    u,
  }));
  return { yB, yD: yOf(offset(t)), wall };
};

/** Where a set wall's area turns sharply: the notch bottom and the deck line's point. */
export const swallowBreaks = (b: SwallowBoard): number[] => {
  const line = b.swallow ? notchLine(b.outline) : null;
  if (!line) return [];
  const apex = swallowDeckApex(b);
  return apex !== null && apex > line.apex ? [line.apex, apex] : [line.apex];
};

/** Where the deck line meets the stringer, or null without a set wall. */
export const swallowDeckApex = (b: SwallowBoard): number | null => {
  const w = b.swallow;
  const line = w ? notchLine(b.outline) : null;
  if (!w || !line) return null;
  // x = x0 + k·top(t(x)): settle it by halving (the thickness changes slowly).
  const g = (x: number) => line.x0 + line.k * wallOffset(w, stringerThicknessAt(b, x), stringerThicknessAt(b, x)) - x; // prettier-ignore
  let lo = line.x0;
  let hi = line.x0 + 1;
  for (let i = 0; i < 20 && g(hi) > 0; i++) hi = line.x0 + (hi - line.x0) * 2;
  for (let i = 0; i < 50; i++) {
    const m = (lo + hi) / 2;
    if (g(m) > 0) lo = m;
    else hi = m;
  }
  return (lo + hi) / 2;
};

/** The deck line in plan, tail to its point on the stringer (empty without a set wall). */
export const swallowDeckLine = (b: SwallowBoard, n = 96): Vec2[] => {
  const end = swallowDeckApex(b);
  if (end === null) return [];
  const out: Vec2[] = [];
  const start = 0.01;
  for (let i = 0; i <= n; i++) {
    // Closer together toward the stringer, where the line turns.
    const u = i / n;
    const x = start + (end - start) * (1 - (1 - u) * (1 - u));
    const s = i === n ? null : swallowStation(b, x, 1);
    out.push(vec2(x, s ? s.yD : 0));
  }
  return out;
};

/**
 * The wall that puts the deck line's point at `x`: the same kind, its angle or size set
 * to fit. Clamped to the wall's range; the notch bottom when `x` is behind it.
 */
export const wallForDeckApex = (b: SwallowBoard, x: number): SwallowWall | null => {
  const w = b.swallow;
  if (!w) return null;
  const make = (p: number): SwallowWall =>
    w.kind === 'bevel' ? { kind: 'bevel', angle: p * MAX_BEVEL } : { kind: 'round', size: p };
  const apex = (p: number) => swallowDeckApex({ ...b, swallow: make(p) }) ?? 0;
  let lo = 0;
  let hi = 1;
  if (apex(hi) <= x) return make(hi);
  if (apex(lo) >= x) return make(lo);
  for (let i = 0; i < 40; i++) {
    const m = (lo + hi) / 2;
    if (apex(m) < x) lo = m;
    else hi = m;
  }
  return make((lo + hi) / 2);
};

// --- the notch in the outline ---

/** The notch an outline has, read off its points: width across the mouth, depth. */
export const swallowSize = (outline: Spline): { width: number; depth: number } | null => {
  if (!hasTailCutout(outline)) return null;
  const tip = tipIndex(outline);
  return { width: 2 * Math.abs(outline.knots[tip]!.end.y), depth: outline.knots[0]!.end.x };
};

const tipIndex = (outline: Spline): number => {
  let tip = 0;
  outline.knots.forEach((k, i) => {
    if (k.end.x < outline.knots[tip]!.end.x) tip = i;
  });
  return tip;
};

const third = (from: Vec2, to: Vec2): Vec2 =>
  vec2(from.x + (to.x - from.x) / 3, from.y + (to.y - from.y) / 3);

/** The outline with any notch filled: a square tail from the stringer out to the tip. */
export const plainTailOutline = (outline: Spline): Spline => {
  if (!hasTailCutout(outline)) return outline;
  const tip = tipIndex(outline);
  const t = outline.knots[tip]!;
  const start = vec2(0, 0);
  const tipEnd = vec2(0, t.end.y);
  return splineFromKnots([
    knot(start, start, third(start, tipEnd), false),
    knot(tipEnd, third(tipEnd, start), t.tangentToNext, false),
    ...outline.knots.slice(tip + 1),
  ]);
};

/**
 * The outline with a straight-sided notch `width` across its mouth and `depth` deep, in
 * place of its tail: the notch bottom on the stringer, the tip where the outline is
 * `width/2` wide, moved back to the tail. Null when the outline is never that wide or
 * the notch would be shallower than the tip.
 */
export const swallowTailOutline = (
  outline: Spline,
  width: number,
  depth: number,
): Spline | null => {
  const plain = plainTailOutline(outline);
  const half = width / 2;
  if (!(half > 0) || !(depth > 0)) return null;
  // The first span to reach the half-width, from the stringer.
  for (let i = 0; i < plain.curves.length; i++) {
    const c = plain.coeffs[i]!;
    const yAt = (t: number) => ((c.ay * t + c.by) * t + c.cy) * t + c.dy;
    const steps = 64;
    let prev = yAt(0);
    for (let s = 1; s <= steps; s++) {
      const y = yAt(s / steps);
      if (prev < half && y >= half) {
        let lo = (s - 1) / steps;
        let hi = s / steps;
        for (let j = 0; j < 50; j++) {
          const m = (lo + hi) / 2;
          if (yAt(m) < half) lo = m;
          else hi = m;
        }
        return notched(plain, i, (lo + hi) / 2, depth);
      }
      prev = y;
    }
  }
  return null;
};

const notched = (plain: Spline, index: number, t: number, depth: number): Spline | null => {
  const split = splitCurve(plain.curves[index]!, t);
  const after = plain.knots[index + 1]!;
  // The tip at the tail, with the rail running on from where the outline was this wide.
  const shift = -split.mid.end.x;
  const tip = vec2(0, split.mid.end.y);
  const next = vec2(split.mid.tangentToNext.x + shift, split.mid.tangentToNext.y);
  if (!(depth > 1e-3)) return null;
  const apex = vec2(depth, 0);
  const knots: Knot[] = [
    knot(apex, apex, third(apex, tip), false),
    knot(tip, third(tip, apex), next, false),
    withHandles(after, split.endTangentToPrev, after.tangentToNext),
    ...plain.knots.slice(index + 2),
  ];
  return splineFromKnots(knots);
};
