// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Native fin document (`.fin.json`): a versioned, lossless serialization of a kernel
 * `FinDesign` (docs/design/fin-designer.md, step 8).
 *
 * Lengths are millimetres, as the fin designer shows them; the kernel works in cm and
 * this module converts both ways. Curves keep their frames:
 *   - `outline`: the blade's side profile in the tab frame, mm.
 *   - `section`: the two foil faces, x and y in chords (unitless). `inside: null` is a
 *     symmetric foil.
 *   - `taper`: x = height as a fraction of the depth (unitless), y = thickness in mm.
 * A design is saved as it is, valid or not: someone may save half-way through an
 * edit. The reader checks the file's structure, not the fin's rules.
 *
 * Handle-lock directions are unit vectors in the design's own frame (for the taper,
 * height fraction × cm), not rescaled to mm; see `scaleSpline`.
 *
 * Version history:
 *   1 — position, hand, cant, lateral offset, outline, section, taper, metadata.
 */
import {
  FIN_POSITIONS,
  knot,
  splineFromKnots,
  vec2,
  type FinDesign,
  type FinHand,
  type FinPosition,
  type Knot,
  type Spline,
  type Vec2,
} from '@openshaper/kernel';
import { assertKnots, isObject, splineFromJson, splineToJson, type KnotJson } from './knot-json';

export const FIN_JSON_VERSION = 1;
export const FIN_JSON_FORMAT = 'openshaper-fin';

export interface FinJson {
  format: typeof FIN_JSON_FORMAT;
  version: number;
  units: 'mm';
  position: FinPosition;
  hand: FinHand | null;
  /** Blade lean from the tab, degrees. */
  cant: number;
  /** Blade's sideways offset on the tab, mm, + outboard. */
  lateralOffset: number;
  outline: KnotJson[];
  section: { outside: KnotJson[]; inside: KnotJson[] | null };
  taper: KnotJson[];
  metadata?: Record<string, unknown>;
}

export class FinJsonError extends Error {}

const MM_PER_CM = 10;

/**
 * Every point of a spline mapped through linear scalings `fx`, `fy` (×10 to write mm,
 * ÷10 to read them back: dividing rather than multiplying by 0.1 keeps the round trip
 * exact in practice). A locked handle's direction is kept as it is, in the design's
 * own frame: renormalising it after unequal scaling (the taper's) drifts by an ulp on
 * every save, and autosave would then rewrite the file forever. The outline scales
 * equally, where a direction doesn't change anyway.
 */
const scaleSpline = (s: Spline, fx: (n: number) => number, fy: (n: number) => number): Spline => {
  const p = (v: Vec2) => vec2(fx(v.x), fy(v.y));
  return splineFromKnots(
    s.knots.map(
      (k): Knot =>
        knot(p(k.end), p(k.tangentToPrev), p(k.tangentToNext), k.continuous, k.other, k.lock),
    ),
  );
};

const toMm = (n: number) => n * MM_PER_CM;
const toCm = (n: number) => n / MM_PER_CM;
const same = (n: number) => n;

/** Serialize a fin design to a `.fin.json` string. */
export const writeFinJson = (d: FinDesign, metadata?: Record<string, unknown>): string => {
  const doc: FinJson = {
    format: FIN_JSON_FORMAT,
    version: FIN_JSON_VERSION,
    units: 'mm',
    position: d.position,
    hand: d.hand,
    cant: d.cant,
    lateralOffset: toMm(d.lateralOffset),
    outline: splineToJson(scaleSpline(d.outline, toMm, toMm)),
    section: {
      outside: splineToJson(d.section.outside),
      inside: d.section.inside ? splineToJson(d.section.inside) : null,
    },
    taper: splineToJson(scaleSpline(d.taper, same, toMm)),
    ...(metadata ? { metadata } : {}),
  };
  return JSON.stringify(doc, null, 2);
};

const fail = (message: string): never => {
  throw new FinJsonError(message);
};

const isNumber = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

/** A curve needs two points to be a curve at all. */
const assertCurve = (v: unknown, where: string): void => {
  assertKnots(v, where, FinJsonError);
  if ((v as unknown[]).length < 2) fail(`Malformed fin: ${where} needs at least two points`);
};

const assertStructure = (doc: Record<string, unknown>): void => {
  if (!(FIN_POSITIONS as readonly unknown[]).includes(doc.position)) {
    fail('Malformed fin: unknown position');
  }
  if (doc.hand !== null && doc.hand !== 'left' && doc.hand !== 'right') {
    fail('Malformed fin: hand must be left, right or null');
  }
  if (!isNumber(doc.cant)) fail('Malformed fin: cant is not a number');
  if (!isNumber(doc.lateralOffset)) fail('Malformed fin: lateralOffset is not a number');
  if (doc.units !== 'mm') fail('Malformed fin: units must be mm');
  assertCurve(doc.outline, 'outline');
  assertCurve(doc.taper, 'taper');
  const section = doc.section;
  if (!isObject(section)) return fail('Malformed fin: section is missing');
  assertCurve(section.outside, 'section outside face');
  if (section.inside !== null) assertCurve(section.inside, 'section inside face');
};

/** Parse a `.fin.json` string back into a fin design (+ any metadata). */
export const readFinJson = (
  text: string,
): { design: FinDesign; metadata?: Record<string, unknown> } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return fail(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!isObject(parsed) || parsed.format !== FIN_JSON_FORMAT) {
    return fail('Not an OpenShaper fin (missing format marker)');
  }
  if (!isNumber(parsed.version) || parsed.version > FIN_JSON_VERSION) {
    return fail(
      `Fin version ${String(parsed.version)} is newer than supported (${FIN_JSON_VERSION})`,
    );
  }
  assertStructure(parsed);
  const doc = parsed as unknown as FinJson;
  const design: FinDesign = {
    position: doc.position,
    hand: doc.hand,
    cant: doc.cant,
    lateralOffset: toCm(doc.lateralOffset),
    outline: scaleSpline(splineFromJson(doc.outline), toCm, toCm),
    section: {
      outside: splineFromJson(doc.section.outside),
      inside: doc.section.inside ? splineFromJson(doc.section.inside) : null,
    },
    taper: scaleSpline(splineFromJson(doc.taper), same, toCm),
  };
  return doc.metadata ? { design, metadata: doc.metadata } : { design };
};
