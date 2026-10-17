// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin designer (docs/design/fin-designer.md, steps 11–12): pick a starting fin,
 * edit its outline over the Futures tab, its foil section and its thickness taper,
 * set its side, cant, thickness and depth, nudge it on the tab, and read its numbers.
 * The fin autosaves, and Open / Save read and write `.fin.json` files (step 14); STEP
 * and STL export (step 15).
 *
 * Four views — profile, foil, thickness, 3D — share one large pane and three small
 * ones; a small pane's swap button brings its view into the large pane (round 1, R3).
 * The large pane's toolbar holds that view's controls. The 3D view's controls (side,
 * cant, nudge) go with it, under it when it is small, so the nudge sits by the view
 * that shows what it does.
 *
 * Lengths show in mm, the owner's choice for fins. Components still take a `units`
 * prop (apps/web/CLAUDE.md), so a unit selector can be added here without touching
 * them.
 */
import {
  FIN_BASES,
  FIN_BASE_LABEL,
  FIN_MAX_CANT,
  finTabOutline,
  futuresKind,
  finReadouts,
  validateFinDesign,
  type FinBase,
  type FinDesign,
  type FinHand,
  type FinPosition,
} from '@openshaper/kernel';
import type { FinStart } from '@openshaper/store';
import { Button, Tooltip } from '@openshaper/ui';
import { Maximize2 } from 'lucide-react';
import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { DegField, LenField } from '../components/fields';
import { fmtArea, fmtLen, lengthUnitByKey, type LengthUnit } from '../format';
import { readStored, writeStored } from '../persisted';
import { shortcutKeys } from '../shortcuts';
import { FinOutlinePane } from './FinOutlinePane';
import { FinSectionPane, FinSectionTools } from './FinSectionPane';
import { FinTaperPane } from './FinTaperPane';
import { PointTools } from './PointTools';
import { downloadFin, exportFin, readFinFile } from './fin-file';
import { finStore } from './fin-store';
import {
  FIN_VIEW_TITLE,
  readViewOrder,
  swapIntoMain,
  writeViewOrder,
  type FinView,
  type FinViewOrder,
} from './fin-views';
import { useFinAutosave } from './use-fin-autosave';
import { NUDGE_FORE_CM, NUDGE_LATERAL_CM, useFinShortcuts } from './use-fin-shortcuts';
import { useFinState } from './use-fin';
import { useSettledDesign } from './use-settled-design';

// three.js is the heavy part of the page: load it after the 2D editor is up.
const FinPreview3D = lazy(() =>
  import('@openshaper/render3d').then((m) => ({ default: m.FinPreview3D })),
);

function Preview({ frameKey }: { frameKey: string }) {
  const design = useSettledDesign(finStore);
  const position = useFinState(finStore, (s) => s.design?.position);
  const hand = useFinState(finStore, (s) => s.design?.hand);
  return (
    <div className="h-full overflow-hidden" aria-label="3D preview">
      <Suspense fallback={null}>
        <FinPreview3D design={design} frameKey={`${position}-${hand}-${frameKey}`} />
      </Suspense>
    </div>
  );
}

/** The starting fins, as the owner names them. */
const STARTS: { label: string; start: FinStart; hand?: FinHand }[] = [
  { label: 'Side, left', start: 'side', hand: 'left' },
  { label: 'Side, right', start: 'side', hand: 'right' },
  { label: 'Quad rear, left', start: 'quad-rear', hand: 'left' },
  { label: 'Quad rear, right', start: 'quad-rear', hand: 'right' },
  { label: 'Centre', start: 'centre' },
  { label: 'Canard, left (FCS single tab)', start: 'canard', hand: 'left' },
  { label: 'Canard, right (FCS single tab)', start: 'canard', hand: 'right' },
];

const POSITION_LABEL: Record<FinPosition, string> = {
  side: 'Side fin',
  'quad-rear': 'Quad rear',
  centre: 'Centre fin',
};

