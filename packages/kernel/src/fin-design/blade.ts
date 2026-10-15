// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The 3D blade of a {@link FinDesign}, as horizontal sections: step 4 of
 * docs/design/fin-designer.md. Meshing (step 7) and STEP (step 5) both loft these.
 *
 * At height h above the tab top, a section is built from:
 * - **chord:** where the line y = h crosses the outline (leading and trailing edge);
 * - **shape:** the section faces, stretched along that chord;
 * - **thickness:** the taper at h / depth. The section is scaled so its thickest point
 *   is exactly that thick. The outline sets the chord, the taper the thickness;
 *   neither scales the other.
 *
 * Then two adjustments:
 * - **Minimum thickness:** nowhere thinner than {@link FIN_MIN_THICKNESS}. Where the
 *   scaled foil is thinner (the edges, and everywhere near the tip), it is padded:
 *   - a symmetric foil grows equally both ways, so it stays symmetric;
 *   - any other foil grows on the outside only, so a flat inside face stays flat.
 * - **Cant:** the blade leans out by sliding each section sideways, h·tan(cant). The
 *   sections stay horizontal, so the root sits exactly on the flat tab top (see "Cant
 *   as a lean of horizontal sections" in the design doc). A horizontal slice of a
 *   leaning blade is wider than the blade is thick, so lateral offsets are divided by
 *   cos(cant); the thickness measured square to the blade is then the taper value.
 *
 * Frame (cm): the fin stands on its tab, as on a board turned deck-down.
 * - X runs along the tab toward its front (the nose), as in the outline.
 * - Z is height above the tab top.
 * - Y completes a right-handed frame. With the board deck-down and the nose toward +X,
 *   the rider's right rail is on +Y. (Looking from the tail toward the nose, that is on
 *   your left, because the board is upside down.)
 * A right fin's outside face and cant point to +Y; a left fin is its exact mirror. A
 * centre fin's outside is +Y too; it is symmetric with no cant, so the choice is moot.
 */
import { DEG_TO_RAD } from '../constants';
import type { Vert3 } from '../loft';
import { crossings, splineExtremes, yAtX } from './curve-shape';
import { FIN_MIN_THICKNESS, type FinDesign } from './fin-design';

/** Chord stations from leading edge (0) to trailing edge (1), clustered at both edges. */
export const cosineStations = (n: number): number[] =>
  Array.from({ length: n + 1 }, (_, j) => (1 - Math.cos((Math.PI * j) / n)) / 2);

export const DEFAULT_CHORD_STATIONS: readonly number[] = cosineStations(48);

/** Everything about a design that doesn't depend on the height, worked out once. */
export interface PreparedBlade {
  readonly design: FinDesign;
  /** Height of the tip above the tab top (cm). */
  readonly depth: number;
  /** Chord fraction where the section shape is thickest. */
  readonly thickestAt: number;
  /** The shape's thickness there, in chords. */
  readonly shapeThickness: number;
  /** +1 if the outside face points to +Y, −1 for a left fin. */
  readonly outward: 1 | -1;
  /** Lateral slide per cm of height (tan cant). */
  readonly lean: number;
  /** Horizontal-slice widening, 1 / cos(cant). */
  readonly widen: number;
}

/** One horizontal section of the blade, at shared chord stations. */
export interface BladeSection {
  /** Height above the tab top (cm). */
  readonly height: number;
  readonly leadingX: number;
  readonly trailingX: number;
  /** The taper's thickness at this height (cm), square to the blade. */
  readonly thickness: number;
  /** The chord stations (0 leading edge → 1 trailing edge) the faces were sampled at. */
  readonly stations: readonly number[];
  /** Points on the outside face, one per station. */
  readonly outside: readonly Vert3[];
  /** Points on the inside face, one per station. */
  readonly inside: readonly Vert3[];
}

/** Outside and inside offsets of the shape at chord fraction u, in chords. */
const shapeAt = (d: FinDesign, u: number): [number, number] => {
  const out = yAtX(d.section.outside, u);
  return [out, d.section.inside ? yAtX(d.section.inside, u) : -out];
};

