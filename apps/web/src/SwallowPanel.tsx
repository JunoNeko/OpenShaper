// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Swallow Tail panel (print version, owner design 2026-11).
 *
 * 1. The person sets the notch's width across the tail and its depth up the stringer,
 *    and how its inside wall climbs to the deck: beveled at an angle, or rounded.
 * 2. Apply notches the outline and sets the wall. The outline view draws the notch as
 *    outline points and the deck line, where the wall meets the deck, dashed.
 * 3. There, dragging the stringer point changes the depth, the deck line's point the
 *    wall, and the tip's handle curves the notch: the deck line follows it.
 *
 * The fields show the board's notch and wall when it has them, so they follow those
 * drags. Apply with only the wall changed keeps the notch as drawn, curve and all. One
 * undo step each. Lengths follow the editor's unit selector (`units`).
 */
import {
  DEFAULT_SWALLOW_SIZE,
  DEFAULT_SWALLOW_WALL,
  MAX_BEVEL,
  hasTailCutout,
  swallowSize,
  type SwallowWall,
} from '@openshaper/kernel';
import type { BoardState } from '@openshaper/store';
import { Button, cn } from '@openshaper/ui';
import { useState, useSyncExternalStore, type ReactNode } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { LenField } from './components/fields';
import { NumericInput } from './components/numeric-input';
import type { LengthUnit } from './format';
import { useSyncedText } from './use-numeric-field';

interface Draft {
  width: number;
  depth: number;
  kind: SwallowWall['kind'];
  angle: number;
  /** Roundness, percent. */
  size: number;
}

const draftOf = (
  size: { width: number; depth: number } | null,
  wall: SwallowWall | null,
): Draft => {
  const w = wall ?? DEFAULT_SWALLOW_WALL;
  return {
    width: size?.width ?? DEFAULT_SWALLOW_SIZE.width,
    depth: size?.depth ?? DEFAULT_SWALLOW_SIZE.depth,
    kind: w.kind,
    angle: w.kind === 'bevel' ? w.angle : 45,
    size: w.kind === 'round' ? w.size * 100 : 80,
  };
};

/** A small unitless number field (degrees, percent): commits on Enter or blur. */
function SmallNumber({
  label,
  value,
  onCommit,
}: {
  label: string;
  value: number;
  onCommit: (v: number) => void;
}) {
  const shown = String(Math.round(value * 10) / 10);
  const [text, setText] = useSyncedText(shown);
  return (
    <NumericInput
      ariaLabel={label}
      value={text}
      onValueChange={setText}
      onCommit={() => {
        const n = Number.parseFloat(text);
        if (Number.isFinite(n)) onCommit(n);
        else setText(shown);
      }}
      onEscape={() => setText(shown)}
      className="w-14 tabular-nums"
    />
  );
}

function WallOption({
  label,
  selected,
  icon,
  onSelect,
  children,
}: {
  label: string;
  selected: boolean;
  icon: string;
  onSelect: () => void;
  children: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center gap-1">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          role="radio"
          aria-checked={selected}
          aria-label={label}
          title={label}
          onClick={onSelect}
          className={cn(
            'rounded-md border px-1 py-1 text-foreground',
            selected ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
          )}
        >
          <svg viewBox="0 0 16 16" className="h-5 w-5" aria-hidden="true">
            <path d={icon} fill="none" stroke="currentColor" strokeWidth="1.5" />
          </svg>
        </button>
        {children}
      </div>
      <span className={cn('text-xs', selected ? 'text-foreground' : 'text-muted-foreground')}>
        {label}
      </span>
    </div>
  );
}

export function SwallowPanel({ store, units }: { store: StoreApi<BoardState>; units: LengthUnit }) {
  const outline = useSyncExternalStore(store.subscribe, () => store.getState().board?.outline);
  const wall = useSyncExternalStore(store.subscribe, () => store.getState().board?.swallow);
  const size = outline ? swallowSize(outline) : null;
  const notched = outline ? hasTailCutout(outline) : false;

  // Typed values, until the board's own notch or wall changes (an Apply, a drag, undo).
  const from = draftOf(size, wall ?? null);
  const key = JSON.stringify(from);
  const [draft, setDraft] = useState<{ key: string; d: Draft }>({ key, d: from });
  if (draft.key !== key) setDraft({ key, d: from });
  const d = draft.key === key ? draft.d : from;
  const set = (patch: Partial<Draft>) => setDraft({ key, d: { ...d, ...patch } });
  const [problem, setProblem] = useState<string | null>(null);

  const apply = () => {
    const w: SwallowWall =
      d.kind === 'bevel'
        ? { kind: 'bevel', angle: Math.min(MAX_BEVEL, Math.max(0, d.angle)) }
        : { kind: 'round', size: Math.min(100, Math.max(0, d.size)) / 100 };
    const ok = store.getState().applySwallowTail(d.width, d.depth, w);
    setProblem(ok ? null : 'The board is never that wide: make the width smaller.');
  };

  return (
    <div className="space-y-3 text-sm">
      <div className="space-y-1.5">
        <LenField
          label="Width"
          valueCm={d.width}
          units={units}
          onCommit={(v) => set({ width: Math.max(0.1, v) })}
        />
        <LenField
          label="Depth"
          valueCm={d.depth}
          units={units}
          onCommit={(v) => set({ depth: Math.max(0.1, v) })}
        />
      </div>

      <div className="space-y-1.5">
        <div className="text-muted-foreground">Inside wall</div>
        <div role="radiogroup" aria-label="Inside wall" className="flex justify-between gap-2">
          <WallOption
            label="Beveled"
            selected={d.kind === 'bevel'}
            icon="M3 14 L13 2 M3 14 L14 14"
            onSelect={() => set({ kind: 'bevel' })}
          >
            <SmallNumber
              label="Bevel angle"
              value={d.angle}
              onCommit={(v) => set({ kind: 'bevel', angle: Math.min(MAX_BEVEL, Math.max(0, v)) })}
            />{' '}
            {/* prettier-ignore */}
            <span className="text-xs text-muted-foreground">°</span>
          </WallOption>
          <WallOption
            label="Rounded"
            selected={d.kind === 'round'}
            icon="M4 14 L4 8 Q4 3 13 3"
            onSelect={() => set({ kind: 'round' })}
          >
            <SmallNumber
              label="Roundness"
              value={d.size}
              onCommit={(v) => set({ kind: 'round', size: Math.min(100, Math.max(0, v)) })}
            />{' '}
            {/* prettier-ignore */}
            <span className="text-xs text-muted-foreground">%</span>
          </WallOption>
        </div>
      </div>

      <div className="flex gap-2">
        <Button size="sm" variant="secondary" onClick={apply} disabled={!outline}>
          Apply
        </Button>
        {notched && (
          <Button size="sm" variant="ghost" onClick={() => store.getState().removeSwallowTail()}>
            Remove
          </Button>
        )}
      </div>
      {problem && (
        <p role="alert" className="text-xs text-destructive">
          {problem}
        </p>
      )}
      <p className="text-xs text-muted-foreground">
        {notched
          ? 'In the outline: drag the point on the stringer for the depth, the dashed deck line’s point for the wall, and the tip’s handle to curve the notch.'
          : 'Apply cuts the notch into the outline. Then shape it there with its points.'}
      </p>
    </div>
  );
}
