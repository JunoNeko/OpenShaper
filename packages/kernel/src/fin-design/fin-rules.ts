// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What makes a {@link FinDesign} buildable. `validateFinDesign` lists every broken rule;
 * an empty list means the design can be meshed and exported. The store (step 9) uses
 * the same checks to clamp drags, so nothing invalid is ever committed.
 *
 * Exact where it matters: the outline, section and taper direction rules read the roots
 * of each Bézier segment's derivative (curve-shape.ts), not samples. Only the
 * "inside face stays inside the outside face" rule samples, at
 * {@link SECTION_CHECK_SAMPLES} chord stations.
 */
import { valueAt, type Spline } from '../bezier-spline';
import { slopeSigns, splineExtremes } from './curve-shape';
import {
  FIN_MAX_CANT,
  FIN_MAX_FRONT_OVERHANG,
  FIN_MIN_THICKNESS,
  finTabKind,
  type FinDesign,
} from './fin-design';
import { lateralOffsetRange } from './fin-placement';
import { FUTURES_TABS } from './futures-tab';

export type FinIssueCode =
  | 'hand'
  | 'cant'
  | 'outline-root'
  | 'outline-rising'
  | 'front-overhang'
  | 'tab-rear'
  | 'tab-contact'
  | 'section-ends'
  | 'section-direction'
  | 'section-crossing'
  | 'section-symmetry'
  | 'taper-span'
  | 'taper-thickness';

export interface FinIssue {
  readonly code: FinIssueCode;
  readonly message: string;
}

/** Positions compared to these are cm (or chord fractions); differences below are equal. */
const EPS = 1e-9;

export const SECTION_CHECK_SAMPLES = 256;

const first = (s: Spline) => s.knots[0]!.end;
const last = (s: Spline) => s.knots[s.knots.length - 1]!.end;
const near = (a: number, b: number): boolean => Math.abs(a - b) <= EPS;
const sameSigns = (a: readonly number[], b: readonly number[]): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i]);

const checkOutline = (d: FinDesign, issues: FinIssue[]): void => {
  const o = d.outline;
  if (o.curves.length === 0) {
    issues.push({ code: 'outline-root', message: 'The outline has no curve.' });
    return;
  }
  const le = first(o);
  const te = last(o);
  if (!near(le.y, 0) || !near(te.y, 0)) {
    issues.push({
      code: 'outline-root',
      message: 'Both ends of the outline must sit on the tab top.',
    });
  } else if (le.x <= te.x + EPS) {
    issues.push({
      code: 'outline-root',
      message: 'The leading-edge root must be in front of the trailing-edge root.',
    });
  }
  // Up the leading edge, then down the trailing edge: one peak, so every horizontal
  // slice crosses the outline exactly twice.
  if (!sameSigns(slopeSigns(o, 'y'), [1, -1])) {
    issues.push({
      code: 'outline-rising',
      message: 'The leading and trailing edges must each keep rising from root to tip.',
    });
  }
  const front = FUTURES_TABS[finTabKind(d.position)].length;
  if (le.x > front + FIN_MAX_FRONT_OVERHANG + EPS) {
    issues.push({
      code: 'front-overhang',
      message: `The leading edge overhangs the front of the tab by more than ${FIN_MAX_FRONT_OVERHANG * 10} mm.`,
    });
  }
  if (le.x < -EPS) {
    issues.push({ code: 'tab-rear', message: 'The fin has slid off the back of the tab.' });
  }
};

/** The tab stays under the foil (fin-placement.ts). Needs a buildable section. */
const checkTabContact = (d: FinDesign, issues: FinIssue[]): void => {
  const { min, max } = lateralOffsetRange(d);
  if (d.lateralOffset < min - EPS || d.lateralOffset > max + EPS) {
    issues.push({ code: 'tab-contact', message: 'The fin has slid sideways off the tab.' });
  }
};

/** The face must run (0, 0) → (1, 0), always moving toward the trailing edge. */
const checkFace = (face: Spline, name: string, issues: FinIssue[]): boolean => {
  if (face.curves.length === 0) {
    issues.push({ code: 'section-ends', message: `The ${name} face has no curve.` });
    return false;
  }
  const a = first(face);
  const b = last(face);
  if (!near(a.x, 0) || !near(a.y, 0) || !near(b.x, 1) || !near(b.y, 0)) {
    issues.push({
      code: 'section-ends',
      message: `The ${name} face must run from the leading edge to the trailing edge.`,
    });
    return false;
  }
  if (!sameSigns(slopeSigns(face, 'x'), [1])) {
    issues.push({
      code: 'section-direction',
      message: `The ${name} face must not turn back toward the leading edge.`,
    });
    return false;
  }
  return true;
};

const checkSection = (d: FinDesign, issues: FinIssue[]): void => {
  const { outside, inside } = d.section;
  if (d.position === 'centre' && inside !== null) {
    issues.push({ code: 'section-symmetry', message: 'A centre fin has a symmetric foil.' });
  }
  const outsideOk = checkFace(outside, 'outside', issues);
  const insideOk = inside === null || checkFace(inside, 'inside', issues);
  if (!outsideOk || !insideOk) return;

  // The inside face mirrors the outside when the foil is symmetric.
  const insideAt = (u: number) => (inside ? valueAt(inside, u) : -valueAt(outside, u));
  let thickest = 0;
  for (let i = 1; i < SECTION_CHECK_SAMPLES; i++) {
    const u = i / SECTION_CHECK_SAMPLES;
    const t = valueAt(outside, u) - insideAt(u);
    if (t < -EPS) {
      issues.push({
        code: 'section-crossing',
        message: 'The inside face crosses the outside face.',
      });
      return;
    }
    thickest = Math.max(thickest, t);
  }
  if (thickest <= EPS) {
    issues.push({ code: 'section-crossing', message: 'The foil has no thickness.' });
  }
};

const checkTaper = (d: FinDesign, issues: FinIssue[]): void => {
  const t = d.taper;
  if (t.curves.length === 0 || !near(first(t).x, 0) || !near(last(t).x, 1)) {
    issues.push({ code: 'taper-span', message: 'The taper must run from the root to the tip.' });
    return;
  }
  if (!sameSigns(slopeSigns(t, 'x'), [1])) {
    issues.push({ code: 'taper-span', message: 'The taper must not turn back toward the root.' });
    return;
  }
  if (splineExtremes(t, 'y').min.point.y < FIN_MIN_THICKNESS - EPS) {
    issues.push({
      code: 'taper-thickness',
      message: `The fin must be at least ${FIN_MIN_THICKNESS * 10} mm thick everywhere.`,
    });
  }
};

/** Every rule the design breaks; empty when it can be built. */
export const validateFinDesign = (d: FinDesign): FinIssue[] => {
  const issues: FinIssue[] = [];
  const centre = d.position === 'centre';
  if (centre ? d.hand !== null : d.hand === null) {
    issues.push({
      code: 'hand',
      message: centre ? 'A centre fin has no side.' : 'A side or quad-rear fin needs a side.',
    });
  }
  if (centre ? d.cant !== 0 : !(d.cant >= 0 && d.cant <= FIN_MAX_CANT)) {
    issues.push({
      code: 'cant',
      message: centre ? 'A centre fin has no cant.' : `Cant must be 0–${FIN_MAX_CANT}°.`,
    });
  }
  checkOutline(d, issues);
  checkSection(d, issues);
  checkTaper(d, issues);
  // Placing the tab under the foil means building the root section, which needs the
  // rest of the design to be sound.
  if (issues.length === 0) checkTabContact(d, issues);
  return issues;
};
