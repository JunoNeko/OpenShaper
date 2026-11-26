// SPDX-License-Identifier: GPL-3.0-or-later
import { getLength, getMaxThickness, getMaxWidth, getWidthAtPos, type BezierBoard } from './board';
import { boardChannels } from './channel-layout';
import { channelRailExits } from './channels';
import { triangulatePolygon } from './polygon';
import {
  MIN_DIM,
  channelCutAt,
  isFinite3,
  loftPoint,
  loftRing,
  loftSection,
  ringFractions,
  ringHalf,
  stationRing,
  type LateralMap,
  type Vert3,
} from './loft';
import { CUTOUT_EPS, cachedOutlineSegments, hasTailCutout, yInOut } from './outline-cutout';
import { notchSqueeze, swallowDeckApex, swallowStation, type SwallowStation } from './swallow';

/**
 * A triangle mesh of the board surface, ready for upload to a GPU buffer.
 *
 * Coordinate convention (cm): X = length axis (tail at 0, nose at +X), Y = width (across,
 * rail-to-rail), Z = height (up). `positions` and `normals` are flat xyz triples;
 * `indices` are triangle vertex indices (3 per triangle).
 */
export interface BoardMesh {
  positions: Float32Array;
  indices: Uint32Array;
  normals: Float32Array;
}

export interface TessellateOptions {
  /** Number of longitudinal stations sampled across the length (default 120). */
  lengthSteps?: number;
  /** Number of points around each cross-section ring (default 48). */
  ringSteps?: number;
  /**
   * Target edge length per face, in cm. When set (and explicit `lengthSteps` /
   * `ringSteps` are not), the step counts are derived from the board's dimensions
   * so faces are ~uniform regardless of board size — finer values give denser meshes.
   */
  targetFaceSize?: number;
}

const DEFAULT_LENGTH_STEPS = 120;
const DEFAULT_RING_STEPS = 48;

const MIN_LENGTH_STEPS = 8;
const MAX_LENGTH_STEPS = 1200;
const MIN_RING_STEPS = 12;
const MAX_RING_STEPS = 400;

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

/**
 * Derive `(lengthSteps, ringSteps)` so that each quad edge is roughly
 * `targetFaceSize` cm. The length axis is straightforward; the ring count is sized
 * from an estimate of the section perimeter (a half-ellipse from max width + max
 * thickness, doubled for the closed loop). Results are clamped to sane bounds.
 */
export const tessellationSteps = (
  board: BezierBoard,
  targetFaceSize: number,
): { lengthSteps: number; ringSteps: number } => {
  const face = Math.max(0.05, targetFaceSize);
  const length = getLength(board);
  const a = getMaxWidth(board) / 2; // semi-axis across
  const b = Math.max(getMaxThickness(board), 1e-3); // semi-axis up
  // Ramanujan's ellipse-perimeter approximation; the ring is the full closed loop.
  const perimeter = Math.PI * (3 * (a + b) - Math.sqrt((3 * a + b) * (a + 3 * b)));
  return {
    lengthSteps: clamp(Math.ceil(length / face), MIN_LENGTH_STEPS, MAX_LENGTH_STEPS),
    ringSteps: clamp(Math.ceil(perimeter / face), MIN_RING_STEPS, MAX_RING_STEPS),
  };
};

const addVert = (positions: number[], v: Vert3): number => {
  const index = positions.length / 3;
  positions.push(v.x, v.y, v.z);
  return index;
};

/**
 * Tessellate a board into a closed triangle mesh.
 *
 * Samples `lengthSteps` stations across (0, length), builds a `ringSteps`-point
 * cross-section ring at each, stitches adjacent rings with quads (two triangles),
 * and caps the nose/tail with fans to a tip vertex. Per-vertex normals are the
 * area-weighted average of adjacent face normals.
 *
 * Robust against null/degenerate sections (skipped) and NaN samples.
 */
