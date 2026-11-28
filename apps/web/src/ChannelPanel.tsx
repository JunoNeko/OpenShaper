// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Channels panel (print version, owner design 2026-11): bottom channels laid out from a
 * cross-section.
 *
 * The person picks a cross-section and adds the channels there: their widths, offset and
 * how far they follow the rail are measured at it. The numbers are the board's channels (`board.channels`, from 'numbers'); the
 * kernel makes the wall and depth curves from them and the board each time
 * (`layoutChannels`), so changing a number recuts them.
 *
 * - Number, Type, Width, Depth, the two radii and Stringer offset shape the channels
 *   across, at that cross-section.
 * - Align: Centre–Rail is how far the walls follow the outline (Centre: parallel to the
 *   stringer); Tail–Nose is where the channels start and end.
 * - Depth blend: the bar is the channels' length, start to end. They are full depth
 *   between its two handles, and fade to nothing from each handle to its end of the bar;
 *   the shaded band draws that.
 *
 * Each typed change and each slider drag is one undo step. Length fields follow the
 * editor's unit selector (`units`); positions along the board follow its measurement
 * axis (`longitudinal`).
 */
import {
  MAX_CHANNELS,
  applyChannels,
  boardChannelProblems,
  boardChannels,
  channelFullDepth,
  defaultChannelParams,
  getLength,
  resetChannels,
  splineSpan,
  valueAt,
  type BezierBoard,
  type ChannelParams,
  type ChannelWall,
} from '@openshaper/kernel';
import type { BoardState } from '@openshaper/store';
import { Button, cn } from '@openshaper/ui';
import { useSyncExternalStore } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { LenField } from './components/fields';
import { MultiSlider } from './components/multi-slider';
import { fmtLen, type LengthUnit } from './format';
import type { Longitudinal } from './longitudinal';
import { Sel } from './view-toolkit';

type PanelShape = 'step' | 'step-in' | 'scoop' | 'wave';

/** The sections the panel offers, each drawn as two channels side by side, bottom down. */
const TYPES: { shape: PanelShape; label: string; path: string }[] = [
  { shape: 'step', label: 'Step, deepest at the rail side', path: 'M2 12 L16 4 L16 12 L30 4 L30 12' }, // prettier-ignore
  { shape: 'step-in', label: 'Step, deepest at the stringer side', path: 'M30 12 L16 4 L16 12 L2 4 L2 12' }, // prettier-ignore
  { shape: 'scoop', label: 'Scoop', path: 'M2 4 Q9 16 16 4 Q23 16 30 4' },
  { shape: 'wave', label: 'Wave', path: 'M2 12 C6 12 5 4 9 4 C13 4 12 12 16 12 C20 12 19 4 23 4 C27 4 26 12 30 12' }, // prettier-ignore
];

const COUNTS = Array.from({ length: MAX_CHANNELS }, (_, i) => {
  const n = i + 1;
  const label = n === 1 ? '1, on the stringer' : n % 2 ? `${n}, one on the stringer` : `${n}`;
  return { value: String(n), label };
});

/** A step keeps its radii when the type changes away and back, or turns round; others have none. */
const wallFor = (shape: PanelShape, from: ChannelWall): ChannelWall => {
  if (shape !== 'step' && shape !== 'step-in') return { shape };
  const radii = from.shape === 'step' ? { radius: from.radius, lip: from.lip } : { radius: 0, lip: 0.5 }; // prettier-ignore
  return shape === 'step-in'
    ? { shape: 'step', ...radii, deepAt: 'stringer' }
    : { shape: 'step', ...radii };
};

/** The type the picker shows for a wall. */
const shapeOf = (w: ChannelWall): string =>
  w.shape === 'step' && w.deepAt === 'stringer' ? 'step-in' : w.shape;

/** The closest the start and end come (cm). */
const MIN_GAP = 1;

