// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A standalone fin design: the persisted intent of the fin designer
 * (docs/design/fin-designer.md). Everything a fin is made from — outline, foil section,
 * thickness taper, cant — is an editable curve or number here; the 3D blade and the
 * exports are computed from it and never stored.
 *
 * Independent of the board's `FinSpec`/`FinConfig` (fins.ts), which place fins on a
 * board; this describes one fin for manufacture.
 *
 * Units are the kernel's cm and degrees, except where a curve is normalised (stated
 * per field).
 */
import type { Spline } from '../bezier-spline';
import type { FinBase } from './fin-tab';
import type { FuturesTabKind } from './futures-tab';

/** Where the fin goes. Quad rears use the shallower centre tab but take cant and a side. */
export type FinPosition = 'side' | 'quad-rear' | 'centre';

export const FIN_POSITIONS: readonly FinPosition[] = ['side', 'quad-rear', 'centre'];

/**
 * Which side a side or quad-rear fin is for, named the way fin makers mark them: with
 * the board seen from below, nose up. That is the opposite of the rider's view from the
 * deck, so a "left" fin sits on the rider's right rail.
 */
export type FinHand = 'left' | 'right';

/**
 * +1 when the fin's outside face (and its cant) points to +Y in the blade frame, −1
 * when it points to −Y (blade.ts describes the frame). Seen from below with the nose
 * up, +Y is on the left, so a left fin faces +Y. A centre fin (no hand) uses +Y too; it
 * is symmetric with no cant, so the choice is moot.
 */
export const finOutward = (hand: FinHand | null): 1 | -1 => (hand === 'right' ? -1 : 1);

/** The Futures tab each position uses by default. */
export const finTabKind = (position: FinPosition): FuturesTabKind =>
  position === 'side' ? 'side' : 'centre';

/** The base a position starts on: its Futures tab. Canards choose the FCS single tab. */
export const defaultFinBase = (position: FinPosition): FinBase =>
  position === 'side' ? 'futures-side' : 'futures-centre';

/** Largest toe correction either way (deg). A little toe makes a big difference. */
export const FIN_MAX_TOE = 5;

/** Largest cant (blade lean from the tab, deg) the designer allows. */
export const FIN_MAX_CANT = 20;

/**
 * How far the leading-edge root may sit in front of a Futures tab's top-front corner
 * (cm): 4 mm. The base foil clears the box's grub screw by that much; the owner measured
 * production fins overhanging more than the 2.5 mm first assumed.
 */
export const FIN_MAX_FRONT_OVERHANG = 0.4;

/**
 * Thinnest the blade may get anywhere — edges and tip — for rider safety and so it
 * prints: some 3D printing materials can't hold a wall under 1 mm (cm).
 */
export const FIN_MIN_THICKNESS = 0.1;

/**
 * The horizontal foil, as two faces offset from the chord line. Frame: x = chord fraction
 * u (0 leading edge → 1 trailing edge), y = offset in chords, + toward the outside face.
 * Both faces run (0, 0) → (1, 0). Only the shape matters: step 4 scales the section so
 * its thickest point matches the taper.
 */
export interface FinSection {
  /** The outside (outboard) face. */
  readonly outside: Spline;
  /**
   * The inside face, or `null` for a symmetric foil (the outside face mirrored). A flat
   * inside face is the straight line y = 0; a negative offset bulges inboard.
   */
  readonly inside: Spline | null;
}

/** A foil at one height up the blade (docs/design/fin-designer.md, foil slices). */
export interface FinSlice {
  /** Height as a fraction of the blade's depth, like the taper's x: 0 root, 1 tip. */
  readonly height: number;
  readonly section: FinSection;
  /**
   * A change of cant and toe at this slice, or none (the blade carries on as below it).
   * Above the slice the blade has this cant and toe; below the transition zone it keeps
   * what it had; in between it eases from one to the other. More cant bends the blade
   * out, a different toe twists it (Futures' upper-blade designs). Each section turns
   * about its own thickest point.
   */
  readonly twist?: FinTwist;
}

/** Cant and toe at a slice, and how far below it they blend in. */
export interface FinTwist {
  /** Cant above the slice (deg), {@link FIN_MIN_SLICE_CANT} to {@link FIN_MAX_CANT}. */
  readonly cant: number;
  /** Toe above the slice (deg, + toe in), ±{@link FIN_MAX_TOE}. */
  readonly toe: number;
  /** The transition zone: how far below the slice the change starts (fraction of the depth). */
  readonly transition: number;
}

/** A slice may take the blade's lean back past upright: an edge case owners asked for. */
export const FIN_MIN_SLICE_CANT = -20;

/**
 * How close slices may sit to each other, the root or the tip (fraction of the depth):
 * 2 mm on a 100 mm fin. Closer and the blend between them would turn too sharply.
 */
export const FIN_SLICE_MIN_GAP = 0.02;

export interface FinDesign {
  readonly position: FinPosition;
  /** `left` or `right` for side and quad-rear fins; `null` for a centre fin. */
  readonly hand: FinHand | null;
  /**
   * Lean of the blade out from the tab (deg), 0 to {@link FIN_MAX_CANT}; 0 for a centre
   * fin, and on an FCS single tab, whose plug carries the cant.
   */
  readonly cant: number;
  /** The tab the fin sits on (fin-tab.ts). */
  readonly base: FinBase;
  /**
   * Toe correction (deg), −{@link FIN_MAX_TOE} to +{@link FIN_MAX_TOE}: the blade turned
   * on its tab about an upright axis through the centre of the root's thickest point,
   * to correct a box set at the wrong angle to the stringer. Positive is more toe in
   * (the leading edge turned toward the stringer), whichever side the fin is for.
   */
  readonly toe: number;
  /**
   * The blade's side profile in the tab frame (cm): x from the tab's rear end toward its
   * front (+x toward the nose), y = height above the tab top (the blade root plane).
   * One open chain: leading-edge root → up the leading edge → tip → down the trailing
   * edge → trailing-edge root. The root edge between the two ends is implied.
   *
   * Being in the tab frame, the outline also places the fin fore and aft on the tab:
   * nudging the fin forward or back moves the whole outline (fin-placement.ts).
   */
  readonly outline: Spline;
  /**
   * How far the blade sits outboard of its default position across the tab (cm);
   * negative is inboard. By default a foil with a flat or curved inside face has its
   * chord line flush with the tab's inboard face, and a symmetric foil is centred
   * (fin-placement.ts). A strongly curved inside face overhangs the tab inboard, and
   * this lets the user slide the blade back over it.
   */
  readonly lateralOffset: number;
  /** The foil at the root (and all the way up, unless {@link slices} say otherwise). */
  readonly section: FinSection;
  /**
   * Foils at other heights, lowest first. Between two slices, and between the root and
   * the first, the shape blends smoothly with height; above the last it stays as the
   * last. Empty for a fin with one foil throughout.
   */
  readonly slices: readonly FinSlice[];
  /**
   * Thickness at the section's thickest point, up the blade. Frame: x = height as a
   * fraction of the blade's depth (0 root → 1 tip), y = thickness (cm). Normalising
   * the height keeps the taper valid when the outline's depth changes.
   */
  readonly taper: Spline;
}
