// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { BoardMesh } from '../tessellate';
import { defaultFinDesign, defaultKeel, defaultTaper } from './fin-defaults';
import { FIN_PANEL_MAX_ANGLE } from './fin-design';
import { FCS_SINGLE_TAB } from './fin-tab';
import { bestPanelAngle, finPlanHull, panelSpan, planHull } from './panel-fit';

/** A mesh of just these points (no triangles): the hull only reads positions. */
const points = (pts: [number, number][]): BoardMesh => ({
  positions: new Float32Array(pts.flatMap(([x, y]) => [x, y, 0])),
  indices: new Uint32Array(),
  normals: new Float32Array(),
});
const empty = points([]);

describe('panel fit', () => {
  // A 10 × 1 rectangle seen from above, with points inside it that the hull drops.
  const rect = planHull({
    blade: points([
      [0, 0],
      [10, 0],
      [10, 1],
      [0, 1],
      [5, 0.5],
      [2, 0.3],
    ]),
    tab: empty,
  });

  it('reduces the fin seen from above to its convex hull', () => {
    expect(rect).toHaveLength(4);
  });

  it('measures the width across a panel turned to any angle', () => {
    for (const a of [0, 3, -7.5, 20]) {
      const t = (a * Math.PI) / 180;
      expect(panelSpan(rect, a).width).toBeCloseTo(10 * Math.abs(Math.sin(t)) + Math.cos(t), 5);
    }
  });

  it('finds the angle that needs the thinnest panel', () => {
    // The same rectangle turned 10°: lying it back 10° fits it in its own thickness.
    const t = (10 * Math.PI) / 180;
    const turn = ([x, y]: [number, number]): [number, number] => [
      x * Math.cos(t) - y * Math.sin(t),
      x * Math.sin(t) + y * Math.cos(t),
    ];
    const hull = planHull({
      blade: points(
        (
          [
            [0, 0],
            [10, 0],
            [10, 1],
            [0, 1],
          ] as [number, number][]
        ).map(turn),
      ),
      tab: empty,
    });
    const best = bestPanelAngle(hull);
    expect(best.angle).toBeCloseTo(10, 1);
    expect(best.width).toBeCloseTo(1, 4);
    expect(Math.abs(best.angle)).toBeLessThanOrEqual(FIN_PANEL_MAX_ANGLE);
  });

  it('needs the foil’s thickness for a straight fin with no cant', () => {
    const d = defaultFinDesign('centre');
    const root = d.taper.knots[0]!.end.y;
    expect(panelSpan(finPlanHull(d, 0.1), 0).width).toBeCloseTo(root, 3);
  });

  it('counts the base: a thin blade on an FCS tab needs the tab’s thickness', () => {
    const d = {
      ...defaultFinDesign('side', 'left'),
      cant: 0,
      base: 'fcs-single' as const,
      taper: defaultTaper(0.4), // a 4 mm blade on a 6.35 mm tab
    };
    expect(panelSpan(finPlanHull(d, 0.1), 0).width).toBeCloseTo(FCS_SINGLE_TAB.thickness, 3);
  });

  it('is wider from above for a canted fin, whatever the angle', () => {
    const d = defaultKeel();
    const root = d.taper.knots[0]!.end.y;
    expect(bestPanelAngle(finPlanHull(d, 0.1)).width).toBeGreaterThan(1.5 * root);
  });
});
