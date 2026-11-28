// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Inserting a station must not change the board, and must still leave something a person
 * can edit. Those two pull against each other, and these pin both ends.
 *
 * The bug: `insertCrossSection` took its section from the control-point blend, which can
 * sit millimetres from the lofted surface the 3D view and the STL show. Asking for a
 * handle silently reshaped the board — measured at 4.79 mm on the golden longboard with a
 * different rail preset at each station.
 *
 * The obvious fix is worse than the bug, which is why the tests below are shaped the way
 * they are. Simply storing `loftCrossSection` would be shape-perfect and hand the user 96
 * control points; and on the ordinary board the blend is not just adequate but exactly
 * right at five knots, so fitting everything would trade an exact cheap answer for an
 * approximate expensive one. So the tests check the policy, not only the accuracy: cheap
 * where it can be, accurate where it must be.
 */
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { arcLengthTable, normalByTT, pointAtArcFraction } from './bezier-spline';
import { getInterpolatedCrossSection, type BezierBoard } from './board';
import { crossSection, type CrossSection } from './cross-section';
import { loftCrossSection, loftPoint, loftSection } from './loft';
import { applyRailProfile, RAIL_PRESETS } from './rail-profile';
import { editableCrossSection, SECTION_FIT_TOL_CM } from './section-fit';
import { parseBrdGeometry } from './test-support/brd-geometry';
import { vec2, type Vec2 } from './vec2';

const here = dirname(fileURLToPath(import.meta.url));
const GOLDEN = ['shortboard.brd', 'funboard.brd', 'longboard.brd'] as const;
const golden = (file: string): BezierBoard =>
  parseBrdGeometry(readFileSync(resolve(here, `../../../docs/specs/golden/${file}`), 'utf8'));

/** Every station a different rail — the case the blend gets wrong. */
const mixedRails = (b: BezierBoard): BezierBoard => {
  const ids = ['80-20-hard', '50-50-soft', 'pinched', 'boxy', 'knifey', 'egg'];
  const list = [...b.crossSections];
  for (let i = 1; i < list.length - 1; i++) {
    const preset = RAIL_PRESETS.find((p) => p.id === ids[i % ids.length]!)!;
    list[i] = applyRailProfile(list[i]!, preset.params);
  }
  return { ...b, crossSections: list };
};

/**
 * Was this section fitted, or is it the blend handed straight back?
 *
 * Reference identity will not answer it — the blend is rebuilt on each call — and the
 * distinction matters: a fitted section is C1 by construction, while a blended one
 * inherits whatever tangent breaks the board's own stations have, and real boards have
 * them (a hard rail edge IS a tangent discontinuity).
 */
const sameKnots = (a: CrossSection, b: CrossSection): boolean =>
  a.spline.knots.length === b.spline.knots.length &&
  a.spline.knots.every((k, i) => {
    const o = b.spline.knots[i]!;
    return (
      k.end.x === o.end.x &&
      k.end.y === o.end.y &&
      k.tangentToPrev.x === o.tangentToPrev.x &&
      k.tangentToPrev.y === o.tangentToPrev.y &&
      k.tangentToNext.x === o.tangentToNext.x &&
      k.tangentToNext.y === o.tangentToNext.y
    );
  });

const withStation = (b: BezierBoard, cs: CrossSection): BezierBoard => ({
  ...b,
  crossSections: [...b.crossSections, cs].sort((p, q) => p.position - q.position),
});

/** Point-to-segment-polyline distance from `p` to `poly`. */
const distToPolyline = (poly: readonly Vec2[], p: Vec2): number => {
  let best = Infinity;
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1]!;
    const b = poly[i]!;
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const L2 = dx * dx + dy * dy;
    const t = L2 > 0 ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / L2)) : 0;
    best = Math.min(best, Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)));
  }
  return best;
};

/**
 * Geometric (point-to-curve) deviation between two lofted sections, matching the metric
 * `editableCrossSection` enforces (`section-fit.ts#deviation`). Using orthogonal curve
 * distance avoids confounding geometric shape error with tiny tangential arc-fraction
 * shifts when one curve is slightly longer than the other.
 */
const sectionCurveDeviation = (
  ref: NonNullable<ReturnType<typeof loftSection>>,
  cand: NonNullable<ReturnType<typeof loftSection>>,
  refSamples = 120,
  candSamples = 400,
): number => {
  const poly: Vec2[] = Array.from({ length: candSamples + 1 }, (_, k) =>
    loftPoint(cand, k / candSamples),
  );
  let worst = 0;
  for (let k = 0; k <= refSamples; k++) {
    const d = distToPolyline(poly, loftPoint(ref, k / refSamples));
    if (d > worst) worst = d;
  }
  return worst;
};

