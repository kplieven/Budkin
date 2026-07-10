import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BabybuddyClient,
  bathToNoteBody,
  childBody,
  HIDDEN_TAGS,
  isBathNote,
  mapProfile,
  nativePicturePart,
  noteToBathEntry,
  noteToNoteBody,
  noteToNoteEntry,
} from '@/api/client';
import type { BathEntry, Child, Entry, NoteEntry, PickedPhoto } from '@/types/models';

const TIME = Date.parse('2026-03-04T18:30:00.000Z');

// birth built via a local Date so toDateStr (local-time) is timezone-stable
const CHILD: Child = { id: '5', first: 'Mira', last: 'Doe', birth: new Date(2025, 0, 15).getTime(), color: '#EC9A66' };

describe('child serialization', () => {
  it('childBody serializes name + birth date, no picture key by default', () => {
    expect(childBody(CHILD)).toEqual({ first_name: 'Mira', last_name: 'Doe', birth_date: '2025-01-15' });
  });

  it('childBody sets picture: null when clearing the photo', () => {
    expect(childBody(CHILD, true)).toEqual({
      first_name: 'Mira',
      last_name: 'Doe',
      birth_date: '2025-01-15',
      picture: null,
    });
  });

  it('nativePicturePart maps a picked photo to the RN file descriptor', () => {
    const photo: PickedPhoto = { uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/png' };
    expect(nativePicturePart(photo)).toEqual({ uri: 'file:///tmp/a.jpg', name: 'a.jpg', type: 'image/png' });
  });
});

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

// The tag system: `/api/tags/` returns { name, color, last_used } objects, and
// entries carry tag NAMES (string[]). listTags maps the color (dropping an
// empty one) and parses last_used to epoch ms. HIDDEN_TAGS names structural
// tags the picker must never surface or let the user create.
describe('listTags + HIDDEN_TAGS', () => {
  const ISO = '2026-03-04T18:30:00.000Z';
  const TIME = Date.parse(ISO);

  function stubFetch(response: unknown) {
    const calls: { url: string; body: any }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
      return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());
  const client = () => new BabybuddyClient('https://x', 't');

  it('maps name + color + last_used, hitting /api/tags/ with a limit', async () => {
    const calls = stubFetch({
      count: 1,
      next: null,
      previous: null,
      results: [{ name: 'Fussy', color: '#ff8800', last_used: ISO }],
    });
    const tags = await client().listTags();
    expect(calls[0].url).toContain('/tags/');
    expect(calls[0].url).toContain('limit=100');
    expect(tags).toEqual([{ name: 'Fussy', color: '#ff8800', lastUsed: TIME }]);
  });

  it('tolerates a missing/empty color and a missing last_used', async () => {
    stubFetch({
      count: 2,
      next: null,
      previous: null,
      results: [
        { name: 'Cluster' },
        { name: 'Sleepy', color: '' },
      ],
    });
    const tags = await client().listTags();
    expect(tags).toEqual([
      { name: 'Cluster', color: undefined, lastUsed: undefined },
      { name: 'Sleepy', color: undefined, lastUsed: undefined },
    ]);
  });

  it('HIDDEN_TAGS covers the bath structural tags plus the breastfeeding side markers', () => {
    for (const t of ['bath', 'small', 'big', 'left', 'right']) {
      expect(HIDDEN_TAGS.has(t)).toBe(true);
    }
    expect(HIDDEN_TAGS.has('Fussy')).toBe(false);
    expect(HIDDEN_TAGS.has('Left side')).toBe(false);
  });
});

// The real Baby Buddy `/api/profile/` response (verified against
// babybuddy/api/serializers.py `ProfileSerializer` + `UserSerializer`):
// account fields nest under a `user` object, `language`/`timezone` are
// top-level on the profile itself (NOT under a `settings` sub-object,
// despite the backing model being named `Settings`), and
// `dashboard_refresh_rate` is a real field on that model but is
// deliberately excluded from `ProfileSerializer.Meta.fields`, so it's never
// present in a stock server's response.
describe('mapProfile', () => {
  it('maps the real /api/profile/ shape: nested user, top-level language/timezone', () => {
    const raw = {
      user: { id: 1, username: 'alex', first_name: 'Alex', last_name: 'Doe', email: 'alex@example.com', is_staff: true },
      language: 'en',
      timezone: 'America/Chicago',
      api_key: 'deadbeef',
    };
    expect(mapProfile(raw)).toEqual({
      username: 'alex',
      firstName: 'Alex',
      lastName: 'Doe',
      email: 'alex@example.com',
      language: 'en',
      timezone: 'America/Chicago',
      dashboardRefreshRate: undefined,
    });
  });

  it('degrades gracefully when the user object and fields are missing', () => {
    expect(mapProfile({})).toEqual({
      username: undefined,
      firstName: undefined,
      lastName: undefined,
      email: undefined,
      language: undefined,
      timezone: undefined,
      dashboardRefreshRate: undefined,
    });
  });

  it('degrades gracefully on null/undefined input', () => {
    expect(mapProfile(null)).toEqual({
      username: undefined,
      firstName: undefined,
      lastName: undefined,
      email: undefined,
      language: undefined,
      timezone: undefined,
      dashboardRefreshRate: undefined,
    });
    expect(mapProfile(undefined)).toEqual({
      username: undefined,
      firstName: undefined,
      lastName: undefined,
      email: undefined,
      language: undefined,
      timezone: undefined,
      dashboardRefreshRate: undefined,
    });
  });

  it('treats empty-string user fields as absent', () => {
    const raw = { user: { username: '', first_name: '', last_name: '', email: '' }, language: 'en', timezone: 'UTC' };
    const p = mapProfile(raw);
    expect(p.username).toBeUndefined();
    expect(p.firstName).toBeUndefined();
    expect(p.lastName).toBeUndefined();
    expect(p.email).toBeUndefined();
  });
});

// Per-entry free-text `notes` on the five real activity resources (bath is
// excluded — its note body is structural). These exercise the private
// buildBody via createEntry/updateEntry (capturing the JSON sent to fetch) and
// each list mapper via a canned paginated response.
describe('per-entry notes', () => {
  const ISO = '2026-03-04T18:30:00.000Z';

  // Capture requests + return a canned JSON body from a stubbed global fetch.
  function stubFetch(response: unknown) {
    const calls: { url: string; body: any }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
      return {
        ok: true,
        status: 200,
        json: async () => response,
        text: async () => JSON.stringify(response),
      } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }

  afterEach(() => vi.unstubAllGlobals());

  const client = () => new BabybuddyClient('https://x', 't');

  // one representative entry per real type, each carrying a note
  const withNotes: Record<string, Entry> = {
    feeding: { id: 'f1', childId: 'c1', type: 'feeding', start: TIME, end: TIME, feedType: 'breast', method: 'left', amount: null, tags: [], notes: 'spit up a lot' },
    sleep: { id: 's1', childId: 'c1', type: 'sleep', start: TIME, end: TIME, nap: true, tags: [], notes: 'went down easy' },
    diaper: { id: 'd1', childId: 'c1', type: 'diaper', time: TIME, wet: true, solid: false, color: null, tags: [], notes: 'small leak' },
    pumping: { id: 'p1', childId: 'c1', type: 'pumping', start: TIME, end: TIME, amount: 90, tags: [], notes: 'left side more' },
    tummy: { id: 't1', childId: 'c1', type: 'tummy', start: TIME, end: TIME, milestone: 'rolled', tags: [], notes: 'lasted longer' },
  };

  for (const [type, entry] of Object.entries(withNotes)) {
    it(`buildBody sends notes through on a ${type} create`, async () => {
      const calls = stubFetch({ id: 1 });
      await client().createEntry(entry);
      expect(calls[0].body.notes).toBe((entry as any).notes);
    });

    it(`buildBody sends an empty-string notes to clear on a ${type} update`, async () => {
      const calls = stubFetch({});
      await client().updateEntry({ ...entry, serverId: 9, notes: undefined } as Entry);
      expect(calls[0].body.notes).toBe('');
    });
  }

  it('does not add a notes field to a bath note body (bath excluded)', async () => {
    const calls = stubFetch({ id: 1 });
    const bath: BathEntry = { id: 'b1', childId: 'c1', type: 'bath', time: TIME, wash: 'small', tags: [] };
    await client().createEntry(bath);
    expect('notes' in calls[0].body).toBe(false);
  });

  const page = (row: Record<string, unknown>) => ({ count: 1, next: null, previous: null, results: [row] });

  it('listFeedings maps a present notes and drops an empty one', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: null, notes: 'good latch', tags: [] }));
    expect((await client().listFeedings('c1'))[0].notes).toBe('good latch');
    stubFetch(page({ id: 2, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: null, notes: '', tags: [] }));
    expect((await client().listFeedings('c1'))[0].notes).toBeUndefined();
  });

  it('listSleep maps notes', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, nap: true, notes: 'restless', tags: [] }));
    expect((await client().listSleep('c1'))[0].notes).toBe('restless');
  });

  it('listChanges maps notes', async () => {
    stubFetch(page({ id: 1, time: ISO, wet: true, solid: false, color: '', amount: null, notes: 'blowout', tags: [] }));
    expect((await client().listChanges('c1'))[0].notes).toBe('blowout');
  });

  it('listPumping maps notes', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, amount: 100, notes: 'both sides', tags: [] }));
    expect((await client().listPumping('c1'))[0].notes).toBe('both sides');
  });

  it('listTummy maps notes', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, milestone: 'held head', notes: 'strong', tags: [] }));
    expect((await client().listTummy('c1'))[0].notes).toBe('strong');
  });

  it('round-trips a note through buildBody -> server echo -> list mapper', async () => {
    const create = stubFetch({ id: 55 });
    await client().createEntry(withNotes.feeding);
    const echoed = create[0].body; // what the server received
    stubFetch(page({ id: 55, ...echoed }));
    const back = (await client().listFeedings('c1'))[0];
    expect(back.notes).toBe('spit up a lot');
  });
});

