// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Channels typed in as numbers, and the board's channels whichever way they were made.
 *
 * A board's channels are one of two things (`BezierBoard.channels`):
 *
 * - **numbers** ({@link ChannelParams}): how many, how deep, how long, where across. The
 *   wall and depth curves are generated from them and the board each time
 *   ({@link layoutChannels}), so channels set to follow the outline follow it as the
 *   outline is edited.
 * - **drawn**: the curves themselves, once a wall has been reshaped by hand. The numbers
 *   they started from are kept, for the parts that still apply (depth, wall shape).
 *
 * Either way the loft sees curves (`channels.ts`): straight channels are just straight
 * walls.
 */
import { splineFromKnots, type Spline } from './bezier-spline';
import { getLength, getThicknessAtPos, getWidthAtPos, type BezierBoard } from './board';
import {
  channelProblems,
  scaleChannels,
  scaleWall,
  type BottomChannel,
  type ChannelWall,
} from './channels';
import { knot } from './knot';
import { vec2 } from './vec2';

/**
 * Channels as a shaper types them in, laid out from one cross-section (`station`): their
 * widths and offsets are measured there. Full depth between `fullFrom` and `fullTo`,
 * fading to nothing at `start` and `end`. Lengths in cm, x from the tail.
 */
export interface ChannelParams {
  /** How many across the whole board: an odd count puts one on the stringer. */
  readonly count: number;
  readonly wall: ChannelWall;
  /** Each channel's width, side by side with no flat between. */
  readonly width: number;
  /** How deep they are cut at their deepest. */
  readonly depth: number;
  /** From the stringer to the first wall (an even count; an odd one starts on the stringer). */
  readonly inner: number;
  /**
   * How far the walls follow the outline: 0 runs them parallel to the stringer, 1 keeps
   * each wall's share of the half-width, in between is a blend.
   */
  readonly follow: number;
  /** Where the channels start toward the tail: 0 runs them out through it. */
  readonly start: number;
  /** Where they end toward the nose. */
  readonly end: number;
  /** The cross-section they are laid out from: widths, offset and follow are measured there. */
  readonly station: number;
  /**
   * Where full depth begins: the depth fades in from nothing at `start` to here. At
   * `start`, no fade: full depth out through the start (the tail, usually).
   */
  readonly fullFrom: number;
  /** Where full depth ends: from here it fades out to nothing at `end`. */
  readonly fullTo: number;
}

/** A board's channels: typed in, or drawn. */
export type BoardChannels =
  | { readonly from: 'numbers'; readonly params: ChannelParams }
  | {
      readonly from: 'drawn';
      readonly channels: readonly BottomChannel[];
      /** The numbers they were generated from, if they were. */
      readonly params?: ChannelParams;
    };

/** How far inside a square end its width is read, past a vertical edge (cm). */
const EDGE_INSET = 0.05;

/** Most channels the panel offers. */
export const MAX_CHANNELS = 9;

/** The narrowest a default channel is (cm). */
const MIN_DEFAULT_WIDTH = 2;
/** What the default channels leave between the outermost wall and the rail (cm). */
const DEFAULT_RAIL_ROOM = 3;
/** The least they leave where they leave the tail, a narrower place (cm). */
const TAIL_RAIL_ROOM = 1.5;

/**
 * A start for typed-in channels on `b`, laid out from the cross-section at `station`:
 * four steps, 5 cm wide, from 5 cm off the stringer, their lips rounded 5 mm, at full
 * depth out through the tail and fading out over the front half of their length.
 * Narrower where the board is too narrow there for that; following the outline in
 * where a tail is too narrow for them to run out parallel, and starting further up
 * where it is too narrow or thin even so (a pin, or the golden boards' pointed tails).
 */
