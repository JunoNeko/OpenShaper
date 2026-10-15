// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A schema-free Part 21 (STEP) reader for tests: splits the DATA section into
 * entities and parses their arguments, so a test can check the file it wrote
 * against its intent without trusting the writer. Shared by step.test.ts and
 * fin-step.test.ts.
 */
import type { BSplineSurface } from '@openshaper/kernel';

export type Value = { ref: number } | { num: number } | { str: string } | { raw: string } | Value[];

export interface Entity {
  readonly id: number;
  readonly name: string;
  readonly args: Value[];
}

/** Split a DATA section into `#id=BODY;` instances, respecting strings and nesting. */
const instances = (text: string): { id: number; body: string }[] => {
  const data = text.slice(text.indexOf('\nDATA;') + 6, text.lastIndexOf('ENDSEC;'));
  const out: { id: number; body: string }[] = [];
  let buf = '';
  let depth = 0;
  let inStr = false;
  for (let i = 0; i < data.length; i++) {
    const ch = data[i]!;
    if (inStr) {
      buf += ch;
      if (ch === "'") inStr = data[i + 1] === "'" ? ((buf += data[++i]!), true) : false;
      continue;
    }
    if (ch === "'") {
      inStr = true;
      buf += ch;
      continue;
    }
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ';' && depth === 0) {
      const m = /^\s*#(\d+)\s*=\s*([\s\S]*)$/.exec(buf);
      if (m) out.push({ id: Number(m[1]), body: m[2]!.trim() });
      buf = '';
      continue;
    }
    buf += ch;
  }
  return out;
};

/** Parse a comma-separated argument list (the text inside the outermost parens). */
const parseArgs = (src: string): Value[] => {
  let i = 0;

  const skip = (): void => {
    while (i < src.length && /[\s,]/.test(src[i]!)) i++;
  };

  const parseList = (): Value[] => {
    const items: Value[] = [];
    i++; // consume '('
    for (;;) {
      skip();
      if (i >= src.length) return items;
      if (src[i] === ')') {
        i++;
        return items;
      }
      items.push(parseValue());
    }
  };

  const parseValue = (): Value => {
    const ch = src[i]!;
    if (ch === '(') return parseList();
    if (ch === "'") {
      let s = '';
      i++;
      while (i < src.length) {
        if (src[i] === "'") {
          if (src[i + 1] === "'") {
            s += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        s += src[i++]!;
      }
      return { str: s };
    }
    if (ch === '#') {
      let n = '';
      i++;
      while (i < src.length && /\d/.test(src[i]!)) n += src[i++]!;
      return { ref: Number(n) };
    }
    // A typed parameter, e.g. LENGTH_MEASURE(25.4): keep the name and step over
    // its balanced parens. Nothing here needs to look inside one.
    if (/[A-Za-z_]/.test(ch)) {
      let name = '';
      while (i < src.length && /[A-Za-z0-9_]/.test(src[i]!)) name += src[i++]!;
      skipSpace();
      if (src[i] === '(') {
        let depth = 0;
        do {
          if (src[i] === '(') depth++;
          else if (src[i] === ')') depth--;
          i++;
        } while (i < src.length && depth > 0);
      }
      return { raw: name };
    }
    let tok = '';
    while (i < src.length && !/[,)]/.test(src[i]!)) tok += src[i++]!;
    // Never return without consuming something, or the scanner spins forever.
    if (tok === '') {
      i++;
      return { raw: ch };
    }
    tok = tok.trim();
    return /^-?[\d.]/.test(tok) && !Number.isNaN(Number(tok)) ? { num: Number(tok) } : { raw: tok };
  };

  const skipSpace = (): void => {
    while (i < src.length && /\s/.test(src[i]!)) i++;
  };

  const items: Value[] = [];
  while (i < src.length) {
    skip();
    if (i >= src.length) break;
    items.push(parseValue());
  }
  return items;
};

export const parse = (text: string): Map<number, Entity> => {
  const map = new Map<number, Entity>();
  for (const { id, body } of instances(text)) {
    // Simple entity `NAME(...)`; complex entities `(A(..)B(..))` keep their whole
    // body as the name, which is all these tests need of them.
    const m = /^([A-Z0-9_]+)\s*\(([\s\S]*)\)$/.exec(body);
    if (m) map.set(id, { id, name: m[1]!, args: parseArgs(m[2]!) });
    else map.set(id, { id, name: body, args: [] });
  }
  return map;
};

export const isRef = (v: Value | undefined): v is { ref: number } =>
  typeof v === 'object' && v !== null && 'ref' in v;
export const isNum = (v: Value | undefined): v is { num: number } =>
  typeof v === 'object' && v !== null && 'num' in v;
export const asList = (v: Value | undefined): Value[] => (Array.isArray(v) ? v : []);
export const nums = (v: Value | undefined): number[] =>
  asList(v)
    .filter(isNum)
    .map((n) => n.num);

/** Coordinates of a CARTESIAN_POINT, resolved in the map it came from. */
export const pointIn = (map: Map<number, Entity>, id: number) => {
  const [x, y, z] = nums(map.get(id)!.args[1]);
  return { x: x!, y: y!, z: z! };
};

/**
 * Rebuild a kernel surface from an emitted B_SPLINE_SURFACE_WITH_KNOTS.
 *
 * Takes the map explicitly: the refs inside an entity only mean anything relative
 * to the file it came from, and resolving them against a different one silently
 * yields a plausible surface at the wrong scale.
 */
export const decodeSurface = (e: Entity, map: Map<number, Entity>, scale = 1): BSplineSurface => {
  const uDegree = isNum(e.args[1]) ? e.args[1].num : 0;
  const vDegree = isNum(e.args[2]) ? e.args[2].num : 0;
  const ctrl = asList(e.args[3]).map((row) =>
    asList(row)
      .filter(isRef)
      .map((r) => {
        const p = pointIn(map, r.ref);
        return { x: p.x * scale, y: p.y * scale, z: p.z * scale };
      }),
  );
  const expand = (mults: number[], values: number[]): number[] =>
    mults.flatMap((m, i) => Array.from({ length: m }, () => values[i]!));
  return {
    uDegree,
    vDegree,
    ctrl,
    uKnots: expand(nums(e.args[8]), nums(e.args[10])),
    vKnots: expand(nums(e.args[9]), nums(e.args[11])),
  };
};
