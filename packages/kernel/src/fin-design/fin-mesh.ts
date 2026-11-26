// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Triangle meshes of a fin for the 3D preview and STL: step 7 of
 * docs/design/fin-designer.md. Two closed shells, blade and tab, in the frame of
 * blade.ts and fin-step.ts (cm; the STL writer scales to mm).
 *
 * The blade is meshed straight from the smooth blade's rows, not from the STEP surface:
 * rings of {@link sectionLoop} along the fin, joined by quads, the root capped and the
 * last row closed. The tab is its profile (arcs sampled to
 * {@link FinMeshOptions.arcTolerance}) extruded across its thickness.
 *
 * Closed by construction: neighbouring triangles share vertex indices, so every edge
 * belongs to exactly two triangles, and each face group is wound against its
 * measured outward direction.
 */
import { meshWithNormals } from '../fins';
import type { BoardMesh } from '../tessellate';
import { vec2, type Vec2 } from '../vec2';
import { splineExtremes } from './curve-shape';
import type { Vert3 } from '../loft';
import { cosineStations, type FinLaminate, NO_LAMINATE } from './blade';
import { sectionLoop } from './blade-surface';
import { FIN_MIN_THICKNESS, finOutward, type FinDesign } from './fin-design';
import { smoothBlade } from './smooth-blade';
import { finTabOutline } from './fin-tab';
import { tabCentreY, tabFacesY } from './fin-placement';
import type { TabSegment } from './futures-tab';
import { triangulateWithHoles } from './triangulate';

export interface FinMeshOptions {
  /** Rings up the blade. */
  readonly rows?: number;
  /** Chord stations per face in each ring. */
  readonly stations?: number;
  /** How far below the tip the rings stop at most (cm); see `bladeTop`. */
  readonly tipGap?: number;
  /** Largest gap between a tab arc and its chords (cm). */
  readonly arcTolerance?: number;
  /** Mesh the blade as the core under this laminate (blade.ts), and the tab if it wraps it. */
  readonly laminate?: FinLaminate;
  /** Thinnest the blade gets (cm); the design minimum by default (blade.ts). */
  readonly minThickness?: number;
}

/** Light enough to rebuild on every edit. */
export const FIN_MESH_PREVIEW = {
  rows: 40,
  stations: 32,
  tipGap: 0.01,
  arcTolerance: 0.002,
  laminate: NO_LAMINATE,
  minThickness: FIN_MIN_THICKNESS,
};

