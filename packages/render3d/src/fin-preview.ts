// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The pure half of `FinPreview3D` (docs/design/fin-designer.md, step 13): the fin's
 * meshes as three.js geometry, and where the camera looks from. Kept apart from the
 * component so it can be tested without WebGL.
 *
 * Frame: the kernel's fin frame (blade.ts), cm. X along the tab toward the nose, Y
 * across (a right fin's outside face toward +Y), Z up the blade from the tab top. The
 * scene keeps it, with the camera's up set to +Z, so nothing is rotated or re-centred:
 * the blade and tab stay where the kernel and the STEP/STL files put them.
 */
import { FIN_MESH_PREVIEW, finMesh, type BoardMesh, type FinDesign } from '@openshaper/kernel';
import { Box3, BufferAttribute, BufferGeometry, Vector3 } from 'three';

/** Kernel mesh → BufferGeometry, in place (no centring). */
export const finMeshGeometry = (mesh: BoardMesh): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
  g.computeBoundingBox();
  g.computeBoundingSphere();
  return g;
};

export interface FinScene {
  readonly blade: BufferGeometry;
  readonly tab: BufferGeometry;
  /** Centre and radius of everything, for framing (cm). */
  readonly center: [number, number, number];
  readonly radius: number;
}

/** The fin's preview meshes (preview quality: a few ms, rebuilt per settled edit). */
export const finScene = (d: FinDesign): FinScene => {
  const m = finMesh(d, FIN_MESH_PREVIEW);
  const blade = finMeshGeometry(m.blade);
  const tab = finMeshGeometry(m.tab);
  const box = new Box3().copy(blade.boundingBox!).union(tab.boundingBox!);
  const c = box.getCenter(new Vector3());
  return {
    blade,
    tab,
    center: [c.x, c.y, c.z],
    radius: box.getSize(new Vector3()).length() / 2,
  };
};

/** Vertical field of view of the preview camera (deg). */
export const FIN_PREVIEW_FOV = 35;

/**
 * Where the camera sits to frame the whole fin: looking at the outside face (so a left
 * fin is seen from −Y), a little from behind and above, far enough back that a sphere
 * of `radius` fills the view with some margin.
 */
export const finCameraPosition = (
  center: readonly [number, number, number],
  radius: number,
  outward: 1 | -1,
  aspect = 1,
): [number, number, number] => {
  const dir = new Vector3(-0.35, outward, 0.4).normalize();
  const half = ((FIN_PREVIEW_FOV / 2) * Math.PI) / 180;
  // Fit the narrower of the vertical and horizontal fields.
  const fit = Math.min(half, Math.atan(Math.tan(half) * aspect));
  const dist = (radius / Math.sin(fit)) * 1.1;
  return [center[0] + dir.x * dist, center[1] + dir.y * dist, center[2] + dir.z * dist];
};
