// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Export the fin's core, for a fin that is printed and then has laminate (usually
 * unidirectional carbon) vacuum-bagged onto its faces for stiffness at the base. The
 * blade is pulled in by the laminate on the chosen faces, never under the 1 mm
 * minimum (FinLaminate in kernel blade.ts), so with the laminate on it is the design.
 * The tab is unchanged: it still has to fit the box.
 */
import { FIN_MIN_THICKNESS, type FinLaminate } from '@openshaper/kernel';
import { Button, Panel, PanelBody, PanelHeader, PanelTitle } from '@openshaper/ui';
import { useState } from 'react';
import { Modal } from '../components/modal';
import { NumericInput } from '../components/numeric-input';
import {
  cmToUnitNumber,
  parseTypedLen,
  unitDecimals,
  unitSuffix,
  type LengthUnit,
} from '../format';
import { readStored, writeStored } from '../persisted';

/** Which faces the laminate goes on. */
export type LaminateSides = 'outside' | 'inside' | 'both';

export interface CoreSettings {
  /** Laminate per face (cm). */
  readonly thickness: number;
  readonly sides: LaminateSides;
}

/** One ply of 200 gsm unidirectional carbon is about 0.20–0.25 mm. */
export const DEFAULT_CORE: CoreSettings = { thickness: 0.02, sides: 'both' };

/** What the field accepts (cm): 0.05 mm up to 2 mm a face. */
export const LAMINATE_MIN = 0.005;
export const LAMINATE_MAX = 0.2;

const SIDES: { value: LaminateSides; label: string }[] = [
  { value: 'outside', label: 'Outside' },
  { value: 'inside', label: 'Inside' },
  { value: 'both', label: 'Both' },
];

export const laminateFor = ({ thickness, sides }: CoreSettings): FinLaminate => ({
  outside: sides === 'inside' ? 0 : thickness,
  inside: sides === 'outside' ? 0 : thickness,
});

const CORE_KEY = 'bs.fin.core';

const isSettings = (v: unknown): v is CoreSettings => {
  const s = v as CoreSettings | null;
  return (
    !!s &&
    typeof s.thickness === 'number' &&
    s.thickness >= LAMINATE_MIN &&
    s.thickness <= LAMINATE_MAX &&
    SIDES.some((o) => o.value === s.sides)
  );
};

export function CoreExportDialog({
  units,
  pair,
  onExport,
  onClose,
}: {
  units: LengthUnit;
  /** R & L is on: each export writes a left and a right core. */
  pair: boolean;
  onExport: (format: 'step' | 'stl', laminate: FinLaminate) => void;
  onClose: () => void;
}) {
  const [initial] = useState(() =>
    readStored(CORE_KEY, DEFAULT_CORE, (v) => (isSettings(v) ? v : DEFAULT_CORE)),
  );
  // A ply is a fraction of a millimetre: show one more decimal than other lengths.
  const show = (cm: number) => cmToUnitNumber(cm, units).toFixed(unitDecimals(units) + 1);
  const withUnit = (cm: number) => `${show(cm)} ${unitSuffix(units)}`;
  const [text, setText] = useState(() => show(initial.thickness));
  const [sides, setSides] = useState<LaminateSides>(initial.sides);
  const typed = parseTypedLen(text, units);
  const ok = typed !== null && typed >= LAMINATE_MIN - 1e-9 && typed <= LAMINATE_MAX + 1e-9;

  const run = (format: 'step' | 'stl') => {
    if (!ok) return;
    const settings: CoreSettings = { thickness: typed, sides };
    writeStored(CORE_KEY, settings);
    onExport(format, laminateFor(settings));
  };

  return (
    <Modal
      name="fin-core-export"
      label="Export core for laminating"
      onClose={onClose}
      className="grid place-items-center p-4"
    >
      {/* Clicks inside the panel aren't backdrop clicks. */}
      <Panel className="flex w-full max-w-md flex-col" onClick={(e) => e.stopPropagation()}>
        <PanelHeader>
          <PanelTitle>Export core for laminating</PanelTitle>
        </PanelHeader>
        <PanelBody className="space-y-4 text-sm">
          <p className="text-muted-foreground">
            For a printed fin with laminate bagged onto it. The blade is made thinner by the
            laminate on the faces you choose, so with the laminate on it matches your design. It
            never goes under {withUnit(FIN_MIN_THICKNESS)}, so the edges stay as they are. The tab
            is unchanged.
          </p>
          <label className="flex items-center gap-2">
            <span className="flex-1">Laminate thickness, per face</span>
            <NumericInput
              value={text}
              onValueChange={setText}
              onCommit={() => {
                if (ok) setText(show(typed));
              }}
              ariaLabel="Laminate thickness"
              className="w-20 tabular-nums"
              autoFocus
            />
            <span className="w-6 text-xs text-muted-foreground">{unitSuffix(units)}</span>
          </label>
          <p className="text-xs text-muted-foreground">
            {ok
              ? `One ply of 200 gsm unidirectional carbon is about ${show(0.02)}–${withUnit(0.025)}. For more plies, add them up.`
              : `Enter a thickness from ${show(LAMINATE_MIN)} to ${withUnit(LAMINATE_MAX)}.`}
          </p>
          <fieldset className="flex items-center gap-4">
            <legend className="mb-2">Laminate on</legend>
            {SIDES.map((o) => (
              <label key={o.value} className="flex items-center gap-1.5">
                <input
                  type="radio"
                  name="laminate-sides"
                  value={o.value}
                  checked={sides === o.value}
                  onChange={() => setSides(o.value)}
                />
                {o.label}
              </label>
            ))}
          </fieldset>
          {pair && (
            <p className="text-xs text-muted-foreground">
              R &amp; L is on: each export writes a left and a right core.
            </p>
          )}
          <div className="flex flex-wrap justify-end gap-2 pt-2">
            <Button variant="ghost" size="sm" onClick={onClose}>
              Cancel
            </Button>
            <Button variant="outline" size="sm" disabled={!ok} onClick={() => run('stl')}>
              Export STL core
            </Button>
            <Button size="sm" disabled={!ok} onClick={() => run('step')}>
              Export STEP core
            </Button>
          </div>
        </PanelBody>
      </Panel>
    </Modal>
  );
}
