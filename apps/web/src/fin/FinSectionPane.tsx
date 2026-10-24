// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The horizontal foil, editable: outside face and inside face over the chord line
 * (docs/design/fin-designer.md, step 12). Drawn four times taller than true, so a
 * 10%-thick foil can be shaped by hand. A symmetric foil (every centre fin) has one
 * face; the other is shown mirrored, dashed. NACA 4-digit presets replace both faces,
 * which stay editable afterwards. The dashed vertical marks the thickest point, where
 * the taper's thickness applies. An asymmetric foil shows how its thickness is shared
 * (outside / inside, top left); typing a share rebuilds the foil as leading-edge radii
 * and straight lines (split-foil.ts).
 */
import {
  finReadouts,
  foilAt,
  foilShare,
  knot,
  parseNaca4,
  splineFromKnots,
  vec2,
  type Spline,
} from '@openshaper/kernel';
import { FinCurveEditor, type FinCurveLayer } from '@openshaper/render2d';
import { getFoil, type FinState } from '@openshaper/store';
import { Button } from '@openshaper/ui';
import { memo, useCallback, useMemo, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { NumericInput } from '../components/numeric-input';
import { fmtLen, type LengthUnit } from '../format';
import { alsoFromSelection, curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { PointTools } from './PointTools';
import { useFinState } from './use-fin';

/** Drawn this many times taller than true. */
export const SECTION_Y_SCALE = 4;

/** Keep the chord line and a strip under it (for the labels) in view; the faces add the rest. */
const SECTION_FRAME = { minX: 0, maxX: 1, minY: -0.03, maxY: 0.01 };

/** The presets in the dropdown; "Other…" takes any 4-digit code. */
const SUGGESTED = ['0008', '0010', '0012', '2408', '2410', '2412', '4409', '4412', '6409'];

const SECTION_CURVES = ['outside', 'inside'] as const;

const OUTSIDE = '#22D3EE';
const INSIDE = '#A78BFA';
const GUIDE = 'rgba(138,155,179,0.7)';

const mirrored = (s: Spline): Spline =>
  splineFromKnots(
    s.knots.map((k) => {
      const m = (p: { x: number; y: number }) => vec2(p.x, -p.y);
      return knot(m(k.end), m(k.tangentToPrev), m(k.tangentToNext), k.continuous);
    }),
  );

/** The preset dropdown's "type any code" choice. */
const OTHER = 'other';

/**
 * A preset dropdown, plus a field for any other 4-digit code. (Not an `<input list>`:
 * browsers filter a datalist by the field's text, so after one Apply it offered only
 * that code.)
 */
function NacaPicker({ store, centre }: { store: StoreApi<FinState>; centre: boolean }) {
  const presets = SUGGESTED.filter((c) => !centre || c.startsWith('00'));
  const [picked, setChoice] = useState(presets[0]!);
  const [code, setCode] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  // A side fin's cambered preset isn't offered on a centre fin: fall back to the first.
  const choice = picked === OTHER || presets.includes(picked) ? picked : presets[0]!;
  const other = choice === OTHER;
  const apply = () => {
    const chosen = other ? code.trim() : choice;
    try {
      const n = parseNaca4(chosen);
      if (centre && n.camber > 0) {
        setProblem('A centre fin needs a symmetric foil: NACA 00xx.');
        return;
      }
    } catch {
      setProblem('Enter a NACA 4-digit code, such as 2412.');
      return;
    }
    setProblem(null);
    store.getState().applyNaca(chosen);
  };
  return (
    <div className="flex flex-wrap items-center gap-1.5">
      <label className="flex items-center gap-1.5">
        <span className="text-muted-foreground">NACA</span>
        <select
          className="h-8 rounded-md border border-input bg-background px-2 tabular-nums"
          value={choice}
          aria-label="NACA preset"
          onChange={(e) => {
            setChoice(e.target.value);
            setProblem(null);
          }}
        >
          {presets.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          <option value={OTHER}>Other…</option>
        </select>
      </label>
      {other && (
        <input
          className="h-8 w-20 rounded-md border border-input bg-background px-2 tabular-nums"
          inputMode="numeric"
          maxLength={4}
          placeholder={centre ? '0010' : '2412'}
          value={code}
          aria-label="NACA 4-digit code"
          onChange={(e) => setCode(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') apply();
          }}
        />
      )}
      <Button size="sm" variant="outline" onClick={apply}>
        Apply
      </Button>
      {problem && (
        <span role="alert" className="w-full text-xs text-destructive">
          {problem}
        </span>
      )}
    </div>
  );
}

/**
 * The section's controls, for the large pane's toolbar: the inside-face choice (side
 * and quad-rear fins) and the NACA presets.
 */
export const FinSectionTools = memo(function FinSectionTools({
  store,
  units,
}: {
  store: StoreApi<FinState>;
  units: LengthUnit;
}) {
  const position = useFinState(store, (s) => s.design?.position);
  const activeFoil = useFinState(store, (s) => s.activeFoil);
  // Asymmetric: the foil has an inside face of its own (flat, split or NACA-cambered).
  const asymmetric = useFinState(store, (s) =>
    s.design ? getFoil(s.design, s.activeFoil)?.inside !== null : false,
  );
  if (!position) return null;
  const centre = position === 'centre';
  return (
    <>
      <FoilTabs store={store} units={units} />
      {activeFoil > 0 && (
        <Button
          size="sm"
          variant="outline"
          onClick={() => store.getState().removeSlice(activeFoil)}
        >
          Remove slice
        </Button>
      )}
      {!centre && (
        <div className="flex gap-1" role="group" aria-label="Inside face">
          <Button
            size="sm"
            variant={asymmetric ? 'outline' : 'default'}
            aria-pressed={!asymmetric}
            onClick={() => store.getState().setInsideFace('symmetric')}
          >
            Symmetric
          </Button>
          <Button
            size="sm"
            variant={asymmetric ? 'default' : 'outline'}
            aria-pressed={asymmetric}
            onClick={() => {
              // Already asymmetric: keep the faces (a split or a NACA camber) as they are.
              if (!asymmetric) store.getState().setInsideFace('flat');
            }}
          >
            Asymmetric
          </Button>
        </div>
      )}
      <NacaPicker store={store} centre={centre} />
      <PointTools store={store} curves={SECTION_CURVES} />
    </>
  );
});

/** Tabs for the foils: the root's and each slice's, by height. */
function FoilTabs({ store, units }: { store: StoreApi<FinState>; units: LengthUnit }) {
  const design = useFinState(store, (s) => s.design);
  const activeFoil = useFinState(store, (s) => s.activeFoil);
  if (!design || design.slices.length === 0) return null;
  const depth = finReadouts(design).depth;
  const tabs = ['Root', ...design.slices.map((sl) => fmtLen(sl.height * depth, units))];
  return (
    <div className="flex gap-1" role="tablist" aria-label="Foil">
      {tabs.map((label, i) => (
        <Button
          key={i}
          size="sm"
          role="tab"
          aria-selected={activeFoil === i}
          variant={activeFoil === i ? 'default' : 'outline'}
          onClick={() => store.getState().setActiveFoil(i)}
        >
          {label}
        </Button>
      ))}
    </div>
  );
}

/**
 * The least share of the thickness the outside face takes (%). 50 / 50 is symmetric,
 * which has its own button; below it the tab would no longer sit under the foil.
 */
const MIN_OUTSIDE = 51;

/** A whole percentage, 0 to 100, or null for anything else. */
const parsePct = (text: string): number | null => {
  const v = Number(text.trim());
  return text.trim() !== '' && Number.isFinite(v) && v >= 0 && v <= 100 ? Math.round(v) : null;
};

/**
 * How an asymmetric foil's thickness is shared: outside above the chord line, inside
 * below, as shapers describe a foil (70 / 30). Typing one fills in the other; Enter or
 * leaving the field builds the foil from it (split-foil.ts).
 */
function SplitFields({ store, share }: { store: StoreApi<FinState>; share: number }) {
  const shown = Math.round(share * 100);
  // What the user is typing in one box, and which box, until it is committed.
  const [draft, setDraft] = useState<{ side: 'outside' | 'inside'; text: string } | null>(null);
  const typed = draft ? parsePct(draft.text) : null;
  const outsideNow = draft
    ? draft.side === 'outside'
      ? draft.text
      : typed === null
        ? ''
        : String(100 - typed)
    : String(shown);
  const insideNow = draft
    ? draft.side === 'inside'
      ? draft.text
      : typed === null
        ? ''
        : String(100 - typed)
    : String(100 - shown);
  const commit = () => {
    if (draft && typed !== null) {
      // At least 51 / 49: an even split is the Symmetric button's.
      const outside = Math.max(MIN_OUTSIDE, draft.side === 'outside' ? typed : 100 - typed);
      store.getState().setFoilSplit(outside / 100);
    }
    setDraft(null);
  };
  const field = (side: 'outside' | 'inside', label: string, color: string, value: string) => (
    <label className="flex flex-col gap-0.5">
      <span style={{ color }}>{label}</span>
      <NumericInput
        value={value}
        onValueChange={(text) => setDraft({ side, text })}
        onCommit={commit}
        onEscape={() => setDraft(null)}
        ariaLabel={`${label} share of the thickness (%)`}
        className="h-7 w-12 px-1 text-center tabular-nums"
      />
    </label>
  );
  return (
    <div
      className="absolute left-2 top-1 z-10 flex items-end gap-1 text-xs"
      role="group"
      aria-label="Outside and inside share of the thickness"
    >
      {field('outside', 'Outside', OUTSIDE, outsideNow)}
      <span className="pb-1.5 text-muted-foreground">/</span>
      {field('inside', 'Inside', INSIDE, insideNow)}
    </div>
  );
}

/** The section canvas. `frameKey` re-fits the view (the pane moving large or small). */
export const FinSectionPane = memo(function FinSectionPane({
  store,
  frameKey = '',
}: {
  store: StoreApi<FinState>;
  frameKey?: string;
}) {
  const design = useFinState(store, (s) => s.design);
  const selection = useFinState(store, (s) => s.selection);
  const activeFoil = useFinState(store, (s) => s.activeFoil);
  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  const section = design ? (getFoil(design, activeFoil) ?? undefined) : undefined;

  const layers = useMemo((): FinCurveLayer[] => {
    if (!section) return [];
    const outside: FinCurveLayer = {
      id: 'outside',
      spline: section.outside,
      editable: true,
      color: OUTSIDE,
    };
    return section.inside
      ? [{ id: 'inside', spline: section.inside, editable: true, color: INSIDE }, outside]
      : [
          {
            id: 'mirror',
            spline: mirrored(section.outside),
            editable: false,
            ghost: true,
            color: OUTSIDE,
          },
          outside,
        ];
  }, [section]);

  // Where the taper's thickness applies: this foil's thickest point.
  const thickestAt = useMemo(() => {
    if (!design) return null;
    const height = activeFoil === 0 ? 0 : (design.slices[activeFoil - 1]?.height ?? 0);
    return foilAt(design, height).thickest.at;
  }, [design, activeFoil]);

  const drawUnder = useCallback(
    (
      ctx: CanvasRenderingContext2D,
      _vp: unknown,
      toScreen: (p: { x: number; y: number }) => { x: number; y: number },
    ) => {
      const line = (a: { x: number; y: number }, b: { x: number; y: number }) => {
        const sa = toScreen(a);
        const sb = toScreen(b);
        ctx.beginPath();
        ctx.moveTo(sa.x, sa.y);
        ctx.lineTo(sb.x, sb.y);
        ctx.stroke();
      };
      ctx.save();
      ctx.strokeStyle = GUIDE;
      ctx.fillStyle = GUIDE;
      ctx.lineWidth = 1;
      ctx.setLineDash([5, 4]);
      line({ x: -0.03, y: 0 }, { x: 1.03, y: 0 }); // the chord line
      // Labels and the thickest-point mark are placed in pixels from the chord line, so
      // they read the same however small the pane is.
      const chord = toScreen({ x: 0, y: 0 }).y;
      const at = (x: number) => toScreen({ x, y: 0 }).x;
      if (thickestAt !== null) {
        ctx.beginPath();
        ctx.moveTo(at(thickestAt), 0);
        ctx.lineTo(at(thickestAt), chord + 20);
        ctx.stroke();
      }
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      const label = (text: string, x: number, dy: number, align: CanvasTextAlign) => {
        ctx.textAlign = align;
        ctx.fillText(text, at(x), chord + dy);
      };
      label('Leading edge', 0, 16, 'left');
      label('Trailing edge', 1, 16, 'right');
      if (thickestAt !== null) label('thickest', thickestAt, 32, 'center');
      ctx.restore();
    },
    [thickestAt],
  );

  if (!design || !section) return null;
  return (
    <div className="relative h-full">
      {section.inside && design.position !== 'centre' ? (
        <SplitFields store={store} share={foilShare(section)} />
      ) : (
        <span
          className="pointer-events-none absolute left-2 top-1 z-10 flex gap-2 text-xs"
          aria-hidden
        >
          <span style={{ color: OUTSIDE }}>— outside</span>
          {section.inside && <span style={{ color: INSIDE }}>— inside</span>}
        </span>
      )}
      <FinCurveEditor
        label="Foil section"
        layers={layers}
        selection={pickFromSelection(selection, ['outside', 'inside'])}
        alsoSelected={alsoFromSelection(selection, ['outside', 'inside'])}
        yScale={SECTION_Y_SCALE}
        frameBounds={SECTION_FRAME}
        frameKey={`${design.position}-${frameKey}`}
        drawUnder={drawUnder}
        {...handlers}
      />
    </div>
  );
});