export const defaultChannelParams = (b: BezierBoard, station: number): ChannelParams => {
  const L = getLength(b);
  const at = Math.min(L * 0.9, Math.max(0, station));
  const count = 4;
  const perSide = count / 2;
  const depth = 0.6;
  const half = (x: number) => getWidthAtPos(b, x) / 2;
  const room = (x: number) => half(x) - DEFAULT_RAIL_ROOM;
  let inner = 5;
  let width = 5;
  if (inner + perSide * width > room(at)) {
    // Whole millimetres: numbers a person would type.
    const mm = (v: number) => Math.floor(v * 10) / 10;
    inner = mm(Math.max(0, Math.min(inner, room(at) / 4)));
    width = mm(Math.max(MIN_DEFAULT_WIDTH, (room(at) - inner) / perSide));
  }
  const reach = inner + perSide * width;
  // Parallel if they fit out through the tail that way; else following the outline in.
  const fits = (x: number, follow: number) =>
    reach * (1 + (half(x) / half(at) - 1) * follow) <= half(x) - TAIL_RAIL_ROOM &&
    getThicknessAtPos(b, x) > depth * 2;
  const follow = fits(0, 0) ? 0 : 1;
  let start = 0;
  while (start < at && !fits(start, follow)) start += 1;
  const end = Math.min(L - 1, Math.max(at, start) + L / 3);
  return {
    count,
    wall: { shape: 'step', radius: 0, lip: 0.5 },
    width,
    depth,
    inner,
    follow,
    start,
    end,
    station: at,
    fullFrom: start,
    fullTo: Math.max(Math.min(at, end), start + (end - start) / 2),
  };
};

/** The walls across the board at the station: [inner or null, outer] per side channel. */
const wallsAcross = (p: ChannelParams): { readonly yi: number | null; readonly yo: number }[] => {
  const n = Math.round(p.count);
  if (!(n >= 1) || !(p.width > 0)) return [];
  const perSide = Math.floor(n / 2);
  const out: { yi: number | null; yo: number }[] = [];
  if (n % 2 === 1) {
    // A centred channel as wide as the rest: half of it each side of the stringer.
    const half = p.width / 2;
    out.push({ yi: null, yo: half });
    for (let k = 0; k < perSide; k++) out.push({ yi: half + k * p.width, yo: half + (k + 1) * p.width }); // prettier-ignore
  } else {
    const y0 = Math.max(0, p.inner);
    for (let k = 0; k < perSide; k++) out.push({ yi: y0 + k * p.width, yo: y0 + (k + 1) * p.width }); // prettier-ignore
  }
  return out;
};

/** Knots along a wall that follows the outline, and along the depth curve. */
const WALL_KNOTS = 13;
const DEPTH_KNOTS = 25;

/** A smooth curve through `pts` (Catmull-Rom tangents as Bézier handles). */
const smoothThrough = (pts: readonly (readonly [number, number])[]): Spline =>
  splineFromKnots(
    pts.map(([x, y], i) => {
      const p = pts[i - 1] ?? pts[i]!;
      const n = pts[i + 1] ?? pts[i]!;
      const tx = (n[0] - p[0]) / 6;
      const ty = (n[1] - p[1]) / 6;
      return knot(vec2(x, y), vec2(x - tx, y - ty), vec2(x + tx, y + ty), true);
    }),
  );

/** 0 to 1 with flat ends. */
const ease = (t: number) => {
  const v = Math.min(1, Math.max(0, t));
  return v * v * (3 - 2 * v);
};

/** The share of full depth at `x`: 1 from `fullFrom` to `fullTo`, easing to 0 at `start` and `end`. */
export const channelDepthShare = (p: ChannelParams, x: number): number => {
  if (x < p.start || x > p.end) return 0;
  const from = Math.min(p.end, Math.max(p.start, p.fullFrom));
  const to = Math.min(p.end, Math.max(from, p.fullTo));
  if (x < from) return ease((x - p.start) / (from - p.start));
  if (x > to) return ease((p.end - x) / (p.end - to));
  return 1;
};

/** Where the channels are: start to end. */
const span = (p: ChannelParams): readonly [number, number] => [p.start, p.end];

/** The depth along the board. */
const depthCurve = (p: ChannelParams): Spline => {
  const [x0, x1] = span(p);
  const xs = Array.from(
    { length: DEPTH_KNOTS },
    (_, i) => x0 + ((x1 - x0) * i) / (DEPTH_KNOTS - 1),
  );
  // Knots where full depth begins and ends, so the fades meet it flat.
  for (const x of [p.fullFrom, p.fullTo]) {
    if (x > x0 && x < x1 && xs.every((v) => Math.abs(v - x) > 1e-6)) xs.push(x);
  }
  xs.sort((a, b) => a - b);
  return smoothThrough(xs.map((x) => [x, p.depth * channelDepthShare(p, x)] as const));
};

