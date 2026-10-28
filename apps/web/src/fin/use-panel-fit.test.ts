// SPDX-License-Identifier: GPL-3.0-or-later
import { defaultFinDesign, foilAt, placeOnBase, type FinDesign } from '@openshaper/kernel';
import { describe, expect, it } from 'vitest';
import { panelFitOf, panelOverlay } from './use-panel-fit';

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
    expect(Math.max(...o.hull.map((p) => p.y))).toBeCloseTo(top, 2);
    // A 9.525 mm panel round an 8 mm fin: the band is wider than the fin by the ratio.
    const band = o.faces[1]![0].y - o.faces[0]![0].y;
    const fin = Math.max(...o.hull.map((p) => p.y)) - Math.min(...o.hull.map((p) => p.y));
    expect(Math.abs(band) / fin).toBeCloseTo(9.525 / 8, 1);
  });

  it('tilts the faces when the fin is turned in the panel', () => {
    const d = fcsFin(9.525, 5);
    const [[a, b]] = panelOverlay(d, 0, panelFitOf(d, 0.1)!, 0.1)!.faces as [
      [{ x: number; y: number }, { x: number; y: number }],
    ];
    expect(Math.abs(b.y - a.y)).toBeGreaterThan(0.01);
  });
});
