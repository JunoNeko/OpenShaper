// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The horizontal foil, editable: outside face and inside face over the chord line
 * (docs/design/fin-designer.md, step 12). Drawn four times taller than true, so a
 * 10%-thick foil can be shaped by hand. A symmetric foil (every centre fin) has one
 * face; the other is shown mirrored, dashed. NACA 4-digit presets replace both faces,
 * which stay editable afterwards. The dashed vertical marks the thickest point, where
 * the taper's thickness applies.
 */
import {
  knot,
  parseNaca4,
  prepareBlade,
  splineFromKnots,
  vec2,
  type Spline,
} from '@openshaper/kernel';
import { FinCurveEditor, type FinCurveLayer } from '@openshaper/render2d';
import type { FinState } from '@openshaper/store';
import { Button } from '@openshaper/ui';
import { memo, useCallback, useMemo, useState } from 'react';
import type { StoreApi } from 'zustand/vanilla';
import { curveEditorHandlers, pickFromSelection } from './curve-editor-wiring';
import { useFinState } from './use-fin';

/** Drawn this many times taller than true. */
export const SECTION_Y_SCALE = 4;

/** The presets in the dropdown; "Other…" takes any 4-digit code. */
const SUGGESTED = ['0008', '0010', '0012', '2408', '2410', '2412', '4409', '4412', '6409'];

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

export const FinSectionPane = memo(function FinSectionPane({
  store,
}: {
  store: StoreApi<FinState>;
}) {
  const design = useFinState(store, (s) => s.design);
  const selection = useFinState(store, (s) => s.selection);
  const handlers = useMemo(() => curveEditorHandlers(store), [store]);
  const section = design?.section;

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

  // Where the taper's thickness applies: the root section's thickest point.
  const thickestAt = useMemo(() => (design ? prepareBlade(design).thickestAt : null), [design]);

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
      if (thickestAt !== null) line({ x: thickestAt, y: -0.09 }, { x: thickestAt, y: 0.09 });
      ctx.setLineDash([]);
      ctx.font = '11px system-ui, sans-serif';
      const label = (text: string, p: { x: number; y: number }, align: CanvasTextAlign) => {
        const s = toScreen(p);
        ctx.textAlign = align;
        ctx.fillText(text, s.x, s.y);
      };
      label('Leading edge', { x: 0, y: -0.1 }, 'left');
      label('Trailing edge', { x: 1, y: -0.1 }, 'right');
      if (thickestAt !== null) label('thickest', { x: thickestAt, y: -0.1 }, 'center');
      ctx.restore();
    },
    [thickestAt],
  );

  if (!design || !section) return null;
  const centre = design.position === 'centre';
  return (
    <div className="flex h-full flex-col">
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-2 py-1.5 text-sm">
        <h2 className="text-xs font-medium text-muted-foreground">Foil section</h2>
        <span className="mr-auto flex gap-2 text-xs" aria-hidden>
          <span style={{ color: OUTSIDE }}>— outside</span>
          {section.inside && <span style={{ color: INSIDE }}>— inside</span>}
        </span>
        {!centre && (
          <div className="flex gap-1" role="group" aria-label="Inside face">
            <Button
              size="sm"
              variant={section.inside ? 'outline' : 'default'}
              aria-pressed={!section.inside}
              onClick={() => store.getState().setInsideFace('symmetric')}
            >
              Symmetric
            </Button>
            <Button
              size="sm"
              variant="outline"
              onClick={() => store.getState().setInsideFace('flat')}
            >
              Flat inside
            </Button>
          </div>
        )}
        <NacaPicker store={store} centre={centre} />
      </div>
      <div className="min-h-0 flex-1">
        <FinCurveEditor
          label="Foil section"
          layers={layers}
          selection={pickFromSelection(selection, ['outside', 'inside'])}
          yScale={SECTION_Y_SCALE}
          frameBounds={{ minX: 0, maxX: 1, minY: -0.11, maxY: 0.11 }}
          frameKey={design.position}
          drawUnder={drawUnder}
          {...handlers}
        />
      </div>
    </div>
  );
});
