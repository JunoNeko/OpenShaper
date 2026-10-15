// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin designer (docs/design/fin-designer.md, steps 11–12): pick a starting fin,
 * edit its outline over the Futures tab, its foil section and its thickness taper,
 * set its side, cant, thickness and depth, nudge it on the tab, and read its numbers.
 * The 3D preview, saving and export follow in later steps.
 *
 * Lengths show in mm, the owner's choice for fins. Components still take a `units`
 * prop (apps/web/CLAUDE.md), so a unit selector can be added here without touching
 * them.
 */
import {
  FIN_MAX_CANT,
  finReadouts,
  validateFinDesign,
  type FinHand,
  type FinPosition,
} from '@openshaper/kernel';
import { Button, Tooltip } from '@openshaper/ui';
import { useEffect, useMemo } from 'react';
import { DegField, LenField } from '../components/fields';
import { fmtArea, fmtLen, lengthUnitByKey, type LengthUnit } from '../format';
import { shortcutKeys } from '../shortcuts';
import { FinOutlinePane } from './FinOutlinePane';
import { FinSectionPane } from './FinSectionPane';
import { FinTaperPane } from './FinTaperPane';
import { finStore } from './fin-store';
import { NUDGE_FORE_CM, NUDGE_LATERAL_CM, useFinShortcuts } from './use-fin-shortcuts';
import { useFinState } from './use-fin';

/** The starting fins, as the owner names them. */
const STARTS: { label: string; position: FinPosition; hand?: FinHand }[] = [
  { label: 'Side, left', position: 'side', hand: 'left' },
  { label: 'Side, right', position: 'side', hand: 'right' },
  { label: 'Quad rear, left', position: 'quad-rear', hand: 'left' },
  { label: 'Quad rear, right', position: 'quad-rear', hand: 'right' },
  { label: 'Centre', position: 'centre' },
];

const POSITION_LABEL: Record<FinPosition, string> = {
  side: 'Side fin (Futures side tab, 17.7 mm)',
  'quad-rear': 'Quad rear (Futures centre tab, 12.7 mm)',
  centre: 'Centre fin (Futures centre tab, 12.7 mm)',
};

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-2">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}

function Readouts({ units }: { units: LengthUnit }) {
  const design = useFinState(finStore, (s) => s.design);
  const r = useMemo(() => (design ? finReadouts(design) : null), [design]);
  if (!r) return null;
  return (
    <dl className="space-y-1 text-sm" aria-label="Fin measurements">
      <Readout label="Area" value={fmtArea(r.area, units)} />
      <Readout label="Depth" value={fmtLen(r.depth, units)} />
      <Readout label="Base (root chord)" value={fmtLen(r.rootChord, units)} />
      <Readout label="Sweep" value={`${r.sweep.toFixed(1)}°`} />
      <Readout label="Front overhang" value={fmtLen(r.frontOverhang, units)} />
    </dl>
  );
}

function Issues() {
  const design = useFinState(finStore, (s) => s.design);
  const issues = useMemo(() => (design ? validateFinDesign(design) : []), [design]);
  if (issues.length === 0) return null;
  return (
    <ul className="space-y-1 rounded-md border border-destructive/60 p-2 text-sm" role="status">
      {issues.map((i) => (
        <li key={i.code}>{i.message}</li>
      ))}
    </ul>
  );
}

function Nudge({
  id,
  label,
  dir,
  act,
}: {
  id: string;
  label: string;
  dir: string;
  act: () => boolean;
}) {
  return (
    <Tooltip label={label} shortcut={shortcutKeys(id)}>
      <Button variant="outline" size="icon" aria-label={label} onClick={act}>
        {dir}
      </Button>
    </Tooltip>
  );
}