/**
 * `p` with its start or end moved: full depth keeps to inside them, and a blend handle
 * that was on the moved end (no fade there) stays on it.
 */
const movedEnds = (p: ChannelParams, start: number, end: number): Partial<ChannelParams> => {
  const clamp = (x: number) => Math.min(end, Math.max(start, x));
  const fullFrom = p.fullFrom <= p.start ? start : clamp(p.fullFrom);
  const fullTo = p.fullTo >= p.end ? end : Math.max(fullFrom, clamp(p.fullTo));
  return { start, end, fullFrom, fullTo };
};

/** The real cross-sections' positions (not the dummies at either end), with their indices. */
const stations = (b: BezierBoard) =>
  b.crossSections
    .map((cs, index) => ({ x: cs.position, index }))
    .slice(1, Math.max(1, b.crossSections.length - 1));

export interface ChannelSectionPick {
  /** The cross-section shown in the cross-section view. */
  index: number;
}

function TypePicker({ value, onChange }: { value: string; onChange: (s: PanelShape) => void }) {
  return (
    <div role="radiogroup" aria-label="Type" className="flex gap-1">
      {TYPES.map((t) => (
        <button
          key={t.shape}
          type="button"
          role="radio"
          aria-checked={value === t.shape}
          aria-label={t.label}
          title={t.label}
          onClick={() => onChange(t.shape)}
          className={cn(
            'rounded-md border px-1.5 py-1 text-foreground',
            value === t.shape ? 'border-primary bg-primary/10' : 'border-border hover:bg-muted',
          )}
        >
          <svg viewBox="0 0 32 16" className="h-4 w-8" aria-hidden="true">
            <path d={t.path} fill="none" stroke="currentColor" strokeWidth="1.3" />
          </svg>
        </button>
      ))}
    </div>
  );
}