/** Worst geometric deviation of the lofted surface between two boards, over the whole length. */
const surfaceCurveDeviation = (a: BezierBoard, b: BezierBoard): number => {
  const end = a.crossSections[a.crossSections.length - 1]!.position;
  let worst = 0;
  for (let i = 0; i <= 60; i++) {
    const x = 20 + ((end - 40) * i) / 60;
    const sa = loftSection(a, x);
    const sb = loftSection(b, x);
    if (!sa || !sb) continue;
    worst = Math.max(worst, sectionCurveDeviation(sa, sb));
  }
  return worst;
};

/** Worst movement of the lofted surface between two boards, over the whole length. */
const surfaceShift = (a: BezierBoard, b: BezierBoard): number => {
  const end = a.crossSections[a.crossSections.length - 1]!.position;
  let worst = 0;
  for (let i = 0; i <= 60; i++) {
    const x = 20 + ((end - 40) * i) / 60;
    const sa = loftSection(a, x);
    const sb = loftSection(b, x);
    if (!sa || !sb) continue;
    for (let k = 0; k <= 120; k++) {
      const p = loftPoint(sa, k / 120);
      const q = loftPoint(sb, k / 120);
      worst = Math.max(worst, Math.hypot(p.x - q.x, p.y - q.y));
    }
  }
  return worst;
};

/** Interior stations to probe, avoiding the tips where a section is a point. */
const probes = (b: BezierBoard): number[] => {
  const end = b.crossSections[b.crossSections.length - 1]!.position;
  return [1, 2, 3, 4, 5].map((i) => (end * i) / 6);
};

