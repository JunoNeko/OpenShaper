// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Fit to panel, shared by the foil view and the 3D view's panel fit (File settings'
 * panel): turns and tilts the fin to what needs the thinnest panel.
 */
import type { FinState } from '@openshaper/store';
import { Button, Tooltip } from '@openshaper/ui';
import type { StoreApi } from 'zustand/vanilla';
import { bestPoseOf } from './use-panel-fit';

/** Turn and tilt the fin to whatever needs the thinnest panel, as one undo step. */
export function FitToPanel({
  store,
  minThickness,
}: {
  store: StoreApi<FinState>;
  minThickness: number;
}) {
  return (
    <Tooltip label="Turn and tilt the fin in the panel to what needs the thinnest panel">
      <Button
        size="sm"
        variant="outline"
        onClick={() => {
          const d = store.getState().design;
          if (d) store.getState().fitPanel(bestPoseOf(d, minThickness));
        }}
      >
        Fit to panel
      </Button>
    </Tooltip>
  );
}
