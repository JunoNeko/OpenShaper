// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The tab a fin sits on: its base. Two Futures tabs (futures-tab.ts) and the FCS single
 * tab that plugs into an FCS 1 style single plug (small canard fins).
 *
 * All share one frame (cm): x from the tab's rear end at 0 toward the nose, y up from
 * the tab bottom to its top at `height` (the blade root plane), extruded `thickness`
 * across, centred on its mid-plane. The outline of a fin is in this frame, so it places
 * the fin fore and aft on its tab.
 */
import { vec2 } from '../vec2';
import {
  FUTURES_TABS,
  futuresTabOutline,
  type FuturesTabKind,
  type TabSegment,
} from './futures-tab';

/** Which tab the fin sits on. */
export type FinBase = 'futures-side' | 'futures-centre' | 'fcs-single';

export const FIN_BASES: readonly FinBase[] = ['futures-side', 'futures-centre', 'fcs-single'];

/** What the designer calls each base. */
export const FIN_BASE_LABEL: Record<FinBase, string> = {
  'futures-side': 'Futures 3/4"',
  'futures-centre': 'Futures 1/2"',
  'fcs-single': 'FCS single tab',
};

/** The Futures tab a base is, or null for one that isn't Futures. */
export const futuresKind = (base: FinBase): FuturesTabKind | null =>
  base === 'futures-side' ? 'side' : base === 'futures-centre' ? 'centre' : null;

/**
 * The FCS single tab (cm): a plain block, held by a grub screw in the side of the plug,
 * so it needs no notch or slot. It drops straight in: no rocking, so no rear clearance
 * and no front grub screw to keep clear of. Cant comes from the plug (0°, 5° or 9°), so
 * the fin itself has none.
 */
export const FCS_SINGLE_TAB = { length: 2.05, height: 1.35, thickness: 0.635 } as const;

/** A tab's side profile and size, in the frame above. */
export interface FinTabOutline {
  readonly base: FinBase;
  readonly length: number;
  readonly height: number;
  readonly thickness: number;
  /** Closed, counter-clockwise (material on the left): lines and arcs. */
  readonly segments: readonly TabSegment[];
}

export const finTabOutline = (base: FinBase): FinTabOutline => {
  const kind = futuresKind(base);
  if (kind) {
    const spec = FUTURES_TABS[kind];
    return {
      base,
      length: spec.length,
      height: spec.height,
      thickness: spec.thickness,
      segments: futuresTabOutline(kind).segments,
    };
  }
  const { length: L, height: H, thickness } = FCS_SINGLE_TAB;
  const corners = [vec2(0, 0), vec2(L, 0), vec2(L, H), vec2(0, H)];
  return {
    base,
    length: L,
    height: H,
    thickness,
    segments: corners.map((from, i) => ({
      kind: 'line' as const,
      from,
      to: corners[(i + 1) % corners.length]!,
    })),
  };
};
