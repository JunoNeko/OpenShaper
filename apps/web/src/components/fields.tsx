// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Labelled number fields shared by the board's fin panel and the fin designer: a
 * length that follows the unit selector, and an angle in degrees. Each commits on
 * Enter or blur and reverts on Escape. Moved out of FinPanel.tsx unchanged.
 */
import {
  cmToUnitNumber,
  parseTypedLen,
  unitDecimals,
  unitSuffix,
  type LengthUnit,
} from '../format';
import { useSyncedText } from '../use-numeric-field';
import { NumericInput } from './numeric-input';

/** Editable length field (units-aware); commits on Enter/blur, reverts on Escape. */
export function LenField({
  label,
  valueCm,
  units,
  onCommit,
}: {
  label: string;
  valueCm: number;
  units: LengthUnit;
  onCommit: (cm: number) => void;
}) {
  const shown = cmToUnitNumber(valueCm, units).toFixed(unitDecimals(units));
  const [text, setText] = useSyncedText(shown);
  const commit = () => {
    const cm = parseTypedLen(text, units);
    if (cm === null) setText(shown);
    else onCommit(cm);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="flex-1 text-muted-foreground">{label}</span>
      <NumericInput
        value={text}
        onValueChange={setText}
        onCommit={commit}
        onEscape={() => setText(shown)}
        className="w-20 tabular-nums"
      />
      <span className="w-6 text-xs text-muted-foreground">{unitSuffix(units)}</span>
    </label>
  );
}

/** Editable degree field (dimensionless). */
export function DegField({
  label,
  value,
  onCommit,
  disabled,
}: {
  label: string;
  value: number;
  onCommit: (deg: number) => void;
  /** Shown but not editable (a value something else sets). */
  disabled?: boolean;
}) {
  const shown = value.toFixed(1);
  const [text, setText] = useSyncedText(shown);
  const commit = () => {
    const n = Number.parseFloat(text);
    if (Number.isFinite(n)) onCommit(n);
    else setText(shown);
  };
  return (
    <label className="flex items-center gap-2">
      <span className="flex-1 text-muted-foreground">{label}</span>
      <NumericInput
        signed
        disabled={disabled}
        value={text}
        onValueChange={setText}
        onCommit={commit}
        onEscape={() => setText(shown)}
        className="w-20 tabular-nums"
      />
      <span className="w-6 text-xs text-muted-foreground">°</span>
    </label>
  );
}
