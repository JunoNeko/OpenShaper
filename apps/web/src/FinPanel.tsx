/**
 * Fins panel (fin integration, phase 1): pick the setup and the fin system, then the
 * fins themselves from the library (`FinChooser`: a set, or one fin at a time), and
 * place each one: distance from the tail, inset from the rail, toe-in. A fin's shape
 * and cant are its own, as OpenFinShaper designs it; on FCS the plugs add 5° or 9°
 * (front sides, and quad rears), the centre 0°. A twinzer takes two boxes: its twins'
 * system, and its canards' own (an FCS single plug; Futures' canard box is listed as
 * coming soon until its dimensions are known). Box clearance problems are listed here
 * as they arise. Everything goes through the store (undoable).
 *
 * Length fields follow the editor's unit selector (`units`); angles are degrees.
 */
import {
  CANARD_BOXES,
  CANARD_BOX_LABELS,
  DEFAULT_CANARD_PLUG_CANT,
  FIN_SETUPS,
  FIN_SETUP_LABELS,
  FIN_SYSTEMS,
  FIN_SYSTEM_LABELS,
  canardBoxAvailable,
  cavityProblems,
  finCavities,
  finGroups,
  finLabel,
  finSetOf,
  type CanardBox,
  type FinGroup,
  type FinSpec,
  type PlugCant,
  type PlugCantGroup,
} from '@openshaper/kernel';
import type { BoardState } from '@openshaper/store';
import { Button, Checkbox, Panel, PanelBody, PanelHeader, PanelTitle } from '@openshaper/ui';
import { useMemo, useState, useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { DegField, LenField } from './components/fields';
import { FinChooser, FinThumb } from './FinChooser';
import type { LengthUnit } from './format';
import { Sel } from './view-toolkit';

const sideLabel = (side: -1 | 0 | 1): string =>
  side === 0 ? 'Center' : side < 0 ? 'Port' : 'Starboard';

/** "Port fin", or "Port canard" for a twinzer's front fins. */
const finName = (side: -1 | 0 | 1, group: FinGroup | undefined): string =>
  `${sideLabel(side)} ${group === 'canard' ? 'canard' : 'fin'}`;

const CANARD_OPTIONS = CANARD_BOXES.map((b) => ({
  value: b,
  label: canardBoxAvailable(b) ? CANARD_BOX_LABELS[b] : `${CANARD_BOX_LABELS[b]} (coming soon)`,
  disabled: !canardBoxAvailable(b),
}));

const PLUG_CANTS: { value: string; label: string }[] = [
  { value: '5', label: '5°' },
  { value: '9', label: '9°' },
];

/**
 * The selected fin: which fin it is, a way to change it alone, and where it goes. Its
 * shape and cant are the fin's own (OpenFinShaper's); the board places it.
 */
function FinInspector({
  store,
  units,
  index,
  spec,
  group,
  onChange,
}: {
  store: StoreApi<BoardState>;
  units: LengthUnit;
  index: number;
  spec: FinSpec;
  group: FinGroup | undefined;
  onChange: () => void;
}) {
  const patch = (p: Partial<FinSpec>) => store.getState().updateFin(index, p);
  return (
    <div className="space-y-1.5 rounded-md border border-border px-2 py-2 text-sm">
      <div className="text-xs font-medium text-muted-foreground">{finName(spec.side, group)}</div>
      <div className="flex items-center gap-2">
        {spec.design && <FinThumb design={spec.design} className="h-8 w-10" />}
        <span className="flex-1">{finLabel(spec)}</span>
        <Button size="sm" variant="secondary" onClick={onChange}>
          Change
        </Button>
      </div>
      <LenField
        label="Fin dot from tail"
        valueCm={spec.trailingFromTail}
        units={units}
        onCommit={(v) => patch({ trailingFromTail: Math.max(0, v) })}
      />
      {spec.side !== 0 && (
        <>
          <LenField
            label="Fin dot from rail"
            valueCm={spec.insetFromRail}
            units={units}
            onCommit={(v) => patch({ insetFromRail: Math.max(0, v) })}
          />
          <DegField label="Toe-in" value={spec.toe} onCommit={(v) => patch({ toe: v })} />
        </>
      )}
    </div>
  );
}

/**
 * FCS plugs come at 5° or 9°: the front sides', a quad's or 5-fin's rears', and a
 * twinzer's canards' single plugs (9° unless set), whatever its twins' system.
 */
function PlugCants({ store }: { store: StoreApi<BoardState> }) {
  const cfg = useSyncExternalStore(store.subscribe, () => store.getState().board?.fins);
  if (!cfg) return null;
  const groups = finGroups(cfg.setup);
  const fcs = cfg.system === 'fcs-ii' || cfg.system === 'fcs-x2';
  const canards = groups.includes('canard') && (cfg.canardBox ?? 'fcs-single') === 'fcs-single';
  if (!fcs && !canards) return null;
  const row = (which: PlugCantGroup, label: string) => (
    <label className="flex items-center gap-2">
      <span className="flex-1 text-muted-foreground">{label}</span>
      <Sel
        value={String(cfg.plugCant?.[which] ?? (which === 'canard' ? DEFAULT_CANARD_PLUG_CANT : 5))}
        onChange={(v) => store.getState().setPlugCant(which, Number(v) as PlugCant)}
        options={PLUG_CANTS}
        title={label}
      />
    </label>
  );
  return (
    <div className="space-y-1">
      {canards && row('canard', 'Canard plugs')}
      {fcs &&
        groups.includes('side') &&
        row(
          'front',
          groups.includes('rear') ? 'Front plugs' : groups.includes('canard') ? 'Twin plugs' : 'Side plugs', // prettier-ignore
        )}
      {fcs && groups.includes('rear') && row('rear', 'Rear plugs')}
      {fcs && groups.includes('centre') && (
        <p className="text-xs text-muted-foreground">Centre plug 0°.</p>
      )}
    </div>
  );
}

/** The Fins panel for the sidebar. */
export function FinPanel({ store, units }: { store: StoreApi<BoardState>; units: LengthUnit }) {
  const board = useSyncExternalStore(store.subscribe, () => store.getState().board);
  const selectedFin = useSyncExternalStore(store.subscribe, () => store.getState().selectedFin);
  const [choosing, setChoosing] = useState<null | 'set' | 'fin'>(null);
  const problems = useMemo(() => (board ? cavityProblems(board, finCavities(board)) : []), [board]);
  if (!board) return null;
  const cfg = board.fins;
  const set = finSetOf(cfg);
  const groups = finGroups(cfg.setup);
  const twinzer = groups.includes('canard');
  const systemSel = (
    <Sel
      value={cfg.system}
      onChange={(s) => store.getState().setFinSystem(s)}
      options={FIN_SYSTEMS.map((s) => ({ value: s, label: FIN_SYSTEM_LABELS[s] }))}
      title={twinzer ? 'Twin fin box' : 'Fin system'}
    />
  );

  return (
    <Panel>
      <PanelHeader>
        <PanelTitle>Fins</PanelTitle>
      </PanelHeader>
      <PanelBody className="space-y-2 text-sm">
        <Sel
          value={cfg.setup}
          onChange={(s) => store.getState().setFinSetup(s)}
          options={FIN_SETUPS.map((s) => ({ value: s, label: FIN_SETUP_LABELS[s] }))}
          title="Fin setup"
        />
        {cfg.setup !== 'none' && (
          <>
            {twinzer ? (
              <>
                <label className="flex items-center gap-2">
                  <span className="flex-1 text-muted-foreground">Twin box</span>
                  {systemSel}
                </label>
                <label className="flex items-center gap-2">
                  <span className="flex-1 text-muted-foreground">Canard box</span>
                  <Sel
                    value={cfg.canardBox ?? 'fcs-single'}
                    onChange={(b: CanardBox) => store.getState().setCanardBox(b)}
                    options={CANARD_OPTIONS}
                    title="Canard box"
                  />
                </label>
              </>
            ) : (
              systemSel
            )}
            <PlugCants store={store} />
            <div className="flex items-center gap-2">
              <span className="flex-1">
                <span className="text-muted-foreground">Fins: </span>
                {set ? `${set.set.label} ${set.size}` : 'Mixed'}
              </span>
              <Button size="sm" variant="secondary" onClick={() => setChoosing('set')}>
                Choose fins
              </Button>
            </div>
            <label className="flex cursor-pointer items-center gap-2 text-xs text-muted-foreground">
              <Checkbox
                checked={cfg.symmetrical}
                onChange={(e) => store.getState().setFinSymmetrical(e.target.checked)}
              />
              Symmetrical (mirror port/starboard edits)
            </label>
            <div className="flex flex-wrap gap-1">
              {cfg.fins.map((f, i) => (
                <button
                  key={i}
                  type="button"
                  onClick={() => store.getState().selectFin(selectedFin === i ? null : i)}
                  className={`flex min-w-8 items-center justify-center rounded px-2 py-0.5 text-xs pointer-coarse:min-h-11 pointer-coarse:min-w-11 ${
                    selectedFin === i
                      ? 'bg-primary text-primary-foreground'
                      : 'border border-border text-muted-foreground'
                  }`}
                  title={`${finName(f.side, groups[i])}: ${finLabel(f)}`}
                >
                  {sideLabel(f.side)[0]}
                  {i + 1}
                </button>
              ))}
            </div>
            {selectedFin != null && cfg.fins[selectedFin] && (
              <FinInspector
                store={store}
                units={units}
                index={selectedFin}
                spec={cfg.fins[selectedFin]!}
                group={groups[selectedFin]}
                onChange={() => setChoosing('fin')}
              />
            )}
            {problems.length > 0 && (
              <ul role="alert" className="space-y-1 text-xs text-destructive">
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted-foreground">
              Fins are placed by the fin dot, the root of the trailing edge: drag it on the outline,
              or type its distances. Choosing another fin moves the box, not the dot. Fins follow
              the rail and rocker, and are saved with the board.
            </p>
          </>
        )}
      </PanelBody>
      {choosing && (
        <FinChooser
          store={store}
          board={board}
          finIndex={choosing === 'fin' ? selectedFin : null}
          onClose={() => setChoosing(null)}
        />
      )}
    </Panel>
  );
}
