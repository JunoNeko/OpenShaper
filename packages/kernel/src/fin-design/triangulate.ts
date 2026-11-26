// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Ear-clipping triangulation of a simple polygon, for the fin mesh's flat faces: the
 * blade's root and tip caps and the tab's sides. Those are small (a few hundred
 * points) and often not convex (the tab's notch and slot, a cambered foil), which
 * rules out a fan and doesn't need anything faster than O(n²).
 */
import type { Vec2 } from '../vec2';

const cross = (o: Vec2, a: Vec2, b: Vec2): number =>
  (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);

/** Signed area: positive when the polygon runs counter-clockwise. */
export const polygonArea = (pts: readonly Vec2[]): number => {
  let s = 0;
  pts.forEach((p, i) => {
    const q = pts[(i + 1) % pts.length]!;
    s += p.x * q.y - q.x * p.y;
  });
  return s / 2;
};

const same = (p: Vec2, q: Vec2): boolean => p.x === q.x && p.y === q.y;

const inTriangle = (p: Vec2, a: Vec2, b: Vec2, c: Vec2): boolean =>
  cross(a, b, p) >= 0 && cross(b, c, p) >= 0 && cross(c, a, p) >= 0;

/**
 * Triangles (index triples into `pts`) covering a simple polygon, each wound the same
 * way as the polygon, using every vertex. Pass each vertex once (no repeated closing
 * point).
 */
export const triangulate = (pts: readonly Vec2[]): [number, number, number][] => {
  const ccw = polygonArea(pts) > 0;
  // Work counter-clockwise; flip the triangles back at the end if the input was not.
  const ring = pts.map((_, i) => i);
  if (!ccw) ring.reverse();
  const tris: [number, number, number][] = [];
  let guard = 0;
  while (ring.length > 3 && guard < pts.length * pts.length) {
    guard++;
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const ia = ring[(i + ring.length - 1) % ring.length]!;
      const ib = ring[i]!;
      const ic = ring[(i + 1) % ring.length]!;
      const a = pts[ia]!;
      const b = pts[ib]!;
      const c = pts[ic]!;
      if (cross(a, b, c) <= 0) continue; // reflex or flat: not an ear
      let blocked = false;
      for (const j of ring) {
        if (j === ia || j === ib || j === ic) continue;
        const p = pts[j]!;
        // A bridge to a hole repeats points: a copy of a corner doesn't block the ear.
        if (same(p, a) || same(p, b) || same(p, c)) continue;
        if (inTriangle(p, a, b, c)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      tris.push([ia, ib, ic]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    // Only collinear runs left (a flat face's points): clip one as a zero-area
    // triangle. Dropping the point instead would leave a hole where it meets the
    // neighbouring faces.
    if (!clipped) {
      const i = ring.findIndex((ib, k) => {
        const a = pts[ring[(k + ring.length - 1) % ring.length]!]!;
        const c = pts[ring[(k + 1) % ring.length]!]!;
        return Math.abs(cross(a, pts[ib]!, c)) <= 1e-15;
      });
      if (i < 0) throw new Error('triangulate: polygon is not simple');
      tris.push([
        ring[(i + ring.length - 1) % ring.length]!,
        ring[i]!,
        ring[(i + 1) % ring.length]!,
      ]);
      ring.splice(i, 1);
    }
  }
  if (ring.length === 3) tris.push([ring[0]!, ring[1]!, ring[2]!]);
  return ccw ? tris : tris.map(([a, b, c]) => [a, c, b]);
};

/** Whether segments pq and rs cross at a point inside both (touching ends don't count). */
const properlyCross = (p: Vec2, q: Vec2, r: Vec2, s: Vec2): boolean => {
  const d1 = cross(r, s, p);
  const d2 = cross(r, s, q);
  const d3 = cross(p, q, r);
  const d4 = cross(p, q, s);
  return ((d1 > 0 && d2 < 0) || (d1 < 0 && d2 > 0)) && ((d3 > 0 && d4 < 0) || (d3 < 0 && d4 > 0));
};

/**
 * Triangles covering a polygon with holes (the tab's side, with its weight-saving
 * holes): `outer` and each hole are simple and don't touch. Indices refer to the points
 * in the order `[...outer, ...holes[0], ...holes[1], …]`; triangles wind as `outer` does.
 *
 * Each hole is joined to the outline by a cut, making one simple ring that visits the
 * cut's two points twice (the usual bridging, rightmost hole first). Cuts only join
 * existing points, so the faces either side of every edge still match.
 */
export const triangulateWithHoles = (
  outer: readonly Vec2[],
  holes: readonly (readonly Vec2[])[],
): [number, number, number][] => {
  const pts: Vec2[] = [...outer];
  const ccwOuter = polygonArea(outer) > 0;
  let ring = outer.map((_, i) => i);
  if (!ccwOuter) ring.reverse(); // work counter-clockwise
  const holeRings = holes.map((h) => {
    const start = pts.length;
    pts.push(...h);
    const r = h.map((_, i) => start + i);
    // Holes run clockwise against a counter-clockwise outline.
    return polygonArea(h) > 0 ? r.reverse() : r;
  });
  const edgesOf = (r: readonly number[]) =>
    r.map((a, i) => [pts[a]!, pts[r[(i + 1) % r.length]!]!] as const);
  const remaining = [...holeRings].sort(
    (a, b) => Math.max(...b.map((i) => pts[i]!.x)) - Math.max(...a.map((i) => pts[i]!.x)),
  );
  while (remaining.length) {
    const hole = remaining.shift()!;
    // The hole's rightmost point, joined to the nearest ring point it can see.
    const k = hole.reduce((best, i, j) => (pts[i]!.x > pts[hole[best]!]!.x ? j : best), 0);
    const m = pts[hole[k]!]!;
    const blockers = [...edgesOf(ring), ...remaining.flatMap(edgesOf), ...edgesOf(hole)];
    const candidates = ring
      .map((v, pos) => ({ v, pos, d: Math.hypot(pts[v]!.x - m.x, pts[v]!.y - m.y) }))
      .sort((a, b) => a.d - b.d);
    const seen = candidates.find(
      ({ v }) => pts[v]!.x >= m.x && !blockers.some(([a, b]) => properlyCross(m, pts[v]!, a, b)),
    );
    if (!seen) throw new Error('triangulateWithHoles: no outline point in view of a hole');
    const loop = [...hole.slice(k), ...hole.slice(0, k), hole[k]!];
    ring = [...ring.slice(0, seen.pos + 1), ...loop, seen.v, ...ring.slice(seen.pos + 1)];
  }
  const tris = triangulate(ring.map((i) => pts[i]!)).map(
    ([a, b, c]) => [ring[a]!, ring[b]!, ring[c]!] as [number, number, number],
  );
  return ccwOuter ? tris : tris.map(([a, b, c]) => [a, c, b]);
};
