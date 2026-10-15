// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The pure half of `FinCurveEditor` (docs/design/fin-designer.md, step 10): which
 * handle or curve a pointer is on, where a drag takes a handle, and how the layers are
 * drawn. No React, no store: the editor is told what to draw and reports what the user
 * did, and the app decides what that means for the fin.
 *
 * View space is data space with y stretched by `yScale`, so a foil 10% of its chord
 * thick can be drawn taller than it is and still be dragged accurately. Everything
 * here works in view space; `fromView` turns a result back into data.
 */
import { splineFromKnots, knot, vec2, type Spline, type Vec2 } from '@openshaper/kernel';
import { defaultStyle, drawControlPoints, drawSpline, type DrawStyle } from './draw';
import { hitTest, type HandleKind } from './hit';
import { boundsOf, sampleSpline } from './sample';
import {
  screenToWorld,
  worldToScreen,
  type Bounds,
  type ScreenPoint,
  type Viewport,
} from './viewport';

/** One curve the editor shows. */
export interface FinCurveLayer {
  readonly id: string;
  readonly spline: Spline;
  /** Whether its points can be picked and dragged. */
  readonly editable: boolean;
  readonly color?: string;
  /** Dashed and muted: a reference, such as the mirrored half of a symmetric foil. */
  readonly ghost?: boolean;
}

/** A picked control point: which layer, which knot, which part of it. */
export interface FinCurvePick {
  readonly layer: string;
  readonly index: number;
  readonly kind: HandleKind;
}

/** Hit radii, px: a fingertip needs more room than a mouse. */
export const HIT_TOL_PX = 8;
export const TOUCH_HIT_TOL_PX = 22;

export const toView = (p: Vec2, yScale: number): Vec2 => vec2(p.x, p.y * yScale);
export const fromView = (p: Vec2, yScale: number): Vec2 => vec2(p.x, p.y / yScale);

/** A spline in view space. */
export const splineToView = (s: Spline, yScale: number): Spline =>
  yScale === 1
    ? s
    : splineFromKnots(
        s.knots.map((k) =>
          knot(
            toView(k.end, yScale),
            toView(k.tangentToPrev, yScale),
            toView(k.tangentToNext, yScale),
            k.continuous,
            k.other,
          ),
        ),
      );

/**
 * The handle under `screen`, among the editable layers, nearest within `tolPx`. Later
 * layers are on top, so they win ties; a `preferred` pick (the current selection) wins
 * over anything at the same spot, so a collapsed handle can still be grabbed.
 */
export const pickHandle = (
  layers: readonly FinCurveLayer[],
  vp: Viewport,
  screen: ScreenPoint,
  yScale: number,
  tolPx: number,
  preferred?: FinCurvePick | null,
): FinCurvePick | null => {
  // The selection first, across layers: where curves share a point (a foil's two faces
  // meet at the leading and trailing edges), the one already picked stays picked.
  const pl = preferred && layers.find((l) => l.id === preferred.layer && l.editable);
  if (pl) {
    const hit = hitTest(splineToView(pl.spline, yScale), vp, screen, tolPx, preferred);
    if (hit && hit.index === preferred.index && hit.kind === preferred.kind) return preferred;
  }
  for (let i = layers.length - 1; i >= 0; i--) {
    const l = layers[i]!;
    if (!l.editable) continue;
    const hit = hitTest(splineToView(l.spline, yScale), vp, screen, tolPx);
    if (hit) return { layer: l.id, index: hit.index, kind: hit.kind };
  }
  return null;
};

/**
 * The nearest point on an editable layer's curve to `screen`, within `tolPx`, in data
 * space: where a double-click adds a point.
 */
export const pickCurve = (
  layers: readonly FinCurveLayer[],
  vp: Viewport,
  screen: ScreenPoint,
  yScale: number,
  tolPx: number,
): { layer: string; point: Vec2 } | null => {
  let best: { layer: string; point: Vec2 } | null = null;
  let bestD = tolPx;
  for (const l of layers) {
    if (!l.editable) continue;
    const pts = sampleSpline(splineToView(l.spline, yScale)).map((p) => worldToScreen(vp, p));
    for (let i = 0; i < pts.length - 1; i++) {
      const a = pts[i]!;
      const b = pts[i + 1]!;
      const dx = b.x - a.x;
      const dy = b.y - a.y;
      const len2 = dx * dx + dy * dy;
      const t =
        len2 > 0
          ? Math.max(0, Math.min(1, ((screen.x - a.x) * dx + (screen.y - a.y) * dy) / len2))
          : 0;
      const q = { x: a.x + t * dx, y: a.y + t * dy };
      const d = Math.hypot(screen.x - q.x, screen.y - q.y);
      if (d <= bestD) {
        bestD = d;
        best = { layer: l.id, point: fromView(screenToWorld(vp, q), yScale) };
      }
    }
  }
  return best;
};

/**
 * Where a dragged handle goes: its position when grabbed, plus how far the pointer has
 * travelled since, never the pointer itself. Grabbing off-centre (normal with a finger)
 * must not jump the handle under the pointer.
 */
export const dragTo = (grabbed: Vec2, pointerAtGrab: Vec2, pointerNow: Vec2): Vec2 =>
  vec2(grabbed.x + pointerNow.x - pointerAtGrab.x, grabbed.y + pointerNow.y - pointerAtGrab.y);

/** Bounds of all layers in view space, joined with any `extra` (e.g. the tab). */
export const layersBounds = (
  layers: readonly FinCurveLayer[],
  yScale: number,
  extra?: Bounds,
): Bounds | null => {
  const all = layers.map((l) => boundsOf(sampleSpline(splineToView(l.spline, yScale))));
  if (extra) all.push(extra);
  if (all.length === 0) return null;
  return {
    minX: Math.min(...all.map((b) => b.minX)),
    minY: Math.min(...all.map((b) => b.minY)),
    maxX: Math.max(...all.map((b) => b.maxX)),
    maxY: Math.max(...all.map((b) => b.maxY)),
  };
};

/** Draw the layers: ghosts first and dashed, then curves, then editable points. */
export const drawFinCurves = (
  ctx: CanvasRenderingContext2D,
  layers: readonly FinCurveLayer[],
  vp: Viewport,
  yScale: number,
  selection: FinCurvePick | null,
  hovered: FinCurvePick | null,
): void => {
  const styleOf = (l: FinCurveLayer): DrawStyle => ({
    ...defaultStyle,
    curve: l.color ?? defaultStyle.curve,
  });
  const ordered = [...layers.filter((l) => l.ghost), ...layers.filter((l) => !l.ghost)];
  for (const l of ordered) {
    ctx.save();
    if (l.ghost) {
      ctx.setLineDash([6, 4]);
      ctx.globalAlpha = 0.55;
    }
    drawSpline(ctx, splineToView(l.spline, yScale), vp, styleOf(l));
    ctx.restore();
  }
  for (const l of layers) {
    if (!l.editable) continue;
    const sel = selection?.layer === l.id ? selection : null;
    const hov = hovered?.layer === l.id ? { index: hovered.index, kind: hovered.kind } : null;
    drawControlPoints(
      ctx,
      splineToView(l.spline, yScale),
      vp,
      styleOf(l),
      sel ? sel.index : null,
      undefined,
      sel?.kind ?? 'end',
      hov,
    );
  }
};
