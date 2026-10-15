// SPDX-License-Identifier: GPL-3.0-or-later
/**
 * The fin autosave, against a fake IndexedDB with real timers (the fake database
 * schedules its own work on timers, so faking them would stall it).
 */
import { readFinJson, writeFinJson } from '@openshaper/io';
import { defaultFinDesign, vec2 } from '@openshaper/kernel';
import { createFinStore } from '@openshaper/store';
import { act, renderHook, waitFor } from '@testing-library/react';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { loadFinSession, saveFinSession } from './fin-session';
import { FIN_AUTOSAVE_MS, useFinAutosave } from './use-fin-autosave';

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));
const storedCant = async (f: IDBFactory) => {
  const text = await loadFinSession(f);
  return text ? readFinJson(text).design.cant : undefined;
};

describe('useFinAutosave', () => {
  it('restores the stored fin, without overwriting it with a default first', async () => {
    const f = new IDBFactory();
    await saveFinSession(writeFinJson({ ...defaultFinDesign('quad-rear', 'right'), cant: 12 }), f);
    const store = createFinStore();
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    expect(store.getState().design!.position).toBe('quad-rear');
    expect(store.getState().design!.cant).toBe(12);
    expect(store.getState().canUndo()).toBe(false); // a restore isn't an edit
    await pause(FIN_AUTOSAVE_MS + 100);
    expect(await storedCant(f)).toBe(12);
  });

  it('starts from a default fin when nothing is stored, and saves edits', async () => {
    const f = new IDBFactory();
    const store = createFinStore();
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    expect(store.getState().design!.position).toBe('side');
    act(() => {
      store.getState().setCant(9);
    });
    await waitFor(async () => expect(await storedCant(f)).toBe(9), { timeout: 3000 });
  });

  it('waits for a drag to end before saving', async () => {
    const f = new IDBFactory();
    const store = createFinStore();
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => {
      store.getState().setCant(5);
    });
    await waitFor(async () => expect(await storedCant(f)).toBe(5), { timeout: 3000 });
    const tip = store.getState().design!.outline.knots[1]!.end;
    act(() => {
      store.getState().beginEdit();
      store.getState().moveControlPoint('outline', 1, vec2(tip.x + 0.2, tip.y));
      store.getState().setCant(6); // lands inside the drag's undo step
    });
    await pause(FIN_AUTOSAVE_MS + 200);
    expect(await storedCant(f)).toBe(5); // nothing saved mid-drag
    act(() => store.getState().endEdit());
    await waitFor(async () => expect(await storedCant(f)).toBe(6), { timeout: 3000 });
  });

  it('saves at once when the page is hidden', async () => {
    const f = new IDBFactory();
    const store = createFinStore();
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    act(() => {
      store.getState().setCant(11);
    });
    act(() => {
      window.dispatchEvent(new Event('pagehide'));
    });
    await waitFor(async () => expect(await storedCant(f)).toBe(11), {
      timeout: FIN_AUTOSAVE_MS / 2,
    });
  });

  it('keeps a fin already in the store rather than restoring over it', async () => {
    const f = new IDBFactory();
    await saveFinSession(writeFinJson(defaultFinDesign('centre')), f);
    const store = createFinStore();
    store.getState().load(defaultFinDesign('side', 'right'));
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    expect(store.getState().design!.position).toBe('side');
  });

  it('drops a damaged autosave and starts from a default', async () => {
    const f = new IDBFactory();
    await saveFinSession('{ not a fin', f);
    const store = createFinStore();
    const { result } = renderHook(() => useFinAutosave(store, f));
    await waitFor(() => expect(result.current).toBe(true));
    expect(store.getState().design!.position).toBe('side');
  });
});