export const tessellateBoard = (board: BezierBoard, opts: TessellateOptions = {}): BoardMesh => {
  // A target face size derives step counts unless explicit counts are given.
  const derived =
    opts.targetFaceSize !== undefined ? tessellationSteps(board, opts.targetFaceSize) : null;
  const lengthSteps = Math.max(
    2,
    Math.floor(opts.lengthSteps ?? derived?.lengthSteps ?? DEFAULT_LENGTH_STEPS),
  );
  const ringSteps = Math.max(
    4,
    Math.floor(opts.ringSteps ?? derived?.ringSteps ?? DEFAULT_RING_STEPS),
  );

  const length = getLength(board);
  if (!Number.isFinite(length) || length <= 0) return emptyMesh();

  // A concave tail (swallow / fish) needs the cutout-aware lofting path; a normal
  // board keeps the original single-loop path exactly (bit-identical meshes).
  if (hasTailCutout(board.outline)) {
    return tessellateCutout(board, length, lengthSteps, ringSteps);
  }

  // How each end is closed depends on whether the board really comes to a point
  // there.
  //
  // `loftSection` floors width and thickness at MIN_DIM, so sampling a station at a
  // tip whose true width is 0 does not give a point — it gives a 5 mm ring, and the
  // band leading into it becomes a near-vertical wall that shades badly. But an end
  // with real width (a squash or round tail) is the opposite case: fanning it to a
  // single off-plane apex, as this used to do unconditionally, collapses a full-width
  // transom to a point in the mesh, and so in the STL a shaper cuts.
  //
  // So branch per end on the UNfloored width:
  //   - pointed (< MIN_DIM): inset the last station and fan to a true apex at the tip,
  //     which is what the board actually does;
  //   - blunt: put the station on the tip itself and fan IN ITS OWN PLANE, making the
  //     cap the flat face the geometry has.
  // Either way the mesh still spans the full length — the apex sits at 0 / `length`.
  //
  // (`loftSection` itself is defined on the closed interval: `getNearestCrossSectionIndex`
  // only ever returns a real station, and the clamps collapse the pair at either tip. The
  // inset that used to be applied unconditionally guarded `getInterpolatedCrossSection`,
  // which the mesh has not gone through since the loft became point-blended.)
  const eps = Math.min(0.5, length * 1e-3);
  const channelled = boardChannels(board).length > 0;
  // A square end drawn with a vertical edge has no width at the tip itself (the outline
  // there is a vertical line), only a hair inside it. With channels running out through
  // it, fanning that end to an apex webs over their mouths, so (on such a board) it is
  // capped flat at the inset station instead. Boards without channels keep their meshes.
  const squareEdge = (tip: number, inset: number) =>
    channelled && getWidthAtPos(board, tip) < MIN_DIM && getWidthAtPos(board, inset) >= MIN_DIM;
  const square0 = squareEdge(0, eps);
  const square1 = squareEdge(length, length - eps);
  const pointed0 = getWidthAtPos(board, 0) < MIN_DIM && !square0;
  const pointed1 = getWidthAtPos(board, length) < MIN_DIM && !square1;
  const x0 = pointed0 || square0 ? eps : 0;
  const x1 = pointed1 || square1 ? length - eps : length;

  const positions: number[] = [];
  const indices: number[] = [];

  // Each entry: the vertex indices for one ring (a closed loop).
  const rings: number[][] = [];

  for (const x of stationXs(board, x0, x1, lengthSteps)) {
    const ring = loftRing(board, x, ringSteps);
    if (!ring) continue;
    const idx = ring.map((v) => addVert(positions, v));
    rings.push(idx);
  }

  if (rings.length < 2) return emptyMesh();

  // Stitch adjacent rings.
  for (let r = 0; r < rings.length - 1; r++) {
    const a = rings[r]!;
    const b = rings[r + 1]!;
    // Rings can differ in length if a degenerate section produced fewer points;
    // stitch only the shared prefix to stay robust.
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) {
      const i0 = i;
      const i1 = (i + 1) % n;
      const a0 = a[i0]!;
      const a1 = a[i1]!;
      const b0 = b[i0]!;
      const b1 = b[i1]!;
      // Quad (a0,a1,b1,b0) -> two triangles, wound consistently.
      indices.push(a0, b0, a1);
      indices.push(a1, b0, b1);
    }
  }

  // Fan the end ring to a hub vertex on the centerline at `capX` — the tip itself for
  // a pointed end (a cone), the ring's own plane for a blunt one (a flat cap). The hub
  // takes the ring's mean height, which is its centroid: the ring is symmetric about
  // y = 0 by construction (`loftRing`).
  const capEnd = (ring: number[], capX: number, reverse: boolean): void => {
    if (ring.length < 3) return;
    let zSum = 0;
    for (const vi of ring) zSum += positions[vi * 3 + 2]!;
    const tipZ = zSum / ring.length;
    if (!isFinite3(capX, 0, tipZ)) return;
    const tip = addVert(positions, { x: capX, y: 0, z: tipZ });
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const i0 = ring[i]!;
      const i1 = ring[(i + 1) % n]!;
      if (reverse) indices.push(tip, i1, i0);
      else indices.push(tip, i0, i1);
    }
  };

  // A blunt end with channels running out through it: its outline is notched, and a fan
  // would web over the channels' mouths. Cover exactly the outline instead.
  const capFlat = (ring: number[], reverse: boolean): void => {
    const pts = ring.map((vi) => ({ x: positions[vi * 3 + 1]!, y: positions[vi * 3 + 2]! }));
    for (const [a, b, c] of triangulatePolygon(pts)) {
      if (reverse) indices.push(ring[c]!, ring[b]!, ring[a]!);
      else indices.push(ring[a]!, ring[b]!, ring[c]!);
    }
  };
  // Wound to match the bands: each ring edge runs one way in its band and the other
  // in its cap, so the shell is a closed, consistently oriented solid. (Until 2026-11
  // both caps ran the same way as their bands; the shell was oriented by its majority
  // and nothing read edge directions, until a solid modeller had to: print blanks.)
  if (channelled && !pointed0) capFlat(rings[0]!, false);
  else capEnd(rings[0]!, pointed0 ? 0 : x0, false);
  if (channelled && !pointed1) capFlat(rings[rings.length - 1]!, true);
  else capEnd(rings[rings.length - 1]!, pointed1 ? length : x1, true);

  return finalizeMesh(positions, indices);
};

