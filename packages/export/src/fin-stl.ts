// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * STL export of a designed fin, for 3D printing (docs/design/fin-designer.md,
 * step 16). Binary, in **millimetres** by default: STL has no unit field and slicers
 * assume mm. (The board STL writes cm; see P47 in PROPOSALS.md.)
 *
 * Two closed shells, blade and tab, touching on the tab top, from the kernel's fine
 * fin mesh (`finMesh`, FIN_MESH_FINE): rings about half a millimetre apart, tab arcs
 * within 0.005 mm. A slicer merges the shells, as CAD does with the STEP's two solids.
 */
import { FIN_MESH_FINE, finMesh, type FinDesign } from '@openshaper/kernel';
import { SHEET_UNIT, type SheetUnit } from './construction/units';
import { encodeBinaryStl, writeMesh } from './stl';

export interface FinStlOptions {
  /** Unit of the coordinates written. Default 'mm', what slicers assume. */
  unit?: SheetUnit;
  /** Name written into the header. Default 'fin'. */
  name?: string;
}

export const exportFinStl = (d: FinDesign, opts: FinStlOptions = {}): Uint8Array => {
  const scale = SHEET_UNIT[opts.unit ?? 'mm'].factor;
  const mesh = finMesh(d, FIN_MESH_FINE);
  const facets: number[] = [];
  writeMesh(facets, mesh.blade, scale);
  writeMesh(facets, mesh.tab, scale);
  return encodeBinaryStl(facets, opts.name ?? 'fin');
};