function ChannelFields({
  board,
  params,
  units,
  longitudinal,
  section,
  onChange,
  onDragStart,
  onDragEnd,
}: {
  board: BezierBoard;
  params: ChannelParams;
  units: LengthUnit;
  longitudinal: Longitudinal;
  section: ChannelSectionPick;
  onChange: (p: ChannelParams) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const L = getLength(board);
  const set = (patch: Partial<ChannelParams>) => onChange({ ...params, ...patch });
  const pos = (v: number) => Math.max(0, v);
  const odd = Math.round(params.count) % 2 === 1;
  const step = params.wall.shape === 'step' ? params.wall : null;
  const at = (x: number) => fmtLen(longitudinal.toDisplay(x), units) + longitudinal.mark;
  const share = (x: number) => (L > 0 ? Math.min(1, Math.max(0, x / L)) : 0);
  const sts = stations(board);
  const station = sts.find((s) => Math.abs(s.x - params.station) < 1e-6);
  /** `x` as a share of the channels' length, for the Depth blend bar. */
  const along = (x: number) =>
    params.end > params.start
      ? Math.min(1, Math.max(0, (x - params.start) / (params.end - params.start)))
      : 0;

  return (
    <div className="space-y-1.5">
      <label className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">Number</span>
        <Sel
          value={String(Math.round(params.count))}
          onChange={(v) => set({ count: Number(v) })}
          options={COUNTS}
          title="How many channels, across the whole board"
        />
      </label>
      <div className="flex items-center gap-2">
        <span className="flex-1 text-muted-foreground">Type</span>
        <TypePicker
          value={shapeOf(params.wall)}
          onChange={(shape) => set({ wall: wallFor(shape, params.wall) })}
        />
      </div>
      <LenField
        label="Width"
        valueCm={params.width}
        units={units}
        onCommit={(v) => set({ width: Math.max(0.1, v) })}
      />
      <LenField
        label="Depth"
        valueCm={params.depth}
        units={units}
        onCommit={(v) => set({ depth: pos(v) })}
      />
      <LenField
        label="Radius top"
        valueCm={step?.radius ?? 0}
        units={units}
        disabled={!step}
        onCommit={(v) => step && set({ wall: { ...step, radius: pos(v) } })}
      />
      <LenField
        label="Radius bottom"
        valueCm={step?.lip ?? 0}
        units={units}
        disabled={!step}
        onCommit={(v) => step && set({ wall: { ...step, lip: pos(v) } })}
      />
      <LenField
        label="Stringer offset"
        valueCm={params.inner}
        units={units}
        disabled={odd}
        onCommit={(v) => set({ inner: pos(v) })}
      />

      <div className="space-y-2 pt-2">
        <div className="text-muted-foreground">Align</div>
        <MultiSlider
          ends={['Centre', 'Rail']}
          handles={[
            {
              value: Math.min(1, Math.max(0, params.follow)),
              label: 'Follow the rail',
              valueText: `${Math.round(params.follow * 100)} %`,
            },
          ]}
          onStart={onDragStart}
          onEnd={onDragEnd}
          onChange={(_, v) => set({ follow: v })}
        />
        <MultiSlider
          ends={['Tail', 'Nose']}
          handles={[
            { value: share(params.start), label: 'Start', valueText: at(params.start) },
            { value: share(params.end), label: 'End', valueText: at(params.end) },
          ]}
          onStart={onDragStart}
          onEnd={onDragEnd}
          onChange={(i, v) => {
            const x = v * L;
            if (i === 0) set(movedEnds(params, Math.min(x, params.end - MIN_GAP), params.end));
            else set(movedEnds(params, params.start, Math.max(x, params.start + MIN_GAP)));
          }}
        />
        <p className="text-xs text-muted-foreground">
          From {at(params.start)} to {at(params.end)}
        </p>
      </div>

      <div className="space-y-2 pt-1">
        <div className="text-muted-foreground">Depth blend</div>
        <MultiSlider
          band={{ from: along(params.fullFrom), to: along(params.fullTo) }}
          handles={[
            { value: along(params.fullFrom), label: 'Full depth from', valueText: at(params.fullFrom) }, // prettier-ignore
            { value: along(params.fullTo), label: 'Full depth to', valueText: at(params.fullTo) },
          ]}
          onStart={onDragStart}
          onEnd={onDragEnd}
          onChange={(i, v) => {
            const x = params.start + v * (params.end - params.start);
            if (i === 0) set({ fullFrom: Math.min(x, params.fullTo) });
            else set({ fullTo: Math.max(x, params.fullFrom) });
          }}
        />
        <p className="text-xs text-muted-foreground">
          Full depth from {at(params.fullFrom)} to {at(params.fullTo)}
        </p>
      </div>

      <p className="text-xs text-muted-foreground">
        Laid out from {station ? `cross-section ${station.index}` : at(params.station)}
      </p>
      {section.index !== station?.index && sts.some((s) => s.index === section.index) && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => set({ station: sts.find((t) => t.index === section.index)!.x })}
        >
          Lay out from cross-section {section.index}
        </Button>
      )}
    </div>
  );
}