/** A feature this close to a station (share of the spacing) moves the station onto it. */
const SNAP_SHARE = 0.25;

/**
 * Where the stations go: evenly from `x0` to `x1`, plus one on each feature the board
 * has between them, where its surface turns sharply along its length:
 *
 * - each corner of the outline (a diamond tail's shoulders): between two even stations
 *   the band cut straight across it, off the outline by millimetres;
 * - where a channel starts or stops running out through the rail: the cut rail
 *   stretched across the gap to the next station, webbing the corner (owner's diamond
 *   tail, 2026-11).
 *
 * A feature near a station moves that station onto it, else it is added between two.
 * A board with no features keeps its stations exactly.
 */
const stationXs = (board: BezierBoard, x0: number, x1: number, n: number): number[] => {
  const xs = Array.from({ length: n }, (_, s) => x0 + ((x1 - x0) * s) / (n - 1));
  const step = (x1 - x0) / (n - 1);
  const inside = (x: number) => x > x0 + step * SNAP_SHARE && x < x1 - step * SNAP_SHARE;
  const features = [
    ...board.outline.knots.filter((k) => !k.continuous).map((k) => k.end.x),
    ...channelRailExits(boardChannels(board), (x) => getWidthAtPos(board, x) / 2, x0, x1),
  ].filter(inside);
  if (features.length === 0) return xs;
  const extra: number[] = [];
  for (const f of features) {
    const i = Math.round((f - x0) / step);
    if (i > 0 && i < n - 1 && Math.abs(xs[i]! - f) <= step * SNAP_SHARE) xs[i] = f;
    else extra.push(f);
  }
  return [...xs, ...extra].sort((a, b) => a - b).filter((x, i, all) => i === 0 || x - all[i - 1]! > 1e-6); // prettier-ignore
};

const emptyMesh = (): BoardMesh => ({
  positions: new Float32Array(0),
  indices: new Uint32Array(0),
  normals: new Float32Array(0),
});

/**
 * Compute area-weighted per-vertex normals, orient the shell outward, and pack the
 * working arrays into a `BoardMesh`. Shared by the normal and cutout loft paths.
 */
