// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin from the front (owner request): the Thickness view's other half. Looking
 * along the panel, tab and blade as exported, true to scale, so cant shows as the
 * blade's lean from the upright tab. With a panel set (File settings) its two faces are
 * drawn dashed, leaning with its tilt: green when base and blade fit between them,
 * orange when not. Cant (the 3D view's, repeated here) and the tilt are what move them.
 *
 * Drawn from the 3D preview's mesh, each triangle seen from the front and all filled
 * as one shape, so the outline is exact wherever the blade turns or twists.
 */
import {
  FIN_EXPORT_MIN_THICKNESS,
  FIN_MESH_PREVIEW,
  finMesh,
  panelAcross,
  type BoardMesh,
  type FinDesign,
  type FinMesh,
} from '@openshaper/kernel';
import { FinCurveEditor, type FinCurveLayer } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { memo, useCallback, useMemo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { PANEL_FIT, PANEL_OVER } from './panel-tools';
import { frontPanelFaces, usePanelFit } from './use-panel-fit';
import { useSettledDesign } from './use-settled-design';

const BLADE = 'rgba(245,158,11,0.35)';
const TAB = 'rgba(138,155,179,0.35)';
const GUIDE = 'rgba(138,155,179,0.7)';
const NO_LAYERS: readonly FinCurveLayer[] = [];

/** The fin seen from the front: each part's triangles, flat (across, height) pairs (cm). */
export interface FrontView {
  readonly blade: Float64Array;
  readonly tab: Float64Array;
  /** The fin's extent (cm). */
  readonly bounds: { minX: number; maxX: number; minY: number; maxY: number };
}

/** Meshes by design, then export minimum: designs are immutable. */
const meshes = new WeakMap<FinDesign, Map<number, FinMesh>>();

const meshOf = (d: FinDesign, minThickness: number): FinMesh => {
  let byMin = meshes.get(d);
  if (!byMin) meshes.set(d, (byMin = new Map()));
  let mesh = byMin.get(minThickness);
  if (!mesh) byMin.set(minThickness, (mesh = finMesh(d, { ...FIN_MESH_PREVIEW, minThickness })));
  return mesh;
};

/**
 * `d` as exported at `minThickness`, seen from the front along a panel the fin is turned
 * `angle` degrees in: across the panel to the right (panelAcross; the outside face of a
 * left fin), height up. Each triangle is wound the same way round, so filling them all
 * as one nonzero path draws their union.
 */
export const frontView = (d: FinDesign, minThickness: number, angle = 0): FrontView => {
  const m = panelAcross(angle);
  const mesh = meshOf(d, minThickness);
  const bounds = { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity };
  const project = ({ positions: p, indices }: BoardMesh): Float64Array => {
    const out = new Float64Array(indices.length * 2);
    for (let i = 0; i < indices.length; i += 3) {
      const t: number[] = [];
      for (let k = 0; k < 3; k++) {
        const j = indices[i + k]! * 3;
        const u = p[j]! * m.x + p[j + 1]! * m.y;
        const z = p[j + 2]!;
        t.push(u, z);
        bounds.minX = Math.min(bounds.minX, u);
        bounds.maxX = Math.max(bounds.maxX, u);
        bounds.minY = Math.min(bounds.minY, z);
        bounds.maxY = Math.max(bounds.maxY, z);
      }
      const area = (t[2]! - t[0]!) * (t[5]! - t[1]!) - (t[3]! - t[1]!) * (t[4]! - t[0]!);
      // Counter-clockwise: swap the last two corners of a clockwise triangle.
      const order = area >= 0 ? [0, 1, 2] : [0, 2, 1];
      order.forEach((c, k) => {
        out[i * 2 + k * 2] = t[c * 2]!;
        out[i * 2 + k * 2 + 1] = t[c * 2 + 1]!;
      });
    }
    return out;
  };
  return { blade: project(mesh.blade), tab: project(mesh.tab), bounds };
};

export const FinFrontPane = memo(function FinFrontPane({
  store,
  frameKey = '',
  showPanel = true,
  minThickness = FIN_EXPORT_MIN_THICKNESS.default,
}: {
  store: StoreApi<FinState>;
  /** Change it to re-fit the view (the pane moving large or small). */
  frameKey?: string;
  /** Draw the panel's faces (File settings). */
  showPanel?: boolean;
  /** The exports' minimum thickness: the fin is drawn as exported. */
  minThickness?: number;
}) {
  // Meshed once per finished edit, as the 3D preview is.
  const design = useSettledDesign(store);
  const fit = usePanelFit(store, minThickness);
  const angle = fit?.pose.angle ?? 0;
  const view = useMemo(
    () => (design ? frontView(design, minThickness, angle) : null),
    [design, minThickness, angle],
  );
  const faces = useMemo(() => (showPanel && fit ? frontPanelFaces(fit) : null), [showPanel, fit]);

  const drawUnder = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _vp: unknown,
      toScreen: (p: { x: number; y: number }) => { x: number; y: number },
    ) => {
      if (!view) return;
      const fill = (tris: Float64Array, color: string) => {
        ctx.beginPath();
        for (let i = 0; i < tris.length; i += 6) {
          const a = toScreen({ x: tris[i]!, y: tris[i + 1]! });
          const b = toScreen({ x: tris[i + 2]!, y: tris[i + 3]! });
          const c = toScreen({ x: tris[i + 4]!, y: tris[i + 5]! });
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.lineTo(c.x, c.y);
          ctx.closePath();
        }
        ctx.fillStyle = color;
        ctx.fill('nonzero');
      };
      const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const sa = toScreen(a);
        const sb = toScreen(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      };
      ctx.save();
      fill(view.tab, TAB);
      fill(view.blade, BLADE);
      const { minX, maxX } = view.bounds;
      const span = maxX - minX;
      ctx.strokeStyle = GUIDE;
      ctx.fillStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      line({ x: minX - span, y: 0 }, { x: maxX + span, y: 0 }); // the tab top: the blade's root
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      ctx.textAlign = 'left';
      const root = toScreen({ x: maxX + span * 0.15, y: 0 });
      ctx.fillText('Tab top', root.x, root.y - 4);
      if (faces) {
        ctx.strokeStyle = fit?.fits ? PANEL_FIT : PANEL_OVER;
        ctx.lineWidth = 1.5;
        ctx.setLineDash([7, 5]);
        for (const [a, b] of faces) line(a, b);
      }
      ctx.restore();
    },
    [view, faces, fit],
  );

  if (!design || !view) return null;
  const { minX, maxX, minY, maxY } = view.bounds;
  // Room either side for the faces and a lean, and for the label.
  const pad = Math.max(maxX - minX, (maxY - minY) * 0.15);
  return (
    <FinCurveEditor
      label="Front view"
      layers={NO_LAYERS}
      selection={null}
      frameBounds={{ minX: minX - pad, maxX: maxX + pad, minY: minY - pad * 0.3, maxY }}
      frameKey={`${design.position}-${frameKey}`}
      drawUnder={drawUnder}
    />
  );
});
