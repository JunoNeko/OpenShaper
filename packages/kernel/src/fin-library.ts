// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The generic fins a board can be given (fin integration, phase 1): OpenFinShaper
 * designs, in sets for each setup and in three sizes.
 *
 * Every fin on a board is a fin design (`fin-design/`), the same thing OpenFinShaper
 * edits, so a generic fin and a person's own are one kind of fin. The library makes them
 * from OpenFinShaper's starting fins (`fin-defaults.ts`): sized to S, M or L, and set on
 * the tab the board's fin system takes (`placeOnBase`).
 *
 * - **Roles:** each fin of a setup is a side (thruster sides, quad and 5-fin fronts,
 *   twins, 2+1 sides), a rear (quad and 5-fin rears) or a centre fin.
 * - **Sizes:** M is a common medium; S and L are 6 % smaller and larger in depth. The
 *   base grows by 80 % as much, as real fin sizes do, and less if the fin would
 *   otherwise overhang its tab (it is checked with the designer's own rules).
 * - **Tabs:** Futures sides on the 3/4" tab, rears and centres on the 1/2"; FCS II and
 *   X-2 on FCS 1 tabs (both plugs take them); a single, or a 2+1's centre, on a US box
 *   whatever the system, as such boards are built. Glass-on fins keep a tab the 3D view
 *   leaves off. A twinzer's canards stand in FCS single plugs whatever its twins' system
 *   (`FinConfig.canardBox`).
 */
import { splineFromKnots, type Spline } from './bezier-spline';
import { knot } from './knot';
import { vec2, type Vec2 } from './vec2';
import {
  defaultCanard,
  defaultFinDesign,
  defaultKeel,
  defaultSingleFin,
  defaultTwinFin,
} from './fin-design/fin-defaults';
import { finMinThickness, type FinDesign, type FinHand } from './fin-design/fin-design';
import { placeOnBase } from './fin-design/fin-placement';
import { validateFinDesign } from './fin-design/fin-rules';
import type { FinBase } from './fin-design/fin-tab';
import {
  defaultFinConfig,
  finGroups,
  mirrorFinIndex,
  plugCantFor,
  withFinDesign,
  type FinConfig,
  type FinSetup,
  type FinSpec,
  type CanardBox,
  type FinSystem,
  type PlugCant,
  type PlugCantGroup,
} from './fins';

export type FinSize = 'S' | 'M' | 'L';
export const FIN_SIZES: readonly FinSize[] = ['S', 'M', 'L'];

/** What a fin does on its board. */
export type FinRole = 'side' | 'rear' | 'centre' | 'canard';

/** A fin in the library, before it is sized and set on a tab. */
export interface LibraryFin {
  readonly id: string;
  readonly label: string;
  /** Which fins of a board it can be. */
  readonly roles: readonly FinRole[];
  /** Always on a US box, whatever the board's system (singles, a 2+1's centre). */
  readonly usBox?: boolean;
  /** Its M size, for the hand given (ignored by a centre fin). */
  readonly make: (hand: FinHand) => FinDesign;
  /** Depth scale of M over the design `make` returns. */
  readonly scaleM: number;
}

/** OpenFinShaper's starting thruster fins are already M (~111–112 mm); quad rear is 80 mm. */
export const LIBRARY_FINS: readonly LibraryFin[] = [
  { id: 'thruster-side', label: 'Thruster side', roles: ['side'], make: (h) => defaultFinDesign('side', h), scaleM: 1 }, // prettier-ignore
  { id: 'thruster-centre', label: 'Thruster centre', roles: ['centre'], make: () => defaultFinDesign('centre'), scaleM: 1 }, // prettier-ignore
  { id: 'quad-rear', label: 'Quad rear', roles: ['rear'], make: (h) => defaultFinDesign('quad-rear', h), scaleM: 1.2 }, // prettier-ignore
  { id: 'twin', label: 'Twin', roles: ['side'], make: (h) => defaultTwinFin(h), scaleM: 1 },
  { id: 'keel', label: 'Keel', roles: ['side'], make: (h) => defaultKeel(h), scaleM: 1 },
  { id: 'side-bite', label: '2+1 side bite', roles: ['side'], make: (h) => defaultFinDesign('side', h), scaleM: 0.85 }, // prettier-ignore
  { id: 'single', label: 'Single', roles: ['centre'], usBox: true, make: () => defaultSingleFin(), scaleM: 1 }, // prettier-ignore
  { id: 'canard', label: 'Canard', roles: ['canard'], make: (h) => defaultCanard(h), scaleM: 1 },
];

export const libraryFin = (id: string): LibraryFin | undefined =>
  LIBRARY_FINS.find((f) => f.id === id);

/** A set of fins for a setup: which library fin each role takes. */
export interface FinSet {
  readonly id: string;
  readonly label: string;
  readonly setups: readonly FinSetup[];
  readonly fins: Partial<Record<FinRole, string>>;
}

export const FIN_SETS: readonly FinSet[] = [
  { id: 'thruster', label: 'Thruster', setups: ['thruster'], fins: { side: 'thruster-side', centre: 'thruster-centre' } }, // prettier-ignore
  { id: 'quad', label: 'Quad', setups: ['quad'], fins: { side: 'thruster-side', rear: 'quad-rear' } }, // prettier-ignore
  { id: 'five', label: 'Five-fin', setups: ['5-fin'], fins: { side: 'thruster-side', rear: 'quad-rear', centre: 'thruster-centre' } }, // prettier-ignore
  { id: 'twin', label: 'Twin', setups: ['twin'], fins: { side: 'twin' } },
  { id: 'keel', label: 'Keel', setups: ['twin'], fins: { side: 'keel' } },
  { id: 'two-plus-one', label: '2+1', setups: ['2+1'], fins: { side: 'side-bite', centre: 'single' } }, // prettier-ignore
  { id: 'single', label: 'Single', setups: ['single'], fins: { centre: 'single' } },
  { id: 'twinzer', label: 'Twinzer', setups: ['twinzer'], fins: { side: 'twin', canard: 'canard' } }, // prettier-ignore
];

/** The sets for a setup, the first its default. */
export const finSetsFor = (setup: FinSetup): FinSet[] =>
  FIN_SETS.filter((s) => s.setups.includes(setup));

/** The roles of a setup's fins, in the order `defaultFinConfig` lays them out. */
export const finRoles = (setup: FinSetup): FinRole[] => finGroups(setup);

/** The tab a role's fin takes in a fin system. */
export const baseFor = (system: FinSystem, role: FinRole, usBox = false): FinBase => {
  if (role === 'canard') return 'fcs-single';
  if (usBox) return 'us-box';
  if (system === 'fcs-ii' || system === 'fcs-x2') return 'fcs-1';
  return role === 'side' ? 'futures-side' : 'futures-centre';
};

/** Depth scale of each size over M. */
const SIZE_SCALE: Record<FinSize, number> = { S: 0.94, M: 1, L: 1.06 };
/** How much of the depth's growth the base takes. */
const BASE_SHARE = 0.8;

/** A spline with every point mapped through `f`. */
const mapSpline = (s: Spline, f: (p: Vec2) => Vec2): Spline =>
  splineFromKnots(
    s.knots.map((k) => knot(f(k.end), f(k.tangentToPrev), f(k.tangentToNext), k.continuous, k.other)), // prettier-ignore
  );

/**
 * `d` scaled about its trailing-edge root: `depth` times as deep, its thickness over the
 * minimum `depth` times as thick, `base` times as long. Rear alignment on the tab is kept.
 */
export const scaleFin = (d: FinDesign, depth: number, base: number): FinDesign => {
  const knots = d.outline.knots;
  const te = knots[knots.length - 1]!.end.x;
  const min = finMinThickness(d);
  return {
    ...d,
    outline: mapSpline(d.outline, (p) => vec2(te + (p.x - te) * base, p.y * depth)),
    // The thickness over the minimum scales, so a smaller fin's tip stays buildable.
    taper: mapSpline(d.taper, (p) => vec2(p.x, min + (p.y - min) * depth)),
  };
};

/**
 * Library fin `id` at `size`, for the board side `side` (−1, 0, +1) and set on the tab
 * its role takes in `system`. Null for an unknown id.
 */
export const makeLibraryFin = (
  id: string,
  size: FinSize,
  side: -1 | 0 | 1,
  system: FinSystem,
  role: FinRole,
): FinDesign | null => {
  const lib = libraryFin(id);
  if (!lib) return null;
  const hand: FinHand = side > 0 ? 'right' : 'left';
  const raw = lib.make(hand);
  const base = baseFor(system, role, lib.usBox);
  // The base grows less than the depth; less still if it would overhang its tab. And
  // where a size still breaks a rule (a small keel's raised rear too low to clear the
  // board as a Futures fin rocks in), it steps back toward M until it doesn't.
  for (const reach of [1, 0.75, 0.5, 0.25, 0]) {
    const depth = lib.scaleM * (1 + reach * (SIZE_SCALE[size] - 1));
    for (const share of [BASE_SHARE, 0.6, 0.4, 0.2, 0]) {
      const d = placeOnBase(scaleFin(raw, depth, 1 + share * (depth - 1)), base);
      if (validateFinDesign(d).length === 0) return d;
    }
  }
  return placeOnBase(scaleFin(raw, lib.scaleM, 1), base);
};

// --- a board's fins from the library -----------------------------------------

/** The library fin a set gives a group, or the usual one for it. */
const setFinFor = (set: FinSet | undefined, role: FinRole): string =>
  set?.fins[role] ?? usualFin(role);

/** The usual library fin for a role. */
export const usualFin = (role: FinRole): string =>
  role === 'rear' ? 'quad-rear' : role === 'centre' ? 'thruster-centre' : role === 'canard' ? 'canard' : 'thruster-side'; // prettier-ignore

/** `cfg` with fin `i` given library fin `id` at `size`, set on its tab. */
const fromLibrary = (cfg: FinConfig, i: number, id: string, size: FinSize): FinSpec => {
  const spec = cfg.fins[i]!;
  const role = finGroups(cfg.setup)[i] ?? 'side';
  const d = makeLibraryFin(id, size, spec.side, cfg.system, role);
  return d ? withFinDesign(spec, d, plugCantFor(cfg, role), { fin: id, size }) : spec;
};

/** Every fin of `cfg` from set `setId` at `size` (placement kept). */
export const withFinSet = (cfg: FinConfig, setId: string, size: FinSize): FinConfig => {
  const set = FIN_SETS.find((s) => s.id === setId);
  const roles = finGroups(cfg.setup);
  return {
    ...cfg,
    fins: cfg.fins.map((_, i) => fromLibrary(cfg, i, setFinFor(set, roles[i] ?? 'side'), size)),
  };
};

/** A new setup's fins: standard placement, its first set at M. */
export const defaultBoardFins = (setup: FinSetup, system: FinSystem): FinConfig => {
  const cfg = defaultFinConfig(setup, system);
  const first = finSetsFor(setup)[0];
  return first ? withFinSet(cfg, first.id, 'M') : cfg;
};

/** The fins `i` changes along with: itself, and its mirror when the pair is kept matched. */
const pairOf = (cfg: FinConfig, i: number): number[] => {
  const m = cfg.symmetrical ? mirrorFinIndex(cfg.fins, i) : null;
  return m === null ? [i] : [i, m];
};

/** Fin `i` (and its mirror, if matched) as library fin `id` at `size`. */
export const withLibraryFin = (cfg: FinConfig, i: number, id: string, size: FinSize): FinConfig => {
  const which = pairOf(cfg, i);
  return { ...cfg, fins: cfg.fins.map((f, j) => (which.includes(j) ? fromLibrary(cfg, j, id, size) : f)) }; // prettier-ignore
};

/**
 * Fin `i` (and its mirror, if matched) given design `d`, a person's own: handed for each
 * fin's side and set on the tab its role takes in the board's system.
 */
export const withOwnFin = (cfg: FinConfig, i: number, d: FinDesign, name?: string): FinConfig => {
  const roles = finGroups(cfg.setup);
  const which = pairOf(cfg, i);
  return {
    ...cfg,
    fins: cfg.fins.map((f, j) => {
      if (!which.includes(j)) return f;
      const role = roles[j] ?? 'side';
      const hand: FinHand | null = d.hand === null ? null : f.side > 0 ? 'right' : 'left';
      const placed = placeOnBase({ ...d, hand }, baseFor(cfg.system, role, d.base === 'us-box'));
      const spec = withFinDesign(f, placed, plugCantFor(cfg, role));
      return name ? { ...spec, name } : spec;
    }),
  };
};

/**
 * `cfg` on fin system `system`: library fins remade for their new tabs, a person's own
 * moved onto them (`placeOnBase`), plug cants as the system has them.
 */
export const withFinSystem = (cfg: FinConfig, system: FinSystem): FinConfig => {
  const next: FinConfig = { ...cfg, system };
  const roles = finGroups(cfg.setup);
  return {
    ...next,
    fins: next.fins.map((f, i) => {
      if (!f.design) return f;
      if (f.library) return fromLibrary(next, i, f.library.fin, f.library.size);
      const role = roles[i] ?? 'side';
      const d = placeOnBase(f.design, baseFor(system, role, f.design.base === 'us-box'));
      const spec = withFinDesign(f, d, plugCantFor(next, role));
      return f.name ? { ...spec, name: f.name } : spec;
    }),
  };
};

/** `cfg` with a twinzer's canard box: the canards re-seated on it, as `withFinSystem` does. */
export const withCanardBox = (cfg: FinConfig, canardBox: CanardBox): FinConfig =>
  withFinSystem({ ...cfg, canardBox }, cfg.system);

/** `cfg` with an FCS plug cant set: the front sides', the rears' or a twinzer's canards'. */
export const withPlugCant = (cfg: FinConfig, which: PlugCantGroup, cant: PlugCant): FinConfig => {
  const plugCant = { ...cfg.plugCant, front: cfg.plugCant?.front ?? 5, rear: cfg.plugCant?.rear ?? 5, [which]: cant }; // prettier-ignore
  const next: FinConfig = { ...cfg, plugCant };
  const roles = finGroups(cfg.setup);
  return {
    ...next,
    fins: next.fins.map((f, i) => {
      if (!f.design) return f;
      const spec = withFinDesign(f, f.design, plugCantFor(next, roles[i]), f.library);
      return f.name ? { ...spec, name: f.name } : spec;
    }),
  };
};

/** What fin `i` is, as the chooser names it: "Thruster side M", or "Own design". */
export const finLabel = (spec: FinSpec): string => {
  if (!spec.design) return 'Generic (older board)';
  const lib = spec.library && libraryFin(spec.library.fin);
  return lib ? `${lib.label} ${spec.library!.size}` : (spec.name ?? 'Own design');
};

/** The set every fin of `cfg` comes from at one size, if they all do. */
export const finSetOf = (cfg: FinConfig): { set: FinSet; size: FinSize } | null => {
  const roles = finGroups(cfg.setup);
  for (const set of finSetsFor(cfg.setup)) {
    const size = cfg.fins[0]?.library?.size;
    if (!size) return null;
    const all = cfg.fins.every(
      (f, i) => f.library?.size === size && f.library.fin === setFinFor(set, roles[i] ?? 'side'),
    );
    if (all) return { set, size };
  }
  return null;
};

/** The OpenFinShaper position a fin of `role` is designed as. */
export const positionFor = (role: FinRole): FinDesign['position'] =>
  role === 'rear' ? 'quad-rear' : role === 'centre' ? 'centre' : 'side';
