// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Triangulating a simple polygon in the plane, for capping a hull's blunt ends.
 *
 * A fan from the centre caps a convex end, which a board's tail is until channels run
 * out through it: then the end's outline has notches cut up into its bottom edge, and
 * fan triangles cross them, closing the channels' mouths with a web (owner report,
 * 2026-11). Ear clipping covers exactly the outline, notches and all.
 */

/** A point in the polygon's plane. */
export interface P2 {
  readonly x: number;
  readonly y: number;
}

/** Twice the signed area: positive when the points run anticlockwise. */
const signedArea2 = (pts: readonly P2[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return a;
};

const cross = (a: P2, b: P2, c: P2) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);

/** `p` strictly inside triangle abc (anticlockwise), with a little slack on the edges. */
const inside = (p: P2, a: P2, b: P2, c: P2, eps: number) =>
  cross(a, b, p) > eps && cross(b, c, p) > eps && cross(c, a, p) > eps;

/**
 * Triangles covering the simple polygon `pts` (closed implicitly, either direction), as
 * index triples wound the same way as the polygon runs. O(n³): fine for a hull's end
 * ring, a few hundred points, closed twice a mesh.
 *
 * Points a hair apart (a channel's vertical wall is two points 1 µm apart) and points on
 * a straight run are handled: the best-shaped ear goes first, so they end up joined to
 * points across the outline rather than in zero-area slivers (owner's
 * Triangles_missing: slivers along a step's straight floor faced either way).
 */
export const triangulatePolygon = (pts: readonly P2[]): [number, number, number][] => {
  const n = pts.length;
  if (n < 3) return [];
  const ccw = signedArea2(pts) >= 0;
  // Work anticlockwise; hand the triangles back in the polygon's own direction.
  const idx = Array.from({ length: n }, (_, i) => (ccw ? i : n - 1 - i));
  const at = (i: number) => pts[i]!;
  let scale = 0;
  for (const p of pts) scale = Math.max(scale, Math.abs(p.x), Math.abs(p.y));
  const eps = (scale * scale + 1e-30) * 1e-14;
  const out: [number, number, number][] = [];
  const emit = (a: number, b: number, c: number) => out.push(ccw ? [a, b, c] : [c, b, a]);

  // Clip the best-shaped ear each time (the widest angle at its tip), not the first
  // found: a vertex on a straight run (a step's straight floor) then goes last, joined
  // to a vertex across the outline, rather than clipped as a zero-area sliver that faces
  // either way.
  const sine = (a: P2, b: P2, c: P2) =>
    cross(a, b, c) / (Math.hypot(b.x - a.x, b.y - a.y) * Math.hypot(c.x - b.x, c.y - b.y) || 1);
  while (idx.length > 3) {
    const m = idx.length;
    let best = -1;
    let bestSine = -Infinity;
    for (let k = 0; k < m; k++) {
      const a = at(idx[(k + m - 1) % m]!);
      const b = at(idx[k]!);
      const c = at(idx[(k + 1) % m]!);
      if (cross(a, b, c) < -eps) continue; // reflex
      const q = sine(a, b, c);
      if (q <= bestSine) continue;
      let blocked = false;
      for (const j of idx) {
        if (j === idx[(k + m - 1) % m] || j === idx[k] || j === idx[(k + 1) % m]) continue;
        if (inside(at(j), a, b, c, eps)) {
          blocked = true;
          break;
        }
      }
      if (blocked) continue;
      best = k;
      bestSine = q;
    }
    if (best < 0) {
      // Numerically stuck (it shouldn't be on a simple polygon): clip the least reflex
      // corner, so the cap still closes.
      let bestCross = -Infinity;
      for (let k = 0; k < m; k++) {
        const c = cross(at(idx[(k + m - 1) % m]!), at(idx[k]!), at(idx[(k + 1) % m]!));
        if (c > bestCross) {
          bestCross = c;
          best = k;
        }
      }
    }
    emit(idx[(best + m - 1) % m]!, idx[best]!, idx[(best + 1) % m]!);
    idx.splice(best, 1);
  }
  if (idx.length === 3) emit(idx[0]!, idx[1]!, idx[2]!);
  return out;
};
