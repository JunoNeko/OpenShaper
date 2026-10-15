// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A canvas for editing a fin's curves: the outline, the foil section, the taper
 * (docs/design/fin-designer.md, step 10). Presentational: it draws the `layers` it is
 * given and reports picks and drags in data coordinates; the app turns those into fin
 * store edits, which clamp them to the fin's rules and hand back new layers.
 *
 * Deliberately not `SplineEditor`, which is bound to the board store; see "Own curve
 * editor" in the design doc. It borrows that editor's lessons:
 * - a drag moves a handle by the pointer's travel, never to the pointer, so a grab
 *   off-centre (normal with a finger) doesn't jump the curve;
 * - touch gets a wider hit radius;
 * - the view is fitted once (and again when `frameKey` changes), never while
 *   editing, so the curve doesn't slide out from under a drag.
 *
 * Mouse and touch: drag a point or handle to move it; drag empty space to pan; wheel
 * to zoom about the cursor; double-click (double-tap) a curve to add a point there.
 */
import type { Vec2 } from '@openshaper/kernel';
import {
  useCallback,
  useEffect,
  useRef,
  useState,
  type MouseEvent,
  type PointerEvent,
} from 'react';
import { clear, drawGrid } from './draw';
import {
  HIT_TOL_PX,
  TOUCH_HIT_TOL_PX,
  dragTo,
  drawFinCurves,
  fromView,
  layersBounds,
  pickCurve,
  pickHandle,
  splineToView,
  toView,
  type FinCurveLayer,
  type FinCurvePick,
} from './fin-curve-view';
import { handlePoint } from './hit';
import {
  fitToBounds,
  pan,
  screenToWorld,
  zoomAt,
  type Bounds,
  type ScreenPoint,
  type Viewport,
} from './viewport';

export interface FinCurveEditorProps {
  layers: readonly FinCurveLayer[];
  selection: FinCurvePick | null;
  /** Vertical stretch of the view (data y × yScale); 1 draws true to scale. */
  yScale?: number;
  /** Extra bounds (data space) to keep in view, e.g. the tab under the outline. */
  frameBounds?: Bounds;
  /** Change it to re-fit the view (a new fin, a switched pane). */
  frameKey?: string | number;
  /** Draw under the curves: the tab, the base line, the clearance line. */
  drawUnder?: (
    ctx: CanvasRenderingContext2D,
    vp: Viewport,
    toScreen: (p: Vec2) => ScreenPoint,
  ) => void;
  onSelect?: (pick: FinCurvePick | null) => void;
  onDragStart?: (pick: FinCurvePick) => void;
  /** The dragged handle's new position, in data space. */
  onDrag?: (pick: FinCurvePick, to: Vec2) => void;
  onDragEnd?: () => void;
  /** Double-click on a curve: add a point there (data space). */
  onAddPoint?: (layer: string, at: Vec2) => void;
  /** Reports the view whenever it changes (tests, overlays). */
  onViewport?: (vp: Viewport) => void;
  /** Accessible name for the canvas. */
  label: string;
  background?: string;
}

type Drag =
  | { kind: 'handle'; pick: FinCurvePick; grabbed: Vec2; pointerAt: Vec2; id: number }
  | { kind: 'pan'; last: ScreenPoint; id: number };

