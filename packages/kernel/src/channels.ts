// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Bottom channels: grooves cut up into the bottom, running along the board, usually
 * through the tail. (owner request, print version)
 *
 * ## What a channel is
 *
 * Two walls drawn in plan and a depth along the board:
 *
 * - `outer` and `inner` are curves in the outline's frame: x along the board (cm from
 *   the tail), y the distance from the stringer (cm). A straight channel has straight
 *   walls; a curved one, curved walls. `inner: null` is one channel centred on the
 *   stringer, spanning both sides of it.
 * - `depth` is a curve of x against how far the bottom is cut up (cm). The channel
 *   exists where `depth` is defined and positive: it ramps in, holds, runs out.
 * - `wall` says how the bottom steps down into the channel across the board.
 *
 * Boards are symmetric, so each channel is cut on both sides of the stringer.
 *
 * ## Why walls are curves, even for straight channels
 *
 * Designers draw curved channels (the owner's reference board has one wide centred
 * channel whose walls bow out through the middle and flare to the swallow tips), and
 * straight ones are typed in as numbers. Both end up as these curves, so the loft, the
 * mesh, the STL and the tests have one shape to handle; numbers only generate it.
 *
 * ## How it reaches the hull
 *
 * Not through the cross-sections: they are sparse stations blended in between, which
 * would smear a channel's fade and could only keep its walls sharp if every station
 * had matching points on them. Instead the loft lifts each bottom point by
 * {@link channelDepthAt} (vertically: channels sit on the bottom's flat middle, where
 * the bottom is within a few degrees of level), and puts ring points exactly on the
 * walls ({@link channelAnchors}) so the walls stay crisp in the mesh. See `loft.ts`.
 *
 * Pure functions of the board, like the rest of the kernel.
 */
import { scaleSpline, valueAt, type Spline } from './bezier-spline';

/**
 * A channel's cross-section: how deep it is cut at each point across it.
 *
 * The first three are the shapes shapers build most (the owner's reference sections):
 * steps, scoops and waves, usually set side by side with no flat between them. The last
 * three have a flat floor between two walls.
 */
export type ChannelWall =
  /**
   * Deepest at a steep wall on the rail side, the floor ramping straight back up to
   * nothing on the stringer side: a sawtooth, set side by side. `radius` (cm) rounds the
   * top of the wall, the inside corner where the floor meets it; `lip` (cm) rounds its
   * bottom, the edge where it meets the uncut bottom. 0 leaves either sharp.
   *
   * `deepAt: 'stringer'` turns it round: the floor ramps down from nothing at the outer
   * wall to the steep wall on the stringer side. A wall on the stringer meets its mirror
   * image at full depth, so there is no wall there: two of them side by side on the
   * stringer make a V, deepest down the middle (the owner's curved-channel board).
   */
  | {
      readonly shape: 'step';
      readonly radius: number;
      readonly lip: number;
      readonly deepAt?: 'rail' | 'stringer';
    }
  /** A concave arc, deepest in the middle, meeting its neighbours in a sharp ridge. */
  | { readonly shape: 'scoop' }
  /** A smooth flute: no edge anywhere, its neighbours meeting in a rounded crest. */
  | { readonly shape: 'wave' }
  /** Flat floor, vertical walls: the full depth at each wall. */
  | { readonly shape: 'square' }
  /** Flat floor, each wall a straight ramp to full depth over `width` (cm). */
  | { readonly shape: 'bevel'; readonly width: number }
  /** Flat floor, each wall a quarter round to full depth over `radius` (cm). */
  | { readonly shape: 'round'; readonly radius: number };

export interface BottomChannel {
  /** The wall nearer the stringer, or null: a channel centred on the stringer. */
  readonly inner: Spline | null;
  /** The wall nearer the rail. */
  readonly outer: Spline;
  /** Depth into the bottom (cm) against x; the channel's length is this curve's. */
  readonly depth: Spline;
  readonly wall: ChannelWall;
}

/** A spline's x span, whichever way it was drawn. */
export const splineSpan = (s: Spline): readonly [number, number] => {
  const a = s.knots[0]?.end.x ?? 0;
  const b = s.knots[s.knots.length - 1]?.end.x ?? 0;
  return a <= b ? [a, b] : [b, a];
};

/** `s` at `x`, held at its end value beyond either end. */
const heldAt = (s: Spline, x: number): number => {
  const [a, b] = splineSpan(s);
  return valueAt(s, Math.min(b, Math.max(a, x)));
};

/** Where a channel is at station `x`: its walls (y, cm) and depth, or null where it isn't. */
interface ChannelAtX {
  /** Inner wall, or null for a channel centred on the stringer. */
  readonly yi: number | null;
  readonly yo: number;
  readonly depth: number;
}