const finalizeMesh = (positions: number[], indices: number[]): BoardMesh => {
  const vertexCount = positions.length / 3;
  const normals = new Float32Array(positions.length);

  for (let t = 0; t < indices.length; t += 3) {
    const ia = indices[t]!;
    const ib = indices[t + 1]!;
    const ic = indices[t + 2]!;

    const ax = positions[ia * 3]!;
    const ay = positions[ia * 3 + 1]!;
    const az = positions[ia * 3 + 2]!;
    const bx = positions[ib * 3]!;
    const by = positions[ib * 3 + 1]!;
    const bz = positions[ib * 3 + 2]!;
    const cx = positions[ic * 3]!;
    const cy = positions[ic * 3 + 1]!;
    const cz = positions[ic * 3 + 2]!;

    const e1x = bx - ax;
    const e1y = by - ay;
    const e1z = bz - az;
    const e2x = cx - ax;
    const e2y = cy - ay;
    const e2z = cz - az;

    // Cross product (unnormalized => area-weighted).
    const nx = e1y * e2z - e1z * e2y;
    const ny = e1z * e2x - e1x * e2z;
    const nz = e1x * e2y - e1y * e2x;
    if (!isFinite3(nx, ny, nz)) continue;

    normals[ia * 3] = normals[ia * 3]! + nx;
    normals[ia * 3 + 1] = normals[ia * 3 + 1]! + ny;
    normals[ia * 3 + 2] = normals[ia * 3 + 2]! + nz;
    normals[ib * 3] = normals[ib * 3]! + nx;
    normals[ib * 3 + 1] = normals[ib * 3 + 1]! + ny;
    normals[ib * 3 + 2] = normals[ib * 3 + 2]! + nz;
    normals[ic * 3] = normals[ic * 3]! + nx;
    normals[ic * 3 + 1] = normals[ic * 3 + 1]! + ny;
    normals[ic * 3 + 2] = normals[ic * 3 + 2]! + nz;
  }

  for (let v = 0; v < vertexCount; v++) {
    const nx = normals[v * 3]!;
    const ny = normals[v * 3 + 1]!;
    const nz = normals[v * 3 + 2]!;
    const len = Math.hypot(nx, ny, nz);
    if (len > 1e-9 && Number.isFinite(len)) {
      normals[v * 3] = nx / len;
      normals[v * 3 + 1] = ny / len;
      normals[v * 3 + 2] = nz / len;
    } else {
      // Degenerate vertex: fall back to a stable up normal rather than NaN/zero.
      normals[v * 3] = 0;
      normals[v * 3 + 1] = 0;
      normals[v * 3 + 2] = 1;
    }
  }

  // --- orient the whole shell outward ---
  // Winding is locally consistent, but its global direction is incidental: the
  // normals may point INTO the board. A FrontSide material would then cull the
  // outward faces and the board renders see-through. Measure orientation against
  // the centroid and, if inverted, flip every normal AND reverse triangle winding
  // (so face culling and lighting agree).
  orientOutward(positions, indices, normals, vertexCount);

  return {
    positions: new Float32Array(positions),
    indices: new Uint32Array(indices),
    normals,
  };
};

/**
 * Loft a board whose outline has a concave tail notch (swallow / fish).
 *
 * Each station maps to inner/outer half-widths (y_in, y_out): the section profile's
 * lateral coordinate is remapped from [0, y_out] to [y_in, y_out], so in the notch
 * the rails pull away from the centerline (when y_in == 0 the map is the identity,
 * so the solid body is unchanged). The board is built as two independent half-shells
 * (±Y); in the notch each half is sealed by a deck↔bottom "wall" (the ring loop's
 * closing edge), while in the body the wall is skipped and the halves meet at the
 * centerline. Each half's first/last ring is fanned shut so both pod tubes are closed.
 *
 * Stations are cosine-clustered toward the tail tip (and nose) so the fast-curving
 * notch walls and tips are well resolved without a dense mesh through the middle.
 */
