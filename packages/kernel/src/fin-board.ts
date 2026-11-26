// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A board's fins as meshes, in board space (fin integration, phase 1).
 *
 * A fin with a design is OpenFinShaper's own blade (`fin-mesh.ts`), the shape the fin
 * designer shows and exports, placed where the board puts it:
 *
 * - The fin's frame is the designer's: the fin standing on its tab, as on a board turned
 *   deck-down (x toward the nose, z up from the tab top, y across). Turned over onto the
 *   board, x stays along the fin's base, z hangs down from the bottom, and the blade's
 *   outward side faces away from the stringer.
 * - The tab's middle across sits on the fin's position, and the fin dot on its distance
 *   from the tail; the base lies on the bottom's tangent at its middle (`bottomZAt`), so
 *   the fin stands square to the bottom, as its box is set.
 * - Toe turns it in plan, as the 2D views draw it; an FCS plug's cant leans the whole
 *   fin outward about its root, on top of the blade's own.
 *
 * The blade only: its tab sits inside the board, in its box. Fins without a design keep
 * their generic blades (`buildFinBladeMesh`).
 */
import type { BezierBoard } from './board';
import { DEG_TO_RAD } from './constants';
import { finOutward, type FinDesign } from './fin-design/fin-design';
import { finMesh, FIN_MESH_PREVIEW } from './fin-design/fin-mesh';
import { tabCentreY } from './fin-design/fin-placement';
import { buildFinBladeMesh, finDotX, meshWithNormals, type ResolvedFin } from './fins';
import { finCavities, planOutline } from './fin-cavities';
import { triangulatePolygon } from './polygon';
import { bottomZAt } from './surface';
import type { BoardMesh } from './tessellate';
import type { Vec2 } from './vec2';

/** Designs are immutable: each one's blade is meshed once. */
const BLADES = new WeakMap<FinDesign, BoardMesh>();

const bladeOf = (d: FinDesign): BoardMesh => {
  let m = BLADES.get(d);
  if (!m) {
    m = finMesh(d, FIN_MESH_PREVIEW).blade;
    BLADES.set(d, m);
  }
  return m;
};

/** Fin `fin` of board `b`, meshed in board space. */
export const boardFinMesh = (b: BezierBoard, fin: ResolvedFin): BoardMesh => {
  const d = fin.design;
  if (!d) return buildFinBladeMesh(fin);
  const blade = bladeOf(d);
  // Along from its fin dot, which sits on the base line's back end.
  const te = finDotX(d);
  const yc = tabCentreY(d);
  const out = finOutward(d.hand);
  // Board directions: along the (toed) base, and outward from the stringer.
  const fx = fin.baseLine.fore.x - fin.baseLine.aft.x;
  const fy = fin.baseLine.fore.y - fin.baseLine.aft.y;
  const len = Math.hypot(fx, fy) || 1;
  const ax = fx / len;
  const ay = fy / len;
  // A centre fin turns over as a left fin does (its outside face is the left's), so the
  // turn is a rotation and its triangles keep facing out; a fin's hand matches its side
  // (`makeLibraryFin`, `setFinDesign`).
  const side = fin.side === 0 ? -1 : fin.side;
  // Outward of the stringer, square to the base in plan.
  const ox = -ay * side;
  const oy = ax * side;
  const plug = fin.plugCant * DEG_TO_RAD;
  const cos = Math.cos(plug);
  const sin = Math.sin(plug);
  const root = fin.baseLine.aft;
  const z0 = bottomZAt(b, fin.center.x, Math.abs(fin.center.y));
  const surface = Number.isFinite(z0) ? z0 : fin.surfaceZ;
  // Square to the bottom where the fin stands: its base on the bottom's tangent at the
  // base's middle, read along the board at the fin's own place across it.
  const half = fin.spec.base / 2;
  const dx = Math.min(0.5, half / 2) || 0.5;
  const zAt = (x: number) => bottomZAt(b, x, Math.abs(fin.center.y));
  const slope = (zAt(fin.center.x + dx) - zAt(fin.center.x - dx)) / (2 * dx);
  const pitch = Number.isFinite(slope) ? Math.atan(slope) : fin.pitch;
  const pc = Math.cos(pitch);
  const ps = Math.sin(pitch);
  const src = blade.positions;
  const positions: number[] = [];
  for (let i = 0; i < src.length; i += 3) {
    const u = src[i]! - te;
    const across = (src[i + 1]! - yc) * out; // outward of the stringer
    const down = src[i + 2]!;
    const a = across * cos + down * sin;
    const h = down * cos - across * sin;
    // About the base's middle: along the bottom's tangent, and down its normal.
    const sAlong = u - half;
    const along = half + sAlong * pc + h * ps;
    const z = surface + sAlong * ps - h * pc;
    positions.push(root.x + ax * along + ox * a, root.y + ay * along + oy * a, z);
  }
  // Turned over, (x, y, z) → (x, −y, −z): a rotation, so each triangle still faces out.
  return meshWithNormals(positions, Array.from(blade.indices));
};

/** How far below the bottom (cm) a box's patch is drawn, so it shows over the hull. */
const BOX_PATCH_GAP = 0.04;

/**
 * Each fin's box or plug as the bottom shows it (fin integration): its widest outline (a
 * Futures flange, an FCS II plug) as a thin patch on the bottom, for the 3D view's
 * Boxes toggle: how close a flange comes to the rail is plain to see. Only the systems
 * whose boxes are known (`finCavities`).
 */
export const finBoxPatches = (b: BezierBoard): BoardMesh[] =>
  finBoxOutlines(b).map((plan) => boxPatch(b, plan));

/**
 * Each fin's box or plug in plan (its widest outline: a Futures flange, an FCS II plug),
 * for the outline view and the 3D view. Only the systems whose boxes are known.
 */
export const finBoxOutlines = (b: BezierBoard): Vec2[][] =>
  finCavities(b).map(
    (c) =>
    planOutline(c, c.steps.reduce((m, s) => (polygonArea(s.outline) > polygonArea(m.outline) ? s : m))), // prettier-ignore
  );

/** A box's outline laid on the bottom, a hair below it. */
const boxPatch = (b: BezierBoard, plan: readonly Vec2[]): BoardMesh => {
  const positions: number[] = [];
  for (const p of plan) {
    const z = bottomZAt(b, p.x, Math.abs(p.y));
    positions.push(p.x, p.y, (Number.isFinite(z) ? z : 0) - BOX_PATCH_GAP);
  }
  const indices: number[] = [];
  // Facing down, out of the bottom.
  for (const [i, j, k] of triangulatePolygon(plan)) indices.push(i, k, j);
  return meshWithNormals(positions, indices);
};

const polygonArea = (pts: readonly { x: number; y: number }[]): number => {
  let a = 0;
  for (let i = 0; i < pts.length; i++) {
    const p = pts[i]!;
    const q = pts[(i + 1) % pts.length]!;
    a += p.x * q.y - q.x * p.y;
  }
  return Math.abs(a / 2);
};
