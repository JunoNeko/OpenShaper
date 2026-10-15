// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The JSON form of a spline's knots, shared by the native documents (`.board.json`,
 * `.fin.json`): compact point tuples, flags, and an optional handle-angle lock. Moved
 * out of board-json.ts unchanged, so board documents serialize exactly as before.
 */
import {
  knot,
  knotLock,
  splineFromKnots,
  vec2,
  type Knot,
  type KnotLock,
  type Spline,
  type Vec2,
} from '@openshaper/kernel';

export type Vec2Tuple = [number, number];
export interface KnotJson {
  e: Vec2Tuple; // endpoint
  p: Vec2Tuple; // tangent to prev
  n: Vec2Tuple; // tangent to next
  c: boolean; // continuous
  o: boolean; // "other" flag
  l?: KnotLockJson; // handle-angle lock; written only for a locked knot
}
export interface KnotLockJson {
  p?: Vec2Tuple; // locked direction of the tangent to prev (unit vector)
  n?: Vec2Tuple; // locked direction of the tangent to next (unit vector)
}

export const lockToJson = (lock: KnotLock): KnotLockJson => ({
  ...(lock.prev ? { p: [lock.prev.x, lock.prev.y] } : {}),
  ...(lock.next ? { n: [lock.next.x, lock.next.y] } : {}),
});

export const knotToJson = (k: Knot): KnotJson => ({
  e: [k.end.x, k.end.y],
  p: [k.tangentToPrev.x, k.tangentToPrev.y],
  n: [k.tangentToNext.x, k.tangentToNext.y],
  c: k.continuous,
  o: k.other,
  ...(k.lock ? { l: lockToJson(k.lock) } : {}),
});

/**
 * A stored lock direction as a unit vector. One written by this module is already
 * unit and is kept bit-for-bit, so a save round-trips exactly; a hand-edited one is
 * normalized, and a zero one is dropped.
 */
export const lockDirectionFromJson = (v: Vec2Tuple | undefined): Vec2 | undefined => {
  if (!v) return undefined;
  const len = Math.hypot(v[0], v[1]);
  if (len <= 1e-12) return undefined;
  return Math.abs(len - 1) <= 1e-9 ? vec2(v[0], v[1]) : vec2(v[0] / len, v[1] / len);
};

export const lockFromJson = (l: KnotLockJson | undefined): KnotLock | undefined =>
  knotLock(lockDirectionFromJson(l?.p), lockDirectionFromJson(l?.n));

export const knotFromJson = (j: KnotJson): Knot =>
  knot(
    vec2(j.e[0], j.e[1]),
    vec2(j.p[0], j.p[1]),
    vec2(j.n[0], j.n[1]),
    j.c,
    j.o,
    lockFromJson(j.l),
  );

export const splineToJson = (s: Spline): KnotJson[] => s.knots.map(knotToJson);
export const splineFromJson = (ks: KnotJson[]): Spline => splineFromKnots(ks.map(knotFromJson));

export const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

export const isPoint = (v: unknown): boolean =>
  Array.isArray(v) && v.length === 2 && v.every((n) => typeof n === 'number' && Number.isFinite(n));

/** Optional flags: absent is tolerated (older or hand-written files), wrong types are not. */
export const isFlag = (v: unknown): boolean => v === undefined || typeof v === 'boolean';

/** An optional lock: absent, or an object whose directions, where given, are points. */
export const isLock = (v: unknown): boolean =>
  v === undefined ||
  (isObject(v) && (v.p === undefined || isPoint(v.p)) && (v.n === undefined || isPoint(v.n)));

/**
 * Check the shape of a curve before any of it reaches the kernel, so a damaged or
 * hand-edited file fails with a message instead of a TypeError or a board with
 * NaN knots.
 */
export const assertKnots = (
  v: unknown,
  where: string,
  Fail: new (message: string) => Error,
): void => {
  if (!Array.isArray(v)) throw new Fail(`Malformed document: ${where} is missing`);
  v.forEach((k: unknown, i) => {
    const at = `${where} point ${i + 1}`;
    if (!isObject(k)) throw new Fail(`Malformed document: ${at} is not a point`);
    for (const key of ['e', 'p', 'n'] as const) {
      if (!isPoint(k[key])) {
        throw new Fail(`Malformed document: ${at} has an invalid coordinate`);
      }
    }
    if (!isFlag(k.c) || !isFlag(k.o)) {
      throw new Fail(`Malformed document: ${at} has an invalid flag`);
    }
    if (!isLock(k.l)) {
      throw new Fail(`Malformed document: ${at} has an invalid handle lock`);
    }
  });
};
