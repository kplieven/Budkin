import { describe, expect, it } from 'vitest';

import { mapNoteBody, mapTagList, planForNote, tagNames } from './migrate-bath-tags.mjs';

describe('tagNames', () => {
  it('accepts both the object and string tag shapes', () => {
    expect(tagNames([{ name: 'bath' }, 'big'])).toEqual(['bath', 'big']);
    expect(tagNames(undefined)).toEqual([]);
  });
});

describe('mapTagList', () => {
  it('rewrites the size tags', () => {
    expect(mapTagList(['bath', 'small'])).toEqual(['bath', 'bath:quick']);
    expect(mapTagList(['bath', 'big'])).toEqual(['bath', 'bath:full']);
  });

  it('leaves the bath marker and user tags alone, preserving order', () => {
    expect(mapTagList(['bath', 'big', 'Fussy', 'Evening'])).toEqual(['bath', 'bath:full', 'Fussy', 'Evening']);
  });

  it('does not touch a word that merely contains a size name', () => {
    expect(mapTagList(['bath', 'smallish', 'bigger'])).toEqual(['bath', 'smallish', 'bigger']);
  });

  it('drops a duplicate the mapping would create', () => {
    expect(mapTagList(['bath', 'big', 'bath:full'])).toEqual(['bath', 'bath:full']);
  });

  it('is idempotent', () => {
    expect(mapTagList(['bath', 'bath:full', 'Fussy'])).toEqual(['bath', 'bath:full', 'Fussy']);
  });
});

describe('mapNoteBody', () => {
  it('rewrites only a body Budkin generated', () => {
    expect(mapNoteBody('Bath, small wash')).toBe('Quick wash');
    expect(mapNoteBody('Bath, big wash')).toBe('Full bath');
  });

  it('leaves a hand-edited body byte-identical', () => {
    for (const body of ['Bath, big wash. Screamed.', 'bath, big wash', 'Bath', '', 'Full bath']) {
      expect(mapNoteBody(body)).toBe(body);
    }
  });
});

describe('planForNote', () => {
  it('plans a pre-migration bath note', () => {
    const plan = planForNote({ id: 1, note: 'Bath, big wash', tags: ['bath', 'big'] });
    expect(plan).toEqual({
      oldTags: ['bath', 'big'],
      newTags: ['bath', 'bath:full'],
      oldBody: 'Bath, big wash',
      newBody: 'Full bath',
      tagsChanged: true,
      bodyChanged: true,
    });
  });

  // The scoping rule. `small` and `big` are ordinary words that may tag anything.
  it('returns null for a note without the bath tag, even when it carries a size word', () => {
    expect(planForNote({ id: 2, note: 'Bought a big pram', tags: ['small', 'big'] })).toBeNull();
  });

  it('returns null for an already-migrated note', () => {
    expect(planForNote({ id: 3, note: 'Full bath', tags: ['bath', 'bath:full'] })).toBeNull();
  });

  it('plans tags alone when the body was hand-edited', () => {
    const plan = planForNote({ id: 4, note: 'Bath, big wash. Screamed.', tags: ['bath', 'big'] });
    expect(plan.tagsChanged).toBe(true);
    expect(plan.bodyChanged).toBe(false);
    expect(plan.newBody).toBe('Bath, big wash. Screamed.');
  });
});
