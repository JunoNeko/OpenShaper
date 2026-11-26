// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fin box cavities, for printing a blank (print version, owner request 2026-11).
 *
 * A printed blank has no foam to route, so the holes a fin system's boxes or plugs are
 * set into are printed in. Their outlines are what each system's router jig cuts: the
 * jig's template opening, brought in all round by the cutter's offset from the
 * template, half of (guide bushing − bit) = (19.5 − 9.525) / 2 ≈ 5 mm. The openings
 * were measured from Gecko Surfboards' published 3D-printed jigs
 * (geckosurfboards.com/surfboard-building-router-jigs), which route the real hardware,
 * and agree with the makers' published sizes plus resin room:
 *
 * | Cavity           | Jig opening (mm) | Cavity (mm)  | Published hardware (mm)     |
 * | ---------------- | ---------------- | ------------ | --------------------------- |
 * | Futures flange   | 164.0 × 41.5     | 155.1 × 31.5 | box 149 × 31.75 (5⅞" × 1¼") |
 * | Futures box body | 139.5 × 22.5     | 129.5 × 12.5 |                             |
 * | FCS II plug      | 120.6 × 46.9     | 110.6 × 36.9 | plug at most 110 × 37.5     |
 *
 * A twinzer's canards stand in FCS 1 single plugs: round, 26 mm across and 20 mm tall
 * (the owner's measurements), so their cavity is that round hole, as deep as the plug.
 *
 * Depths: a Futures flange is 1.587 mm thick, plus 0.8 mm for resin, 2.4 mm; FCS II
 * plugs vary, 18.5 mm is safe (both the owner's). A Futures box body is as deep as its
 * box: "F" boxes (thruster sides, quad fronts) 3/4", "X" boxes (centres, quad rears)
 * 1/2" (Fiberglass Hawaii's placement guide), plus the same 0.8 mm. All editable.
 *
 * Each cavity is centred on its fin's base and runs along it (toe included), square
 * to the bottom there: the plugs and boxes carry the fin's cant themselves. Its depth
 * is measured from the bottom as cut, channels included, so a box sits flush.
 */
import { getWidthAtPos, type BezierBoard } from './board';
import { boardChannels } from './channel-layout';
import { channelDepthAt } from './channels';
import { FCS_SINGLE_PLUG, finGroups, resolveFins } from './fins';
import { bottomZAt, deckZAt } from './surface';
import { vec2, type Vec2 } from './vec2';

const pts = (xy: readonly (readonly [number, number])[]): readonly Vec2[] =>
  xy.map(([x, y]) => vec2(x, y));

/** The Futures flange step's outline (cm): x along the fin base toward the nose, y across. */
// prettier-ignore
const FUTURES_FLANGE = pts([
  [-7.7562, 0.1776], [-7.596, 0.2453], [-7.4512, -0.2588], [-7.4058, -0.452], [-7.3368, -0.6381], [-7.2454, -0.8143],
  [-7.1328, -0.9779], [-7.0028, -1.1245], [-6.8544, -1.2516], [-6.6891, -1.3606], [-6.5111, -1.4486], [-6.3237, -1.5139],
  [-6.1296, -1.5556], [-5.9204, -1.5734], [-5.6817, -1.5753], [-5.4234, -1.5752], [-5.1628, -1.5752], [-4.9021, -1.5752],
  [-4.6415, -1.5752], [-4.3809, -1.5752], [-4.1202, -1.5752], [-3.8596, -1.5752], [-3.599, -1.5752], [-3.3383, -1.5752],
  [-3.0777, -1.5752], [-2.8171, -1.5752], [-2.5564, -1.5752], [-2.2958, -1.5752], [-2.0352, -1.5752], [-1.7745, -1.5752],
  [-1.5139, -1.5752], [-1.2533, -1.5752], [-0.9926, -1.5752], [-0.732, -1.5752], [-0.4714, -1.5752], [-0.2107, -1.5752],
  [0.0499, -1.5752], [0.3105, -1.5752], [0.5712, -1.5752], [0.8318, -1.5752], [1.0924, -1.5752], [1.3531, -1.5752],
  [1.6137, -1.5752], [1.8743, -1.5752], [2.135, -1.5752], [2.3956, -1.5752], [2.6562, -1.5752], [2.9169, -1.5752],
  [3.1775, -1.5752], [3.4381, -1.5752], [3.6988, -1.5752], [3.9594, -1.5752], [4.22, -1.5752], [4.4807, -1.5752],
  [4.7413, -1.5752], [5.0019, -1.5752], [5.2626, -1.5752], [5.5232, -1.5752], [5.7762, -1.5753], [6.0043, -1.5689],
  [6.2072, -1.5427], [6.3985, -1.4932], [6.5798, -1.4204], [6.7507, -1.3235], [6.9101, -1.2052], [7.0536, -1.068],
  [7.1791, -0.9142], [7.2846, -0.7461], [7.3684, -0.5663], [7.4285, -0.3804], [7.4778, -0.1092], [7.6541, 0.267],
  [7.7561, -0.1774], [7.596, -0.2453], [7.4512, 0.2588], [7.4058, 0.452], [7.3368, 0.6381], [7.2454, 0.8143],
  [7.1328, 0.9779], [7.0028, 1.1245], [6.8544, 1.2516], [6.6891, 1.3606], [6.5111, 1.4486], [6.3237, 1.5139],
  [6.1296, 1.5556], [5.9204, 1.5734], [5.6817, 1.5753], [5.4234, 1.5752], [5.1628, 1.5752], [4.9021, 1.5752],
  [4.6415, 1.5752], [4.3809, 1.5752], [4.1202, 1.5752], [3.8596, 1.5752], [3.599, 1.5752], [3.3383, 1.5752],
  [3.0777, 1.5752], [2.8171, 1.5752], [2.5564, 1.5752], [2.2958, 1.5752], [2.0352, 1.5752], [1.7745, 1.5752],
  [1.5139, 1.5752], [1.2533, 1.5752], [0.9926, 1.5752], [0.732, 1.5752], [0.4714, 1.5752], [0.2107, 1.5752],
  [-0.0499, 1.5752], [-0.3105, 1.5752], [-0.5712, 1.5752], [-0.8318, 1.5752], [-1.0924, 1.5752], [-1.3531, 1.5752],
  [-1.6137, 1.5752], [-1.8743, 1.5752], [-2.135, 1.5752], [-2.3956, 1.5752], [-2.6562, 1.5752], [-2.9169, 1.5752],
  [-3.1775, 1.5752], [-3.4381, 1.5752], [-3.6988, 1.5752], [-3.9594, 1.5752], [-4.22, 1.5752], [-4.4807, 1.5752],
  [-4.7413, 1.5752], [-5.0019, 1.5752], [-5.2626, 1.5752], [-5.5232, 1.5752], [-5.7762, 1.5753], [-6.0043, 1.5689],
  [-6.2073, 1.5427], [-6.3985, 1.4932], [-6.5798, 1.4204], [-6.7507, 1.3235], [-6.9101, 1.2052], [-7.0536, 1.068],
  [-7.1791, 0.9142], [-7.2846, 0.7461], [-7.3684, 0.5663], [-7.4285, 0.3804], [-7.4779, 0.109], [-7.6543, -0.2669],
]);

/** The Futures box body's outline (cm), as {@link FUTURES_FLANGE}. */
// prettier-ignore
const FUTURES_BODY = pts([
  [-6.4752, 0.0], [-6.4621, -0.1154], [-6.4303, -0.2299], [-6.3768, -0.3328], [-6.3043, -0.427], [-6.2176, -0.5039],
  [-6.1149, -0.5639], [-6.0063, -0.6047], [-5.8792, -0.6224], [-5.7052, -0.6253], [-5.4992, -0.6253], [-5.2877, -0.6253],
  [-5.0762, -0.6253], [-4.8647, -0.6253], [-4.6532, -0.6253], [-4.4417, -0.6253], [-4.2302, -0.6253], [-4.0187, -0.6253],
  [-3.8072, -0.6253], [-3.5956, -0.6253], [-3.3841, -0.6253], [-3.1726, -0.6253], [-2.9611, -0.6253], [-2.7496, -0.6253],
  [-2.5381, -0.6253], [-2.3266, -0.6253], [-2.1151, -0.6253], [-1.9036, -0.6253], [-1.6921, -0.6253], [-1.4806, -0.6253],
  [-1.2691, -0.6253], [-1.0575, -0.6253], [-0.846, -0.6253], [-0.6345, -0.6253], [-0.423, -0.6253], [-0.2115, -0.6253],
  [0.0, -0.6253], [0.2115, -0.6253], [0.423, -0.6253], [0.6345, -0.6253], [0.846, -0.6253], [1.0575, -0.6253],
  [1.2691, -0.6253], [1.4806, -0.6253], [1.6921, -0.6253], [1.9036, -0.6253], [2.1151, -0.6253], [2.3266, -0.6253],
  [2.5381, -0.6253], [2.7496, -0.6253], [2.9611, -0.6253], [3.1726, -0.6253], [3.3841, -0.6253], [3.5956, -0.6253],
  [3.8072, -0.6253], [4.0187, -0.6253], [4.2302, -0.6253], [4.4417, -0.6253], [4.6532, -0.6253], [4.8647, -0.6253],
  [5.0762, -0.6253], [5.2877, -0.6253], [5.4992, -0.6253], [5.7052, -0.6253], [5.8792, -0.6224], [6.0063, -0.6047],
  [6.1149, -0.5639], [6.2176, -0.5039], [6.3043, -0.427], [6.3768, -0.3328], [6.4303, -0.2299], [6.4621, -0.1154],
  [6.4752, 0.0], [6.4621, 0.1154], [6.4303, 0.2299], [6.3768, 0.3328], [6.3043, 0.427], [6.2176, 0.5039],
  [6.1149, 0.5639], [6.0063, 0.6047], [5.8792, 0.6224], [5.7052, 0.6253], [5.4992, 0.6253], [5.2877, 0.6253],
  [5.0762, 0.6253], [4.8647, 0.6253], [4.6532, 0.6253], [4.4417, 0.6253], [4.2302, 0.6253], [4.0187, 0.6253],
  [3.8072, 0.6253], [3.5956, 0.6253], [3.3841, 0.6253], [3.1726, 0.6253], [2.9611, 0.6253], [2.7496, 0.6253],
  [2.5381, 0.6253], [2.3266, 0.6253], [2.1151, 0.6253], [1.9036, 0.6253], [1.6921, 0.6253], [1.4806, 0.6253],
  [1.2691, 0.6253], [1.0575, 0.6253], [0.846, 0.6253], [0.6345, 0.6253], [0.423, 0.6253], [0.2115, 0.6253],
  [0.0, 0.6253], [-0.2115, 0.6253], [-0.423, 0.6253], [-0.6345, 0.6253], [-0.846, 0.6253], [-1.0575, 0.6253],
  [-1.2691, 0.6253], [-1.4806, 0.6253], [-1.6921, 0.6253], [-1.9036, 0.6253], [-2.1151, 0.6253], [-2.3266, 0.6253],
  [-2.5381, 0.6253], [-2.7496, 0.6253], [-2.9611, 0.6253], [-3.1726, 0.6253], [-3.3841, 0.6253], [-3.5956, 0.6253],
  [-3.8072, 0.6253], [-4.0187, 0.6253], [-4.2302, 0.6253], [-4.4417, 0.6253], [-4.6532, 0.6253], [-4.8647, 0.6253],
  [-5.0762, 0.6253], [-5.2877, 0.6253], [-5.4992, 0.6253], [-5.7052, 0.6253], [-5.8792, 0.6224], [-6.0063, 0.6047],
  [-6.1149, 0.5639], [-6.2176, 0.5039], [-6.3043, 0.427], [-6.3768, 0.3328], [-6.4303, 0.2299], [-6.4621, 0.1154],
]);

/** The FCS II plug's outline (cm), as {@link FUTURES_FLANGE}. */
// prettier-ignore
const FCS2_PLUG = pts([
  [-0.0158, 1.246], [-0.2306, 1.2452], [-0.4595, 1.2556], [-0.6919, 1.2769], [-0.9293, 1.3147], [-1.1535, 1.3671],
  [-1.3563, 1.4205], [-1.5519, 1.4701], [-1.7482, 1.5187], [-1.9476, 1.5665], [-2.151, 1.6166], [-2.3512, 1.668],
  [-2.5438, 1.7165], [-2.7306, 1.7591], [-2.9132, 1.7945], [-3.0924, 1.821], [-3.2686, 1.8376], [-3.4445, 1.8433],
  [-3.6154, 1.8395], [-3.7829, 1.8215], [-3.9525, 1.7921], [-4.1197, 1.7514], [-4.2776, 1.7019], [-4.4264, 1.6392],
  [-4.5711, 1.5637], [-4.7056, 1.4782], [-4.8331, 1.3778], [-4.9599, 1.2619], [-5.0865, 1.1313], [-5.2068, 0.9991],
  [-5.302, 0.8786], [-5.3712, 0.7603], [-5.4258, 0.6262], [-5.4706, 0.473], [-5.5051, 0.3079], [-5.5279, 0.1488],
  [-5.5317, -0.01], [-5.5244, -0.1711], [-5.4996, -0.3339], [-5.4648, -0.4976], [-5.419, -0.646], [-5.3619, -0.7778],
  [-5.2898, -0.8957], [-5.1902, -1.0175], [-5.0678, -1.151], [-4.9409, -1.2802], [-4.8153, -1.3932], [-4.6865, -1.4907],
  [-4.5495, -1.5758], [-4.404, -1.6499], [-4.255, -1.7109], [-4.0971, -1.7582], [-3.9295, -1.7965], [-3.7585, -1.824],
  [-3.5885, -1.8405], [-3.418, -1.844], [-3.2437, -1.8363], [-3.0667, -1.8179], [-2.8869, -1.79], [-2.7037, -1.7534],
  [-2.5161, -1.7098], [-2.3222, -1.6605], [-2.1212, -1.6093], [-1.9182, -1.5594], [-1.7192, -1.5118], [-1.5235, -1.463],
  [-1.3273, -1.4129], [-1.1218, -1.3592], [-0.8952, -1.3083], [-0.6581, -1.2728], [-0.426, -1.2532], [-0.1979, -1.2445],
  [0.0158, -1.246], [0.2306, -1.2452], [0.4595, -1.2556], [0.6919, -1.2769], [0.9293, -1.3147], [1.1535, -1.3671],
  [1.3563, -1.4205], [1.5519, -1.4701], [1.7482, -1.5187], [1.9476, -1.5665], [2.151, -1.6166], [2.3512, -1.668],
  [2.5438, -1.7165], [2.7306, -1.7591], [2.9132, -1.7945], [3.0924, -1.821], [3.2686, -1.8376], [3.4445, -1.8433],
  [3.6154, -1.8395], [3.7829, -1.8216], [3.9525, -1.7921], [4.1197, -1.7514], [4.2776, -1.7019], [4.4264, -1.6392],
  [4.5711, -1.5637], [4.7056, -1.4782], [4.8331, -1.3778], [4.9599, -1.2619], [5.0865, -1.1313], [5.2068, -0.9991],
  [5.302, -0.8786], [5.3712, -0.7603], [5.4258, -0.6262], [5.4706, -0.473], [5.5051, -0.3079], [5.5279, -0.1488],
  [5.5317, 0.01], [5.5244, 0.1711], [5.4996, 0.3339], [5.4648, 0.4976], [5.419, 0.646], [5.3619, 0.7778],
  [5.2898, 0.8957], [5.1902, 1.0175], [5.0678, 1.151], [4.9409, 1.2802], [4.8153, 1.3932], [4.6865, 1.4907],
  [4.5495, 1.5758], [4.404, 1.6499], [4.255, 1.7109], [4.0971, 1.7582], [3.9295, 1.7965], [3.7585, 1.824],
  [3.5885, 1.8405], [3.418, 1.844], [3.2437, 1.8363], [3.0667, 1.8179], [2.8869, 1.79], [2.7037, 1.7534],
  [2.5161, 1.7098], [2.3222, 1.6605], [2.1212, 1.6093], [1.9182, 1.5594], [1.7192, 1.5118], [1.5235, 1.463],
  [1.3273, 1.4129], [1.1218, 1.3592], [0.8952, 1.3083], [0.6581, 1.2728], [0.426, 1.2532], [0.1979, 1.2445],
]);

/** The FCS single plug's outline (cm), as {@link FUTURES_FLANGE}: a circle. */
const FCS_SINGLE = Array.from({ length: 48 }, (_, i) => {
  const a = (i / 48) * 2 * Math.PI;
  const r = FCS_SINGLE_PLUG.diameter / 2;
  return vec2(r * Math.cos(a), r * Math.sin(a));
});

/** How deep each cavity is cut (cm, below the bottom), and extra room all round. */
export interface CavitySettings {
  /** The Futures flange step: the flange, 1.587 mm, plus 0.8 mm for resin. */
  readonly futuresFlangeDepth: number;
  /** A Futures "F" box body (thruster sides, quad fronts): 3/4" plus resin. */
  readonly futuresSideDepth: number;
  /** A Futures "X" box body (centre fins, quad rears): 1/2" plus resin. */
  readonly futuresCentreDepth: number;
  /** An FCS II plug: they vary; 18.5 mm is safe. */
  readonly fcs2Depth: number;
  /** An FCS single plug (a twinzer's canards): the plug's height, 20 mm. */
  readonly fcsSingleDepth: number;
  /** Extra room all round every outline (cm), past the jigs' own. */
  readonly clearance: number;
}

export const DEFAULT_CAVITY_SETTINGS: CavitySettings = {
  futuresFlangeDepth: 0.24,
  futuresSideDepth: 1.905 + 0.08,
  futuresCentreDepth: 1.27 + 0.08,
  fcs2Depth: 1.85,
  fcsSingleDepth: FCS_SINGLE_PLUG.height,
  clearance: 0,
};

/** One step of a cavity: an outline, cut to a depth. A box with a flange has two. */
export interface CavityStep {
  /** Closed outline (cm): x along the fin base toward the nose, y across. */
  readonly outline: readonly Vec2[];
  /** How far it is cut below the bottom (cm), along {@link FinCavity.axis}. */
  readonly depth: number;
  /** Extra room all round the outline (cm). */
  readonly grow: number;
}

/** A point or direction in board space (cm): x along, y across, z up. */
export interface P3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Where and what to cut for one fin. */
export interface FinCavity {
  /** The fin, by index in the board's fin configuration. */
  readonly fin: number;
  /** Which box, as a shaper calls it. */
  readonly kind: 'Futures F' | 'Futures X' | 'FCS II' | 'FCS single';
  /** Its centre on the bottom as cut (cm). */
  readonly origin: P3;
  /** Along the fin base toward the nose, in plan (unit). */
  readonly along: Vec2;
  /** Into the board, square to the bottom (unit, mostly +z). */
  readonly axis: P3;
  readonly steps: readonly CavityStep[];
}

/** Step for the bottom's slope (cm). */
const SLOPE_STEP = 0.5;

/** A side fin with another on its side further toward the nose: a quad's rear. */
const rearOfPair = (fins: ReturnType<typeof resolveFins>, i: number): boolean => {
  const f = fins[i]!;
  if (f.side === 0) return false;
  return fins.some((g, j) => j !== i && g.side === f.side && g.center.x > f.center.x + 1);
};

/**
 * The cavities to print into board `b` for its fins: none for glass-on fins, or for
 * the FCS X-2's round plugs or Futures' canard box, whose cavities aren't known yet.
 * A twinzer's canards take their own box (`FinConfig.canardBox`), its twins the system.
 */
export const finCavities = (
  b: BezierBoard,
  s: CavitySettings = DEFAULT_CAVITY_SETTINGS,
): FinCavity[] => {
  const cfg = b.fins;
  const groups = finGroups(cfg.setup);
  const boxOf = (i: number) =>
    groups[i] === 'canard' ? (cfg.canardBox ?? 'fcs-single') : cfg.system;
  const known = (i: number) => ['futures', 'fcs-ii', 'fcs-single'].includes(boxOf(i));
  if (!cfg.fins.some((_, i) => known(i))) return [];
  const fins = resolveFins(b);
  const channels = boardChannels(b);
  return fins.flatMap((f, i): FinCavity[] => {
    if (!known(i)) return [];
    const system = boxOf(i);
    const { fore, aft } = f.baseLine;
    const dx = fore.x - aft.x;
    const dy = fore.y - aft.y;
    const len = Math.hypot(dx, dy) || 1;
    const along = vec2(dx / len, dy / len);
    // Under the fin's tab (a fin with a design), or the middle of its base.
    const { x, y } = f.boxCenter;
    // Square to the uncut bottom (a channel wall nearby would tip it), at the height
    // the bottom is cut to. The board is symmetric and the surface is read on the +y
    // side (`bottomZAt` is defined there only), then mirrored: read at a negative y it
    // gave the left fins' cavities the wrong height, ~1.5 mm shallow (owner report).
    const ay = Math.abs(y);
    const side = y < 0 ? -1 : 1;
    const zAt = (px: number, py: number) => bottomZAt(b, px, Math.abs(py));
    const zx = (zAt(x + SLOPE_STEP, ay) - zAt(x - SLOPE_STEP, ay)) / (2 * SLOPE_STEP);
    const zy = side * ((zAt(x, ay + SLOPE_STEP) - zAt(x, Math.max(0, ay - SLOPE_STEP))) / (ay + SLOPE_STEP - Math.max(0, ay - SLOPE_STEP))); // prettier-ignore
    const n = Math.hypot(zx, zy, 1);
    const axis = { x: -zx / n, y: -zy / n, z: 1 / n };
    const origin = { x, y, z: zAt(x, ay) + channelDepthAt(channels, x, ay) };
    if (system === 'fcs-ii') {
      const steps = [{ outline: FCS2_PLUG, depth: s.fcs2Depth, grow: s.clearance }];
      return [{ fin: i, kind: 'FCS II', origin, along, axis, steps }];
    }
    if (system === 'fcs-single') {
      const steps = [{ outline: FCS_SINGLE, depth: s.fcsSingleDepth, grow: s.clearance }];
      return [{ fin: i, kind: 'FCS single', origin, along, axis, steps }];
    }
    // A Futures box: an X box for a centre, or a rear with a fin ahead of it on its
    // side (a quad's; a twinzer's twins are its main fins, ahead of nothing but canards).
    const small = f.side === 0 || (groups[i] !== 'side' && rearOfPair(fins, i));
    return [
      {
        fin: i,
        kind: small ? 'Futures X' : 'Futures F',
        origin,
        along,
        axis,
        steps: [
          { outline: FUTURES_FLANGE, depth: s.futuresFlangeDepth, grow: s.clearance },
          {
            outline: FUTURES_BODY,
            depth: small ? s.futuresCentreDepth : s.futuresSideDepth,
            grow: s.clearance,
          },
        ],
      },
    ];
  });
};

/** The least board left above a cavity's floor before it is worth a warning (cm). */
const MIN_SKIN = 0.3;

/** The least foam between a box (its flange, on Futures) and the rail before a warning (cm). */
export const MIN_RAIL_GAP = 1;

/** A channel's depth changing more than this across a box means it straddles a wall (cm). */
const CHANNEL_STEP = 0.1;

/** Where a cavity step's outline lies in plan (cm), grown by its clearance. */
export const planOutline = (c: FinCavity, step: CavityStep): Vec2[] => {
  const across = vec2(-c.along.y, c.along.x);
  return step.outline.map((p) => {
    const r = Math.hypot(p.x, p.y) || 1;
    const g = step.grow / r;
    const px = p.x * (1 + g);
    const py = p.y * (1 + g);
    return vec2(c.origin.x + c.along.x * px + across.x * py, c.origin.y + c.along.y * px + across.y * py); // prettier-ignore
  });
};

/**
 * What a person should check about `cavities` in `b`, said for them (fin integration):
 *
 * - a box too deep for the board above it: under 3 mm of foam left to the deck, read
 *   where the box is (a thin tail toward the rail is where a side box comes through);
 * - a box or flange within {@link MIN_RAIL_GAP} of the rail, or past it in plan;
 * - a box set across a channel's wall, its floor stepping across it.
 *
 * Empty if nothing.
 */
export const cavityProblems = (b: BezierBoard, cavities: readonly FinCavity[]): string[] => {
  const channels = boardChannels(b);
  const half = (x: number) => getWidthAtPos(b, x) / 2;
  return cavities.flatMap((c) => {
    const out: string[] = [];
    const name = `Fin ${c.fin + 1}'s ${c.kind} box`;
    const deepest = c.steps.reduce((m, s) => (s.depth > m.depth ? s : m));
    // The foam above the floor, at its thinnest over the box.
    let left = Infinity;
    for (const p of [vec2(c.origin.x, c.origin.y), ...planOutline(c, deepest)]) {
      const y = Math.abs(p.y);
      const t = deckZAt(b, p.x, y) - bottomZAt(b, p.x, y);
      if (Number.isFinite(t)) left = Math.min(left, t - deepest.depth);
    }
    if (left < MIN_SKIN) {
      out.push(`${name} leaves ${Math.max(0, left * 10).toFixed(1)} mm of board above it: it may come through the deck.`); // prettier-ignore
    }
    // The widest step (a Futures flange) nearest the rail.
    let gap = Infinity;
    for (const step of c.steps) {
      for (const p of planOutline(c, step)) gap = Math.min(gap, half(p.x) - Math.abs(p.y));
    }
    if (gap < 0) {
      out.push(`${name} reaches ${(-gap * 10).toFixed(1)} mm past the rail.`);
    } else if (gap < MIN_RAIL_GAP) {
      out.push(`${name} comes within ${(gap * 10).toFixed(1)} mm of the rail.`);
    }
    if (channels.length > 0) {
      let lo = Infinity;
      let hi = -Infinity;
      for (const p of planOutline(c, deepest)) {
        const d = channelDepthAt(channels, p.x, Math.abs(p.y));
        lo = Math.min(lo, d);
        hi = Math.max(hi, d);
      }
      if (hi - lo > CHANNEL_STEP) out.push(`${name} sits across a channel wall.`);
    }
    return out;
  });
};
