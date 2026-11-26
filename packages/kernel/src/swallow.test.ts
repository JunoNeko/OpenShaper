// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { splineFromKnots } from './bezier-spline';
import { board, getLength, getVolume, widthBoundsAt, type BezierBoard } from './board';
import { deckZAt } from './surface';
import { defaultChannelParams } from './channel-layout';
import { channelCutAt, loftSection, ringHalf, stationRing } from './loft';
import { cachedOutlineSegments, yInOut } from './outline-cutout';
import { hasTailCutout } from './outline-cutout';
import {
  notchSqueeze,
  plainTailOutline,
  stringerThicknessAt,
  swallowDeckApex,
  swallowDeckLine,
  swallowSize,
  swallowStation,
  swallowTailOutline,
  wallForDeckApex,
  wallOffset,
  type SwallowWall,
} from './swallow';
import { tessellateBoard, type BoardMesh } from './tessellate';
import { parseBrdGeometry } from './test-support/brd-geometry';

const here = dirname(fileURLToPath(import.meta.url));
const shortboard = parseBrdGeometry(
  readFileSync(resolve(here, '../../../docs/specs/golden/shortboard.brd'), 'utf8'),
);

const swallowed = (wall?: SwallowWall, width = 10, depth = 10): BezierBoard => {
  const b = shortboard;
  const outline = swallowTailOutline(b.outline, width, depth)!;
  return board(outline, b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins, undefined, wall); // prettier-ignore
};

/**
 * Edges used by other than two triangles, after welding points within 1/`perCm` cm (0
 * when closed). Channels need a fine weld: a step's wall is two points 2 µm apart.
 */
const openEdges = (mesh: BoardMesh, perCm = 1000): number => {
  const q = (v: number): number => Math.round(v * perCm);
  const ids = new Map<string, number>();
  const id = (i: number): number => {
    const k = `${q(mesh.positions[i * 3]!)},${q(mesh.positions[i * 3 + 1]!)},${q(mesh.positions[i * 3 + 2]!)}`;
    let c = ids.get(k);
    if (c === undefined) ids.set(k, (c = ids.size));
    return c;
  };
  const edges = new Map<string, number>();
  for (let t = 0; t < mesh.indices.length; t += 3) {
    const v = [id(mesh.indices[t]!), id(mesh.indices[t + 1]!), id(mesh.indices[t + 2]!)];
    for (let e = 0; e < 3; e++) {
      const a = v[e]!;
      const b = v[(e + 1) % 3]!;
      if (a === b) continue;
      const k = a < b ? `${a}_${b}` : `${b}_${a}`;
      edges.set(k, (edges.get(k) ?? 0) + 1);
    }
  }
  let open = 0;
  for (const n of edges.values()) if (n !== 2) open++;
  return open;
};