// Temperature is a POINT event on Baby Buddy's /api/temperature/ resource:
// a decimal reading + a single `time` + notes + tags. These exercise buildBody
// (via createEntry/updateEntry) and the listTemperature mapper.
describe('temperature serialization', () => {
  const ISO = '2026-03-04T18:30:00.000Z';

  function stubFetch(response: unknown) {
    const calls: { url: string; body: any }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
      return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());
  const client = () => new BabybuddyClient('https://x', 't');

  it('buildBody sends child/time/temperature/notes/tags to the temperature endpoint on create', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'tp1', childId: 'c1', type: 'temperature', time: TIME, value: 37.4, notes: 'warm', tags: ['Fussy'] };
    await client().createEntry(entry);
    expect(calls[0].url).toContain('/temperature/');
    expect(calls[0].body).toEqual({ child: 'c1', time: ISO, temperature: 37.4, notes: 'warm', tags: ['Fussy'] });
  });

  it('buildBody sends an empty-string notes to clear on a temperature update', async () => {
    const calls = stubFetch({});
    const entry: Entry = { id: 'tp2', serverId: 9, childId: 'c1', type: 'temperature', time: TIME, value: 36.8, tags: [] };
    await client().updateEntry(entry);
    expect(calls[0].body.notes).toBe('');
    expect(calls[0].body.temperature).toBe(36.8);
  });

  it('listTemperature maps id/serverId/time/value/notes/tags', async () => {
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 12, time: ISO, temperature: '37.60', notes: 'slight fever', tags: ['Fussy'] }] });
    const [e] = await client().listTemperature('c1');
    expect(e).toEqual({
      id: 'temperature-12',
      serverId: 12,
      childId: 'c1',
      type: 'temperature',
      time: TIME,
      value: 37.6,
      notes: 'slight fever',
      tags: ['Fussy'],
    });
  });

  it('listTemperature drops an empty notes to undefined and reads object-shaped tags', async () => {
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 13, time: ISO, temperature: '37.0', notes: '', tags: [{ name: 'Sleepy' }] }] });
    const [e] = await client().listTemperature('c1');
    expect(e.notes).toBeUndefined();
    expect(e.tags).toEqual(['Sleepy']);
  });

  it('round-trips a reading through buildBody -> server echo -> list mapper', async () => {
    const entry: Entry = { id: 'tp3', childId: 'c1', type: 'temperature', time: TIME, value: 38.1, notes: 'evening', tags: [] };
    const create = stubFetch({ id: 77 });
    await client().createEntry(entry);
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 77, ...create[0].body }] });
    const back = (await client().listTemperature('c1'))[0];
    expect(back).toMatchObject({ type: 'temperature', time: TIME, value: 38.1, notes: 'evening', serverId: 77 });
  });
});

