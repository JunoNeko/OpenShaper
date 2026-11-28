// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Print-blank export dialog (print version): the board as an STL to print, with a
 * cavity for each fin's box or plug cut into the bottom and no fins.
 *
 * Shows only the depths that apply to the board's fin system, in the editor's unit,
 * and says what will be cut and what to check before printing. The cutting itself runs
 * in a solid modeller loaded on first use, so Export shows progress and the dialog
 * stays open to report the result.
 *
 * Modeled on ExportStepDialog (Modal + Panel, reset to defaults).
 */
import {
  cavityProblems,
  finCavities,
  FIN_SYSTEM_LABELS,
  type BezierBoard,
  type CavitySettings,
} from '@openshaper/kernel';
import { Button, Panel, PanelBody, PanelHeader, PanelTitle } from '@openshaper/ui';
import { useMemo, useState } from 'react';
import { LenField } from './components/fields';
import { Modal } from './components/modal';
import type { LengthUnit } from './format';
import { DEFAULT_PRINT_BLANK, type PrintBlankSettings } from './print-blank-settings';

export interface ExportPrintBlankDialogProps {
  board: BezierBoard;
  units: LengthUnit;
  /** Current persisted settings, used to pre-populate the form. */
  settings: PrintBlankSettings;
  /** Persist the settings and cut and download the blank; resolves with what was cut. */
  onExport: (
    settings: PrintBlankSettings,
  ) => Promise<{ cavities: number; warnings: readonly string[] }>;
  onClose: () => void;
}

type Status =
  | { kind: 'idle' }
  | { kind: 'working' }
  | { kind: 'done'; cavities: number; warnings: readonly string[] }
  | { kind: 'failed'; message: string };

export function ExportPrintBlankDialog({
  board,
  units,
  settings,
  onExport,
  onClose,
}: ExportPrintBlankDialogProps) {
  const [draft, setDraft] = useState<PrintBlankSettings>({ ...settings });
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const set = (patch: Partial<CavitySettings>) => setDraft((d) => ({ ...d, ...patch }));
  const pos = (v: number) => Math.max(0, v);

  const system = board.fins.system;
  const cavities = useMemo(() => finCavities(board, draft), [board, draft]);
  const problems = useMemo(() => cavityProblems(board, cavities), [board, cavities]);
  const kinds = cavities.reduce<Record<string, number>>((acc, c) => {
    acc[c.kind] = (acc[c.kind] ?? 0) + 1;
    return acc;
  }, {});

  const exportNow = async () => {
    setStatus({ kind: 'working' });
    try {
      const r = await onExport(draft);
      setStatus({ kind: 'done', ...r });
    } catch (e) {
      setStatus({ kind: 'failed', message: e instanceof Error ? e.message : String(e) });
    }
  };

  return (
    <Modal
      name="export-print-blank"
      label="Export blank for printing"
      onClose={onClose}
      className="grid place-items-center p-4"
    >
      <Panel
        className="flex max-h-[90vh] w-full max-w-md flex-col overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <PanelHeader className="flex items-center justify-between">
          <PanelTitle>Export blank for printing</PanelTitle>
          <Button size="sm" variant="ghost" title="Close" onClick={onClose}>
            ✕
          </Button>
        </PanelHeader>

        <PanelBody className="space-y-4 overflow-y-auto text-sm">
          <p className="text-muted-foreground">
            The board as an STL with a cavity in the bottom for each fin&apos;s box or plug, and no
            fins. Channels are cut. Cavity outlines are what each system&apos;s router jig cuts.
          </p>

          <p>
            <span className="text-muted-foreground">Fins: </span>
            {FIN_SYSTEM_LABELS[system]}
            {cavities.length > 0 && (
              <>
                {' — '}
                {Object.entries(kinds)
                  .map(([k, n]) => `${n} × ${k}`)
                  .join(', ')}
              </>
            )}
          </p>
          {cavities.length === 0 && (
            <p className="text-xs text-muted-foreground">
              {board.fins.fins.length === 0
                ? 'This board has no fins: the blank is exported plain. Choose a setup under Build → Fins.'
                : system === 'glass-on'
                  ? 'Glass-on fins need no cavities: the blank is exported plain.'
                  : "Cavities for FCS X-2 plugs aren't known yet: the blank is exported plain."}
            </p>
          )}

          {system === 'futures' && (
            <div className="space-y-1.5">
              <LenField
                label="Flange step depth"
                valueCm={draft.futuresFlangeDepth}
                units={units}
                onCommit={(v) => set({ futuresFlangeDepth: pos(v) })}
              />
              <LenField
                label="F box depth (sides)"
                valueCm={draft.futuresSideDepth}
                units={units}
                onCommit={(v) => set({ futuresSideDepth: pos(v) })}
              />
              <LenField
                label="X box depth (centre)"
                valueCm={draft.futuresCentreDepth}
                units={units}
                onCommit={(v) => set({ futuresCentreDepth: pos(v) })}
              />
              <p className="text-xs text-muted-foreground">
                Flange: 1.6 mm plus 0.8 mm for resin. Boxes: 3/4&quot; F, 1/2&quot; X, plus resin.
                Measure yours.
              </p>
            </div>
          )}
          {system === 'fcs-ii' && (
            <LenField
              label="Plug depth"
              valueCm={draft.fcs2Depth}
              units={units}
              onCommit={(v) => set({ fcs2Depth: pos(v) })}
            />
          )}
          {cavities.length > 0 && (
            <LenField
              label="Extra room all round"
              valueCm={draft.clearance}
              units={units}
              onCommit={(v) => set({ clearance: pos(v) })}
            />
          )}

          {problems.length > 0 && (
            <ul role="alert" className="space-y-1 text-xs text-destructive">
              {problems.map((p) => (
                <li key={p}>{p}</li>
              ))}
            </ul>
          )}

          {status.kind === 'working' && (
            <p className="text-xs text-muted-foreground">Cutting the cavities…</p>
          )}
          {status.kind === 'done' && (
            <p role="status" className="text-xs">
              Exported, {status.cavities} cavit{status.cavities === 1 ? 'y' : 'ies'} cut.
            </p>
          )}
          {status.kind === 'failed' && (
            <p role="alert" className="text-xs text-destructive">
              The blank couldn&apos;t be cut: {status.message}
            </p>
          )}
        </PanelBody>

        <div className="flex items-center justify-between gap-2 border-t border-border px-4 py-3">
          <Button size="sm" variant="ghost" onClick={() => setDraft({ ...DEFAULT_PRINT_BLANK })}>
            Reset to defaults
          </Button>
          <div className="flex gap-2">
            <Button size="sm" variant="ghost" onClick={onClose}>
              {status.kind === 'done' ? 'Close' : 'Cancel'}
            </Button>
            <Button size="sm" disabled={status.kind === 'working'} onClick={exportNow}>
              Export
            </Button>
          </div>
        </div>
      </Panel>
    </Modal>
  );
}
