// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Cutting a fin mesh with a plane, for the 3D view's section analysis: where the plane
 * cuts the surface, and what that cut measures.
 *
 * Two planes, in the fin frame (blade.ts, cm): `z`, a horizontal plane at a height up
 * the blade (it shows the foil there), and `x`, an upright plane square to the base at a
 * point along it (it shows the thickness up the blade there). Pure: a mesh in, segments
 * and numbers out, so the 3D view only draws them.
 */
import type { BoardMesh } from '../tessellate';

/** Which plane: `z` horizontal at a height, `x` upright at a point along the base. */
export type SliceAxis = 'x' | 'z';

/**
 * Where the plane `axis = at` cuts the mesh: one segment per triangle it crosses, as a
 * flat list of endpoint coordinates (x, y, z, x, y, z per segment), ready to draw.
 */
export const sliceMesh = (mesh: BoardMesh, axis: SliceAxis, at: number): number[] => {
  const k = axis === 'x' ? 0 : 2;
  const p = mesh.positions;
  const out: number[] = [];
  const hit: number[] = [];
  for (let i = 0; i < mesh.indices.length; i += 3) {
    hit.length = 0;
    for (let e = 0; e < 3; e++) {
      const a = mesh.indices[i + e]! * 3;
      const b = mesh.indices[i + ((e + 1) % 3)]! * 3;
      const da = p[a + k]! - at;
      const db = p[b + k]! - at;
      // Each edge that straddles the plane once (a vertex on it counts for one edge).
      if ((da < 0 && db >= 0) || (da >= 0 && db < 0)) {
        const t = da / (da - db);
        hit.push(
          p[a]! + (p[b]! - p[a]!) * t,
          p[a + 1]! + (p[b + 1]! - p[a + 1]!) * t,
          p[a + 2]! + (p[b + 2]! - p[a + 2]!) * t,
        );
      }
    }
    if (hit.length === 6) out.push(...hit);
  }
  return out;
};

/** What a cut measures (cm), or null where the plane misses the blade. */
export interface SliceMeasure {
  /** Horizontal cut: the chord. Upright cut: the blade's height there. */
  readonly length: number;
  /** The greatest thickness across the cut, measured square to the plane's other axis. */
  readonly thickness: number;
}

/**
 * Measure a cut from {@link sliceMesh}: its length along the plane (x for a horizontal
 * cut, z up from the tab top for an upright one) and its greatest thickness across (y),
 * found by crossing the cut with `samples` lines along that length.
 */
export const measureSlice = (
  segments: readonly number[],
  axis: SliceAxis,
  samples = 400,
): SliceMeasure | null => {
  if (segments.length === 0) return null;
  // Along: x for a horizontal cut, z for an upright one. Across: always y.
  const along = axis === 'z' ? 0 : 2;
  let lo = Infinity;
  let hi = -Infinity;
  for (let i = along; i < segments.length; i += 3) {
    lo = Math.min(lo, segments[i]!);
    hi = Math.max(hi, segments[i]!);
  }
  // An upright cut's length is the blade's height above the tab top, not the tab's depth.
  if (axis === 'x') lo = Math.max(0, lo);
  if (!(hi > lo)) return null;
  let thickness = 0;
  for (let s = 0; s <= samples; s++) {
    const v = lo + ((hi - lo) * s) / samples;
    let min = Infinity;
    let max = -Infinity;
    for (let i = 0; i < segments.length; i += 6) {
      const a = segments[i + along]!;
      const b = segments[i + 3 + along]!;
      if ((a - v) * (b - v) > 0 || a === b) continue;
      const t = (v - a) / (b - a);
      const y = segments[i + 1]! + (segments[i + 4]! - segments[i + 1]!) * t;
      min = Math.min(min, y);
      max = Math.max(max, y);
    }
    if (max > min) thickness = Math.max(thickness, max - min);
  }
  return { length: hi - lo, thickness };
};