/** The channel's full depth at `x` (0 outside its length). */
export const channelFullDepth = (c: BottomChannel, x: number): number => {
  const [a, b] = splineSpan(c.depth);
  if (x < a || x > b) return 0;
  const d = valueAt(c.depth, x);
  return Number.isFinite(d) && d > 0 ? d : 0;
};

/** The walls at `x`, whether or not the channel has depth there (for anchors). */
const wallsAt = (c: BottomChannel, x: number): { yi: number | null; yo: number } => {
  const yo = Math.max(0, heldAt(c.outer, x));
  const yi = c.inner ? Math.min(yo, Math.max(0, heldAt(c.inner, x))) : null;
  return { yi, yo };
};

const at = (c: BottomChannel, x: number): ChannelAtX => ({
  ...wallsAt(c, x),
  depth: channelFullDepth(c, x),
});

/** A quarter round over `r` (cm): 0 on the wall, 1 at `r` in from it. */
const quarterRound = (d: number, r: number): number => {
  if (!(r > 0) || d >= r) return 1;
  const t = 1 - d / r;
  return Math.sqrt(Math.max(0, 1 - t * t));
};

/**
 * A step's two radii where it is `d` deep and `w` wide: the lip first, each held to what
 * the step has room for (a shallow end of a fade has less wall to round).
 */
const stepRadii = (wall: { radius: number; lip: number }, d: number, w: number) => {
  const lip = Math.max(0, Math.min(wall.lip, d, w / 2));
  const top = Math.max(0, Math.min(wall.radius, d - lip, w / 2));
  return { lip, top };
};

/**
 * A step's depth (cm) `dIn` out from its inner edge and `dOut` in from its outer wall,
 * `d` deep at the wall. The wall stands `lip` in from the outer edge: a quarter round of
 * radius `lip` climbs from the uncut bottom to it, it rises straight, and a quarter round
 * of radius `radius` turns it into the floor, which ramps back down to nothing at the
 * inner edge.
 */
const stepDepth = (
  wall: { radius: number; lip: number },
  d: number,
  dIn: number,
  dOut: number,
): number => {
  const w = dIn + dOut;
  if (!(w > 0) || !(d > 0)) return 0;
  const { lip, top } = stepRadii(wall, d, w);
  if (dOut < lip) return lip - Math.sqrt(Math.max(0, lip * lip - dOut * dOut));
  const floor = d * Math.min(1, Math.max(0, dIn / (w - lip)));
  const dw = dOut - lip;
  if (dw < top) return floor - top + Math.sqrt(Math.max(0, top * top - (top - dw) * (top - dw)));
  return floor;
};

/** A step whose steep wall is on the stringer side. */
const facesStringer = (wall: ChannelWall): boolean =>
  wall.shape === 'step' && wall.deepAt === 'stringer';

/** No radii: a step wall that meets its mirror image on the stringer has nothing to round. */
const SHARP = { radius: 0, lip: 0 } as const;

/**
 * The depth (cm) of a channel `d` deep at a point `dIn` (cm) out from its inner edge and
 * `dOut` in from its outer wall, `u` = dIn / (dIn + dOut) across it. `onStringer`: its
 * inner edge is the stringer (or it is centred on it).
 */
const profileDepth = (
  wall: ChannelWall,
  d: number,
  dIn: number,
  dOut: number,
  u: number,
  onStringer = false,
): number => {
  const v = Math.min(1, Math.max(0, u));
  switch (wall.shape) {
    case 'step':
      return facesStringer(wall)
        ? stepDepth(onStringer ? SHARP : wall, d, dOut, dIn)
        : stepDepth(wall, d, dIn, dOut);
    case 'scoop':
      return d * Math.sin(Math.PI * v);
    case 'wave':
      return (d * (1 - Math.cos(2 * Math.PI * v))) / 2;
    case 'square':
      return d;
    case 'bevel':
      return wall.width > 0 ? d * Math.min(1, Math.min(dIn, dOut) / wall.width) : d;
    case 'round':
      return d * quarterRound(Math.min(dIn, dOut), wall.radius);
  }
};

/**
 * How far the bottom is cut up (cm) at station `x`, distance `y` from the stringer
 * (either side). 0 outside every channel. Where channels overlap, the deeper wins.
 *
 * A channel centred on the stringer (no inner wall) spans -yo to yo. A step is
 * one-sided, so a centred step is two steps back to back: a V, nothing on the
 * stringer, full depth at both walls.
 */