describe('editableCrossSection', () => {
  /**
   * The headline: adding a station leaves the board alone within `SECTION_FIT_TOL_CM`
   * (0.5 mm — the fitter's own tolerance, unloosened).
   *
   * Because the cardinal spline's secant tangents at the two neighbouring stations read
   * the inserted station, inserting even an *exact* lofted station slightly re-forms the
   * two adjacent spans whenever stations differ. Checking three unloosened invariants
   * cleanly separates the fitter's accuracy from the cardinal spline's re-formation:
   *  1. At the inserted station `x` itself, the fitted section matches the original loft
   *     within `SECTION_FIT_TOL_CM` (0.5 mm).
   *  2. Across the entire board, inserting `editableCrossSection` matches inserting an
   *     exact `loftCrossSection` within `SECTION_FIT_TOL_CM` (0.5 mm).
   *  3. Cardinal-spline locality: intervals beyond the two neighbouring stations move by
   *     identically 0 (`< 1e-12`).
   */
  it.each(GOLDEN)('inserting a station does not reshape %s', (file) => {
    const stock = golden(file);
    for (const board of [stock, mixedRails(stock)]) {
      const stationPos = board.crossSections.slice(1, -1).map((c) => c.position);
      for (const x of probes(board)) {
        const fitted = editableCrossSection(board, x);
        const exact = loftCrossSection(board, x);
        expect(fitted).not.toBeNull();
        expect(exact).not.toBeNull();

        const withFitted = withStation(board, fitted!);
        const withExact = withStation(board, exact!);

        // 1. At the inserted station x itself, match the original surface within 0.5 mm.
        const beforeAtX = loftSection(board, x)!;
        const afterAtX = loftSection(withFitted, x)!;
        expect(sectionCurveDeviation(beforeAtX, afterAtX)).toBeLessThanOrEqual(SECTION_FIT_TOL_CM);

        // 2. Across the entire board, fitter error vs an exact station insert stays <= 0.5 mm.
        expect(surfaceCurveDeviation(withExact, withFitted)).toBeLessThanOrEqual(
          SECTION_FIT_TOL_CM,
        );

        // 3. Cardinal spline locality: outside [prevPrev, nextNext], shift is identically 0.
        const nextIdx = stationPos.findIndex((p) => p > x);
        const prevIdx = nextIdx === -1 ? stationPos.length - 1 : nextIdx - 1;
        const leftBound = prevIdx > 0 ? stationPos[prevIdx - 1]! : -Infinity;
        const rightBound =
          nextIdx !== -1 && nextIdx + 1 < stationPos.length ? stationPos[nextIdx + 1]! : Infinity;
        const end = board.crossSections[board.crossSections.length - 1]!.position;
        for (let i = 0; i <= 60; i++) {
          const px = 20 + ((end - 40) * i) / 60;
          if (px >= leftBound && px <= rightBound) continue;
          const sa = loftSection(board, px);
          const sb = loftSection(withFitted, px);
          if (!sa || !sb) continue;
          for (let k = 0; k <= 40; k++) {
            const p = loftPoint(sa, k / 40);
            const q = loftPoint(sb, k / 40);
            expect(Math.hypot(p.x - q.x, p.y - q.y)).toBeLessThan(1e-12);
          }
        }
      }
    }
  });

  /**
   * ...and it stays editable. A station exists to be dragged; the lofted curve itself is
   * 96 knots, which would be no station at all.
   *
   * 12 is what the golden boards actually need at their worst — the mixed-rail longboard
   * — against 5 or 6 for a stored section. The bound is here to catch the fitter quietly
   * escalating, which is exactly what it did at a tighter tolerance.
   */
  it.each(GOLDEN)('hands back a section a person can still edit on %s', (file) => {
    for (const board of [golden(file), mixedRails(golden(file))]) {
      for (const x of probes(board)) {
        expect(editableCrossSection(board, x)!.spline.knots.length).toBeLessThanOrEqual(12);
      }
    }
  });

  /**
   * Where the two neighbouring stations share a profile the blend returns it untouched,
   * and there is nothing to improve on: no fit, no extra control points, the same section
   * the editor has always inserted. This is most boards most of the time, and it is the
   * reason the fitter is conditional rather than unconditional.
   */
  it('keeps the blend, untouched, where the blend is already exact', () => {
    const base = golden('shortboard.brd');
    const one = base.crossSections[1]!;
    // Every real station the same shape, so any blend of two of them is that shape.
    const uniform: BezierBoard = {
      ...base,
      crossSections: base.crossSections.map((cs, i) =>
        i === 0 || i === base.crossSections.length - 1 ? cs : crossSection(cs.position, one.spline),
      ),
    };
    for (const x of probes(uniform)) {
      const blend = getInterpolatedCrossSection(uniform, x)!;
      const cs = editableCrossSection(uniform, x)!;
      expect(cs.spline.knots).toEqual(blend.spline.knots);
      expect(cs.spline.knots.length).toBeLessThanOrEqual(6);
    }
  });

  /**
   * A fitted section has to be fair, not merely close. Every knot's two handles are built
   * along one shared direction, so the joins are C1 by construction — this is the check
   * that the construction actually holds, because a kink at a knot would show as a crease
   * down the board and no positional tolerance would catch it.
   */
  it('joins its spans smoothly, so a fitted station has no creases', () => {
    const board = mixedRails(golden('longboard.brd'));
    let fitted = 0;
    for (const x of probes(board)) {
      const cs = editableCrossSection(board, x)!;
      // Only fitted sections; a kept blend carries the board's own tangent breaks, which
      // are the shape the user drew and not this module's to smooth away.
      if (sameKnots(cs, getInterpolatedCrossSection(board, x)!)) continue;
      fitted++;
      const spline = cs.spline;
      const n = spline.curves.length;
      if (n < 2) continue;
      for (let i = 1; i < n; i++) {
        // Approach the join from both sides; the normal angle must not jump.
        const before = normalByTT(spline, (i - 1e-9) / n);
        const after = normalByTT(spline, (i + 1e-9) / n);
        expect(Math.abs(after - before)).toBeLessThan(1e-6);
      }
    }
    // ...and the board really did exercise the fitter, or the loop proved nothing.
    expect(fitted).toBeGreaterThan(0);
  });

  /**
   * The fit is a real improvement, not a relabelling. On the stations where the blend is
   * wrong it must be decisively better — otherwise the extra control points bought
   * nothing and the conditional should have kept the blend.
   */
  it('beats the blend outright wherever it replaces it', () => {
    const board = mixedRails(golden('longboard.brd'));
    const worseAt: number[] = [];
    let replaced = 0;
    for (const x of probes(board)) {
      const blend = getInterpolatedCrossSection(board, x)!;
      const cs = editableCrossSection(board, x)!;
      if (sameKnots(cs, blend)) continue; // blend kept, nothing to compare
      replaced++;
      const blendShift = surfaceShift(board, withStation(board, blend));
      const fitShift = surfaceShift(board, withStation(board, cs));
      if (!(fitShift < blendShift)) worseAt.push(x);
      // The case this exists for: the blend was millimetres out.
      if (blendShift > 0.1) expect(fitShift).toBeLessThan(blendShift / 2);
    }
    expect(worseAt).toEqual([]);
    expect(replaced).toBeGreaterThan(0);
  });

  it('has no section past either tip', () => {
    const board = golden('shortboard.brd');
    expect(editableCrossSection(board, -1)).toBeNull();
    expect(editableCrossSection(board, 1e6)).toBeNull();
  });

  /** The fitted curve runs bottom-centreline → rail → deck-centreline, like every other. */
  it('keeps both ends on the centreline and the rail in between', () => {
    const board = mixedRails(golden('longboard.brd'));
    for (const x of probes(board)) {
      const spline = editableCrossSection(board, x)!.spline;
      const table = arcLengthTable(spline);
      const pts: Vec2[] = Array.from({ length: 201 }, (_, i) => pointAtArcFraction(table, i / 200));
      expect(pts[0]!.x).toBeCloseTo(0, 6);
      expect(pts[pts.length - 1]!.x).toBeCloseTo(0, 6);
      // Monotone up the profile: the deck end is above the bottom end.
      expect(pts[pts.length - 1]!.y).toBeGreaterThan(pts[0]!.y);
      // ...and the rail really is out at the widest point, not somewhere silly.
      const widest = pts.reduce((m, p) => (p.x > m.x ? p : m), vec2(0, 0));
      expect(widest.x).toBeGreaterThan(1);
    }
  });
});
