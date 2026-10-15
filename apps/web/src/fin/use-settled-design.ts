// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The design as of the last finished edit: during a drag it holds the design from
 * before the drag, and catches up on release. The 3D preview reads this, so a drag
 * rebuilds the mesh once, not on every pointer move (the board's useSettledBoard does
 * the same for its heavy readouts).
 */
import type { FinDesign } from '@openshaper/kernel';
import type { FinState } from '@openshaper/store';
import { useRef } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { useFinState } from './use-fin';

export function useSettledDesign(store: StoreApi<FinState>): FinDesign | null {
  const design = useFinState(store, (s) => s.design);
  const editing = useFinState(store, (s) => s.editing);
  const settled = useRef(design);
  if (!editing) settled.current = design;
  return settled.current;
}