export const channelDepthAt = (
  channels: readonly BottomChannel[],
  x: number,
  y: number,
): number => {
  const ay = Math.abs(y);
  let out = 0;
  for (const c of channels) {
    const { yi, yo, depth } = at(c, x);
    if (depth <= 0) continue;
    let cut: number;
    if (yi === null) {
      if (ay > yo || yo <= 0) continue;
      cut =
        c.wall.shape === 'step'
          ? profileDepth(c.wall, depth, ay, yo - ay, ay / yo, true)
          : profileDepth(c.wall, depth, yo + ay, yo - ay, 0.5 + (0.5 * ay) / yo);
    } else {
      if (ay < yi || ay > yo || yo - yi <= 0) continue;
      const u = (ay - yi) / (yo - yi);
      cut = profileDepth(c.wall, depth, ay - yi, yo - ay, u, yi <= ON_STRINGER);
    }
    out = Math.max(out, cut);
  }
  return out;
};

/** An inner wall this close to the stringer (cm) is on it. */
const ON_STRINGER = 1e-6;

/**
 * The narrowest (cm) a channel is spread over when the ring gets its points. Walls that
 * meet at the stringer close to nothing, and past the channel's end they are held there:
 * its points would all land on one spot, and the mesh would be made of slivers. So below
 * this the points are spread over this much instead, on the uncut bottom just outside
 * the narrow tip.
 */
export const MIN_ANCHOR_SPAN = 0.5;

/** Points spread across a channel's floor, besides those its walls need. */
export const CHANNEL_FLOOR_POINTS = 6;
/** More across a curved floor (scoop, wave), whose whole width is shape. */
export const CHANNEL_CURVE_POINTS = 12;

/**
 * A square wall is a vertical step: two ring points this far (cm) either side of it,
 * one on the bottom and one on the channel floor. 1 µm: vertical to any machine.
 */
export const SQUARE_WALL_GAP = 1e-4;

/**
 * The nearest a channel point comes to the stringer (cm). The ring already has a point
 * there; one on top of it would make a zero-length edge.
 */
const OFF_STRINGER = 1e-3;

/** Where a rounded corner gets points, as shares of its radius in from the wall. */
const ROUND_STOPS = [0, 0.05, 0.2, 0.45, 1] as const;

/** Angles round a quarter round at which it gets points, besides its ends. */
const ARC_STEPS = [Math.PI / 8, Math.PI / 4, (3 * Math.PI) / 8] as const;

/**
 * Offsets (cm) in from the outer and inner walls that need a ring point, for a channel
 * of this section `w` wide at the station. How many never depends on `w`, only on the
 * section, so every ring along the board has the same points.
 */
const wallStops = (
  wall: ChannelWall,
  w: number,
  onStringer = false,
): { outer: readonly number[]; inner: readonly number[] } => {
  switch (wall.shape) {
    case 'step': {
      // Round the lip, the vertical wall (a pair of points 1 µm apart), round its top,
      // and a crease at the inner edge.
      // Spaced by the radii as set (held to the width only), not to this station's depth:
      // where the depth fades to nothing they would all land on the wall, and a mesh
      // welds points on top of each other into edges shared by many faces. At the
      // shallow end of a fade they sit a little off the shrunken corners, which is where
      // there is next to nothing to cut.
      const { lip, top } = stepRadii(wall, Infinity, w);
      const outer: number[] = [];
      // No point where the lip meets the bottom: it meets it tangent, and side by side
      // that is the next channel's inner edge, which has one already.
      if (wall.lip > 0) outer.push(...ARC_STEPS.map((a) => lip * Math.sin(a)));
      outer.push(lip - SQUARE_WALL_GAP, lip + SQUARE_WALL_GAP);
      if (wall.radius > 0) {
        outer.push(...[...ARC_STEPS, Math.PI / 2].map((a) => lip + top * (1 - Math.cos(a))));
      }
      if (!facesStringer(wall)) return { outer, inner: [0] };
      // Turned round: the wall's points are in from the inner edge, the crease at the
      // outer one. On the stringer there is no wall, only the V's crease.
      return { outer: [0], inner: onStringer ? [0] : outer };
    }
    case 'scoop':
    case 'wave':
      return { outer: [0], inner: [0] };
    case 'square':
      return {
        outer: [-SQUARE_WALL_GAP, SQUARE_WALL_GAP],
        inner: [-SQUARE_WALL_GAP, SQUARE_WALL_GAP],
      };
    case 'bevel':
      return { outer: [0, wall.width], inner: [0, wall.width] };
    case 'round': {
      const stops = ROUND_STOPS.map((s) => s * wall.radius);
      return { outer: stops, inner: stops };
    }
  }
};