const SEARCH_SAMPLES = 400;

/** Where the shape is thickest: a coarse scan, then a golden-section refine. */
const thickest = (d: FinDesign): { at: number; thickness: number } => {
  const t = (u: number) => {
    const [o, i] = shapeAt(d, u);
    return o - i;
  };
  let best = 0;
  for (let j = 1; j < SEARCH_SAMPLES; j++) {
    if (t(j / SEARCH_SAMPLES) > t(best / SEARCH_SAMPLES)) best = j;
  }
  let lo = Math.max(0, (best - 1) / SEARCH_SAMPLES);
  let hi = Math.min(1, (best + 1) / SEARCH_SAMPLES);
  const g = (Math.sqrt(5) - 1) / 2;
  for (let k = 0; k < 80; k++) {
    const a = hi - g * (hi - lo);
    const b = lo + g * (hi - lo);
    if (t(a) < t(b)) lo = a;
    else hi = b;
  }
  const at = (lo + hi) / 2;
  return { at, thickness: t(at) };
};

/**
 * Work out the height-independent parts of the blade. The design must pass
 * `validateFinDesign`; the result is undefined otherwise.
 */
export const prepareBlade = (d: FinDesign): PreparedBlade => {
  const { at, thickness } = thickest(d);
  const cant = d.cant * DEG_TO_RAD;
  return {
    design: d,
    depth: splineExtremes(d.outline, 'y').max.point.y,
    thickestAt: at,
    shapeThickness: thickness,
    outward: d.hand === 'left' ? -1 : 1,
    lean: Math.tan(cant),
    widen: 1 / Math.cos(cant),
  };
};

/** Leading- and trailing-edge x where the outline is `h` above the tab top. */
export const chordAt = (b: PreparedBlade, h: number): { leading: number; trailing: number } => {
  if (!(h >= 0 && h <= b.depth)) {
    throw new RangeError(`chordAt: height ${h} is outside 0–${b.depth}`);
  }
  // Single-peaked outline: the first crossing is on the leading edge, the last on the
  // trailing edge. At the tip they meet.
  const hits = crossings(b.design.outline, 'y', h);
  if (h === b.depth || hits.length === 0) {
    const tip = splineExtremes(b.design.outline, 'y').max.point.x;
    return { leading: tip, trailing: tip };
  }
  return { leading: hits[0]!.point.x, trailing: hits[hits.length - 1]!.point.x };
};

/** The taper's thickness (cm) at height `h`. */
export const thicknessAt = (b: PreparedBlade, h: number): number =>
  yAtX(b.design.taper, Math.min(1, Math.max(0, h / b.depth)));

/** The horizontal section of the blade at height `h` (cm above the tab top). */
export const bladeSection = (
  b: PreparedBlade,
  h: number,
  stations: readonly number[] = DEFAULT_CHORD_STATIONS,
): BladeSection => {
  const { leading, trailing } = chordAt(b, h);
  const thickness = thicknessAt(b, h);
  const scale = thickness / b.shapeThickness;
  const symmetric = b.design.section.inside === null;
  const slide = h * b.lean;
  const at = (x: number, offset: number): Vert3 => ({
    x,
    y: b.outward * (slide + offset * b.widen),
    z: h,
  });

  const outside: Vert3[] = [];
  const inside: Vert3[] = [];
  for (const u of stations) {
    const [o, i] = shapeAt(b.design, u);
    let out = o * scale;
    let ins = i * scale;
    const short = FIN_MIN_THICKNESS - (out - ins);
    if (short > 0) {
      if (symmetric) {
        out += short / 2;
        ins -= short / 2;
      } else {
        out += short;
      }
    }
    const x = leading + (trailing - leading) * u;
    outside.push(at(x, out));
    inside.push(at(x, ins));
  }
  return {
    height: h,
    leadingX: leading,
    trailingX: trailing,
    thickness,
    stations,
    outside,
    inside,
  };
};