/** Applied (or drawn) channels: what they are at the cross-section on show, live as its points are dragged. */
function AppliedChannels({
  board,
  units,
  section,
}: {
  board: BezierBoard;
  units: LengthUnit;
  section: ChannelSectionPick;
}) {
  const cs = boardChannels(board);
  const x = board.crossSections[section.index]?.position;
  const rows =
    x === undefined
      ? []
      : cs.flatMap((c, i) => {
          const [a, z] = splineSpan(c.outer);
          if (!(x > a && x < z)) return [];
          const yo = Math.max(0, valueAt(c.outer, x));
          const yi = c.inner ? Math.min(yo, Math.max(0, valueAt(c.inner, x))) : -yo;
          return [{ i, from: Math.max(0, yi), width: yo - yi, depth: channelFullDepth(c, x) }];
        });
  return (
    <div className="space-y-1.5">
      <p className="text-xs text-muted-foreground">
        Applied: on the outline, each wall is a curve to shape like the outline. Double-click it to
        add a point; drag points and handles. On a cross-section, drag a wall point to move the wall
        across, or the point at a channel&apos;s deepest to set its depth; on the rocker, a point
        sets the depth of every channel there. Those ease out to the cross-sections either side.
      </p>
      <div className="text-muted-foreground">At cross-section {section.index}</div>
      {rows.length ? (
        <table className="w-full text-xs tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="text-left font-normal">Channel</th>
              <th className="text-right font-normal">From stringer</th>
              <th className="text-right font-normal">Width</th>
              <th className="text-right font-normal">Depth</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.i}>
                <td>{r.i + 1}</td>
                <td className="text-right">{fmtLen(r.from, units)}</td>
                <td className="text-right">{fmtLen(r.width, units)}</td>
                <td className="text-right">{fmtLen(r.depth, units)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      ) : (
        <p className="text-xs text-muted-foreground">No channels run through it.</p>
      )}
    </div>
  );
}

/** The Channels panel for the sidebar. */
export function ChannelPanel({
  store,
  units,
  longitudinal,
  section,
}: {
  store: StoreApi<BoardState>;
  units: LengthUnit;
  longitudinal: Longitudinal;
  section: ChannelSectionPick;
}) {
  const board = useSyncExternalStore(store.subscribe, () => store.getState().board);
  if (!board) return null;
  const channels = board.channels;
  const problems = boardChannelProblems(board);
  const { setChannels, beginEdit, endEdit } = store.getState();
  const selected = stations(board).find((s) => s.index === section.index);

  return (
    <div className="space-y-2 text-sm">
      {!channels && (
        <>
          <p className="text-xs text-muted-foreground">
            Grooves cut up into the bottom. Select the cross-section to lay them out from, then add
            them there.
          </p>
          <Button
            size="sm"
            variant="outline"
            disabled={!selected}
            onClick={() =>
              selected &&
              setChannels({ from: 'numbers', params: defaultChannelParams(board, selected.x) })
            }
          >
            Add channels
          </Button>
        </>
      )}
      {channels?.from === 'numbers' && (
        <ChannelFields
          board={board}
          params={channels.params}
          units={units}
          longitudinal={longitudinal}
          section={section}
          onChange={(params) => setChannels({ from: 'numbers', params })}
          onDragStart={() => beginEdit('Edit channels')}
          onDragEnd={endEdit}
        />
      )}
      {channels?.from === 'numbers' && (
        <div className="space-y-1 pt-1">
          <Button
            size="sm"
            onClick={() =>
              setChannels(
                applyChannels(
                  board,
                  channels.params,
                  stations(board).map((s) => s.x),
                ),
                'Apply channels',
              )
            }
          >
            Apply
          </Button>
          <p className="text-xs text-muted-foreground">
            Makes them editable: each wall a curve to shape in the outline view with points and
            handles, the depth set at each cross-section they pass.
          </p>
        </div>
      )}
      {channels?.from === 'drawn' && (
        <AppliedChannels board={board} units={units} section={section} />
      )}
      {channels?.from === 'drawn' && channels.params && (
        <div className="space-y-1">
          <Button
            size="sm"
            variant="outline"
            onClick={() => setChannels(resetChannels(channels), 'Reset channels')}
          >
            Reset
          </Button>
          <p className="text-xs text-muted-foreground">
            Back to the numbers they were applied from, clearing every edit.
          </p>
        </div>
      )}
      {problems.length > 0 && (
        <ul role="alert" className="space-y-1 text-xs text-destructive">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {channels && (
        <>
          <p className="text-xs text-muted-foreground">
            Cut into the cross-section and 3D views and the STL; volume and STEP don&apos;t include
            them yet.
          </p>
          <Button size="sm" variant="ghost" onClick={() => setChannels(null)}>
            Remove channels
          </Button>
        </>
      )}
    </div>
  );
}