// General notes ride on the SAME `/api/notes/` endpoint as baths, discriminated
// only by the `bath` tag. These exercise the single-fetch partition
// (listChildNotes), the note body builder (strips structural tags), and the
// note<->entry mappers.
describe('general notes transport (shared /api/notes/ endpoint with baths)', () => {
  const ISO = '2026-03-04T18:30:00.000Z';

  function stubFetch(response: unknown) {
    const calls: { url: string; body: any }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      const raw = init?.body;
      calls.push({ url, body: typeof raw === 'string' ? JSON.parse(raw) : raw });
      return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());
  const client = () => new BabybuddyClient('https://x', 't');

  it('isBathNote discriminates purely on the bath tag (string- or object-shaped)', () => {
    expect(isBathNote({ tags: ['bath', 'small'] })).toBe(true);
    expect(isBathNote({ tags: [{ name: 'bath' }] })).toBe(true);
    expect(isBathNote({ tags: ['Milestone'] })).toBe(false);
    expect(isBathNote({ tags: [] })).toBe(false);
    expect(isBathNote({})).toBe(false);
  });

  it('listChildNotes reads /notes/ ONCE and partitions baths vs general notes', async () => {
    const calls = stubFetch({
      count: 3,
      next: null,
      previous: null,
      results: [
        { id: 1, time: ISO, note: 'Bath — small wash', tags: ['bath', 'small'] },
        { id: 2, time: ISO, note: 'Doctor follow-up Tuesday', tags: ['Milestone'] },
        { id: 3, time: ISO, note: 'First giggle today', tags: [] },
      ],
    });
    const { baths, notes } = await client().listChildNotes('c1');
    expect(calls).toHaveLength(1); // single fetch — no double-read of /notes/
    expect(calls[0].url).toContain('/notes/');
    expect(baths).toHaveLength(1);
    expect(baths[0]).toMatchObject({ type: 'bath', wash: 'small', serverId: 1 });
    expect(notes).toHaveLength(2);
    expect(notes[0]).toEqual({
      id: 'note-2',
      serverId: 2,
      childId: 'c1',
      type: 'note',
      time: TIME,
      text: 'Doctor follow-up Tuesday',
      tags: ['Milestone'],
    });
    expect(notes[1].text).toBe('First giggle today');
  });

  it('noteToNoteEntry maps the note body + all tag names, defaulting a missing body to empty', () => {
    expect(noteToNoteEntry({ id: 9, time: ISO, note: 'hi', tags: [{ name: 'A' }, 'B'] }, 'c1')).toEqual({
      id: 'note-9',
      serverId: 9,
      childId: 'c1',
      type: 'note',
      time: TIME,
      text: 'hi',
      tags: ['A', 'B'],
    });
    expect(noteToNoteEntry({ id: 10, time: ISO, tags: [] }, 'c1').text).toBe('');
  });

  it('noteToNoteBody strips structural bath tags so a note can never be misread as a bath', () => {
    const entry: NoteEntry = { id: 'n1', childId: 'c1', type: 'note', time: TIME, text: 'watch her temp', tags: ['bath', 'small', 'big', 'Fussy'] };
    expect(noteToNoteBody(entry)).toEqual({ child: 'c1', time: ISO, note: 'watch her temp', tags: ['Fussy'] });
  });

  it('buildBody sends a note to /notes/ with its body, stripping structural tags', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'n2', childId: 'c1', type: 'note', time: TIME, text: 'call pediatrician', tags: ['bath', 'Milestone'] };
    await client().createEntry(entry);
    expect(calls[0].url).toContain('/notes/');
    expect(calls[0].body).toEqual({ child: 'c1', time: ISO, note: 'call pediatrician', tags: ['Milestone'] });
  });

  it('a bath still serializes as a bath on the shared endpoint (regression)', async () => {
    const calls = stubFetch({ id: 1 });
    const bath: BathEntry = { id: 'b9', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: [] };
    await client().createEntry(bath);
    expect(calls[0].url).toContain('/notes/');
    expect(calls[0].body.tags).toEqual(['bath', 'big']);
  });

  it('round-trips a note through create -> server echo -> listChildNotes (lands in notes, not baths)', async () => {
    const entry: Entry = { id: 'n3', childId: 'c1', type: 'note', time: TIME, text: 'evening fuss', tags: ['Fussy'] };
    const create = stubFetch({ id: 55 });
    await client().createEntry(entry);
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 55, ...create[0].body }] });
    const { baths, notes } = await client().listChildNotes('c1');
    expect(baths).toHaveLength(0);
    expect(notes[0]).toMatchObject({ type: 'note', time: TIME, text: 'evening fuss', tags: ['Fussy'], serverId: 55 });
  });
});
