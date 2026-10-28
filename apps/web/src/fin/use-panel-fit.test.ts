// SPDX-License-Identifier: GPL-3.0-or-later
import {
  defaultFinDesign,
  defaultKeel,
  foilAt,
  placeOnBase,
  type FinDesign,
} from '@openshaper/kernel';
import { describe, expect, it } from 'vitest';
import { frontView } from './FinFrontPane';
import { bestPoseOf, frontPanelFaces, panelFitOf, panelOverlay } from './use-panel-fit';

/** A side fin on an FCS tab with no cant, cut from a panel `mm` thick. */
const fcsFin = (mm: number, angle = 0): FinDesign => ({
  ...placeOnBase(defaultFinDesign('side', 'left'), 'fcs-single'),
  panel: { thickness: mm / 10, angle },
});

describe('panel fit in the app', () => {
  it('has nothing to say without a panel', () => {
    expect(panelFitOf(defaultFinDesign('side', 'left'), 0.1)).toBeNull();
  });

  it('fits an 8 mm FCS fin in a 3/8" panel, not in a 1/4" one', () => {
    expect(panelFitOf(fcsFin(9.525), 0.1)!.fits).toBe(true);
    const thin = panelFitOf(fcsFin(6.35), 0.1)!;
    expect(thin.fits).toBe(false);
    expect(thin.width * 10).toBeCloseTo(8, 1);
  });

  it('lays the real section over the foil view: thickest point on the shape, faces parallel', () => {
    const d = fcsFin(9.525);
    const o = panelOverlay(d, 0, panelFitOf(d, 0.1)!, 0.1)!;
    // At angle 0 the faces run along the chord: level in the view.
    for (const [a, b] of o.faces) expect(a.y).toBeCloseTo(b.y, 9);
    // The fin from above is the root foil (and tab) here: its top reaches the shape's top.
    const shape = foilAt(d, 0);
    const top = shape.shapeAt(shape.thickest.at)[0];
    expect(Math.max(...o.hull!.map((p) => p.y))).toBeCloseTo(top, 2);
    // A 9.525 mm panel round an 8 mm fin: the band is wider than the fin by the ratio.
    const band = o.faces[1]![0].y - o.faces[0]![0].y;
    const fin = Math.max(...o.hull!.map((p) => p.y)) - Math.min(...o.hull!.map((p) => p.y));
    expect(Math.abs(band) / fin).toBeCloseTo(9.525 / 8, 1);
  });

  it('tilts the faces when the fin is turned in the panel', () => {
    const d = fcsFin(9.525, 5);
    const [[a, b]] = panelOverlay(d, 0, panelFitOf(d, 0.1)!, 0.1)!.faces as [
      [{ x: number; y: number }, { x: number; y: number }],
    ];
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(0.01);
  });

  it('fits a canted Futures keel in a 3/8" panel by tilting it, and draws the tilt', () => {
    const keel = defaultKeel();
    const d: FinDesign = { ...keel, panel: { thickness: 0.9525, angle: 0 } };
    const straight = panelFitOf(d, 0.1)!;
    expect(straight.fits).toBe(false); // upright, the leaning blade sticks out of it
    const pose = bestPoseOf(d, 0.1);
    expect(pose.tilt).toBeGreaterThan(0);
    const tilted = panelFitOf({ ...d, panel: { ...d.panel!, ...pose } }, 0.1)!;
    expect(tilted.fits).toBe(true);
    // Seen from the front, the faces lean toward the outside face (+across for a left
    // fin) by the tilt, and stay a panel's thickness apart square to themselves.
    const faces = frontPanelFaces(tilted);
    const [[a, b], [c]] = faces as [
      [{ x: number; y: number }, { x: number; y: number }],
      [{ x: number; y: number }],
    ];
    expect(Math.atan2(b.x - a.x, b.y - a.y) * (180 / Math.PI)).toBeCloseTo(pose.tilt, 6);
    const gap = Math.abs(
      (c.x - a.x) * Math.cos((pose.tilt * Math.PI) / 180) -
        (c.y - a.y) * Math.sin((pose.tilt * Math.PI) / 180),
    );
    expect(gap).toBeCloseTo(0.9525, 9);
    // The foil view has no single outline from above for a tilted panel.
    expect(panelOverlay({ ...d, panel: tilted.panel }, 0, tilted, 0.1)!.hull).toBeNull();
  });

  it('draws the fin from the front true to scale: the canted blade leaning out over its tab', () => {
    const keel = defaultKeel();
    const v = frontView(keel, 0.1);
    // Tab below the root, blade above it up to the fin's depth.
    expect(v.bounds.minY).toBeLessThan(0);
    const tips = (tris: Float64Array) => {
      let best = { x: 0, y: -Infinity };
      for (let i = 0; i < tris.length; i += 2)
        if (tris[i + 1]! > best.y) best = { x: tris[i]!, y: tris[i + 1]! };
      return best;
    };
    const tip = tips(v.blade);
    // A left fin leans to +across: its tip is outboard of the tab by about depth · tan(cant).
    expect(tip.x).toBeGreaterThan(0.6 * tip.y * Math.tan((keel.cant * Math.PI) / 180));
    // A right fin is its mirror.
    expect(tips(frontView(defaultKeel('right'), 0.1).blade).x).toBeCloseTo(-tip.x, 6);
    // Every triangle wound the same way, so they fill as one shape.
    for (let i = 0; i < v.blade.length; i += 6) {
      const t = v.blade;
      const area =
        (t[i + 2]! - t[i]!) * (t[i + 5]! - t[i + 1]!) -
        (t[i + 3]! - t[i + 1]!) * (t[i + 4]! - t[i]!);
      expect(area).toBeGreaterThanOrEqual(0);
    }
  });
});
