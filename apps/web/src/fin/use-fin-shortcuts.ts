// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin designer's keyboard shortcuts. The chords live in `shortcuts.ts` with the
 * board editor's (one table, so `/docs/shortcuts` lists both); this maps the ids the
 * fin page uses to fin store actions. Ids it doesn't use (`[`, the view keys) are
 * left to the browser.
 */
import type { FinState } from '@openshaper/store';
import { useEffect } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { isTextEntry, matches, SHORTCUTS } from '../shortcuts';

/** Nudge steps (cm): the arrow keys and the arrow buttons share them. */
export const NUDGE_FORE_CM = 0.05;
export const NUDGE_LATERAL_CM = 0.01;

export function useFinShortcuts(
  store: StoreApi<FinState>,
  { onSave }: { onSave: () => void },
): void {
  useEffect(() => {
    const run = (id: string): boolean => {
      const s = store.getState();
      switch (id) {
        case 'undo':
          s.undo();
          return true;
        case 'save':
          onSave();
          return true;
        case 'redo':
        case 'redo-alt':
          s.redo();
          return true;
        case 'delete-point':
          if (!s.selection) return false;
          s.deleteControlPoint(s.selection.curve, s.selection.index);
          return true;
        case 'cross-section-blur':
          if (!s.selection) return false;
          s.select(null);
          return true;
        case 'fin-nudge-forward':
          s.nudgeFore(NUDGE_FORE_CM);
          return true;
        case 'fin-nudge-back':
          s.nudgeFore(-NUDGE_FORE_CM);
          return true;
        case 'fin-nudge-out':
          s.nudgeLateral(NUDGE_LATERAL_CM);
          return true;
        case 'fin-nudge-in':
          s.nudgeLateral(-NUDGE_LATERAL_CM);
          return true;
        default:
          return false;
      }
    };
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const inField =
        !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
      const hit = SHORTCUTS.find((sc) => matches(sc, e, inField, isTextEntry(t)));
      if (hit && run(hit.id)) e.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [store, onSave]);
}
