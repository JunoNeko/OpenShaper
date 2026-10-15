// SPDX-License-Identifier: GPL-3.0-or-later
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { FIN_SESSION_VERSION, loadFinSession, saveFinSession } from './fin-session';

describe('fin session', () => {
  it('round-trips the fin text', async () => {
    const f = new IDBFactory();
    expect(await loadFinSession(f)).toBeUndefined();
    await saveFinSession('{"fin":1}', f);
    expect(await loadFinSession(f)).toBe('{"fin":1}');
    await saveFinSession('{"fin":2}', f); // one record, replaced
    expect(await loadFinSession(f)).toBe('{"fin":2}');
  });

  it('ignores a record from another schema version', async () => {
    const f = new IDBFactory();
    await saveFinSession('{}', f);
    const db = await new Promise<IDBDatabase>((resolve) => {
      const r = f.open('bs.fin-session', FIN_SESSION_VERSION);
      r.onsuccess = () => resolve(r.result);
    });
    await new Promise((resolve) => {
      const tx = db.transaction('session', 'readwrite');
      tx.objectStore('session').put({ key: 'current', version: 99, finJson: '{}', savedAt: 0 });
      tx.oncomplete = resolve;
    });
    db.close();
    expect(await loadFinSession(f)).toBeUndefined();
  });

  it('degrades to nothing without IndexedDB', async () => {
    await expect(saveFinSession('{}')).resolves.toBeUndefined();
    await expect(loadFinSession()).resolves.toBeUndefined();
  });
});
