// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Pure edits on a fin design, for the fin store (docs/design/fin-designer.md, step 9).
 * Spline operations are the board's (edits.ts); this module knows which curve of a fin
 * is which, what each curve's ends are pinned to, and the fin-wide edits (cant,
 * thickness, depth, foil presets, hand).
 */
import {
  FIN_MAX_CANT,
  FIN_MIN_THICKNESS,
  defaultFinDesign,
  flatFace,
  knot,
  nacaSection,
  parseNaca4,
  splineFromKnots,
  sub,
  validateFinDesign,
  value,
  vec2,
  withHandles,
  type FinDesign,
  type FinHand,
  type FinIssueCode,
  type FinPosition,
  type Spline,
  type Vec2,
} from '@openshaper/kernel';
import { setKnotContinuous } from './edits';

/** The editable curves of a fin. */
export type FinCurve = 'outline' | 'outside' | 'inside' | 'taper';

export const getFinCurve = (d: FinDesign, c: FinCurve): Spline | null => {
  switch (c) {
    case 'outline':
      return d.outline;
    case 'outside':
      return d.section.outside;
    case 'inside':
      return d.section.inside;
    case 'taper':
      return d.taper;
  }
};

export const withFinCurve = (d: FinDesign, c: FinCurve, s: Spline): FinDesign => {
  switch (c) {
    case 'outline':
      return { ...d, outline: s };
    case 'outside':
      return { ...d, section: { ...d.section, outside: s } };
    case 'inside':
      return { ...d, section: { ...d.section, inside: s } };
    case 'taper':
      return { ...d, taper: s };
  }
};

/**
 * Where a knot of `curve` may go when dragged toward `p`:
 * - the outline's two ends slide along the base (y = 0);
 * - a section face's ends are the leading and trailing edges, fixed at (0, 0), (1, 0);
 * - the taper's ends keep their heights (0 at the root, 1 at the tip).
 */
export const constrainKnot = (s: Spline, c: FinCurve, index: number, p: Vec2): Vec2 => {
  const end = index === 0 || index === s.knots.length - 1;
  if (!end) return p;
  const at = s.knots[index]!.end;
  if (c === 'outline') return vec2(p.x, 0);
  if (c === 'taper') return vec2(at.x, p.y);
  return at; // section faces: pinned
};

/** Rule codes `next` breaks that `prev` did not (`prev` may be its issue codes). */
export const newIssues = (
  prev: FinDesign | ReadonlySet<FinIssueCode>,
  next: FinDesign,
): FinIssueCode[] => {
  const had = prev instanceof Set ? prev : issueCodes(prev as FinDesign);
  return validateFinDesign(next)
    .map((i) => i.code)
    .filter((c) => !had.has(c));
};

const issueCodes = (d: FinDesign): ReadonlySet<FinIssueCode> =>
  new Set(validateFinDesign(d).map((i) => i.code));

/**
 * The furthest edit along a move that breaks no new rule. `at(t)` builds the design
 * moved a fraction t of the way (t = 1 is the whole move). Returns the full move if it
 * is fine; otherwise bisects for the last fine fraction, so a dragged point stops at the
 * boundary rather than refusing to move. Null if no part of the move is allowed.
 */
export const clampEdit = (
  current: FinDesign,
  at: (t: number) => FinDesign,
  steps = 12,
): FinDesign | null => {
  const had = issueCodes(current); // once, not per probe
  const ok = (d: FinDesign) => newIssues(had, d).length === 0;
  const full = at(1);
  if (ok(full)) return full;
  let lo = 0;
  let hi = 1;
  for (let i = 0; i < steps; i++) {
    const mid = (lo + hi) / 2;
    if (ok(at(mid))) lo = mid;
    else hi = mid;
  }
  return lo > 0 ? at(lo) : null;
};

/** Cant clamped to what the position allows: 0 for a centre fin, else 0 to the max. */
export const setCant = (d: FinDesign, deg: number): FinDesign => {
  const cant = d.position === 'centre' ? 0 : Math.min(FIN_MAX_CANT, Math.max(0, deg));
  return cant === d.cant ? d : { ...d, cant };
};

/**
 * Scale the taper so the root is `cm` thick, keeping its shape: every point's
 * thickness scales by the same factor, then nothing goes under the minimum.
 */