export function FinCurveEditor({
  layers,
  selection,
  yScale = 1,
  frameBounds,
  frameKey,
  drawUnder,
  onSelect,
  onDragStart,
  onDrag,
  onDragEnd,
  onAddPoint,
  onViewport,
  label,
  background,
}: FinCurveEditorProps) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [vp, setVp] = useState<Viewport | null>(null);
  const [hovered, setHovered] = useState<FinCurvePick | null>(null);
  const drag = useRef<Drag | null>(null);
  const framedFor = useRef<string | number | undefined | null>(null);

  // Track the pane's size.
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Fit the view on first size, and whenever frameKey changes; never mid-edit.
  useEffect(() => {
    if (size.w === 0 || size.h === 0 || drag.current) return;
    if (vp && framedFor.current === frameKey) return;
    const extra = frameBounds && {
      minX: frameBounds.minX,
      maxX: frameBounds.maxX,
      minY: frameBounds.minY * yScale,
      maxY: frameBounds.maxY * yScale,
    };
    const b = layersBounds(layers, yScale, extra);
    if (!b) return;
    framedFor.current = frameKey;
    setVp(fitToBounds(b, size.w, size.h, 32));
  }, [size.w, size.h, frameKey, layers, frameBounds, yScale, vp]);

  useEffect(() => {
    if (vp) onViewport?.(vp);
  }, [vp, onViewport]);

  // Draw.
  useEffect(() => {
    const c = canvas.current;
    const ctx = c?.getContext('2d');
    if (!c || !ctx || !vp) return;
    const dpr = globalThis.devicePixelRatio ?? 1;
    c.width = Math.round(size.w * dpr);
    c.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    clear(ctx, size.w, size.h, background);
    drawGrid(ctx, vp, size.w, size.h);
    drawUnder?.(ctx, vp, (p) => {
      const s = toView(p, yScale);
      return { x: vp.originX + s.x * vp.scale, y: vp.originY - s.y * vp.scale };
    });
    drawFinCurves(ctx, layers, vp, yScale, selection, hovered);
  }, [vp, size, layers, selection, hovered, yScale, drawUnder, background]);

  const local = (e: { clientX: number; clientY: number }): ScreenPoint => {
    const r = canvas.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const tolFor = (e: PointerEvent) => (e.pointerType === 'touch' ? TOUCH_HIT_TOL_PX : HIT_TOL_PX);

  const onPointerDown = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!vp || e.button !== 0) return;
    const p = local(e);
    e.currentTarget.setPointerCapture?.(e.pointerId);
    const pick = pickHandle(layers, vp, p, yScale, tolFor(e), selection);
    if (pick) {
      const layer = layers.find((l) => l.id === pick.layer)!;
      const k = splineToView(layer.spline, yScale).knots[pick.index]!;
      drag.current = {
        kind: 'handle',
        pick,
        grabbed: handlePoint(k, pick.kind),
        pointerAt: screenToWorld(vp, p),
        id: e.pointerId,
      };
      onSelect?.(pick);
      onDragStart?.(pick);
    } else {
      drag.current = { kind: 'pan', last: p, id: e.pointerId };
      onSelect?.(null);
    }
  };

  const onPointerMove = (e: PointerEvent<HTMLCanvasElement>) => {
    if (!vp) return;
    const p = local(e);
    const d = drag.current;
    if (!d) {
      if (e.pointerType !== 'touch') setHovered(pickHandle(layers, vp, p, yScale, tolFor(e)));
      return;
    }
    if (d.id !== e.pointerId) return;
    if (d.kind === 'handle') {
      const to = dragTo(d.grabbed, d.pointerAt, screenToWorld(vp, p));
      onDrag?.(d.pick, fromView(to, yScale));
    } else {
      setVp(pan(vp, p.x - d.last.x, p.y - d.last.y));
      drag.current = { ...d, last: p };
    }
  };

  const endDrag = (e: PointerEvent<HTMLCanvasElement>) => {
    const d = drag.current;
    if (!d || d.id !== e.pointerId) return;
    drag.current = null;
    e.currentTarget.releasePointerCapture?.(e.pointerId);
    if (d.kind === 'handle') onDragEnd?.();
  };

  const onDoubleClick = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!vp || !onAddPoint) return;
    const hit = pickCurve(layers, vp, local(e), yScale, TOUCH_HIT_TOL_PX);
    if (hit) onAddPoint(hit.layer, hit.point);
  };

  // Wheel zoom about the cursor. Attached natively so it can preventDefault (React's
  // wheel listener is passive).
  const zoom = useCallback((e: WheelEvent) => {
    e.preventDefault();
    setVp((v) => (v ? zoomAt(v, local(e), Math.exp(-e.deltaY * 0.0015)) : v));
  }, []);
  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    c.addEventListener('wheel', zoom, { passive: false });
    return () => c.removeEventListener('wheel', zoom);
  }, [zoom]);

  return (
    <div
      ref={wrap}
      style={{ position: 'relative', width: '100%', height: '100%', touchAction: 'none' }}
    >
      <canvas
        ref={canvas}
        role="img"
        aria-label={label}
        style={{ width: '100%', height: '100%', display: 'block', touchAction: 'none' }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onPointerLeave={() => setHovered(null)}
        onDoubleClick={onDoubleClick}
      />
    </div>
  );
}
