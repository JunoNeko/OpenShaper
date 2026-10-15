// SPDX-License-Identifier: GPL-3.0-or-later
/** Saving a fin to a `.fin.json` file and opening one, for the fin designer's File buttons. */
import type { FinDesign } from '@openshaper/kernel';
import { FinJsonError, readFinJson, writeFinJson } from '@openshaper/io';
import { download } from '../file-io';

/** A file name stem for the design: `fin-side-left`, `fin-centre`. */
export const finFileStem = (d: FinDesign): string =>
  `fin-${d.position}${d.hand ? `-${d.hand}` : ''}`;

/** A file name for the design: `fin-side-left.fin.json`, `fin-centre.fin.json`. */
export const finFileName = (d: FinDesign): string => `${finFileStem(d)}.fin.json`;

/**
 * Export the design for manufacture and download it: STEP (CNC) or STL (printing),
 * both in mm. The exporters are loaded on first use, so the page doesn't carry them.
 * STEP fits its surfaces on the main thread (about a second), as the board's does.
 */
export async function exportFin(d: FinDesign, format: 'step' | 'stl'): Promise<void> {
  const { exportFinStep, exportFinStl } = await import('@openshaper/export');
  const stem = finFileStem(d);
  if (format === 'step') {
    download(exportFinStep(d, { name: stem }), `${stem}.step`, 'model/step');
  } else {
    download(exportFinStl(d, { name: stem }) as unknown as BlobPart, `${stem}.stl`, 'model/stl');
  }
}

/** Download the design as a `.fin.json` file. */
export const downloadFin = (d: FinDesign): void =>
  download(writeFinJson(d), finFileName(d), 'application/json');

/**
 * Read a chosen file as a fin design. Rejects with a message fit to show the user:
 * the reader's own for a damaged fin file, a plainer one for anything else.
 */
export async function readFinFile(file: Blob): Promise<FinDesign> {
  const text = await file.text();
  try {
    return readFinJson(text).design;
  } catch (e) {
    throw new Error(
      e instanceof FinJsonError
        ? `That file can't be opened as a fin: ${e.message}`
        : "That file can't be opened as a fin.",
      { cause: e },
    );
  }
}