const tessellateCutout = (
  board: BezierBoard,
  length: number,
  lengthSteps: number,
  ringSteps: number,
): BoardMesh => {
  const segments = cachedOutlineSegments(board.outline);
  const eps = Math.min(0.5, length * 1e-3);
  // A swallow made with the tool runs out to the board's ends: its end stations are
  // fanned to a point on each end (see `capRow`), and stations packed toward them follow
  // a round nose in. Boards folded by hand keep their meshes.
  const swallowed = board.swallow !== undefined;
  const x0 = eps;
  const x1 = length - eps;
  const half = ringHalf(ringSteps);
  const ladder = ringFractions(board, half);
  const cut = boardChannels(board).length > 0;

  const positions: number[] = [];
  const indices: number[] = [];

  // Longitudinal stations. A uniform/cosine distribution in x under-samples the
  // concave wall where it runs nearly parallel to y (a big change in y_in over a
  // tiny change in x → large flat facets). So seed coarse cosine stations, then
  // recursively subdivide any interval whose midpoint (y_in, y_out) deviates from a
  // straight chord — concentrating rings exactly where the outline bends, so the
  // mesh follows the bezier with smooth, consistent facets.
  // A swallow's set inside wall (`swallow.ts`): the deck's edge moves with it too.
  const lat = (x: number): number[] => {
    const { yIn, yOut } = yInOut(segments, x);
    if (!swallowed) return [yIn, yOut];
    return [yIn, yOut, swallowStation(board, x, 1)?.yD ?? 0];
  };
  const FLATNESS = 0.04; // cm: max midpoint deviation from the chord before splitting
  const STEP = 0.6; // cm: max lateral change of y_in / y_out per facet (bounds facet size)
  const minDx = Math.max((x1 - x0) / (MAX_LENGTH_STEPS * 1.5), 0.008);
  const xs: number[] = [x0];
  const refine = (a: number, b: number, depth: number): void => {
    const m = (a + b) / 2;
    const la = lat(a);
    const lb = lat(b);
    const lm = lat(m);
    // Split where the curve bends (midpoint off the chord) OR where the boundary moves
    // too far laterally across the interval (a near-vertical wall → big flat facet).
    let dev = 0;
    let step = 0;
    for (let i = 0; i < la.length; i++) {
      dev = Math.max(dev, Math.abs(lm[i]! - (la[i]! + lb[i]!) / 2));
      step = Math.max(step, Math.abs(la[i]! - lb[i]!));
    }
    if (
      (dev > FLATNESS || step > STEP) &&
      b - a > minDx &&
      depth < 24 &&
      xs.length < MAX_LENGTH_STEPS
    ) {
      refine(a, m, depth + 1);
      refine(m, b, depth + 1);
    } else {
      xs.push(b);
    }
  };
  for (let s = 1; s < lengthSteps; s++) {
    const u0 = (s - 1) / (lengthSteps - 1);
    const u1 = s / (lengthSteps - 1);
    const cd0 = (1 - Math.cos(u0 * Math.PI)) / 2;
    const cd1 = (1 - Math.cos(u1 * Math.PI)) / 2;
    refine(x0 + cd0 * (x1 - x0), x0 + cd1 * (x1 - x0), 0);
  }
  if (swallowed) {
    // Stations on the notch bottom and just past the deck line's point, where the wall
    // changes from notch to V and from V to none, and a few across the V between.
    const bottomEnd = segments.tailInner.reduce((m, p) => Math.max(m, p.x), -Infinity);
    const deckEnd = swallowDeckApex(board);
    xs.push(bottomEnd);
    // Packed toward each end (squares of a step: the width runs out as a square root).
    for (let i = 1; i < END_STATIONS; i++) {
      const d = END_REACH * (i / END_STATIONS) ** 2;
      xs.push(x0 + d, x1 - d);
    }
    if (deckEnd !== null && deckEnd > bottomEnd) {
      const v = deckEnd + 1e-4 - bottomEnd;
      for (let i = 1; i <= 6; i++) xs.push(bottomEnd + (v * i) / 6);
    }
    xs.sort((p, q) => p - q);
    for (let i = xs.length - 1; i > 0; i--) if (xs[i]! - xs[i - 1]! < 1e-6) xs.splice(i, 1);
  }

  const yIns: number[] = [];
  /** Points on the inside wall after each row's ring (0 where the deck isn't notched). */
  const wallCounts: number[] = [];
  /** Rows inside the bottom's notch, whose wall ends on the ring's first point. */
  const notched: boolean[] = [];
  const rightRows: (number[] | null)[] = [];
  const leftRows: (number[] | null)[] = [];

  /** The notch's remap at x, as a channel sees it. */
  const lateralAt = (x: number): LateralMap => {
    if (swallowed) {
      const { yIn, yOut } = yInOut(segments, x);
      return notchSqueeze(yIn > 1e-9 ? yIn : 0, yOut);
    }
    let { yIn, yOut } = yInOut(segments, x);
    if (yIn < CUTOUT_EPS) yIn = 0;
    if (yOut < yIn + CUTOUT_EPS) yOut = yIn;
    const k = yOut > 1e-6 ? (yOut - yIn) / yOut : 0;
    return (px) => yIn + px * k;
  };
  // Points per half ring: the ladder's, plus each channel's (the same at every station).
  let rowLength = half;

  for (const x of xs) {
    const section = loftSection(board, x);
    if (!section) {
      yIns.push(0);
      wallCounts.push(0);
      notched.push(false);
      rightRows.push(null);
      leftRows.push(null);
      continue;
    }
    let { yIn, yOut } = yInOut(segments, x);
    const sw: SwallowStation | null = swallowed ? swallowStation(board, x) : null;
    if (sw)
      yIn = sw.yB; // the wall ends on it exactly
    else if (yIn < CUTOUT_EPS) yIn = 0;
    if (yOut < yIn + CUTOUT_EPS) yOut = yIn; // collapsed tip → zero-width sliver
    yIns.push(yIn);

    const scale = yOut > 1e-6 ? (yOut - yIn) / yOut : 0;
    const ring = cut ? stationRing(board, section, x, half, lateralAt) : null;
    const fs = ring ? ring.fs : ladder;
    rowLength = fs.length;
    const pts = fs.map((f) =>
      ring ? channelCutAt(board, ring, section, f, x, lateralAt(x)) : loftPoint(section, f),
    );
    // The deck runs from its own edge: from the rail's widest point on, its points are
    // squeezed into [yD, yOut] (they meet the bottom's there, both at yOut).
    let widest = 0;
    if (sw) pts.forEach((p, i) => p.x > pts[widest]!.x && (widest = i));
    // Within the rail, should the tip's band have been closed up to nothing.
    const yD = sw ? Math.min(sw.yD, yOut) : 0;
    const bottomMap = sw ? notchSqueeze(yIn, yOut) : null;
    const deckMap = sw ? notchSqueeze(yD, yOut) : null;
    const right: number[] = [];
    const left: number[] = [];
    let ok = true;
    const push = (y: number, z: number): void => {
      if (!isFinite3(x, y, z)) {
        ok = false;
        return;
      }
      right.push(addVert(positions, { x, y, z }));
      left.push(addVert(positions, { x, y: -y, z }));
    };
    // A swallow's deck is the board's own deck, cut away at the deck line: its points are
    // spread by the squeeze but sit at the deck's height where they land. (Carried with
    // them, the deck's height at the stringer rode out to each tip, the deck rising a few
    // millimetres toward the tips: a kick, owner report 2026-11.)
    const deckFrom = sw ? fs[widest]! : 1;
    const deckHeightAt = (y: number): number => {
      let lo = deckFrom;
      let hi = 1;
      for (let k = 0; k < DECK_STEPS; k++) {
        const m = (lo + hi) / 2;
        if (loftPoint(section, m).x > y) lo = m;
        else hi = m;
      }
      return loftPoint(section, (lo + hi) / 2).y;
    };
    let zd = 0;
    for (let i = 0; i < pts.length && ok; i++) {
      const p = pts[i]!;
      // p.x ∈ [0, yOut] → [yIn, yOut]
      if (!sw) {
        push(yIn + p.x * scale, p.y + section.rocker);
      } else if (i > widest) {
        const y = deckMap!(p.x);
        zd = deckHeightAt(y) + section.rocker;
        push(y, zd);
      } else {
        push(bottomMap!(p.x), p.y + section.rocker);
      }
    }
    if (sw && ok) {
      // The inside wall, from the deck's edge down to the bottom's, or to where the V
      // closes on the stringer.
      const zb = pts[0]!.y + section.rocker;
      for (const q of sw.wall) if (ok) push(Math.min(q.y, yOut), zb + q.u * (zd - zb));
    }
    wallCounts.push(sw && ok ? sw.wall.length : 0);
    notched.push(yIn > 0);
    if (!ok || right.length < 2) {
      rightRows.push(null);
      leftRows.push(null);
      continue;
    }
    rightRows.push(right);
    leftRows.push(left);
  }

  const samePos = (i: number, j: number): boolean =>
    Math.abs(positions[i * 3]! - positions[j * 3]!) < 1e-9 &&
    Math.abs(positions[i * 3 + 1]! - positions[j * 3 + 1]!) < 1e-9 &&
    Math.abs(positions[i * 3 + 2]! - positions[j * 3 + 2]!) < 1e-9;

  // Stitch one half-shell's rows; `mirror` flips the winding for the -Y side.
  const stitch = (rows: (number[] | null)[], mirror: boolean): void => {
    for (let r = 0; r < rows.length - 1; r++) {
      const a = rows[r];
      const b = rows[r + 1];
      if (!a || !b) continue;
      if (swallowed) {
        const wa = wallCounts[r]!;
        const wb = wallCounts[r + 1]!;
        stitchSwallow(indices, a, b, rowLength, wa, wb, mirror);
        // Out of the bottom's notch onto the stringer: the wall's upright foot, from the
        // notch's last edge to the stringer below where the wall leaves it.
        const bLast = b[rowLength - 1 + wb]!;
        if (notched[r] && !notched[r + 1] && !samePos(bLast, b[0]!)) {
          if (!mirror) indices.push(a[0]!, bLast, b[0]!);
          else indices.push(a[0]!, b[0]!, bLast);
        }
        continue;
      }
      // Close the deck↔bottom wall (the ring's wrap edge) only inside the notch.
      const wall = yIns[r]! > CUTOUT_EPS || yIns[r + 1]! > CUTOUT_EPS;
      const lim = wall ? rowLength : rowLength - 1;
      for (let j = 0; j < lim; j++) {
        const j1 = (j + 1) % rowLength;
        const a0 = a[j]!;
        const a1 = a[j1]!;
        const b0 = b[j]!;
        const b1 = b[j1]!;
        if (!mirror) {
          indices.push(a0, b0, a1);
          indices.push(a1, b0, b1);
        } else {
          indices.push(a0, a1, b0);
          indices.push(a1, b1, b0);
        }
      }
    }
  };

  stitch(rightRows, false);
  stitch(leftRows, true);

  // Fan a half's end ring (rail + wall) to its centroid so the pod tube is capped.
  // With channels running out through the tail, the end is notched and a fan would web
  // over the channels' mouths: cover exactly its outline instead (the row is one station,
  // so it lies in a plane of constant x).
  const channelled = boardChannels(board).length > 0;
  const capRow = (whole: number[] | null, reverse: boolean, hubX?: number, pod = false): void => {
    let row = whole;
    if (!row || row.length < 3) return;
    if (hubX !== undefined) {
      // A swallow's end: fanned out to a point on the board's own end, so the mesh runs
      // all the way (capped flat at the inset station, a round nose was cut off square,
      // centimetres wide; owner report, 2026-11). A tail pod is a closed ring (its wall
      // ends on its first point) and gets a point of its own; a half of the nose, open
      // along the stringer, meets its mirror at one point on it, and leaves the stringer
      // edge to the mirror's fan.
      const n = row.length;
      let sy = 0;
      let sz = 0;
      for (const vi of row) {
        sy += positions[vi * 3 + 1]!;
        sz += positions[vi * 3 + 2]!;
      }
      if (!isFinite3(hubX, sy / n, sz / n)) return;
      const hub = addVert(positions, { x: hubX, y: pod ? sy / n : 0, z: sz / n });
      for (let i = 0; i < (pod ? n : n - 1); i++) {
        const i0 = row[i]!;
        const i1 = row[(i + 1) % n]!;
        if (samePos(i0, i1)) continue;
        if (reverse) indices.push(hub, i1, i0);
        else indices.push(hub, i0, i1);
      }
      return;
    }
    if (channelled) {
      // A swallow's wall ends on the ring's first point: one corner, not two.
      while (row.length > 3 && samePos(row[row.length - 1]!, row[0]!)) row = row.slice(0, -1);
      const pts = row.map((vi) => ({ x: positions[vi * 3 + 1]!, y: positions[vi * 3 + 2]! }));
      for (const [a, b, c] of triangulatePolygon(pts)) {
        if (reverse) indices.push(row[c]!, row[b]!, row[a]!);
        else indices.push(row[a]!, row[b]!, row[c]!);
      }
      return;
    }
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const vi of row) {
      sx += positions[vi * 3]!;
      sy += positions[vi * 3 + 1]!;
      sz += positions[vi * 3 + 2]!;
    }
    const n = row.length;
    const cx = sx / n;
    const cy = sy / n;
    const cz = sz / n;
    if (!isFinite3(cx, cy, cz)) return;
    const tip = addVert(positions, { x: cx, y: cy, z: cz });
    for (let i = 0; i < n; i++) {
      const i0 = row[i]!;
      const i1 = row[(i + 1) % n]!;
      if (samePos(i0, i1)) continue; // a swallow's wall ends on the ring's first point
      if (reverse) indices.push(tip, i1, i0);
      else indices.push(tip, i0, i1);
    }
  };

  let firstIdx = -1;
  let lastIdx = -1;
  for (let i = 0; i < rightRows.length; i++) {
    if (rightRows[i]) {
      if (firstIdx === -1) firstIdx = i;
      lastIdx = i;
    }
  }
  if (firstIdx !== -1 && lastIdx !== firstIdx) {
    // Wound against their bands, as the single-loop caps (see there).
    const tail = swallowed ? 0 : undefined;
    const nose = swallowed ? length : undefined;
    const pod0 = notched[firstIdx]!;
    const pod1 = notched[lastIdx]!;
    capRow(rightRows[firstIdx]!, false, tail, pod0);
    capRow(rightRows[lastIdx]!, true, nose, pod1);
    capRow(leftRows[firstIdx]!, true, tail, pod0);
    capRow(leftRows[lastIdx]!, false, nose, pod1);
  }

  return finalizeMesh(positions, indices);
};