export const setRootThickness = (d: FinDesign, cm: number): FinDesign => {
  const root = d.taper.knots[0]!.end.y;
  if (!(cm > 0) || root <= 0 || cm === root) return d;
  const f = cm / root;
  const m = (p: Vec2) => vec2(p.x, Math.max(FIN_MIN_THICKNESS, p.y * f));
  return {
    ...d,
    taper: splineFromKnots(
      d.taper.knots.map((k) =>
        knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous, k.other, k.lock),
      ),
    ),
  };
};

/**
 * Stretch the outline vertically so its highest point is `cm` above the tab, keeping
 * the base (and so the root chord) where it is. Sweep changes with it, as it would if
 * the shaper drew a taller fin over the same base.
 */
export const setDepth = (d: FinDesign, cm: number, currentDepth: number): FinDesign => {
  if (!(cm > 0) || !(currentDepth > 0) || cm === currentDepth) return d;
  const f = cm / currentDepth;
  const m = (p: Vec2) => vec2(p.x, p.y * f);
  return {
    ...d,
    outline: splineFromKnots(
      d.outline.knots.map((k) =>
        knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous, k.other, k.lock),
      ),
    ),
  };
};

/**
 * Replace the section with a NACA 4-digit preset. A centre fin takes only symmetric
 * (00XX) foils: null for anything else, or for a code that isn't one.
 */
export const applyNaca = (d: FinDesign, code: string): FinDesign | null => {
  let n;
  try {
    n = parseNaca4(code);
  } catch {
    return null;
  }
  if (d.position === 'centre' && n.camber > 0) return null;
  return { ...d, section: nacaSection(n) };
};

/** Make the inside face flat (side fins) or mirror the outside (any fin). */
export const setInsideFace = (d: FinDesign, kind: 'flat' | 'symmetric'): FinDesign | null => {
  if (kind === 'flat' && d.position === 'centre') return null;
  return { ...d, section: { ...d.section, inside: kind === 'flat' ? flatFace() : null } };
};

/** Which side a side or quad-rear fin is for; the design is otherwise unchanged. */
export const setHand = (d: FinDesign, hand: FinHand): FinDesign =>
  d.position === 'centre' || d.hand === hand ? d : { ...d, hand };

/** A fresh default fin for a position (the designer's starting points). */
export const newFin = (position: FinPosition, hand: FinHand = 'left'): FinDesign =>
  defaultFinDesign(position, hand);

/**
 * Where the toolbar's add-point button puts a new point: halfway along the span after
 * knot `index` (the span before it, for the last knot). Null for an index off the curve.
 */
export const spanMidpoint = (s: Spline, index: number): Vec2 | null => {
  const spans = s.knots.length - 1;
  if (spans < 1 || index < 0 || index > spans) return null;
  return value(s.coeffs[Math.min(index, spans - 1)]!, 0.5);
};

/**
 * Knot `index` made smooth with its handles lined up, each keeping its length: they
 * turn to the average of their two directions. Flagging a corner smooth without this
 * would leave its kink in place until the next drag.
 */
export const smoothKnot = (s: Spline, index: number): Spline => {
  const k = s.knots[index];
  if (!k) return s;
  // A locked handle's direction is fixed; setKnotContinuous mirrors the lock instead.
  if (k.lock) return setKnotContinuous(s, index, true);
  const prev = sub(k.tangentToPrev, k.end);
  const next = sub(k.tangentToNext, k.end);
  const lp = Math.hypot(prev.x, prev.y);
  const ln = Math.hypot(next.x, next.y);
  let dir: Vec2;
  if (lp > 0 && ln > 0) dir = vec2(next.x / ln - prev.x / lp, next.y / ln - prev.y / lp);
  else if (ln > 0) dir = next;
  else if (lp > 0) dir = vec2(-prev.x, -prev.y);
  else return setKnotContinuous(s, index, true);
  const ld = Math.hypot(dir.x, dir.y);
  // Handles pointing the same way: nothing sensible to average.
  if (ld < 1e-12) return setKnotContinuous(s, index, true);
  const u = vec2(dir.x / ld, dir.y / ld);
  const aligned = withHandles(
    k,
    vec2(k.end.x - u.x * lp, k.end.y - u.y * lp),
    vec2(k.end.x + u.x * ln, k.end.y + u.y * ln),
  );
  const knots = s.knots.slice();
  knots[index] = aligned;
  return setKnotContinuous(splineFromKnots(knots), index, true);
};
