// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Restore the fin from the autosave on open, then autosave after every finished
 * edit (debounced, and flushed when the tab is hidden or closed). Mirrors the board
 * editor's session autosave in App.tsx, including its two lessons:
 * - nothing is saved until the restore has finished, or a default fin would
 *   overwrite the stored one;
 * - a pending save is cancelled on unmount, since the store outlives the page.
 *
 * If the store already holds a fin (the page was left and reopened within the
 * session), that newer fin is kept and nothing is restored.
 */
import { readFinJson, writeFinJson } from '@openshaper/io';
import type { FinState } from '@openshaper/store';
import { useEffect, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { loadFinSession, saveFinSession } from './fin-session';

/** How long edits must pause before they are saved (ms). */
export const FIN_AUTOSAVE_MS = 800;

/** Returns whether the restore has finished (the designer is ready to edit). */
export function useFinAutosave(store: StoreApi<FinState>, factory?: IDBFactory): boolean {
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let cancelled = false;
    const done = () => {
      if (!cancelled) setHydrated(true);
    };
    if (store.getState().design) {
      done();
      return;
    }
    void loadFinSession(factory).then((text) => {
      if (cancelled) return;
      let restored = null;
      if (text) {
        try {
          restored = readFinJson(text).design;
        } catch {
          // A damaged autosave is dropped: start from a default fin instead.
        }
      }
      if (restored) store.getState().load(restored);
      else if (!store.getState().design) store.getState().newFin('side', 'left');
      done();
    });
    return () => {
      cancelled = true;
    };
  }, [store, factory]);

  useEffect(() => {
    if (!hydrated) return;
    let timer: number | undefined;
    const save = () => {
      timer = undefined;
      const d = store.getState().design;
      if (d) void saveFinSession(writeFinJson(d), factory);
    };
    const unsubscribe = store.subscribe((s, prev) => {
      if (s.design === prev.design && s.editing === prev.editing) return;
      if (s.editing || !s.design) return; // mid-drag: wait for the release
      window.clearTimeout(timer);
      timer = window.setTimeout(save, FIN_AUTOSAVE_MS);
    });
    const flush = () => {
      if (timer === undefined) return;
      window.clearTimeout(timer);
      save();
    };
    const onHide = () => {
      if (document.visibilityState === 'hidden') flush();
    };
    window.addEventListener('pagehide', flush);
    document.addEventListener('visibilitychange', onHide);
    return () => {
      unsubscribe();
      window.clearTimeout(timer);
      window.removeEventListener('pagehide', flush);
      document.removeEventListener('visibilitychange', onHide);
    };
  }, [hydrated, store, factory]);

  return hydrated;
}
