// SPDX-License-Identifier: GPL-3.0-or-later
/** Saving a fin to a `.fin.json` file and opening one, for the fin designer's File buttons. */
import type { FinDesign } from '@openshaper/kernel';
import { FinJsonError, readFinJson, writeFinJson } from '@openshaper/io';
import { download } from '../file-io';

/** A file name for the design: `fin-side-left.fin.json`, `fin-centre.fin.json`. */
export const finFileName = (d: FinDesign): string =>
  `fin-${d.position}${d.hand ? `-${d.hand}` : ''}.fin.json`;

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
