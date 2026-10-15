// SPDX-License-Identifier: GPL-3.0-or-later
import type { FinState } from '@openshaper/store';
import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';

/** Subscribe to one slice of the fin store; re-renders only when it changes. */
export const useFinState = <T>(store: StoreApi<FinState>, pick: (s: FinState) => T): T =>
  useSyncExternalStore(
    store.subscribe,
    () => pick(store.getState()),
    () => pick(store.getState()),
  );
