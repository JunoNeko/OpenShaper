// SPDX-License-Identifier: GPL-3.0-or-later
import { describe, expect, it } from 'vitest';
import type { BoardMesh } from '../tessellate';
import { defaultFinDesign, defaultKeel, defaultTaper } from './fin-defaults';
import { FIN_PANEL_MAX_ANGLE } from './fin-design';
import { FCS_SINGLE_TAB } from './fin-tab';
import { bestPanelPose, finPanelPoints, panelPoints, panelSpan, planHull } from './panel-fit';

/** A mesh of just these points (no triangles): the fit only reads positions. */
const points = (pts: [number, number][], z = 0): BoardMesh => ({
  positions: new Float32Array(pts.flatMap(([x, y]) => [x, y, z])),
  indices: new Uint32Array(),
  normals: new Float32Array(),
});
const empty = points([]);
const flat = (angle: number) => ({ angle, tilt: 0 });

describe('panel fit', () => {
  // A 10 × 1 rectangle seen from above, with points inside it that the hull drops.
  const rect = panelPoints({
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

  it('keeps only the points that can touch a face', () => {
    expect(rect).toHaveLength(4);
    expect(planHull(rect)).toHaveLength(4);
  });

  it('measures the width across a panel turned to any angle', () => {
    for (const a of [0, 3, -7.5, 20]) {
      const t = (a * Math.PI) / 180;
      expect(panelSpan(rect, flat(a)).width).toBeCloseTo(
        10 * Math.abs(Math.sin(t)) + Math.cos(t),
        5,
      );
    }
  });

  it('finds the angle that needs the thinnest panel', () => {
    // The same rectangle turned 10°: lying it back 10° fits it in its own thickness.
    const t = (10 * Math.PI) / 180;
    const turn = ([x, y]: [number, number]): [number, number] => [
      x * Math.cos(t) - y * Math.sin(t),
      x * Math.sin(t) + y * Math.cos(t),
    ];
    const plan = (
      [
        [0, 0],
        [10, 0],
        [10, 1],
        [0, 1],
      ] as [number, number][]
    ).map(turn);
    // Standing 10 high, so tilting the panel doesn't help.
    const pts = panelPoints({ blade: points(plan, 0), tab: points(plan, 10) });
    const best = bestPanelPose(pts);
    expect(best.angle).toBeCloseTo(10, 1);
    expect(best.tilt).toBeCloseTo(0, 1);
    expect(best.width).toBeCloseTo(1, 4);
    expect(Math.abs(best.angle)).toBeLessThanOrEqual(FIN_PANEL_MAX_ANGLE);
  });

  it('needs the foil’s thickness for a straight fin with no cant', () => {
    const d = defaultFinDesign('centre');
    const root = d.taper.knots[0]!.end.y;
    expect(panelSpan(finPanelPoints(d, 0.1), flat(0)).width).toBeCloseTo(root, 3);
  });

  it('counts the base: a thin blade on an FCS tab needs the tab’s thickness', () => {
    const d = {
      ...defaultFinDesign('side', 'left'),
      cant: 0,
      base: 'fcs-single' as const,
      taper: defaultTaper(0.4), // a 4 mm blade on a 6.35 mm tab
    };
    expect(panelSpan(finPanelPoints(d, 0.1), flat(0)).width).toBeCloseTo(
      FCS_SINGLE_TAB.thickness,
      3,
    );
  });

  it('measures a tilted panel: a board leaning in it needs its thickness over the cosine', () => {
    // A 10 × 1 board standing upright, seen from the front: the panel leans 20° to it.
    const board = panelPoints({
      blade: points(
        [
          [0, 0],
          [10, 0],
          [10, 1],
          [0, 1],
        ],
        0,
      ),
      tab: points(
        [
          [0, 0],
          [10, 0],
          [10, 1],
          [0, 1],
        ],
        10,
      ),
    });
    const t = 20 * (Math.PI / 180);
    // Across the leaning faces: the thickness and the height both count.
    expect(panelSpan(board, { angle: 0, tilt: 20 }).width).toBeCloseTo(
      Math.cos(t) + 10 * Math.sin(t),
      5,
    );
    // Leaning the board instead, out by its cant, a panel leaning with it fits it exactly.
    const lean = (y: number, z: number) => y + z * Math.tan(t);
    // 10 long, so turning the panel doesn't help.
    const at = (z: number): [number, number][] => [
      [0, lean(0, z)],
      [0, lean(1, z)],
      [10, lean(0, z)],
      [10, lean(1, z)],
    ];
    const canted = panelPoints({ blade: points(at(0), 0), tab: points(at(10), 10) });
    const best = bestPanelPose(canted);
    expect(best.tilt).toBeCloseTo(20, 1);
    // A horizontal slice is 1 wide, so the slab square to the lean is cos(20°).
    expect(best.width).toBeCloseTo(Math.cos(t), 4);
    // A right fin leans the other way: the same tilt, mirrored, fits it.
    const mirrored = canted.map((p) => ({ ...p, y: -p.y }));
    expect(bestPanelPose(mirrored, -1).tilt).toBeCloseTo(20, 1);
  });

  it('fits a canted keel by tilting the panel toward its cant', () => {
    const d = defaultKeel();
    const pts = finPanelPoints(d, 0.1);
    const straight = panelSpan(pts, flat(0), 1).width;
    const best = bestPanelPose(pts, d.hand === 'right' ? -1 : 1);
    expect(best.tilt).toBeGreaterThan(0);
    expect(best.tilt).toBeLessThanOrEqual(d.cant);
    expect(best.width).toBeLessThan(straight * 0.8);
  });
});
