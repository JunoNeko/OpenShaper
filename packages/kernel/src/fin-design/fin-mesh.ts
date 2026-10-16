// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Triangle meshes of a fin for the 3D preview and STL: step 7 of
 * docs/design/fin-designer.md. Two closed shells, blade and tab, in the frame of
 * blade.ts and fin-step.ts (cm; the STL writer scales to mm).
 *
 * The blade is meshed straight from the design's sections, not from the STEP surface:
 * rings of {@link sectionLoop} stacked up the blade, joined by quads, with the root
 * and tip rings capped flat. Sections stop {@link FinMeshOptions.tipGap} under the
 * tip, as the STEP blade does. The tab is its profile (arcs sampled to
 * {@link FinMeshOptions.arcTolerance}) extruded across its thickness.
 *
 * Closed by construction: neighbouring triangles share vertex indices, so every edge
 * belongs to exactly two triangles, and each face group is wound against its
 * measured outward direction.
 */
import { meshWithNormals } from '../fins';
import type { BoardMesh } from '../tessellate';
import { vec2, type Vec2 } from '../vec2';
import type { Vert3 } from '../loft';
import { bladeSection, cosineStations, prepareBlade, raisedRearHeights } from './blade';
import { sectionLoop } from './blade-surface';
import { finTabKind, type FinDesign } from './fin-design';
import { tabCentreY } from './fin-placement';
import { futuresTabOutline, type TabSegment } from './futures-tab';
import { polygonArea, triangulate } from './triangulate';

export interface FinMeshOptions {
  /** Rings up the blade. */
  readonly rows?: number;
  /** Chord stations per face in each ring. */
  readonly stations?: number;
  /** How far below the tip the rings stop (cm). */
  readonly tipGap?: number;
  /** Largest gap between a tab arc and its chords (cm). */
  readonly arcTolerance?: number;
}

/** Light enough to rebuild on every edit. */
export const FIN_MESH_PREVIEW = { rows: 40, stations: 32, tipGap: 0.01, arcTolerance: 0.002 };

/** For STL: rings about 0.5 mm apart on a 100 mm fin. */
export const FIN_MESH_FINE = { rows: 200, stations: 120, tipGap: 0.01, arcTolerance: 0.0005 };

export interface FinMesh {
  readonly blade: BoardMesh;
  readonly tab: BoardMesh;
}

const sub = (a: Vert3, b: Vert3): Vert3 => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
const crossV = (a: Vert3, b: Vert3): Vert3 => ({
  x: a.y * b.z - a.z * b.y,
  y: a.z * b.x - a.x * b.z,
  z: a.x * b.y - a.y * b.x,
});
const dot = (a: Vert3, b: Vert3): number => a.x * b.x + a.y * b.y + a.z * b.z;

/** Collects vertices and triangles; `tri` winds each triangle about `outward`. */
const builder = () => {
  const positions: number[] = [];
  const indices: number[] = [];
  const pts: Vert3[] = [];
  return {
    add(p: Vert3): number {
      pts.push(p);
      positions.push(p.x, p.y, p.z);
      return pts.length - 1;
    },
    tri(a: number, b: number, c: number, outward: Vert3): void {
      const n = crossV(sub(pts[b]!, pts[a]!), sub(pts[c]!, pts[a]!));
      if (dot(n, outward) >= 0) indices.push(a, b, c);
      else indices.push(a, c, b);
    },
    done: (): BoardMesh => meshWithNormals(positions, indices),
  };
};

/** Fill a flat ring (vertex ids, positions in the plane) facing `outward`. */
const cap = (
  m: ReturnType<typeof builder>,
  ids: readonly number[],
  flat: readonly Vec2[],
  outward: Vert3,
): void => {
  for (const [a, b, c] of triangulate(flat)) m.tri(ids[a]!, ids[b]!, ids[c]!, outward);
};