function Controls({ units }: { units: LengthUnit }) {
  const design = useFinState(finStore, (s) => s.design);
  if (!design) return null;
  const s = finStore.getState;
  const r = finReadouts(design);
  return (
    <div className="space-y-4 text-sm">
      <div className="text-xs text-muted-foreground">{POSITION_LABEL[design.position]}</div>
      {design.hand && (
        <div className="flex items-center gap-2" role="group" aria-label="Side">
          <span className="flex-1 text-muted-foreground">Side</span>
          {(['left', 'right'] as const).map((h) => (
            <Button
              key={h}
              size="sm"
              variant={design.hand === h ? 'default' : 'outline'}
              aria-pressed={design.hand === h}
              onClick={() => s().setHand(h)}
            >
              {h === 'left' ? 'Left' : 'Right'}
            </Button>
          ))}
        </div>
      )}
      <div className="space-y-1.5">
        {design.position !== 'centre' && (
          <DegField
            label={`Cant (0–${FIN_MAX_CANT}°)`}
            value={design.cant}
            onCommit={(v) => s().setCant(v)}
          />
        )}
        <LenField
          label="Root thickness"
          valueCm={design.taper.knots[0]!.end.y}
          units={units}
          onCommit={(cm) => s().setRootThickness(cm)}
        />
        <LenField
          label="Depth"
          valueCm={r.depth}
          units={units}
          onCommit={(cm) => s().setDepth(cm)}
        />
      </div>
      <div>
        <div className="mb-1 text-xs font-medium text-muted-foreground">Position on the tab</div>
        <div className="grid w-fit grid-cols-3 gap-1">
          <span />
          <Nudge
            id="fin-nudge-out"
            label="Slide the blade outboard"
            dir="↑"
            act={() => s().nudgeLateral(NUDGE_LATERAL_CM)}
          />
          <span />
          <Nudge
            id="fin-nudge-back"
            label="Move the fin back"
            dir="←"
            act={() => s().nudgeFore(-NUDGE_FORE_CM)}
          />
          <span />
          <Nudge
            id="fin-nudge-forward"
            label="Move the fin forward"
            dir="→"
            act={() => s().nudgeFore(NUDGE_FORE_CM)}
          />
          <span />
          <Nudge
            id="fin-nudge-in"
            label="Slide the blade inboard"
            dir="↓"
            act={() => s().nudgeLateral(-NUDGE_LATERAL_CM)}
          />
          <span />
        </div>
      </div>
      <Readouts units={units} />
      <Issues />
    </div>
  );
}

function History() {
  const canUndo = useFinState(finStore, (s) => s.past.length > 0);
  const canRedo = useFinState(finStore, (s) => s.future.length > 0);
  return (
    <>
      <Tooltip label="Undo" shortcut={shortcutKeys('undo')}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canUndo}
          onClick={() => finStore.getState().undo()}
        >
          Undo
        </Button>
      </Tooltip>
      <Tooltip label="Redo" shortcut={shortcutKeys('redo')}>
        <Button
          variant="ghost"
          size="sm"
          disabled={!canRedo}
          onClick={() => finStore.getState().redo()}
        >
          Redo
        </Button>
      </Tooltip>
    </>
  );
}

export function FinApp() {
  const units = lengthUnitByKey('mm');
  useFinShortcuts(finStore);
  // Start from a left side fin; saving and autosave (step 14) will restore instead.
  useEffect(() => {
    if (!finStore.getState().design) finStore.getState().newFin('side', 'left');
  }, []);

  return (
    <div className="flex h-dvh flex-col bg-background text-foreground">
      <header className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2">
        <h1 className="mr-2 text-sm font-semibold">Fin designer</h1>
        <label className="flex items-center gap-2 text-sm">
          <span className="text-muted-foreground">New fin</span>
          <select
            className="h-8 rounded-md border border-input bg-background px-2 text-sm"
            value=""
            aria-label="Start a new fin"
            onChange={(e) => {
              const start = STARTS[Number(e.target.value)];
              if (start) finStore.getState().newFin(start.position, start.hand);
            }}
          >
            <option value="" disabled>
              Choose…
            </option>
            {STARTS.map((st, i) => (
              <option key={st.label} value={i}>
                {st.label}
              </option>
            ))}
          </select>
        </label>
        <div className="ml-auto flex items-center gap-1">
          <History />
        </div>
      </header>
      <main className="flex min-h-0 flex-1 flex-col overflow-y-auto lg:flex-row lg:overflow-hidden">
        <section className="min-h-[50vh] flex-1 lg:min-h-0" aria-label="Outline">
          <FinOutlinePane store={finStore} />
        </section>
        {/* Section over taper beside the outline on wide screens; stacked below it on narrow. */}
        <div className="flex shrink-0 flex-col border-border lg:w-[26rem] lg:border-l">
          <section
            className="h-[40vh] border-t border-border lg:h-1/2 lg:border-t-0"
            aria-label="Foil"
          >
            <FinSectionPane store={finStore} />
          </section>
          <section className="h-[40vh] border-t border-border lg:h-1/2" aria-label="Taper">
            <FinTaperPane store={finStore} units={units} />
          </section>
        </div>
        <aside className="w-full shrink-0 overflow-y-auto border-t border-border p-3 lg:w-80 lg:border-l lg:border-t-0">
          <Controls units={units} />
        </aside>
      </main>
    </div>
  );
}
