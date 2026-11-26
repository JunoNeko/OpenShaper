// SPDX-License-Identifier: GPL-3.0-or-later
import { writeFinJson } from '@openshaper/io';
import { defaultFinDesign, defaultKeel } from '@openshaper/kernel';
import { IDBFactory } from 'fake-indexeddb';
import { describe, expect, it } from 'vitest';
import { addMyFin, defaultFinName, listMyFins, removeMyFin } from './my-fins';

describe('My fins', () => {
  it('keeps fins with their names, newest first, and lets one go', async () => {
    const f = new IDBFactory();
    const a = await addMyFin('Old side', defaultFinDesign('side', 'left'), f);
    await new Promise((r) => setTimeout(r, 5));
    const b = await addMyFin('Big keel', defaultKeel('left'), f);
    const fins = await listMyFins(f);
    expect(fins.map((x) => x.name)).toEqual(['Big keel', 'Old side']);
    expect(writeFinJson(fins[0]!.design)).toBe(writeFinJson(defaultKeel('left')));
    await removeMyFin(a!, f);
    expect((await listMyFins(f)).map((x) => x.id)).toEqual([b]);
  });

  it('is simply empty where the browser keeps nothing', async () => {
    const blocked = { open: () => { throw new Error('blocked'); } } as unknown as IDBFactory; // prettier-ignore
    expect(await listMyFins(blocked)).toEqual([]);
    expect(await addMyFin('x', defaultKeel('left'), blocked)).toBeUndefined();
  });

  it('names a fin by what it is and when', () => {
    expect(defaultFinName(defaultKeel('left'))).toMatch(/^Side fin, /);
    expect(defaultFinName(defaultFinDesign('centre'))).toMatch(/^Centre fin, /);
  });
});