const bladeMesh = (d: FinDesign, o: Required<FinMeshOptions>): BoardMesh => {
  const b = prepareBlade(d);
  const top = b.depth - o.tipGap;
  const st = cosineStations(o.stations);
  // Rings gather toward the tip, where the chord closes fastest.
  const tipward = Array.from({ length: o.rows + 1 }, (_, k) => top * (1 - (1 - k / o.rows) ** 2));
  // A raised rear's underside needs rings of its own (raisedRearHeights).
  const rear = raisedRearHeights(b, o.rows, top);
  const corner = b.raisedRear?.cornerZ ?? 0;
  const heights = rear.length
    ? [0, ...rear, corner, ...tipward.filter((h) => h > corner)]
    : tipward;
  const rings = heights.map((h) => sectionLoop(bladeSection(b, h, st)).slice(0, -1));
  const m = builder();
  const ids = rings.map((ring) => ring.map((p) => m.add(p)));
  const n = rings[0]!.length;

  // Which way round the rings run (a right fin's mirror runs the other way), so each
  // side quad can be wound with its outward normal pointing away from the ring.
  const ccw = polygonArea(rings[0]!.map((p) => vec2(p.x, p.y))) > 0;
  for (let k = 0; k < rings.length - 1; k++) {
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      const a = rings[k]![j]!;
      const c = rings[k]![j1]!;
      // Outward in the ring's plane: right of travel for a counter-clockwise ring.
      const t = sub(c, a);
      const out = ccw ? { x: t.y, y: -t.x, z: 0 } : { x: -t.y, y: t.x, z: 0 };
      m.tri(ids[k]![j]!, ids[k]![j1]!, ids[k + 1]![j1]!, out);
      m.tri(ids[k]![j]!, ids[k + 1]![j1]!, ids[k + 1]![j]!, out);
    }
  }
  const flat = (ring: readonly Vert3[]) => ring.map((p) => vec2(p.x, p.y));
  cap(m, ids[0]!, flat(rings[0]!), { x: 0, y: 0, z: -1 });
  cap(m, ids[ids.length - 1]!, flat(rings[rings.length - 1]!), { x: 0, y: 0, z: 1 });
  return m.done();
};

/** The tab profile as a polygon (tab frame, counter-clockwise), arcs sampled to `tolerance` cm. */
export const tabProfilePoints = (segments: readonly TabSegment[], tolerance: number): Vec2[] =>
  segments.flatMap((s) => {
    if (s.kind === 'line') return [s.from];
    const a = Math.atan2(s.from.y - s.center.y, s.from.x - s.center.x);
    let sweep = Math.atan2(s.to.y - s.center.y, s.to.x - s.center.x) - a;
    if (s.ccw && sweep <= 0) sweep += 2 * Math.PI;
    if (!s.ccw && sweep >= 0) sweep -= 2 * Math.PI;
    // Chord sag r(1 − cos(step/2)) within tolerance.
    const step = 2 * Math.acos(Math.max(-1, 1 - tolerance / s.radius));
    const n = Math.max(2, Math.ceil(Math.abs(sweep) / step));
    return Array.from({ length: n }, (_, i) =>
      vec2(
        s.center.x + s.radius * Math.cos(a + (sweep * i) / n),
        s.center.y + s.radius * Math.sin(a + (sweep * i) / n),
      ),
    );
  });

const tabMesh = (d: FinDesign, o: Required<FinMeshOptions>): BoardMesh => {
  const tab = futuresTabOutline(finTabKind(d.position));
  const { height: H, thickness: t } = tab.spec;
  const yc = tabCentreY(d);
  const profile = tabProfilePoints(tab.segments, o.arcTolerance);
  const m = builder();
  // Tab frame (x, y up from the bottom) to the fin frame: z = y − H.
  const side = (y: number) => profile.map((p) => m.add({ x: p.x, y, z: p.y - H }));
  const lo = side(yc - t / 2);
  const hi = side(yc + t / 2);
  cap(m, lo, profile, { x: 0, y: -1, z: 0 });
  cap(m, hi, profile, { x: 0, y: 1, z: 0 });
  const n = profile.length;
  for (let i = 0; i < n; i++) {
    const i1 = (i + 1) % n;
    const dx = profile[i1]!.x - profile[i]!.x;
    const dz = profile[i1]!.y - profile[i]!.y;
    // Outward is right of travel round the counter-clockwise profile.
    const out = { x: dz, y: 0, z: -dx };
    m.tri(lo[i]!, lo[i1]!, hi[i1]!, out);
    m.tri(lo[i]!, hi[i1]!, hi[i]!, out);
  }
  return m.done();
};

/** Blade and tab meshes of a valid design (see `validateFinDesign`). */
export const finMesh = (d: FinDesign, opts: FinMeshOptions = {}): FinMesh => {
  const o = { ...FIN_MESH_PREVIEW, ...opts };
  return { blade: bladeMesh(d, o), tab: tabMesh(d, o) };
};