/** Over how much length (cm) at each end a swallow's stations are packed in. */
const END_REACH = 1;
/** Stations packed into each end. */
const END_STATIONS = 12;

/** Halvings finding the deck's height at a point across a swallow's station: 2^-30 of the profile. */
const DECK_STEPS = 30;

/**
 * Stitch two rows of a swallow's half-shell. Each row is the ring (`n` points, stringer
 * bottom to stringer deck) then `wa`/`wb` points down the inside wall. The wall's last
 * point lies on the ring's first, or on the stringer, so no wrap edge is closed: the
 * shell meets itself, or its mirror, there. Where only one row has a wall it fans to the
 * other's deck edge.
 */
const stitchSwallow = (
  indices: number[],
  a: readonly number[],
  b: readonly number[],
  n: number,
  wa: number,
  wb: number,
  mirror: boolean,
): void => {
  const quad = (a0: number, a1: number, b0: number, b1: number): void => {
    if (!mirror) indices.push(a0, b0, a1, a1, b0, b1);
    else indices.push(a0, a1, b0, a1, b1, b0);
  };
  const tri = (p: number, q: number, r: number): void => {
    if (!mirror) indices.push(p, q, r);
    else indices.push(p, r, q);
  };
  const shared = wa === wb ? n + wa : n;
  for (let j = 0; j < shared - 1; j++) quad(a[j]!, a[j + 1]!, b[j]!, b[j + 1]!);
  if (wa === wb) return;
  if (wb === 0) {
    for (let k = 0; k < wa; k++) tri(a[n - 1 + k]!, b[n - 1]!, a[n + k]!);
  } else if (wa === 0) {
    for (let k = 0; k < wb; k++) tri(a[n - 1]!, b[n - 1 + k]!, b[n + k]!);
  }
};