function Readout({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex gap-1.5">
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
    <dl className="flex flex-wrap gap-x-4 gap-y-1 text-sm" aria-label="Fin measurements">
      <Readout label="Area" value={fmtArea(r.area, units)} />
      <Readout label="Depth" value={fmtLen(r.depth, units)} />
      <Readout label="Base (root chord)" value={fmtLen(r.rootChord, units)} />
      <Readout label="Sweep" value={`${r.sweep.toFixed(1)}°`} />
      {/* Futures only: the limit is the grub screw at the box's front. */}
      {futuresKind(design!.base) && (
        <Readout label="Front overhang" value={fmtLen(r.frontOverhang, units)} />
      )}
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

/** Fore/aft and across nudges, in one row. */
function NudgePad() {
  const s = finStore.getState;
  return (
    <div className="flex items-center gap-1" role="group" aria-label="Position on the tab">
      <span className="mr-1 text-muted-foreground">Position</span>
      <Nudge
        id="fin-nudge-back"
        label="Move the fin back"
        dir="←"
        act={() => s().nudgeFore(-NUDGE_FORE_CM)}
      />
      <Nudge
        id="fin-nudge-forward"
        label="Move the fin forward"
        dir="→"
        act={() => s().nudgeFore(NUDGE_FORE_CM)}
      />
      <Nudge
        id="fin-nudge-out"
        label="Slide the blade outboard"
        dir="↑"
        act={() => s().nudgeLateral(NUDGE_LATERAL_CM)}
      />
      <Nudge
        id="fin-nudge-in"
        label="Slide the blade inboard"
        dir="↓"
        act={() => s().nudgeLateral(-NUDGE_LATERAL_CM)}
      />
    </div>
  );
}

/** The 3D view's controls: side, cant and the nudges. */
function PlacementTools() {
  const position = useFinState(finStore, (s) => s.design?.position);
  const hand = useFinState(finStore, (s) => s.design?.hand);
  const cant = useFinState(finStore, (s) => s.design?.cant ?? 0);
  const base = useFinState(finStore, (s) => s.design?.base);
  if (!position || !base) return null;
  const s = finStore.getState;
  const fcs = !futuresKind(base);
  return (
    <>
      <label className="flex items-center gap-2">
        <span className="text-muted-foreground">Base</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 text-sm"
          value={base}
          aria-label="Base"
          onChange={(e) => s().setBase(e.target.value as FinBase)}
        >
          {FIN_BASES.map((b) => (
            <option key={b} value={b}>
              {FIN_BASE_LABEL[b]}
            </option>
          ))}
        </select>
      </label>
      {hand && (
        <div className="flex items-center gap-1" role="group" aria-label="Side">
          {(['left', 'right'] as const).map((h) => (
            <Button
              key={h}
              size="sm"
              variant={hand === h ? 'default' : 'outline'}
              aria-pressed={hand === h}
              onClick={() => s().setHand(h)}
            >
              {h === 'left' ? 'Left' : 'Right'}
            </Button>
          ))}
        </div>
      )}
      {position !== 'centre' && (
        <Tooltip label={fcs ? 'Set by the FCS plug (0°, 5° or 9°)' : 'Blade lean out from the tab'}>
          <div>
            <DegField
              label={fcs ? 'Cant (plug)' : `Cant (0–${FIN_MAX_CANT}°)`}
              value={cant}
              disabled={fcs}
              onCommit={(v) => s().setCant(v)}
            />
          </div>
        </Tooltip>
      )}
      <NudgePad />
    </>
  );
}

const OUTLINE_CURVES = ['outline'] as const;
const TAPER_CURVES = ['taper'] as const;

/**
 * Where a new slice goes: halfway up the biggest gap between the root, the slices and
 * the tip, so repeated clicks spread them out.
 */
const nextSliceHeight = (d: FinDesign): number => {
  const hs = [0, ...d.slices.map((sl) => sl.height), 1];
  let best = 0;
  for (let i = 1; i < hs.length - 1; i++)
    if (hs[i + 1]! - hs[i]! > hs[best + 1]! - hs[best]!) best = i;
  return (hs[best]! + hs[best + 1]!) / 2;
};

/** The profile view's controls. */
function OutlineTools({ units }: { units: LengthUnit }) {
  const design = useFinState(finStore, (s) => s.design);
  const depth = useMemo(() => (design ? finReadouts(design).depth : 0), [design]);
  if (!design) return null;
  return (
    <>
      <LenField
        label="Depth"
        valueCm={depth}
        units={units}
        onCommit={(cm) => finStore.getState().setDepth(cm)}
      />
      <PointTools store={finStore} curves={OUTLINE_CURVES} />
      <Tooltip label="Add a foil slice: drag its line to place it, then shape its foil">
        <Button
          variant="outline"
          size="sm"
          onClick={() => finStore.getState().addSlice(nextSliceHeight(design))}
        >
          Add slice
        </Button>
      </Tooltip>
    </>
  );
}

/** The thickness view's controls. */
function TaperTools({ units }: { units: LengthUnit }) {
  const root = useFinState(finStore, (s) => s.design?.taper.knots[0]!.end.y);
  if (root === undefined) return null;
  return (
    <>
      <LenField
        label="Root thickness"
        valueCm={root}
        units={units}
        onCommit={(cm) => finStore.getState().setRootThickness(cm)}
      />
      <PointTools store={finStore} curves={TAPER_CURVES} />
    </>
  );
}

/** Readouts and broken rules, always in view. */
function Status({ units }: { units: LengthUnit }) {
  const position = useFinState(finStore, (s) => s.design?.position);
  const base = useFinState(finStore, (s) => s.design?.base);
  if (!position || !base) return null;
  const tab = finTabOutline(base);
  return (
    <div className="space-y-2 border-t border-border px-3 py-2" style={{ gridArea: 'status' }}>
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <span className="text-xs text-muted-foreground">
          {POSITION_LABEL[position]} on {FIN_BASE_LABEL[base]} ({fmtLen(tab.length, units)} ×{' '}
          {fmtLen(tab.height, units)})
        </span>
        <Readouts units={units} />
      </div>
      <Issues />
    </div>
  );
}

/**
 * One view's pane. Large: its title and controls across the top. Small: its title and
 * a button that swaps it into the large pane; the 3D view keeps its controls, under it.
 */
function ViewPane({
  view,
  slot,
  onSwap,
  tools,
  children,
}: {
  view: FinView;
  /** 0 for the large pane, 1–3 for the small ones. */
  slot: number;
  onSwap: (slot: number) => void;
  tools: ReactNode;
  children: ReactNode;
}) {
  const large = slot === 0;
  const title = FIN_VIEW_TITLE[view];
  const keepTools = view === '3d';
  return (
    <section
      aria-label={title}
      data-slot={large ? 'main' : `small-${slot}`}
      style={{ gridArea: large ? 'main' : `s${slot}` }}
      className={`flex min-h-0 flex-col border-border ${large ? '' : 'border-t lg:border-l'}`}
    >
      <div className="flex min-h-9 flex-wrap items-center gap-x-3 gap-y-1.5 border-b border-border px-2 py-1 text-sm">
        <h2 className="text-xs font-medium text-muted-foreground">{title}</h2>
        {large ? (
          tools
        ) : (
          <Tooltip label={`Show ${title} in the large pane`}>
            <Button
              variant="ghost"
              size="icon"
              className="ml-auto h-7 w-7"
              aria-label={`Show ${title} in the large pane`}
              onClick={() => onSwap(slot)}
            >
              <Maximize2 className="h-4 w-4" />
            </Button>
          </Tooltip>
        )}
      </div>
      <div className="min-h-0 flex-1">{children}</div>
      {!large && keepTools && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 border-t border-border px-2 py-1.5 text-sm">
          {tools}
        </div>
      )}
    </section>
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

/** Open and Save: `.fin.json` files. Opening replaces the fin and starts a fresh history. */
function FileButtons({ onSave }: { onSave: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const open = async (file: File | undefined) => {
    if (!file) return;
    try {
      finStore.getState().load(await readFinFile(file));
      setProblem(null);
    } catch (e) {
      setProblem((e as Error).message);
    }
  };
  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => input.current?.click()}>
        Open…
      </Button>
      <input
        ref={input}
        type="file"
        accept=".json,application/json"
        className="hidden"
        aria-label="Open a fin file"
        onChange={(e) => {
          void open(e.target.files?.[0]);
          e.target.value = ''; // the same file can be opened again
        }}
      />
      <Tooltip label="Save to a .fin.json file" shortcut={shortcutKeys('save')}>
        <Button variant="ghost" size="sm" onClick={onSave}>
          Save
        </Button>
      </Tooltip>
      {problem && (
        <span role="alert" className="text-xs text-destructive">
          {problem}
        </span>
      )}
    </>
  );
}

/** Export for manufacture: STEP for CNC, STL for printing. Off while a rule is broken. */
/** Remembered per device: whether Save and Export write a left and a right fin. */
const PAIR_KEY = 'bs.fin.pair';

/**
 * The R & L option beside Save and Export: when ticked, each writes the fin and its
 * mirror for the other side, two files. Only for fins that have a side.
 */
function PairOption({ pair, onChange }: { pair: boolean; onChange: (on: boolean) => void }) {
  const hand = useFinState(finStore, (s) => s.design?.hand);
  if (!hand) return null;
  return (
    <Tooltip label="Save and export a left and a right fin: two files each time">
      <label className="flex items-center gap-1.5 px-1 text-sm">
        <input
          type="checkbox"
          className="h-4 w-4 accent-primary"
          checked={pair}
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>R &amp; L</span>
      </label>
    </Tooltip>
  );
}

function ExportButtons({ pair }: { pair: boolean }) {
  const design = useFinState(finStore, (s) => s.design);
  const issues = useMemo(() => (design ? validateFinDesign(design) : []), [design]);
  const [busy, setBusy] = useState<'step' | 'stl' | null>(null);
  const run = (format: 'step' | 'stl') => {
    const d = finStore.getState().design;
    if (!d || busy) return;
    setBusy(format);
    // Let "Exporting…" paint before the work starts.
    window.setTimeout(() => {
      void exportFin(d, format, pair).finally(() => setBusy(null));
    }, 0);
  };
  const blocked = issues.length > 0;
  const why = blocked ? 'Fix the issues listed under the measurements first' : undefined;
  return (
    <>
      <Tooltip label={why ?? 'Export a STEP file for CNC (mm)'}>
        <Button
          variant="outline"
          size="sm"
          disabled={blocked || busy !== null}
          onClick={() => run('step')}
        >
          {busy === 'step' ? 'Exporting…' : 'Export STEP'}
        </Button>
      </Tooltip>
      <Tooltip label={why ?? 'Export an STL file for 3D printing (mm)'}>
        <Button
          variant="outline"
          size="sm"
          disabled={blocked || busy !== null}
          onClick={() => run('stl')}
        >
          {busy === 'stl' ? 'Exporting…' : 'Export STL'}
        </Button>
      </Tooltip>
    </>
  );
}

export function FinApp() {
  const units = lengthUnitByKey('mm');
  const [pair, setPair] = useState(() => readStored(PAIR_KEY, false, (v) => v === true));
  const changePair = useCallback((on: boolean) => {
    setPair(on);
    writeStored(PAIR_KEY, on);
  }, []);
  // ⌘S saves through a stable callback, so it reads the option from a ref.
  const pairRef = useRef(pair);
  useEffect(() => {
    pairRef.current = pair;
  }, [pair]);
  const save = useCallback(() => {
    const d = finStore.getState().design;
    if (d) void downloadFin(d, pairRef.current);
  }, []);
  useFinShortcuts(finStore, { onSave: save });
  const ready = useFinAutosave(finStore);
  const [order, setOrder] = useState<FinViewOrder>(readViewOrder);
  const swap = useCallback((slot: number) => {
    setOrder((o) => {
      const next = swapIntoMain(o, slot);
      writeViewOrder(next);
      return next;
    });
  }, []);
  const slotOf = (view: FinView) => order.indexOf(view);
  // Re-fit a view's canvas when it moves between the large pane and a small one.
  const sizeKey = (view: FinView) => (order[0] === view ? 'large' : 'small');

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
              if (start) finStore.getState().newFin(start.start, start.hand);
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
        <div className="ml-auto flex flex-wrap items-center gap-1">
          <FileButtons onSave={save} />
          <PairOption pair={pair} onChange={changePair} />
          <ExportButtons pair={pair} />
          <History />
          <a
            className="px-2 text-sm text-muted-foreground underline-offset-4 hover:underline"
            href="/docs/fin-designer"
          >
            Help
          </a>
        </div>
      </header>
      <main aria-busy={!ready} className="fin-grid min-h-0 flex-1">
        <ViewPane
          view="outline"
          slot={slotOf('outline')}
          onSwap={swap}
          tools={<OutlineTools units={units} />}
        >
          <FinOutlinePane store={finStore} units={units} frameKey={sizeKey('outline')} />
        </ViewPane>
        <ViewPane
          view="foil"
          slot={slotOf('foil')}
          onSwap={swap}
          tools={<FinSectionTools store={finStore} units={units} />}
        >
          <FinSectionPane store={finStore} frameKey={sizeKey('foil')} />
        </ViewPane>
        <ViewPane
          view="taper"
          slot={slotOf('taper')}
          onSwap={swap}
          tools={<TaperTools units={units} />}
        >
          <FinTaperPane store={finStore} units={units} frameKey={sizeKey('taper')} />
        </ViewPane>
        <ViewPane view="3d" slot={slotOf('3d')} onSwap={swap} tools={<PlacementTools />}>
          <Preview frameKey={sizeKey('3d')} />
        </ViewPane>
        <Status units={units} />
      </main>
    </div>
  );
}
