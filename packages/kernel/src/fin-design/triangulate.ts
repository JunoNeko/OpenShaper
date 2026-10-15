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
        if (inTriangle(pts[j]!, a, b, c)) {
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
