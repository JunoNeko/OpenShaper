// SPDX-License-Identifier: GPL-3.0-or-later
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { board, defaultFinConfig, type FinSetup, type FinSystem } from '@openshaper/kernel';
import { parseBrd } from '@openshaper/io';
import { ExportPrintBlankDialog } from './ExportPrintBlankDialog';
import { LENGTH_UNITS } from './format';
import { DEFAULT_PRINT_BLANK, migratePrintBlank } from './print-blank-settings';

const golden = resolve(dirname(fileURLToPath(import.meta.url)), '../../../docs/specs/golden');
const shortboard = parseBrd(readFileSync(resolve(golden, 'shortboard.brd'), 'utf8')).board;
const withFins = (setup: FinSetup, system: FinSystem) => {
  const b = shortboard;
  return board(b.outline, b.bottom, b.deck, b.crossSections, b.interpolationType, defaultFinConfig(setup, system)); // prettier-ignore
};
const mm = LENGTH_UNITS.find((u) => u.key === 'mm')!;

const open = (system: FinSystem, onExport = vi.fn(async () => ({ cavities: 3, warnings: [] }))) => {
  render(
    <ExportPrintBlankDialog
      board={withFins('thruster', system)}
      units={mm}
      settings={DEFAULT_PRINT_BLANK}
      onExport={onExport}
      onClose={() => {}}
    />,
  );
  return onExport;
};

describe('<ExportPrintBlankDialog />', () => {
  it('Futures: says what it will cut and asks the flange and box depths, in mm', () => {
    open('futures');
    expect(screen.getByText(/2 × Futures F, 1 × Futures X/)).toBeTruthy();
    expect((screen.getByLabelText(/^Flange step depth/) as HTMLInputElement).value).toBe('2.4');
    expect(screen.getByLabelText(/^F box depth/)).toBeTruthy();
    expect(screen.getByLabelText(/^X box depth/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Plug depth/)).toBeNull();
  });

  it('FCS II: the plug depth only, 18.5 mm', () => {
    open('fcs-ii');
    expect(screen.getByText(/3 × FCS II/)).toBeTruthy();
    expect((screen.getByLabelText(/^Plug depth/) as HTMLInputElement).value).toBe('18.5');
    expect(screen.queryByLabelText(/^Flange step depth/)).toBeNull();
  });

  it('glass-on: nothing to cut, said so', () => {
    open('glass-on');
    expect(screen.getByText(/Glass-on fins need no cavities/)).toBeTruthy();
    expect(screen.queryByLabelText(/^Extra room/)).toBeNull();
  });

  it('a board with no fins: said so, not blamed on the fin system', () => {
    render(
      <ExportPrintBlankDialog
        board={withFins('none', 'fcs-ii')}
        units={mm}
        settings={DEFAULT_PRINT_BLANK}
        onExport={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByText(/This board has no fins/)).toBeTruthy();
  });

  it('exports with the depths typed in, and reports what was cut', async () => {
    const onExport = open('fcs-ii');
    const field = screen.getByLabelText(/^Plug depth/);
    fireEvent.change(field, { target: { value: '20' } });
    fireEvent.blur(field);
    fireEvent.click(screen.getByRole('button', { name: 'Export' }));
    await waitFor(() => expect(screen.getByRole('status').textContent).toMatch(/3 cavities cut/));
    expect(onExport).toHaveBeenCalledWith(expect.objectContaining({ fcs2Depth: 2 }));
  });

  it('warns before export when a cavity leaves too little board above it', () => {
    render(
      <ExportPrintBlankDialog
        board={withFins('thruster', 'fcs-ii')}
        units={mm}
        settings={{ ...DEFAULT_PRINT_BLANK, fcs2Depth: 9 }}
        onExport={vi.fn()}
        onClose={() => {}}
      />,
    );
    expect(screen.getByRole('alert').textContent).toMatch(/leaves .* mm of board above it/);
  });

  it('settings: keep what was saved, default what is missing or nonsense', () => {
    expect(migratePrintBlank({ fcs2Depth: 2.1, clearance: -1 })).toMatchObject({
      fcs2Depth: 2.1,
      clearance: 0,
      futuresFlangeDepth: 0.24,
    });
  });
});
