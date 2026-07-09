import { describe, expect, it } from 'vitest';

import { bathToNoteBody, noteToBathEntry } from '@/api/client';
import type { BathEntry } from '@/types/models';

const TIME = Date.parse('2026-03-04T18:30:00.000Z');

describe('bath <-> note serialization', () => {
  it('encodes a small wash as a tagged note the tags own as the source of truth', () => {
    const entry: BathEntry = { id: 'e1', childId: 'c1', type: 'bath', time: TIME, wash: 'small', tags: [] };
    expect(bathToNoteBody(entry)).toEqual({
      child: 'c1',
      time: new Date(TIME).toISOString(),
      note: 'Bath — small wash',
      tags: ['bath', 'small'],
    });
  });

  it('encodes a big wash and keeps user tags after the structural ones', () => {
    const entry: BathEntry = { id: 'e2', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: ['Fussy'] };
    expect(bathToNoteBody(entry)).toEqual({
      child: 'c1',
      time: new Date(TIME).toISOString(),
      note: 'Bath — big wash',
      tags: ['bath', 'big', 'Fussy'],
    });
  });

  it('reads a note back into a bath entry, deriving wash from the tags', () => {
    const note = { id: 42, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath — big wash', tags: ['bath', 'big', 'Fussy'] };
    expect(noteToBathEntry(note, 'c1')).toEqual({
      id: 'bath-42',
      serverId: 42,
      childId: 'c1',
      type: 'bath',
      time: TIME,
      wash: 'big',
      tags: ['Fussy'],
    });
  });

  it('treats a note without a big tag as a small wash', () => {
    const note = { id: 7, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath — small wash', tags: ['bath', 'small'] };
    expect(noteToBathEntry(note, 'c1').wash).toBe('small');
  });

  it('accepts object-shaped tags (taggit) as well as strings', () => {
    const note = { id: 8, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath — big wash', tags: [{ name: 'bath' }, { name: 'big' }] };
    const back = noteToBathEntry(note, 'c1');
    expect(back.wash).toBe('big');
    expect(back.tags).toEqual([]);
  });

  it('round-trips wash and user tags through encode -> server echo -> decode', () => {
    const entry: BathEntry = { id: 'e3', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: ['Fussy'] };
    const body = bathToNoteBody(entry);
    const back = noteToBathEntry({ id: 99, ...body }, 'c1');
    expect(back).toMatchObject({ type: 'bath', childId: 'c1', time: TIME, wash: 'big', tags: ['Fussy'], serverId: 99 });
  });
});