/** For STL: rings about 0.5 mm apart on a 100 mm fin. */
export const FIN_MESH_FINE = {
  rows: 200,
  stations: 120,
  tipGap: 0.01,
  arcTolerance: 0.0005,
  laminate: NO_LAMINATE,
  minThickness: FIN_MIN_THICKNESS,
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

/**
 * The smooth blade's mesh (smooth-blade.ts): rings along its rows (s), each a section
 * loop from edge to edge, gathered toward the tip edge where the tip rounds over fastest;
 * the root ring capped flat, and the last row, at the tip edge, closed as a strip across
 * its minimum thickness.
 */
const smoothBladeMesh = (d: FinDesign, o: Required<FinMeshOptions>): BoardMesh => {
  const sb = smoothBlade(d, o.laminate, o.minThickness);
  const us = cosineStations(o.stations);
  const rootEnd = d.outline.knots[d.outline.knots.length - 1]!.end.x;
  // Gathered toward the tip edge (s = 1), even near the base; and a row through each of
  // the profile's outermost points (rearmost, foremost, highest), where the layout has a
  // node on it (smooth-blade.ts), so the mesh reaches them: a hook's tip, say.
  const even = Array.from({ length: o.rows + 1 }, (_, i) => Math.sin((Math.PI / 2) * (i / o.rows)));
  const ex = splineExtremes(d.outline, 'x');
  const ey = splineExtremes(d.outline, 'y');
  const ext = [ex.min, ex.max, ey.max];
  const through = ext
    .map((e) => sb.nearest(e.point.x, e.point.y).s)
    .filter((s) => s > 0.02 && s < 1);
  const ss = [...even];
  const used = new Set<number>();
  for (const t of through) {
    // In place of the nearest unused interior row, so the rows stay as many, in order, and
    // without overwriting another extremum's row or collapsing a neighbouring gap.
    let k = -1;
    let bestDist = Infinity;
    for (let i = 1; i < ss.length - 1; i++) {
      if (used.has(i)) continue;
      const dist = Math.abs(ss[i]! - t);
      if (dist < bestDist) {
        bestDist = dist;
        k = i;
      }
    }
    if (k < 0) continue;
    const minGap = (ss[k + 1]! - ss[k - 1]!) * 0.1;
    if (t - ss[k - 1]! > minGap && ss[k + 1]! - t > minGap) {
      ss[k] = t;
      used.add(k);
    }
  }
  const rows = ss.map((s) => {
    const outside: Vert3[] = [];
    const inside: Vert3[] = [];
    for (const u of us) {
      const f = sb.faces(s, u);
      // Along the root the first row sits exactly on the tab top; the layout's spline can
      // stray from it by a few microns beside a raised rear's corner.
      const onRoot = s === 0 && sb.point(0, u).x >= rootEnd;
      outside.push(onRoot ? { ...f.outside, z: 0 } : f.outside);
      inside.push(onRoot ? { ...f.inside, z: 0 } : f.inside);
    }
    return { outside, inside };
  });
  const rings = rows.map((r) => sectionLoop(r).slice(0, -1));
  const m = builder();
  const ids = rings.map((ring) => ring.map((p) => m.add(p)));
  const n = rings[0]!.length;
  // Every quad is wound the same way round, as the rings all run the same way: which way
  // is outward is settled once, on the outside face halfway along the first row, where it
  // faces the outside. (Judged quad by quad from the ring's direction seen from above, as
  // the sweep's horizontal rings are, it flipped wherever a row runs up and down, round a
  // hook's tip.)
  const normal = (a: Vert3, b: Vert3, c: Vert3) => crossV(sub(b, a), sub(c, a));
  const ref = (() => {
    const j = Math.floor(us.length / 2);
    return normal(rings[0]![j]!, rings[0]![j + 1]!, rings[1]![j + 1]!);
  })();
  const sign = ref.y * sb.blade.outward >= 0 ? 1 : -1;
  /**
   * A triangle kept in its own order, or reversed with all the rest: never judged on its
   * own (an edge cap's triangles have no area to judge by).
   */
  const keep = (a: number, b: number, c: number, pa: Vert3, pb: Vert3, pc: Vert3) => {
    if (sign > 0) m.tri(a, b, c, normal(pa, pb, pc));
    else m.tri(a, c, b, normal(pa, pc, pb));
  };
  for (let k = 0; k < rings.length - 1; k++) {
    const r0 = rings[k]!;
    const r1 = rings[k + 1]!;
    for (let j = 0; j < n; j++) {
      const j1 = (j + 1) % n;
      keep(ids[k]![j]!, ids[k]![j1]!, ids[k + 1]![j1]!, r0[j]!, r0[j1]!, r1[j1]!);
      keep(ids[k]![j]!, ids[k + 1]![j1]!, ids[k + 1]![j]!, r0[j]!, r1[j1]!, r1[j]!);
    }
  }
  // The two ends: the base, and the short last row at the tip edge. Each is closed face to
  // face across the blade. The base isn't flat on a raised rear, whose underside it climbs:
  // capped as a flat polygon seen from above, triangles ran from the underside down to the
  // tab top, a V in any cut through it (owner testing). Each triangle is listed in the ring's
  // own order, running its edges against the quads next to it (reversed at the base, whose
  // quads are on its other side), and takes the same outward choice.
  const last = us.length - 1;
  const caps = (n - 2 * us.length) / 2;
  const outAt = (j: number) => j;
  const inAt = (j: number) => last + caps + 1 + (last - j);
  const closeRing = (k: number, reverse: boolean) => {
    const id = ids[k]!;
    const ring = rings[k]!;
    const close = (a: number, b: number, c: number) =>
      reverse
        ? keep(id[a]!, id[c]!, id[b]!, ring[a]!, ring[c]!, ring[b]!)
        : keep(id[a]!, id[b]!, id[c]!, ring[a]!, ring[b]!, ring[c]!);
    for (let j = 0; j < last; j++) {
      close(outAt(j), outAt(j + 1), inAt(j + 1));
      close(outAt(j), inAt(j + 1), inAt(j));
    }
    // The ends of the strip: each edge cap's points fanned from its first.
    const teCap = [
      outAt(last),
      ...Array.from({ length: caps }, (_, q) => last + 1 + q),
      inAt(last),
    ];
    const leCap = [inAt(0), ...Array.from({ length: caps }, (_, q) => n - caps + q), outAt(0)];
    for (const fan of [teCap, leCap]) {
      for (let q = 1; q < fan.length - 1; q++) close(fan[0]!, fan[q]!, fan[q + 1]!);
    }
  };
  closeRing(0, true);
  closeRing(rings.length - 1, false);
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
  const tab = finTabOutline(d.base, d.outline);
  const { height: H } = tab;
  const [yLo, yHi] = tabFacesY(d, o.laminate);
  const outward = finOutward(d.hand);
  // Bores are centred on the tab's own mid-plane, whatever a laminate takes off its faces.
  const yc = tabCentreY(d);
  const m = builder();
  // Each tab its own closed shell (FCS 1 has two).
  for (const part of tab.parts) {
    const profile = tabProfilePoints(part.segments, o.arcTolerance);
    const holes = part.holes.map((h) => tabProfilePoints(h, o.arcTolerance));
    // Tab frame (x, y up from the bottom) to the fin frame: z = y − H.
    const side = (ring: readonly Vec2[], y: number) =>
      ring.map((p) => m.add({ x: p.x, y, z: p.y - H }));
    const rings = [profile, ...holes];
    const lo = rings.map((r) => side(r, yLo));
    const hi = rings.map((r) => side(r, yHi));
    // Shallow blind circular recesses on either side face (Modii locking dimples).
    const pockets = (part.pockets ?? []).map((p) => {
      const onHi = (p.side === 'outside') === (outward === 1);
      const faceY = onHi ? yHi : yLo;
      const ny = onHi ? 1 : -1;
      const depth = Math.min(p.depth, (yHi - yLo) * 0.45);
      const floorY = faceY - ny * depth;
      const n = Math.max(
        16,
        Math.ceil((2 * Math.PI * p.radius) / (2 * Math.sqrt(2 * p.radius * o.arcTolerance))),
      );
      // Clockwise in (x, y), matching `holes` for triangulateWithHoles.
      const ring2d = Array.from({ length: n }, (_, j) => {
        const a = (-2 * Math.PI * j) / n;
        return vec2(p.x + p.radius * Math.cos(a), p.y + p.radius * Math.sin(a));
      });
      const mouthIds = ring2d.map((q) => m.add({ x: q.x, y: faceY, z: q.y - H }));
      const floorIds = ring2d.map((q) => m.add({ x: q.x, y: floorY, z: q.y - H }));
      const centerId = m.add({ x: p.x, y: floorY, z: p.y - H });
      return { p, onHi, ny, ring2d, mouthIds, floorIds, centerId };
    });
    const loPockets = pockets.filter((pk) => !pk.onHi);
    const hiPockets = pockets.filter((pk) => pk.onHi);
    // The two sides: the profile less its through-holes and any blind pockets on that face.
    const l = [...lo.flat(), ...loPockets.flatMap((pk) => pk.mouthIds)];
    const h = [...hi.flat(), ...hiPockets.flatMap((pk) => pk.mouthIds)];
    for (const [a, b, c] of triangulateWithHoles(profile, [
      ...holes,
      ...loPockets.map((pk) => pk.ring2d),
    ])) {
      m.tri(l[a]!, l[b]!, l[c]!, { x: 0, y: -1, z: 0 });
    }
    for (const [a, b, c] of triangulateWithHoles(profile, [
      ...holes,
      ...hiPockets.map((pk) => pk.ring2d),
    ])) {
      m.tri(h[a]!, h[b]!, h[c]!, { x: 0, y: 1, z: 0 });
    }
    // Each blind pocket's cylindrical wall (facing in) and flat circular floor (facing out).
    for (const { p, ny, ring2d, mouthIds, floorIds, centerId } of pockets) {
      const n = ring2d.length;
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        const q = ring2d[j]!;
        const inward = { x: p.x - q.x, y: 0, z: p.y - q.y };
        m.tri(mouthIds[j]!, mouthIds[j1]!, floorIds[j1]!, inward);
        m.tri(mouthIds[j]!, floorIds[j1]!, floorIds[j]!, inward);
        m.tri(centerId, floorIds[j]!, floorIds[j1]!, { x: 0, y: ny, z: 0 });
      }
    }
    // Holes straight down (the US box screw hole): a ring where each bore leaves a flat
    // horizontal wall, shared with the bore's own wall.
    const bores = (part.bores ?? []).map((b) => {
      const n = Math.max(
        16,
        Math.ceil((2 * Math.PI * b.radius) / (2 * Math.sqrt(2 * b.radius * o.arcTolerance))),
      );
      const ring = (y: number) =>
        Array.from({ length: n }, (_, j) => {
          const a = (2 * Math.PI * j) / n;
          return { x: b.x + b.radius * Math.cos(a), y: yc + b.radius * Math.sin(a), z: y - H };
        });
      const bottom = ring(b.from);
      const top = ring(b.to);
      return {
        b,
        bottom,
        top,
        bottomIds: bottom.map((q) => m.add(q)),
        topIds: top.map((q) => m.add(q)),
      };
    });
    // The walls round the profile and through each hole. Outward is right of travel for
    // both: the profile runs counter-clockwise, each hole clockwise.
    rings.forEach((ring, r) => {
      const n = ring.length;
      for (let i = 0; i < n; i++) {
        const i1 = (i + 1) % n;
        const dx = ring[i1]!.x - ring[i]!.x;
        const dz = ring[i1]!.y - ring[i]!.y;
        const out = { x: dz, y: 0, z: -dx };
        // A flat horizontal wall a bore passes through: the wall with the bore's ring cut out.
        const level = r === 0 && dz === 0 ? ring[i]!.y : null;
        const lo0 = Math.min(ring[i]!.x, ring[i1]!.x);
        const hi0 = Math.max(ring[i]!.x, ring[i1]!.x);
        const cut = bores.filter(
          ({ b }) =>
            level !== null &&
            (b.from === level || b.to === level) &&
            b.x - b.radius > lo0 &&
            b.x + b.radius < hi0,
        );
        if (cut.length) {
          const corners = [lo[r]![i]!, lo[r]![i1]!, hi[r]![i1]!, hi[r]![i]!];
          const flat = (q: Vert3) => vec2(q.x, q.y);
          const cornerPts = [
            vec2(ring[i]!.x, yLo),
            vec2(ring[i1]!.x, yLo),
            vec2(ring[i1]!.x, yHi),
            vec2(ring[i]!.x, yHi),
          ];
          const holes = cut.map((c) => (c.b.from === level ? c.bottom : c.top));
          const holeIds = cut.map((c) => (c.b.from === level ? c.bottomIds : c.topIds));
          const ids = [...corners, ...holeIds.flat()];
          for (const [a, b2, c] of triangulateWithHoles(
            cornerPts,
            holes.map((h) => h.map(flat)),
          )) {
            m.tri(ids[a]!, ids[b2]!, ids[c]!, out);
          }
          continue;
        }
        m.tri(lo[r]![i]!, lo[r]![i1]!, hi[r]![i1]!, out);
        m.tri(lo[r]![i]!, hi[r]![i1]!, hi[r]![i]!, out);
      }
    });
    // Each bore's wall faces in, toward its axis.
    for (const { b, bottom, bottomIds, topIds } of bores) {
      const n = bottomIds.length;
      for (let j = 0; j < n; j++) {
        const j1 = (j + 1) % n;
        const q = bottom[j]!;
        const inward = { x: b.x - q.x, y: yc - q.y, z: 0 };
        m.tri(bottomIds[j]!, bottomIds[j1]!, topIds[j1]!, inward);
        m.tri(bottomIds[j]!, topIds[j1]!, topIds[j]!, inward);
      }
    }
  }
  return m.done();
};

/** Blade and tab meshes of a valid design (see `validateFinDesign`). */
export const finMesh = (d: FinDesign, opts: FinMeshOptions = {}): FinMesh => {
  const o = { ...FIN_MESH_PREVIEW, ...opts };
  return { blade: smoothBladeMesh(d, o), tab: tabMesh(d, o) };
};
