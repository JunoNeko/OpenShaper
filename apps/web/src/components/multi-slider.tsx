// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * A slider with one or more handles on one track, labelled at its two ends (the Channels
 * panel's Align and Depth blend controls).
 *
 * Values are shares of the track, 0 to 1. Keeping handles in order is the caller's:
 * `onChange` gets the handle and where it was dragged to, and the caller passes back
 * what it made of that. A drag is bracketed by `onStart` and `onEnd`, so the caller can
 * make it one undo step; so is each arrow-key press.
 */
import { useRef, type KeyboardEvent, type PointerEvent } from 'react';
import { cn } from '@openshaper/ui';

export interface SliderHandle {
  value: number;
  /** Its accessible name ("Start", "Full depth from"). */
  label: string;
  /** What screen readers announce for its value (a length, not a share). */
  valueText?: string;
}

/** Keyboard step, as a share of the track; Shift moves ten times as far. */
const KEY_STEP = 0.005;

/** The band's shade where it is full. */
const BAND = 'color-mix(in oklch, var(--foreground) 22%, transparent)';

export function MultiSlider({
  handles,
  ends,
  band,
  onChange,
  onStart,
  onEnd,
  className,
}: {
  handles: readonly SliderHandle[];
  /** The words at the track's left and right ends, if any. */
  ends?: readonly [string, string];
  /**
   * A shaded band behind the track: full between `from` and `to` (shares), fading out to
   * nothing at the track's two ends. The Depth blend draws the depth with it.
   */
  band?: { from: number; to: number };
  onChange: (index: number, value: number) => void;
  onStart?: () => void;
  onEnd?: () => void;
  className?: string;
}) {
  const track = useRef<HTMLDivElement>(null);
  const dragging = useRef<number | null>(null);

  const shareAt = (clientX: number) => {
    const r = track.current?.getBoundingClientRect();
    if (!r || r.width <= 0) return null;
    return Math.min(1, Math.max(0, (clientX - r.left) / r.width));
  };

  const down = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.currentTarget.setPointerCapture?.(e.pointerId);
    dragging.current = i;
    onStart?.();
  };
  const move = (i: number) => (e: PointerEvent<HTMLButtonElement>) => {
    if (dragging.current !== i) return;
    const v = shareAt(e.clientX);
    if (v !== null) onChange(i, v);
  };
  const up = (i: number) => () => {
    if (dragging.current !== i) return;
    dragging.current = null;
    onEnd?.();
  };
  const key = (i: number) => (e: KeyboardEvent<HTMLButtonElement>) => {
    const dir =
      e.key === 'ArrowRight' || e.key === 'ArrowUp'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowDown'
          ? -1
          : 0;
    if (!dir) return;
    e.preventDefault();
    const next = handles[i]!.value + dir * KEY_STEP * (e.shiftKey ? 10 : 1);
    onStart?.();
    onChange(i, Math.min(1, Math.max(0, next)));
    onEnd?.();
  };

  const pct = (v: number) => `${(Math.min(1, Math.max(0, v)) * 100).toFixed(2)}%`;

  return (
    <div className={cn('space-y-1', className)}>
      {ends && (
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{ends[0]}</span>
          <span>{ends[1]}</span>
        </div>
      )}
      <div ref={track} className="relative mx-2 h-5">
        {band && (
          <div
            data-testid="slider-band"
            className="absolute inset-x-0 top-1/2 h-3.5 -translate-y-1/2"
            style={{
              background: `linear-gradient(to right, transparent 0%, ${BAND} ${pct(band.from)}, ${BAND} ${pct(band.to)}, transparent 100%)`,
            }}
          />
        )}
        <div className="absolute inset-x-0 top-1/2 h-px -translate-y-1/2 bg-muted-foreground/50" />
        {handles.map((h, i) => (
          <button
            key={h.label}
            type="button"
            role="slider"
            aria-label={h.label}
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(h.value * 100)}
            aria-valuetext={h.valueText}
            title={h.valueText ? `${h.label}: ${h.valueText}` : h.label}
            onPointerDown={down(i)}
            onPointerMove={move(i)}
            onPointerUp={up(i)}
            onPointerCancel={up(i)}
            onKeyDown={key(i)}
            className={cn(
              'absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 touch-none rounded-full bg-primary',
              'focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring',
            )}
            style={{ left: `${h.value * 100}%` }}
          />
        ))}
      </div>
    </div>
  );
}
