// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Point tools for a curve view's toolbar (docs/design/fin-designer.md, round 1, R4):
 * add a point halfway along the selected span, delete the selected point, and make it
 * smooth or a corner. They act on the selected point when it is on one of `curves`, and
 * are greyed out otherwise. A curve's two end points can't be deleted or made smooth:
 * they are pinned to the base, the tip or the chord.
 */
import { canDeleteKnot, getFinCurve, type FinCurve, type FinState } from '@openshaper/store';
import { Button, Tooltip } from '@openshaper/ui';
import { Minus, Plus } from 'lucide-react';
import { memo } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { shortcutKeys } from '../shortcuts';
import { useFinState } from './use-fin';

export const PointTools = memo(function PointTools({
  store,
  curves,
}: {
  store: StoreApi<FinState>;
  curves: readonly FinCurve[];
}) {
  const selection = useFinState(store, (s) => s.selection);
  const design = useFinState(store, (s) => s.design);
  const sel = selection && curves.includes(selection.curve) ? selection : null;
  const spline = sel && design ? getFinCurve(design, sel.curve) : null;
  const k = sel && spline ? spline.knots[sel.index] : undefined;
  const interior = !!spline && !!sel && sel.index > 0 && sel.index < spline.knots.length - 1;
  const s = store.getState;
  const hint = sel ? undefined : 'Select a point first';

  return (
    <div className="flex items-center gap-1" role="group" aria-label="Point tools">
      <Tooltip label={hint ?? 'Add a point halfway to the next one'}>
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Add a point"
          disabled={!sel}
          onClick={() => sel && s().addControlPointAfter(sel.curve, sel.index)}
        >
          <Plus className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Tooltip
        label={hint ?? 'Delete the selected point'}
        shortcut={sel ? shortcutKeys('delete-point') : undefined}
      >
        <Button
          variant="outline"
          size="icon"
          className="h-8 w-8"
          aria-label="Delete the point"
          disabled={!sel || !spline || !canDeleteKnot(spline, sel.index)}
          onClick={() => sel && s().deleteControlPoint(sel.curve, sel.index)}
        >
          <Minus className="h-4 w-4" />
        </Button>
      </Tooltip>
      <Button
        size="sm"
        variant={interior && k?.continuous ? 'default' : 'outline'}
        aria-pressed={interior && !!k?.continuous}
        disabled={!interior}
        onClick={() => sel && s().setContinuous(sel.curve, sel.index, true)}
      >
        Smooth
      </Button>
      <Button
        size="sm"
        variant={interior && k && !k.continuous ? 'default' : 'outline'}
        aria-pressed={interior && !!k && !k.continuous}
        disabled={!interior}
        onClick={() => sel && s().setContinuous(sel.curve, sel.index, false)}
      >
        Corner
      </Button>
    </div>
  );
});
