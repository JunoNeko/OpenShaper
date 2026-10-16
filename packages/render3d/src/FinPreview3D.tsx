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
import { DoubleSide } from 'three';
import { FIN_PREVIEW_FOV, finCameraPosition, finScene, type FinScene } from './fin-preview';

export interface FinPreview3DProps {
  design: FinDesign | null;
  /** Change it to re-frame the camera (a new fin). */
  frameKey?: string | number;
  background?: string;
  bladeColor?: string;
  tabColor?: string;
}

/** Puts the camera on the fin whenever `frameKey` changes. */
function Framer({
  scene,
  frameKey,
  outward,
}: {
  scene: FinScene;
  frameKey: unknown;
  outward: 1 | -1;
}) {
  const { camera, controls, size, invalidate } = useThree();
  const framed = useRef<unknown>(Symbol('never'));
  useEffect(() => {
    // Wait for the orbit controls: they mount after this on the first frame, and would
    // otherwise start aimed at the origin and override the camera set here.
    const orbit = controls as ComponentRef<typeof OrbitControls> | null;
    if (!orbit || framed.current === frameKey || size.width === 0) return;
    framed.current = frameKey;
    const [x, y, z] = finCameraPosition(
      scene.center,
      scene.radius,
      outward,
      size.width / size.height,
    );
    camera.up.set(0, 0, 1);
    camera.position.set(x, y, z);
    orbit.target.set(...scene.center);
    orbit.update();
    invalidate();
  }, [frameKey, scene, outward, camera, controls, size.width, size.height, invalidate]);
  return null;
}

export function FinPreview3D({
  design,
  frameKey,
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
          <Framer scene={scene} frameKey={frameKey} outward={outward} />
        </>
      )}
      <OrbitControls makeDefault enableDamping={false} />
    </Canvas>
  );
}
