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
import {
  bladeRowHeights,
  bladeSection,
  cosineStations,
  type FinLaminate,
  NO_LAMINATE,
  outlineFeatureHeights,
  prepareBlade,
} from './blade';
import { sectionLoop } from './blade-surface';
import type { FinDesign } from './fin-design';
import { finTabOutline } from './fin-tab';
import { tabFacesY } from './fin-placement';
import type { TabSegment } from './futures-tab';
import { polygonArea, triangulate, triangulateWithHoles } from './triangulate';

export interface FinMeshOptions {
  /** Rings up the blade. */
  readonly rows?: number;
  /** Chord stations per face in each ring. */
  readonly stations?: number;
  /** How far below the tip the rings stop (cm). */
  readonly tipGap?: number;
  /** Largest gap between a tab arc and its chords (cm). */
  readonly arcTolerance?: number;
  /** Mesh the blade as the core under this laminate (blade.ts), and the tab if it wraps it. */
  readonly laminate?: FinLaminate;
}

/** Light enough to rebuild on every edit. */
export const FIN_MESH_PREVIEW = {
  rows: 40,
  stations: 32,
  tipGap: 0.01,
  arcTolerance: 0.002,
  laminate: NO_LAMINATE,
};

/** For STL: rings about 0.5 mm apart on a 100 mm fin. */
export const FIN_MESH_FINE = {
  rows: 200,
  stations: 120,
  tipGap: 0.01,
  arcTolerance: 0.0005,
  laminate: NO_LAMINATE,
};

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

/** Offsets (cm) of the extra rings either side of an outline feature's height. */
const FEATURE_RINGS = [0.01, 0.03, 0.1];

const bladeMesh = (d: FinDesign, o: Required<FinMeshOptions>): BoardMesh => {
  const b = prepareBlade(d, o.laminate);
  const top = b.depth - o.tipGap;
  const st = cosineStations(o.stations);
  // Rings spaced along the edges' travel: they gather at the tip, and wherever an edge
  // runs nearly level (a raised rear's underside, a hooked tip).
  // Plus rings at and either side of where the outline turns hardest, so a tip that
  // sticks out backward isn't cut off between rings (outlineFeatureHeights).
  const features = outlineFeatureHeights(b, top).flatMap((h) =>
    [0, ...FEATURE_RINGS.flatMap((o) => [-o, o])].map((o) => h + o),
  );
  const heights = [
    ...new Set([
      ...bladeRowHeights(b, 0, top, o.rows),
      ...features.filter((h) => h > 0 && h < top),
    ]),
  ].sort((p, q) => p - q);
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
  const tab = finTabOutline(d.base);
  const { height: H } = tab;
  const [yLo, yHi] = tabFacesY(d, o.laminate);
  const profile = tabProfilePoints(tab.segments, o.arcTolerance);
  const holes = tab.holes.map((h) => tabProfilePoints(h, o.arcTolerance));
  const m = builder();
  // Tab frame (x, y up from the bottom) to the fin frame: z = y − H.
  const side = (ring: readonly Vec2[], y: number) =>
    ring.map((p) => m.add({ x: p.x, y, z: p.y - H }));
  const rings = [profile, ...holes];
  const lo = rings.map((r) => side(r, yLo));
  const hi = rings.map((r) => side(r, yHi));
  // The two sides: the profile less its holes.
  const flatIds = (ids: number[][]) => ids.flat();
  const tris = triangulateWithHoles(profile, holes);
  for (const [a, b, c] of tris) {
    const l = flatIds(lo);
    const h = flatIds(hi);
    m.tri(l[a]!, l[b]!, l[c]!, { x: 0, y: -1, z: 0 });
    m.tri(h[a]!, h[b]!, h[c]!, { x: 0, y: 1, z: 0 });
  }
  // The walls round the profile and through each hole. Outward is right of travel for
  // both: the profile runs counter-clockwise, each hole clockwise.
  rings.forEach((ring, r) => {
    const n = ring.length;
    for (let i = 0; i < n; i++) {
      const i1 = (i + 1) % n;
      const dx = ring[i1]!.x - ring[i]!.x;
      const dz = ring[i1]!.y - ring[i]!.y;
      const out = { x: dz, y: 0, z: -dx };
      m.tri(lo[r]![i]!, lo[r]![i1]!, hi[r]![i1]!, out);
      m.tri(lo[r]![i]!, hi[r]![i1]!, hi[r]![i]!, out);
    }
  });
  return m.done();
};

/** Blade and tab meshes of a valid design (see `validateFinDesign`). */
export const finMesh = (d: FinDesign, opts: FinMeshOptions = {}): FinMesh => {
  const o = { ...FIN_MESH_PREVIEW, ...opts };
  return { blade: bladeMesh(d, o), tab: tabMesh(d, o) };
};