describe('swallow tail', () => {
  it('cuts the notch asked for into the outline, and fills it again', () => {
    const outline = swallowTailOutline(shortboard.outline, 10, 9)!;
    expect(hasTailCutout(outline)).toBe(true);
    const size = swallowSize(outline)!;
    expect(size.width).toBeCloseTo(10, 6);
    expect(size.depth).toBeCloseTo(9, 9);
    expect(outline.knots[1]!.end.x).toBe(0); // the tip at the tail
    expect(hasTailCutout(plainTailOutline(outline))).toBe(false);
    // Wider than the board: no notch.
    expect(swallowTailOutline(shortboard.outline, 200, 9)).toBeNull();
  });

  it('a beveled wall leans back t·tan(angle) at the deck, and the deck line runs past the notch', () => {
    const b = swallowed({ kind: 'bevel', angle: 30 });
    const x = 4;
    const s = swallowStation(b, x)!;
    expect(s.yD).toBeGreaterThan(s.yB);
    // The wall ends on the bottom's edge, and climbs outward the whole way.
    expect(s.wall.at(-1)!.y).toBeCloseTo(s.yB, 9);
    expect(s.wall.at(-1)!.u).toBe(0);
    const ys = [s.yD, ...s.wall.map((q) => q.y)];
    for (let i = 1; i < ys.length; i++) expect(ys[i]!).toBeLessThanOrEqual(ys[i - 1]! + 1e-9);
    const apex = swallowDeckApex(b)!;
    expect(apex).toBeGreaterThan(10);
    // Where the notch bottom is on the stringer, the deck line is t·tan(30°)/sin from it.
    expect(apex - 10).toBeLessThan(stringerThicknessAt(b, apex) * Math.tan(Math.PI / 6) * 3);
    // Between the notch bottom and the deck line's point, a V that closes on the stringer.
    const v = swallowStation(b, (10 + apex) / 2)!;
    expect(v.yB).toBe(0);
    expect(v.wall.at(-1)!.y).toBe(0);
    expect(v.wall.at(-1)!.u).toBeGreaterThan(0);
    expect(swallowStation(b, apex + 0.01)).toBeNull();
    const line = swallowDeckLine(b);
    expect(line.at(-1)!).toEqual({ x: apex, y: 0 });
  });

  it('a rounded wall stands upright, then rounds into the deck', () => {
    expect(wallOffset({ kind: 'round', size: 0.5 }, 0.4, 2)).toBe(0);
    expect(wallOffset({ kind: 'round', size: 0.5 }, 2, 2)).toBeCloseTo(1, 12);
    const b = swallowed({ kind: 'round', size: 0.8 });
    const s = swallowStation(b, 4)!;
    expect(s.yD).toBeGreaterThan(s.yB);
  });

  it('dragging the deck line point sets the angle or size that puts it there', () => {
    for (const wall of [
      { kind: 'bevel', angle: 40 },
      { kind: 'round', size: 0.6 },
    ] as const) {
      const b = swallowed(wall);
      const apex = swallowDeckApex(b)!;
      const back = wallForDeckApex(b, apex)!;
      expect(back.kind).toBe(wall.kind);
      if (back.kind === 'bevel') expect(back.angle).toBeCloseTo(40, 4);
      if (back.kind === 'round') expect(back.size).toBeCloseTo(0.6, 4);
      // Behind the notch bottom: upright.
      const flat = wallForDeckApex(b, 5)!;
      expect(flat.kind === 'bevel' ? flat.angle : flat.size).toBe(0);
    }
  });

  it('meshes closed, with the wall leaning in 3D, and weighs less than an upright wall', () => {
    const upright = swallowed({ kind: 'bevel', angle: 0 });
    for (const wall of [
      { kind: 'bevel', angle: 45 },
      { kind: 'bevel', angle: 0 },
      { kind: 'round', size: 0.8 },
    ] as const) {
      const b = swallowed(wall);
      const mesh = tessellateBoard(b, { lengthSteps: 80, ringSteps: 48 });
      for (const v of mesh.positions) expect(Number.isFinite(v)).toBe(true);
      expect(openEdges(mesh)).toBe(0);
      if (wall.kind === 'bevel' && wall.angle === 0) continue;
      expect(getVolume(b)).toBeLessThan(getVolume(upright));
      // Some deck point in the V forward of the notch bottom, off the stringer.
      let seen = false;
      const apex = swallowDeckApex(b)!;
      for (let i = 0; i < mesh.positions.length; i += 3) {
        const x = mesh.positions[i]!;
        if (x > 10.2 && x < apex - 0.2 && Math.abs(mesh.positions[i + 1]!) > 0.05) seen = true;
      }
      expect(seen).toBe(true);
    }
    expect(openEdges(tessellateBoard(upright, { lengthSteps: 80, ringSteps: 48 }))).toBe(0);
    // As fine as an STL export: the notch bottom pinched the halves together there once.
    expect(openEdges(tessellateBoard(swallowed({ kind: 'bevel', angle: 45 }), { targetFaceSize: 0.5 }), 1e5)).toBe(0); // prettier-ignore
  });

  it('a channel wall in the notch is one edge of the mesh, where it is cut (owner report)', () => {
    const plain = swallowed(undefined, 17.4, 11.3);
    const params = { ...defaultChannelParams(plain, 40), start: 0, follow: 0, fullFrom: 0 };
    const b = board(plain.outline, plain.bottom, plain.deck, plain.crossSections, plain.interpolationType, plain.fins, { from: 'numbers', params }, { kind: 'round', size: 0.8 }); // prettier-ignore
    const segments = cachedOutlineSegments(b.outline);
    const lateralAt = (x: number) => {
      const { yIn, yOut } = yInOut(segments, x);
      return (px: number) => yIn + (px * (yOut - yIn)) / yOut;
    };
    // The ring point where the cut ends (the outer wall at 10 cm) is the same at every
    // station across the notch: it hopped between points before.
    const edges = new Set<number>();
    for (let x = 4; x <= 9; x += 0.05) {
      const s = loftSection(b, x)!;
      const ring = stationRing(b, s, x, ringHalf(160), lateralAt);
      const m = lateralAt(x);
      const ps = ring.fs.map((f) => channelCutAt(b, ring, s, f, x, m));
      let edge = -1;
      for (let i = 0; i < ps.length - 1; i++) {
        const y = m(ps[i]!.x);
        if (y > 9 && y < 10.2 && ps[i]!.y - ps[i + 1]!.y > 0.05) edge = i; // off the cut floor
      }
      edges.add(edge);
    }
    expect(edges.size).toBeLessThanOrEqual(2);
  });

  it('round a tip curled across the board, the deck line runs on with no step (owner report)', () => {
    // The tip's handle pulled round so the notch runs straight across the board there.
    const b0 = swallowed({ kind: 'round', size: 0.66 }, 20, 11);
    const knots = b0.outline.knots.map((k, i) =>
      i === 1 ? { ...k, tangentToPrev: { x: -0.05, y: k.end.y - 2.5 } } : k,
    );
    const b = { ...b0, outline: splineFromKnots(knots) };
    let prev = swallowStation(b, 0.05)!.yD;
    let worst = 0;
    for (let x = 0.06; x < 6; x += 0.01) {
      const yD = swallowStation(b, x)!.yD;
      worst = Math.max(worst, Math.abs(yD - prev));
      prev = yD;
    }
    // A step of half a centimetre at one station before; now it moves as the notch does.
    expect(worst).toBeLessThan(0.03);
    expect(openEdges(tessellateBoard(b, { targetFaceSize: 0.5 }), 1e5)).toBe(0);
  });

  it('square-walled channels held on to a narrow nose, in a swallow, mesh closed (owner board)', () => {
    const plain = swallowed(undefined, 20, 11);
    const params = {
      ...defaultChannelParams(plain, 30),
      count: 2,
      inner: 0,
      width: 10,
      wall: { shape: 'step' as const, radius: 0.5, lip: 0 },
      follow: 0,
      start: 0,
      fullFrom: 0,
      end: 70,
    };
    for (const wall of [undefined, { kind: 'round', size: 0.66 }] as const) {
      const b = board(plain.outline, plain.bottom, plain.deck, plain.crossSections, plain.interpolationType, plain.fins, { from: 'numbers', params }, wall); // prettier-ignore
      expect(openEdges(tessellateBoard(b, { targetFaceSize: 0.3 }), 1e5)).toBe(0); // 0.1 µm, finer than a float STL
    }
  }, 60_000); // two fine meshes: slow when the whole suite runs at once

  it("volume counts the wall's foam as the mesh does", () => {
    const meshVolume = (m: BoardMesh): number => {
      let v = 0;
      const p = m.positions;
      for (let t = 0; t < m.indices.length; t += 3) {
        const [a, b, c] = [0, 1, 2].map((j) => m.indices[t + j]! * 3) as [number, number, number];
        v += p[a]! * (p[b + 1]! * p[c + 2]! - p[b + 2]! * p[c + 1]!);
        v -= p[a + 1]! * (p[b]! * p[c + 2]! - p[b + 2]! * p[c]!);
        v += p[a + 2]! * (p[b]! * p[c + 1]! - p[b + 1]! * p[c]!);
      }
      return Math.abs(v / 6);
    };
    // Volume blends the stations' control points straight from one to the next (legacy,
    // pinned); the mesh curves through them (`loft.ts`), which puts any board's mesh a
    // few tenths of a percent off its volume. What the swallow's own accounting adds must
    // match: the foam a wall takes, against an upright one on the same notch.
    const upright = swallowed({ kind: 'bevel', angle: 0 });
    const uprightMesh = meshVolume(tessellateBoard(upright, { targetFaceSize: 0.4 }));
    for (const wall of [
      { kind: 'bevel', angle: 45 },
      { kind: 'round', size: 0.8 },
    ] as const) {
      const b = swallowed(wall);
      const mesh = meshVolume(tessellateBoard(b, { targetFaceSize: 0.4 }));
      const byVolume = getVolume(upright) - getVolume(b);
      const byMesh = uprightMesh - mesh;
      expect(byMesh).toBeGreaterThan(1);
      expect(Math.abs(byVolume - byMesh) / mesh).toBeLessThan(1.5e-4);
    }
  });

  it('the notch squeezes only the foam near it, never folding (no crease across the deck)', () => {
    for (const yOut of [3, 10.8, 20]) {
      for (const edge of [0.01, 0.5, 2, 5, 9, yOut * 0.95]) {
        if (edge >= yOut) continue;
        const m = notchSqueeze(edge, yOut);
        expect(m(0)).toBeCloseTo(edge, 9);
        expect(m(yOut)).toBeCloseTo(yOut, 9);
        let prev = m(0);
        for (let px = 0.01; px <= yOut; px += 0.01) {
          const y = m(px);
          expect(y).toBeGreaterThan(prev);
          prev = y;
        }
      }
    }
    // Past its reach (4 cm while the notch is narrow), a section isn't moved: where the
    // notch closes onto the stringer the rail doesn't feel it.
    expect(notchSqueeze(0.3, 20)(6)).toBe(6);
    expect(notchSqueeze(0.3, 20)(1)).toBeGreaterThan(1);
  });

  it('short of room at a tip, the wall is a smaller wall of the same shape', () => {
    const b = swallowed({ kind: 'round', size: 0.8 }, 17.4, 11.3);
    const tight = swallowStation(b, 0.3)!;
    // Upright below its round: the lower points stand on the bottom's edge.
    const upright = tight.wall.filter((q) => Math.abs(q.y - tight.yB) < 1e-9);
    expect(upright.length).toBeGreaterThan(0);
    expect(tight.yD).toBeGreaterThan(tight.yB);
  });

  it("the deck in the notch is the board's own deck, not raised toward the tips (owner report)", () => {
    const b = swallowed({ kind: 'round', size: 0.66 }, 17.4, 11.3);
    const plain = board(plainTailOutline(b.outline), b.bottom, b.deck, b.crossSections, b.interpolationType, b.fins); // prettier-ignore
    const mesh = tessellateBoard(b, { targetFaceSize: 0.3 });
    const p = mesh.positions;
    let checked = 0;
    let worst = 0;
    for (let i = 0; i < p.length; i += 3) {
      const [x, y, z] = [p[i]!, p[i + 1]!, p[i + 2]!];
      if (x < 0.4 || x > 6 || y <= 0) continue;
      const st = swallowStation(b, x)!;
      const { yOut } = widthBoundsAt(b, x);
      // On the deck, off the wall and the rail.
      if (y < st.yD + 0.2 || y > yOut - 1 || z < deckZAt(plain, x, y) - 0.5) continue;
      worst = Math.max(worst, Math.abs(z - deckZAt(plain, x, y)));
      checked++;
    }
    expect(checked).toBeGreaterThan(50);
    // It rode the stringer's height out to the tips before: 2.5 to 7 mm high.
    expect(worst).toBeLessThan(0.05);
  });

  it("the mesh runs out to the board's ends, not cut square short of them (owner report)", () => {
    const b = swallowed({ kind: 'round', size: 0.66 });
    const p = tessellateBoard(b, { targetFaceSize: 0.5 }).positions;
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < p.length; i += 3) {
      lo = Math.min(lo, p[i]!);
      hi = Math.max(hi, p[i]!);
    }
    // Capped flat 1.6 mm in before: a round nose came out a flat face centimetres wide.
    expect(lo).toBeLessThan(1e-6);
    expect(hi).toBeGreaterThan(getLength(b) - 1e-4);
  });
});
