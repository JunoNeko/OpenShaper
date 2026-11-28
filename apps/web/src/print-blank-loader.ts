// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The print-blank exporter and its solid modeller's WebAssembly, loaded only when a
 * blank is exported (`file-io.ts` imports this module dynamically): the modeller is
 * half a megabyte the editor otherwise never needs.
 */
import { exportPrintBlank, type PrintBlankOptions } from '@openshaper/export/print-blank';
import wasmUrl from 'manifold-3d/manifold.wasm?url';

export const printBlank = (
  ...[board, opts]: Parameters<typeof exportPrintBlank>
): ReturnType<typeof exportPrintBlank> =>
  exportPrintBlank(board, { ...(opts as PrintBlankOptions), wasmUrl });
