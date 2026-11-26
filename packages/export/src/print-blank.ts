// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The board as a blank to print (print version, owner request 2026-11): the closed hull,
 * channels cut, with a cavity for each fin's box or plug cut into the bottom
 * (`finCavities`), and no fins.
 *
 * The cavities are cut with a solid modeller, Manifold (manifold-3d, Apache-2.0), which
 * runs as WebAssembly. It is a separate entry point (`@openshaper/export/print-blank`)
 * so the editor loads it only when a blank is exported.
 *
 * The hull is the kernel's welded mesh (`tessellateBoard`), which is closed; each
 * cavity step is its outline extruded along the cavity's axis from a little outside
 * the bottom to its depth, and the cavities are subtracted from the hull together.
 * Units are the STL writer's: centimetres.
 */
import Module, { type Manifold, type ManifoldToplevel } from 'manifold-3d';
import {
  DEFAULT_CAVITY_SETTINGS,
  cavityProblems,
  finCavities,
  tessellateBoard,
  tessellationSteps,
  type BezierBoard,
  type CavitySettings,
  type FinCavity,
} from '@openshaper/kernel';
import { BOARD_BRAND } from './brand';
import { encodeBinaryStl } from './stl';

let loading: Promise<ManifoldToplevel> | null = null;

/**
 * Load the solid modeller once. `wasmUrl` says where its `manifold.wasm` is served (a
 * bundler's asset URL); without it the module finds the file next to itself (Node).
 */
export const loadManifold = (wasmUrl?: string): Promise<ManifoldToplevel> => {
  loading ??= Module(wasmUrl ? { locateFile: () => wasmUrl } : undefined).then((m) => {
    m.setup();
    return m;
  });
  return loading;
};

export interface PrintBlankOptions {
  /** Target face size (cm) of the hull mesh; the STL default. */
  targetFaceSize?: number;
  cavities?: CavitySettings;
  /** `solid` name written into the STL. */
  name?: string;
  /** Where `manifold.wasm` is served, in a browser. */
  wasmUrl?: string;
}

export interface PrintBlank {
  readonly stl: Uint8Array;
  /** The cavities cut, as described by the kernel. */
  readonly cavities: readonly FinCavity[];
  /** What a person should check before printing, said for them. Empty if nothing. */
  readonly warnings: readonly string[];
}

/** How far each cavity's solid starts outside the bottom (cm), so it cuts cleanly through it. */
const OUTSIDE = 2;
/** The face size the STL writer uses (cm). */
const DEFAULT_FACE_SIZE = 0.5;

/** A column-major 4×4 placing a cavity's local frame (x along, y across, z into the board). */
const frameOf = (
  c: FinCavity,
): [
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
  number,
] => {
  // prettier-ignore
  const z = c.axis;
  // Along the fin base, made square to the axis.
  const d = c.along.x * z.x + c.along.y * z.y;
  let x = { x: c.along.x - d * z.x, y: c.along.y - d * z.y, z: -d * z.z };
  const lx = Math.hypot(x.x, x.y, x.z) || 1;
  x = { x: x.x / lx, y: x.y / lx, z: x.z / lx };
  const y = { x: z.y * x.z - z.z * x.y, y: z.z * x.x - z.x * x.z, z: z.x * x.y - z.y * x.x };
  const o = c.origin;
  return [x.x, x.y, x.z, 0, y.x, y.y, y.z, 0, z.x, z.y, z.z, 0, o.x, o.y, o.z, 1];
};

/** Cavity `c` as a solid, in board space. */
const cavitySolid = (m: ManifoldToplevel, c: FinCavity): Manifold => {
  const parts = c.steps.map((s) => {
    let section = new m.CrossSection([s.outline.map((p) => [p.x, p.y] as [number, number])], 'Positive'); // prettier-ignore
    if (s.grow > 0) {
      const grown = section.offset(s.grow, 'Round');
      section.delete();
      section = grown;
    }
    const solid = section.extrude(s.depth + OUTSIDE).translate([0, 0, -OUTSIDE]);
    section.delete();
    return solid;
  });
  const local = parts.length === 1 ? parts[0]! : m.Manifold.union(parts);
  const placed = local.transform(frameOf(c));
  if (parts.length > 1) for (const p of parts) p.delete();
  local.delete();
  return placed;
};

/** The board as a closed solid, from the kernel's mesh. */
const hullSolid = (m: ManifoldToplevel, board: BezierBoard, faceSize: number): Manifold => {
  const steps = tessellationSteps(board, faceSize);
  const mesh = tessellateBoard(board, steps);
  const shape = new m.Mesh({
    numProp: 3,
    vertProperties: new Float32Array(mesh.positions),
    triVerts: new Uint32Array(mesh.indices),
  });
  // Points the loft repeats at one place (a seam, a cap's ring) become one vertex.
  shape.merge();
  return new m.Manifold(shape);
};

/** STL facets (normal, then three corners) for a solid's mesh. */
const facetsOf = (solid: Manifold): number[] => {
  const mesh = solid.getMesh();
  const v = mesh.vertProperties;
  const np = mesh.numProp;
  const t = mesh.triVerts;
  const out: number[] = [];
  for (let i = 0; i < t.length; i += 3) {
    const [a, b, c] = [t[i]! * np, t[i + 1]! * np, t[i + 2]! * np];
    const ux = v[b]! - v[a]!;
    const uy = v[b + 1]! - v[a + 1]!;
    const uz = v[b + 2]! - v[a + 2]!;
    const wx = v[c]! - v[a]!;
    const wy = v[c + 1]! - v[a + 1]!;
    const wz = v[c + 2]! - v[a + 2]!;
    const nx = uy * wz - uz * wy;
    const ny = uz * wx - ux * wz;
    const nz = ux * wy - uy * wx;
    const l = Math.hypot(nx, ny, nz) || 1;
    out.push(nx / l, ny / l, nz / l);
    for (const k of [a, b, c]) out.push(v[k]!, v[k + 1]!, v[k + 2]!);
  }
  return out;
};

/** The board as a blank to print: binary STL, with its fin cavities cut. */
export const exportPrintBlank = async (
  board: BezierBoard,
  opts: PrintBlankOptions = {},
): Promise<PrintBlank> => {
  const m = await loadManifold(opts.wasmUrl);
  const settings = opts.cavities ?? DEFAULT_CAVITY_SETTINGS;
  const cavities = finCavities(board, settings);
  const warnings = cavityProblems(board, cavities);
  const hull = hullSolid(m, board, opts.targetFaceSize ?? DEFAULT_FACE_SIZE);
  if (hull.status() !== 'NoError') {
    const status = hull.status();
    hull.delete();
    throw new Error(
      `The board's mesh is not a closed solid (${status}), so cavities can't be cut.`,
    );
  }
  let blank = hull;
  if (cavities.length) {
    const solids = cavities.map((c) => cavitySolid(m, c));
    const all = m.Manifold.union(solids);
    blank = hull.subtract(all);
    for (const s of solids) s.delete();
    all.delete();
    hull.delete();
  }
  const facets = facetsOf(blank);
  blank.delete();
  return {
    stl: encodeBinaryStl(facets, opts.name ?? 'openshaper-blank', BOARD_BRAND.product),
    cavities,
    warnings,
  };
};
