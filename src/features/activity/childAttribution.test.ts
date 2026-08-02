import { describe, expect, it } from 'vitest';

import { childAttribution } from '@/features/activity/childAttribution';

const kids = [
  { id: 'c1', first: 'Mara', color: '#f0a' },
  { id: 'c2', first: 'Tom', color: '#0af' },
];

const SILENT = { name: null, color: null, drawn: '', spoken: '' };

describe('childAttribution', () => {
  it("names the record's own child once a household has two", () => {
    expect(childAttribution('c2', kids)).toEqual({ name: 'Tom', color: '#0af', drawn: ' · Tom', spoken: ', Tom' });
  });

  it('draws the middle dot and speaks a comma, from the same name', () => {
    // The whole reason every form comes out of one call: a screen reader saying
    // "middle dot" is noise, and the forms must never name different children.
    const a = childAttribution('c1', kids);
    expect(a.drawn).toBe(' · Mara');
    expect(a.spoken).toBe(', Mara');
    expect(a.name).toBe('Mara');
  });

  it('hands History the bare name and tint to build its own chip from', () => {
    // The timeline draws an element rather than appending to a line, so it needs
    // the name unattached and the child's avatar colour to tint it with. It
    // still takes `spoken` from here rather than rebuilding one, which is what
    // keeps a drawn chip from going unannounced.
    const a = childAttribution('c1', kids);
    expect(a.name).toBe('Mara');
    expect(a.color).toBe('#f0a');
    expect(a.spoken).toBe(', Mara');
  });

  it('stays silent in a single-child household', () => {
    expect(childAttribution('c1', [{ id: 'c1', first: 'Mara', color: '#f0a' }])).toEqual(SILENT);
  });

  it('stays silent for a record whose child is no longer on the device', () => {
    expect(childAttribution('gone', kids)).toEqual(SILENT);
  });

  it('stays silent for a legacy timer that carries no owner at all', () => {
    // `Timer.childId` is optional because the persisted payloads are cast, not
    // validated. An unattributable timer shows nothing rather than being filed
    // under whoever happens to be selected.
    expect(childAttribution(undefined, kids)).toEqual(SILENT);
  });

  it('names the child but reports no tint when the list carries none', () => {
    // The widget snapshots pass `{ id, first }` alone. A missing tint is not the
    // same as no attribution: the name is still worth saying, and the caller
    // draws it in a neutral colour.
    const a = childAttribution('c2', [
      { id: 'c1', first: 'Mara' },
      { id: 'c2', first: 'Tom' },
    ]);
    expect(a.name).toBe('Tom');
    expect(a.color).toBeNull();
    expect(a.drawn).toBe(' · Tom');
  });
});
