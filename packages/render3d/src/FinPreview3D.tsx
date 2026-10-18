// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A 3D preview of a fin design: the foiled blade and its Futures tab, orbitable
 * (docs/design/fin-designer.md, step 13). Presentational: the app passes the design to
 * show, and passes the *settled* one (not every move of a drag), so the mesh is
 * rebuilt per edit rather than per pointer move.
 *
 * Renders on demand (`frameloop="demand"`). The camera frames the fin on first show and
 * whenever `frameKey` changes (a new fin), never on an edit, so a view the user has
 * orbited to stays put while they work, like the 2D panes.
 */
import { finOutward, type FinDesign } from '@openshaper/kernel';
import { OrbitControls } from '@react-three/drei';
import { Canvas, useThree } from '@react-three/fiber';
import { useEffect, useMemo, useRef, type ComponentRef } from 'react';
import { BufferGeometry, DoubleSide, Vector3 } from 'three';
import {
  FIN_PREVIEW_FOV,
  finCameraPosition,
  finScene,
  type FinPreviewView,
  type FinScene,
} from './fin-preview';

export interface FinPreview3DProps {
  design: FinDesign | null;
  /** Change it to re-frame the camera (a new fin). */
  frameKey?: string | number;
  /** Beside the fin (default) or from above; changing it re-frames the camera. */
  view?: FinPreviewView;
  background?: string;
  bladeColor?: string;
  tabColor?: string;
}

/** Puts the camera on the fin whenever `frameKey` changes. */
function Framer({
  scene,
  frameKey,
  outward,
  view,
}: {
  scene: FinScene;
  frameKey: unknown;
  outward: 1 | -1;
  view: FinPreviewView;
}) {
  const { camera, controls, size, invalidate } = useThree();
  const framed = useRef<unknown>(Symbol('never'));
  useEffect(() => {
    // Wait for the orbit controls: they mount after this on the first frame, and would
    // otherwise start aimed at the origin and override the camera set here.
    const orbit = controls as ComponentRef<typeof OrbitControls> | null;
    const key = `${String(frameKey)}|${view}`;
    if (!orbit || framed.current === key || size.width === 0) return;
    framed.current = key;
    const [x, y, z] = finCameraPosition(
      scene.center,
      scene.radius,
      outward,
      size.width / size.height,
      view,
    );
    // From above, the nose is up the screen; beside the fin, the blade's height is.
    if (view === 'above') camera.up.set(1, 0, 0);
    else camera.up.set(0, 0, 1);
    camera.position.set(x, y, z);
    orbit.target.set(...scene.center);
    orbit.update();
    invalidate();
  }, [frameKey, view, scene, outward, camera, controls, size.width, size.height, invalidate]);
  return null;
}

/** A faint line along the tab's centre: the box's direction. */
function TabAxis({
  from,
  to,
}: {
  from: readonly [number, number, number];
  to: readonly [number, number, number];
}) {
  const geometry = useMemo(
    () => new BufferGeometry().setFromPoints([new Vector3(...from), new Vector3(...to)]),
    [from, to],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);
  return (
    <lineSegments geometry={geometry}>
      <lineBasicMaterial color="#F97316" transparent opacity={0.7} />
    </lineSegments>
  );
}

export function FinPreview3D({
  design,
  frameKey,
  view = 'side',
  background = '#0A1424',
  bladeColor = '#22D3EE',
  tabColor = '#8A9BB3',
}: FinPreview3DProps) {
  const scene = useMemo(() => (design ? finScene(design) : null), [design]);
  useEffect(
    () => () => {
      scene?.blade.dispose();
      scene?.tab.dispose();
    },
    [scene],
  );
  const outward = finOutward(design?.hand ?? null);

  return (
    <Canvas
      frameloop="demand"
      dpr={[1, 2]}
      camera={{ fov: FIN_PREVIEW_FOV, near: 0.1, far: 2000, up: [0, 0, 1], position: [0, 40, 20] }}
      aria-label="Fin 3D preview"
    >
      <color attach="background" args={[background]} />
      <ambientLight intensity={0.45} />
      {/* Key lights on both sides, so a right fin's outside face (−Y) shades like a left one's. */}
      <directionalLight position={[60, 80, 120]} intensity={1} />
      <directionalLight position={[60, -80, 120]} intensity={1} />
      <directionalLight position={[-80, 0, -40]} intensity={0.35} />
      {scene && (
        <>
          <mesh geometry={scene.blade}>
            <meshStandardMaterial color={bladeColor} roughness={0.35} side={DoubleSide} />
          </mesh>
          <mesh geometry={scene.tab}>
            <meshStandardMaterial color={tabColor} roughness={0.6} />
          </mesh>
          <TabAxis from={scene.tabAxis[0]} to={scene.tabAxis[1]} />
          <Framer scene={scene} frameKey={frameKey} outward={outward} view={view} />
        </>
      )}
      <OrbitControls makeDefault enableDamping={false} />
    </Canvas>
  );
}
