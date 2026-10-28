// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * What the foil view and the front view share for the panel (File settings): the
 * colours its faces are drawn in, the toggle that shows them, and Fit to panel.
 */
import type { FinState } from '@openshaper/store';
import { Button, Tooltip } from '@openshaper/ui';
import type { StoreApi } from 'zustand/vanilla';
import { bestPoseOf } from './use-panel-fit';

/** The panel's faces: green when the fin fits, orange when not. */
export const PANEL_FIT = 'rgba(34,197,94,0.9)';
export const PANEL_OVER = 'rgba(249,115,22,0.95)';
/** The fin as the panel sees it, faint behind the faces. */
export const PANEL_HULL_FILL = 'rgba(138,155,179,0.08)';
export const PANEL_HULL_LINE = 'rgba(138,155,179,0.45)';

/** Show or hide the panel's faces (File settings' toggle, shared by both views). */
export function PanelToggle({
  show,
  onShow,
  tooltip,
}: {
  show: boolean;
  onShow: (on: boolean) => void;
  tooltip: string;
}) {
  return (
    <Tooltip label={tooltip}>
      <Button
        size="sm"
        variant={show ? 'default' : 'outline'}
        aria-pressed={show}
        onClick={() => onShow(!show)}
      >
        Panel
      </Button>
    </Tooltip>
  );
}

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
