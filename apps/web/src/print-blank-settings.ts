// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * Settings for the print-blank export (print version): how deep each fin cavity is cut
 * and the extra room all round. Persisted as a versioned JSON blob in localStorage under
 * 'bs.printBlank'. Modeled on step-export-settings.ts. Lengths in cm.
 */
import { DEFAULT_CAVITY_SETTINGS, type CavitySettings } from '@openshaper/kernel';
import { readStored, writeStored } from './persisted';

const STORAGE_KEY = 'bs.printBlank';

/** Bump when the shape of PrintBlankSettings changes in a breaking way. */
export const PRINT_BLANK_VERSION = 1;

export interface PrintBlankSettings extends CavitySettings {
  version: number;
}

export const DEFAULT_PRINT_BLANK: PrintBlankSettings = {
  version: PRINT_BLANK_VERSION,
  ...DEFAULT_CAVITY_SETTINGS,
};

const finite = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v);

export function migratePrintBlank(blob: Partial<PrintBlankSettings>): PrintBlankSettings {
  const out = { ...DEFAULT_PRINT_BLANK };
  for (const k of Object.keys(DEFAULT_CAVITY_SETTINGS) as (keyof CavitySettings)[]) {
    if (finite(blob[k]) && blob[k] >= 0) out[k] = blob[k];
  }
  return out;
}

export function loadPrintBlank(): PrintBlankSettings {
  return readStored(STORAGE_KEY, DEFAULT_PRINT_BLANK, (p) =>
    migratePrintBlank(p as Partial<PrintBlankSettings>),
  );
}

export function savePrintBlank(s: PrintBlankSettings): void {
  writeStored(STORAGE_KEY, s);
}