/** The curves for typed-in channels on board `b`; none if there is nothing to cut. */
export const layoutChannels = (b: BezierBoard, p: ChannelParams): BottomChannel[] => {
  const [x0, x1] = span(p);
  if (!(x1 > x0) || !(p.depth > 0)) return [];
  const across = wallsAcross(p);
  const half = (x: number) => getWidthAtPos(b, x) / 2;
  const wRef = half(Math.min(getLength(b), Math.max(0, p.station)));
  if (!across.length || !(wRef > 0)) return [];
  const depth = depthCurve(p);
  const follow = Number.isFinite(p.follow) ? Math.min(1, Math.max(0, p.follow)) : 0;
  /** A wall `y` out from the stringer at the station. */
  const wall = (y: number): Spline => {
    if (follow === 0) {
      return splineFromKnots([
        knot(vec2(x0, y), vec2(x0, y), vec2(x0 + (x1 - x0) / 3, y), true),
        knot(vec2(x1, y), vec2(x1 - (x1 - x0) / 3, y), vec2(x1, y), true),
      ]);
    }
    const pts: [number, number][] = [];
    for (let i = 0; i < WALL_KNOTS; i++) {
      const x = x0 + ((x1 - x0) * i) / (WALL_KNOTS - 1);
      pts.push([x, Math.max(0, y * (1 + (half(x) / wRef - 1) * follow))]);
    }
    return smoothThrough(pts);
  };
  return across.map(({ yi, yo }) => ({
    inner: yi === null ? null : wall(yi),
    outer: wall(yo),
    depth,
    wall: p.wall,
  }));
};

const LAYOUT_CACHE = new WeakMap<BezierBoard, readonly BottomChannel[]>();

/** The channels cut into `b`, as curves: none unless it has some. Memoised per board. */
export const boardChannels = (b: BezierBoard): readonly BottomChannel[] => {
  const c = b.channels;
  if (!c) return [];
  if (c.from === 'drawn') return c.channels;
  let hit = LAYOUT_CACHE.get(b);
  if (!hit) {
    hit = layoutChannels(b, c.params);
    LAYOUT_CACHE.set(b, hit);
  }
  return hit;
};

/** What is wrong with `b`'s channels, said for the person making them. Empty if nothing. */
export const boardChannelProblems = (b: BezierBoard): string[] => {
  const c = b.channels;
  if (!c) return [];
  if (c.from === 'numbers') {
    const p = c.params;
    if (!(p.depth > 0)) return ['Channels need some depth.'];
    if (!(p.width > 0)) return ['Channels need some width.'];
    if (!(p.end > p.start)) return ['Channels must end further up the board than they start.'];
  }
  // A square end drawn with a vertical edge has no width at the tip itself, only a hair
  // inside: measure there, or a channel running out through it reads as off the bottom.
  const L = getLength(b);
  const half = (x: number) =>
    Math.max(getWidthAtPos(b, x), getWidthAtPos(b, Math.min(L, Math.max(0, x + (x < L / 2 ? EDGE_INSET : -EDGE_INSET))))) / 2; // prettier-ignore
  return channelProblems(boardChannels(b), half, (x) => getThicknessAtPos(b, x));
};

/** `p` on a board scaled by `fL` along, `fW` across and `fT` in thickness. */
const scaleParams = (p: ChannelParams, fL: number, fW: number, fT: number): ChannelParams => ({
  ...p,
  width: p.width * fW,
  depth: p.depth * fT,
  inner: p.inner * fW,
  start: p.start * fL,
  end: p.end * fL,
  station: p.station * fL,
  fullFrom: p.fullFrom * fL,
  fullTo: p.fullTo * fL,
  wall: scaleWall(p.wall, fW),
});

/** A board's channels scaled with it. */
export const scaleBoardChannels = (
  c: BoardChannels,
  fL: number,
  fW: number,
  fT: number,
): BoardChannels =>
  c.from === 'numbers'
    ? { from: 'numbers', params: scaleParams(c.params, fL, fW, fT) }
    : {
        from: 'drawn',
        channels: scaleChannels(c.channels, fL, fW, fT),
        ...(c.params ? { params: scaleParams(c.params, fL, fW, fT) } : {}),
      };
