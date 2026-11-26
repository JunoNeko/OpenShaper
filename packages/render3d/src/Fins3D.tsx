import {
  boardFinMesh,
  finBoxPatches,
  resolveFins,
  type BezierBoard,
  type BoardMesh,
} from '@openshaper/kernel';
import { useEffect, useMemo } from 'react';
import { BufferAttribute, BufferGeometry, DoubleSide } from 'three';
import { useBoardOffset } from './use-board-offset';

/** On-brand cyan-blue resin (the OpenShaper accent) so the blades read against the hull. */
const FIN_COLOR = '#22D3EE';
/** Fin boxes and plugs are black plastic. */
const BOX_COLOR = '#16181D';

/** Kernel mesh → BufferGeometry WITHOUT centering (fins are placed in board coords). */
const rawGeometry = (mesh: BoardMesh): BufferGeometry => {
  const g = new BufferGeometry();
  g.setAttribute('position', new BufferAttribute(new Float32Array(mesh.positions), 3));
  g.setAttribute('normal', new BufferAttribute(new Float32Array(mesh.normals), 3));
  g.setIndex(new BufferAttribute(new Uint32Array(mesh.indices), 1));
  g.computeBoundingBox();
  return g;
};

/**
 * Foiled fin blades for the board, positioned on the bottom surface. The board mesh is
 * centered by `geometry.center()`, so the fins (built in board coords) are wrapped in a
 * group translated by the same offset (the board mesh's bbox center, reused from the
 * tessellation cache) to stay aligned with the hull.
 */
export function Fins3D({
  board,
  targetFaceSize,
  color = FIN_COLOR,
  showBoxes = true,
}: {
  board: BezierBoard;
  targetFaceSize: number;
  color?: string;
  /** Draw each fin's box or plug on the bottom (where its system's boxes are known). */
  showBoxes?: boolean;
}) {
  // Built from the board the hull was meshed from, not the live one: the hull waits
  // for the worker, and fins built synchronously used to run ahead of it mid-drag.
  const placed = useBoardOffset(board, targetFaceSize);
  const placedBoard = placed?.board ?? null;

  // A fin with a design is OpenFinShaper's own blade (`boardFinMesh`); older ones, generic.
  const geometries = useMemo(
    () =>
      placedBoard
        ? resolveFins(placedBoard).map((fin) => rawGeometry(boardFinMesh(placedBoard, fin)))
        : [],
    [placedBoard],
  );
  useEffect(() => () => geometries.forEach((g) => g.dispose()), [geometries]);
  const boxes = useMemo(
    () => (placedBoard && showBoxes ? finBoxPatches(placedBoard).map(rawGeometry) : []),
    [placedBoard, showBoxes],
  );
  useEffect(() => () => boxes.forEach((g) => g.dispose()), [boxes]);

  if (!placed || geometries.length === 0) return null;
  return (
    <group position={placed.offset}>
      {geometries.map((g, i) => (
        <mesh key={i} geometry={g} castShadow>
          <meshStandardMaterial color={color} roughness={0.35} metalness={0.0} side={DoubleSide} />
        </mesh>
      ))}
      {boxes.map((g, i) => (
        <mesh key={`box-${i}`} geometry={g}>
          <meshStandardMaterial color={BOX_COLOR} roughness={0.6} side={DoubleSide} />
        </mesh>
      ))}
    </group>
  );
}