/**
 * Flip normals + triangle winding in place if the mesh's per-vertex normals
 * predominantly point toward the centroid (i.e. the shell is inside-out).
 */
const orientOutward = (
  positions: number[],
  indices: number[],
  normals: Float32Array,
  vertexCount: number,
): void => {
  if (vertexCount === 0) return;

  let cx = 0;
  let cy = 0;
  let cz = 0;
  for (let v = 0; v < vertexCount; v++) {
    cx += positions[v * 3]!;
    cy += positions[v * 3 + 1]!;
    cz += positions[v * 3 + 2]!;
  }
  cx /= vertexCount;
  cy /= vertexCount;
  cz /= vertexCount;

  // Sum dot(normal, vertex - centroid): positive => outward, negative => inverted.
  let outwardness = 0;
  for (let v = 0; v < vertexCount; v++) {
    const rx = positions[v * 3]! - cx;
    const ry = positions[v * 3 + 1]! - cy;
    const rz = positions[v * 3 + 2]! - cz;
    outwardness += normals[v * 3]! * rx + normals[v * 3 + 1]! * ry + normals[v * 3 + 2]! * rz;
  }

  if (outwardness >= 0) return;

  for (let i = 0; i < normals.length; i++) normals[i] = -normals[i]!;
  for (let t = 0; t + 2 < indices.length; t += 3) {
    const swap = indices[t + 1]!;
    indices[t + 1] = indices[t + 2]!;
    indices[t + 2] = swap;
  }
};
