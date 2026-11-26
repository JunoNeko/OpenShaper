// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * My fins (fin integration, phase 2): a person's own fins, kept in this browser for
 * any board. Each is the `.fin.json` text OpenFinShaper saves, with a name. Fins come in
 * from the OpenFinShaper round trip (Apply to board), from OpenFinShaper's "Add to My
 * fins", and from imported `.fin.json` files; the board's fin chooser lists them.
 *
 * Like the other stores (session-store.ts, fin-session.ts), every function swallows
 * storage failures (private browsing, denied quota, no IndexedDB): the library is then
 * simply empty.
 */
import { readFinJson, writeFinJson } from '@openshaper/io';
import type { FinDesign } from '@openshaper/kernel';
import { useCallback, useEffect, useState } from 'react';
import { objectStore, openSingleStoreDb, promisify } from './idb';

const DB_NAME = 'bs.my-fins';
const STORE_NAME = 'fins';
const VERSION = 1;

interface StoredFin {
  id: string;
  name: string;
  finJson: string;
  savedAt: number;
}

/** A fin in the library, read back. */
export interface MyFin {
  readonly id: string;
  readonly name: string;
  readonly design: FinDesign;
  readonly savedAt: number;
}

const factoryOf = (factory?: IDBFactory): IDBFactory | undefined =>
  factory ?? (typeof indexedDB === 'undefined' ? undefined : indexedDB);

const withStore = async <T>(
  mode: IDBTransactionMode,
  run: (store: IDBObjectStore) => Promise<T>,
  factory?: IDBFactory,
): Promise<T | undefined> => {
  const f = factoryOf(factory);
  if (!f) return undefined;
  try {
    const db = await openSingleStoreDb(f, DB_NAME, VERSION, STORE_NAME, 'id');
    try {
      return await run(objectStore(db, STORE_NAME, mode));
    } finally {
      db.close();
    }
  } catch {
    return undefined;
  }
};

const newId = (): string => `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;

/** Add `design` named `name`; its id, or undefined if it couldn't be stored. */
export const addMyFin = async (
  name: string,
  design: FinDesign,
  factory?: IDBFactory,
): Promise<string | undefined> => {
  const rec: StoredFin = { id: newId(), name, finJson: writeFinJson(design), savedAt: Date.now() };
  const done = await withStore('readwrite', (s) => promisify(s.put(rec)), factory);
  if (done === undefined) return undefined;
  notify();
  return rec.id;
};

/** Remove the fin with `id`. */
export const removeMyFin = async (id: string, factory?: IDBFactory): Promise<void> => {
  await withStore('readwrite', (s) => promisify(s.delete(id)), factory);
  notify();
};

/** Every fin in the library, newest first. A record that won't read is left out. */
export const listMyFins = async (factory?: IDBFactory): Promise<MyFin[]> => {
  const all = (await withStore('readonly', (s) => promisify(s.getAll() as IDBRequest<StoredFin[]>), factory)) ?? []; // prettier-ignore
  const fins: MyFin[] = [];
  for (const r of all) {
    try {
      fins.push({
        id: r.id,
        name: r.name,
        design: readFinJson(r.finJson).design,
        savedAt: r.savedAt,
      });
    } catch {
      // A damaged record: skipped.
    }
  }
  return fins.sort((a, b) => b.savedAt - a.savedAt);
};

/** A name for a fin with none: "Side fin, 17 Nov 14:05". */
export const defaultFinName = (d: FinDesign, at = new Date()): string => {
  const what = d.position === 'centre' ? 'Centre fin' : d.position === 'quad-rear' ? 'Quad rear' : 'Side fin'; // prettier-ignore
  const when = at.toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }); // prettier-ignore
  return `${what}, ${when}`;
};

// Every open list re-reads when the library changes.
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((l) => l());

/** The library, kept current; and a way to read it again. */
export function useMyFins(factory?: IDBFactory): { fins: MyFin[]; reload: () => void } {
  const [fins, setFins] = useState<MyFin[]>([]);
  const reload = useCallback(() => {
    void listMyFins(factory).then(setFins);
  }, [factory]);
  useEffect(() => {
    reload();
    listeners.add(reload);
    return () => {
      listeners.delete(reload);
    };
  }, [reload]);
  return { fins, reload };
}
