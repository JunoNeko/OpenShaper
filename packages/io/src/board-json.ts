import {
  FIN_SETUPS,
  board,
  crossSection,
  defaultFinConfig,
  noFins,
  type BezierBoard,
  type FinConfig,
  type FinSetup,
} from '@openshaper/kernel';
import {
  assertKnots as assertKnotsAs,
  isObject,
  splineFromJson,
  splineToJson,
  type KnotJson,
} from './knot-json';

/**
 * Native OpenShaper document format (`.board.json`) — a clean, versioned,
 * lossless serialization of a kernel BezierBoard. Unlike the legacy `.brd` text
 * format this is schema-stable and round-trips exactly.
 *
 * The `format` marker is written as `'openshaper'`; documents written by the
 * project's former name (`'board-studio'`) are still accepted on read.
 *
 * Version history:
 *   1 — outline/bottom/deck/crossSections + interpolationType + metadata.
 *   2 — adds the parametric `fins` config. Older docs (v1, or any doc carrying a
 *       legacy `metadata.finType`) are migrated on read via `defaultFinConfig`.
 *       Later, still 2: a locked knot carries an optional `l` (its fixed handle
 *       directions). The field is written only for locked knots, so a board without
 *       locks serializes exactly as before, and a reader that predates it ignores it.
 */
export const BOARD_JSON_VERSION = 2;

interface CrossSectionJson {
  position: number;
  knots: KnotJson[];
}
export interface BoardJson {
  format: 'openshaper' | 'board-studio';
  version: number;
  interpolationType: BezierBoard['interpolationType'];
  outline: KnotJson[];
  bottom: KnotJson[];
  deck: KnotJson[];
  crossSections: CrossSectionJson[];
  /** Parametric fin configuration (v2+). Omitted when there are no fins. */
  fins?: FinConfig;
  metadata?: Record<string, unknown>;
}

/**
 * Resolve the fin config for a parsed document: prefer an explicit v2 `fins` block;
 * otherwise migrate a legacy `metadata.finType` setup name to a default config; else
 * no fins.
 */
const finConfigFromDoc = (doc: BoardJson): FinConfig => {
  if (doc.fins && Array.isArray(doc.fins.fins)) {
    // `symmetrical` was added after the v2 `fins` block; default older docs to true.
    return { ...doc.fins, symmetrical: doc.fins.symmetrical ?? true };
  }
  const legacy = doc.metadata?.finType;
  if (typeof legacy === 'string' && (FIN_SETUPS as readonly string[]).includes(legacy)) {
    return defaultFinConfig(legacy as FinSetup, 'fcs-ii');
  }
  return noFins();
};

/** Serialize a board to a `.board.json` string. */
export const writeBoardJson = (b: BezierBoard, metadata?: Record<string, unknown>): string => {
  const doc: BoardJson = {
    format: 'openshaper',
    version: BOARD_JSON_VERSION,
    interpolationType: b.interpolationType,
    outline: splineToJson(b.outline),
    bottom: splineToJson(b.bottom),
    deck: splineToJson(b.deck),
    crossSections: b.crossSections.map((cs) => ({
      position: cs.position,
      knots: splineToJson(cs.spline),
    })),
    ...(b.fins.setup !== 'none' ? { fins: b.fins } : {}),
    ...(metadata ? { metadata } : {}),
  };
  return JSON.stringify(doc, null, 2);
};

export class BoardJsonError extends Error {}

const assertKnots = (v: unknown, where: string): void => assertKnotsAs(v, where, BoardJsonError);

const assertStructure = (doc: Record<string, unknown>): void => {
  for (const curve of ['outline', 'bottom', 'deck'] as const) assertKnots(doc[curve], curve);
  if (!Array.isArray(doc.crossSections)) {
    throw new BoardJsonError('Malformed document: crossSections is missing');
  }
  doc.crossSections.forEach((cs: unknown, i) => {
    const where = `cross-section ${i + 1}`;
    if (!isObject(cs) || typeof cs.position !== 'number' || !Number.isFinite(cs.position)) {
      throw new BoardJsonError(`Malformed document: ${where} has no valid position`);
    }
    assertKnots(cs.knots, where);
  });
};

/** Parse a `.board.json` string back into a board (+ any metadata). */
export const readBoardJson = (
  text: string,
): { board: BezierBoard; metadata?: Record<string, unknown> } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    throw new BoardJsonError(`Not valid JSON: ${(e as Error).message}`);
  }
  if (!isObject(parsed)) {
    throw new BoardJsonError('Not an OpenShaper document (missing format marker)');
  }
  const doc = parsed as unknown as BoardJson;
  if (doc.format !== 'openshaper' && doc.format !== 'board-studio') {
    throw new BoardJsonError('Not an OpenShaper document (missing format marker)');
  }
  if (doc.version > BOARD_JSON_VERSION) {
    throw new BoardJsonError(
      `Document version ${doc.version} is newer than supported (${BOARD_JSON_VERSION})`,
    );
  }
  assertStructure(parsed);
  const b = board(
    splineFromJson(doc.outline),
    splineFromJson(doc.bottom),
    splineFromJson(doc.deck),
    doc.crossSections.map((cs) => crossSection(cs.position, splineFromJson(cs.knots))),
    doc.interpolationType ?? 'controlPoint',
    finConfigFromDoc(doc),
  );
  return doc.metadata ? { board: b, metadata: doc.metadata } : { board: b };
};