/**
 * The distances from the stringer (cm, ascending) at which the ring at station `x`
 * needs a point for the channels to be cut true: on each wall (both sides of a vertical
 * one), across a bevel or rounded corner, and spread over each floor.
 *
 * The COUNT never depends on `x`: the mesh joins neighbouring rings point by point, so
 * every ring needs the same number in the same order. A channel is anchored even where
 * it has no depth (its walls held at their end values), and those points simply sit on
 * the uncut bottom.
 */
export const channelAnchors = (channels: readonly BottomChannel[], x: number): number[] => {
  const ys: number[] = [];
  for (const c of channels) {
    const walls = wallsAt(c, x);
    const { yi } = walls;
    const lo = yi ?? 0;
    const yo = Math.max(walls.yo, lo + MIN_ANCHOR_SPAN);
    const inside = (y: number) => Math.min(yo + SQUARE_WALL_GAP, Math.max(lo - SQUARE_WALL_GAP, y));
    const stops = wallStops(c.wall, yo - lo, yi === null || yi <= ON_STRINGER);
    for (const s of stops.outer) ys.push(inside(yo - s));
    if (yi !== null) for (const s of stops.inner) ys.push(inside(yi + s));
    const n =
      c.wall.shape === 'scoop' || c.wall.shape === 'wave'
        ? CHANNEL_CURVE_POINTS
        : CHANNEL_FLOOR_POINTS;
    for (let k = 1; k <= n; k++) ys.push(lo + ((yo - lo) * k) / (n + 1));
  }
  return ys.map((y) => Math.max(OFF_STRINGER, y)).sort((a, b) => a - b);
};

/** Samples along a channel's length when checking it. */
const CHECK_SAMPLES = 64;

/**
 * What is wrong with `channels` on a board whose half-width at x is `halfWidth(x)` and
 * thickness `thickness(x)`, said for the person drawing them. Empty when they can be cut.
 */
export const channelProblems = (
  channels: readonly BottomChannel[],
  halfWidth: (x: number) => number,
  thickness: (x: number) => number,
): string[] => {
  const out: string[] = [];
  channels.forEach((c, i) => {
    const name = `Channel ${i + 1}`;
    const runsLengthways = (s: Spline) => {
      const xs = s.knots.map((k) => k.end.x);
      const up = xs.every((v, j) => j === 0 || v > xs[j - 1]!);
      const down = xs.every((v, j) => j === 0 || v < xs[j - 1]!);
      return xs.length >= 2 && (up || down);
    };
    if (!runsLengthways(c.outer) || (c.inner && !runsLengthways(c.inner))) {
      out.push(`${name}: each wall must run along the board, one point across at each station.`);
      return;
    }
    const [a, b] = splineSpan(c.depth);
    if (!(b > a)) {
      out.push(`${name} has no length.`);
      return;
    }
    let crossed = false;
    let offBottom = false;
    let tooDeep = false;
    for (let k = 0; k <= CHECK_SAMPLES; k++) {
      const x = a + ((b - a) * k) / CHECK_SAMPLES;
      const { yo, depth } = at(c, x);
      // Unclamped: wallsAt holds the inner wall inside the outer one. Meeting (a channel
      // tapered to a point) is fine; passing isn't.
      if (c.inner && heldAt(c.inner, x) > heldAt(c.outer, x) + 1e-9) crossed = true;
      if (depth > 0 && yo >= halfWidth(x)) offBottom = true;
      if (depth > 0 && depth >= thickness(x) / 2) tooDeep = true;
    }
    if (crossed) out.push(`${name}: its walls cross.`);
    if (offBottom) out.push(`${name} runs off the bottom: keep its outer wall inside the rail.`);
    if (tooDeep) out.push(`${name} is deeper than half the board's thickness.`);
  });
  return out;
};

/** A wall's size scaled across the board by `fW`. */
export const scaleWall = (w: ChannelWall, fW: number): ChannelWall =>
  w.shape === 'bevel'
    ? { shape: 'bevel', width: w.width * fW }
    : w.shape === 'round'
      ? { shape: 'round', radius: w.radius * fW }
      : w.shape === 'step'
        ? { ...w, radius: w.radius * fW, lip: w.lip * fW }
        : w;

/** `channels` on a board scaled by `fL` along, `fW` across and `fT` in thickness. */
export const scaleChannels = (
  channels: readonly BottomChannel[],
  fL: number,
  fW: number,
  fT: number,
): BottomChannel[] =>
  channels.map((c) => ({
    inner: c.inner && scaleSpline(c.inner, fW, fL),
    outer: scaleSpline(c.outer, fW, fL),
    depth: scaleSpline(c.depth, fT, fL),
    wall: scaleWall(c.wall, fW),
  }));
