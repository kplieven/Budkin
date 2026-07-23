import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BabybuddyClient,
  bathToNoteBody,
  childBody,
  durationToSec,
  HIDDEN_TAGS,
  isBathNote,
  isHiddenTag,
  isMilestoneNote,
  mapProfile,
  milestoneToNoteBody,
  nativePicturePart,
  noteToBathEntry,
  noteToMilestoneEntry,
  noteToNoteBody,
  noteToNoteEntry,
  secToDuration,
} from '@/api/client';
import type { BathEntry, Child, Entry, MilestoneEntry, NoteEntry, PickedPhoto } from '@/types/models';

/** Minimal Fetch `Response` stand-in for stubbing `global.fetch` around a
 *  `BabybuddyClient` instance — the client's `request()` is private, so the
 *  fetch layer is the seam these tests mock. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

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

describe('listChildren', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('maps a server child to a stable string id plus a numeric serverId', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 7, first_name: 'A', birth_date: '2024-01-01' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');

    const children = await client.listChildren();

    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ id: '7', serverId: 7, first: 'A' });
  });
});

describe('updateChild', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined and skips the network call when the child has no serverId', async () => {
    // `id` deliberately looks numeric to prove the source of truth is
    // `serverId`, not a parse of the (now-stable, server-independent) `id`.
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, id: '99' };

    const result = await client.updateChild(child);

    expect(result).toBeUndefined();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('PATCHes /children/<slug>/, since Baby Buddy keys children by slug not id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ picture: null, slug: 'mira-doe' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, id: 'local-abc', serverId: 42, slug: 'mira-doe' };

    await client.updateChild(child);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/api/children/mira-doe/');
  });

  // Baby Buddy DERIVES the slug from the child's name, so a rename changes it
  // (verified against a live server: PATCHing first_name Gregory -> Gregor
  // moved the slug gregory-hill -> gregor-hill). A cached slug therefore goes
  // stale the moment a rename lands, and the next request keyed by it 404s:
  // the same silent failure this whole describe exists to prevent. The fresh
  // slug comes back in the PATCH response, so hand it to the caller to store.
  it('returns the fresh slug from the PATCH response so a rename cannot stale it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ picture: null, slug: 'mirabel-doe' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, first: 'Mirabel', serverId: 42, slug: 'mira-doe' };

    const res = await client.updateChild(child);

    expect(res?.slug).toBe('mirabel-doe');
  });

  // uploadUnsynced (src/data/sync.ts) only learns the new numeric id when it
  // pushes a child, and a child persisted by a build from before slugs were
  // captured has none either. Look the slug up rather than sending a numeric
  // id that would 404.
  it('resolves the slug via listChildren when the child carries none', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 42, first_name: 'Mira', birth_date: '2025-01-15', slug: 'mira-doe' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ picture: null, slug: 'mira-doe' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, serverId: 42 };

    await client.updateChild(child);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0][0]).toContain('/children/?limit=100');
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/api/children/mira-doe/');
  });

  // An empty lookup is positive evidence the child is GONE (another device
  // deleted it), not a reason to guess at a URL. Skipping the PATCH keeps the
  // caller from reporting a failure for a child that no longer exists.
  it('skips the request when the lookup proves the child is no longer on the server', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, serverId: 42 };

    await expect(client.updateChild(child)).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledTimes(1); // the lookup only, no PATCH
  });

  it('falls back to the numeric id when the child is present but carries no slug', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 42, first_name: 'Mira', birth_date: '2025-01-15' }],
        }),
      )
      .mockResolvedValueOnce(jsonResponse({ picture: null }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, serverId: 42 };

    await expect(client.updateChild(child)).resolves.toBeDefined();
    expect(fetchMock.mock.calls[1][0]).toBe('https://example.com/api/children/42/');
  });
});

describe('createChild', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  // Verified against a live Baby Buddy: the POST response carries the slug for
  // both the JSON and the multipart (photo) body. Capturing it here is what
  // lets a child created this session be updated or deleted before the next
  // refresh has had a chance to fill the slug in.
  it('captures the slug from the create response alongside the id', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(jsonResponse({ id: 9, slug: 'mira-doe', picture: null }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');

    const res = await client.createChild(CHILD);

    expect(res).toEqual({ id: 9, slug: 'mira-doe', picture: null });
  });
});

describe('bath <-> note serialization', () => {
  it('encodes a small wash as a tagged note the tags own as the source of truth', () => {
    const entry: BathEntry = { id: 'e1', childId: 'c1', type: 'bath', time: TIME, wash: 'small', tags: [] };
    expect(bathToNoteBody(entry, 1)).toEqual({
      child: 1,
      time: new Date(TIME).toISOString(),
      note: 'Bath, small wash',
      tags: ['bath', 'small'],
    });
  });

  it('encodes a big wash and keeps user tags after the structural ones', () => {
    const entry: BathEntry = { id: 'e2', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: ['Fussy'] };
    expect(bathToNoteBody(entry, 1)).toEqual({
      child: 1,
      time: new Date(TIME).toISOString(),
      note: 'Bath, big wash',
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
    const body = bathToNoteBody(entry, 1);
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
      await client().createEntry(entry, 1);
      expect(calls[0].body.notes).toBe((entry as any).notes);
    });

    it(`buildBody sends an empty-string notes to clear on a ${type} update`, async () => {
      const calls = stubFetch({});
      await client().updateEntry({ ...entry, serverId: 9, notes: undefined } as Entry, 1);
      expect(calls[0].body.notes).toBe('');
    });
  }

  it('buildBody sends nap on a sleep create so the client choice wins', async () => {
    const calls = stubFetch({ id: 1 });
    await client().createEntry(withNotes.sleep, 1);
    expect(calls[0].body.nap).toBe(true);
  });

  it('buildBody sends nap:false explicitly rather than omitting it', async () => {
    // Omitting the field lets Baby Buddy re-derive nap from its own
    // NAP_START_MIN/NAP_START_MAX, which is what silently reverted a manual
    // "Night" choice on the next listSleep.
    const calls = stubFetch({ id: 1 });
    await client().createEntry({ ...withNotes.sleep, nap: false } as Entry, 1);
    expect(calls[0].body.nap).toBe(false);
    expect('nap' in calls[0].body).toBe(true);
  });

  it('buildBody sends nap on a sleep update too', async () => {
    const calls = stubFetch({});
    await client().updateEntry({ ...withNotes.sleep, serverId: 9, nap: false } as Entry, 1);
    expect(calls[0].body.nap).toBe(false);
  });

  it('does not add a notes field to a bath note body (bath excluded)', async () => {
    const calls = stubFetch({ id: 1 });
    const bath: BathEntry = { id: 'b1', childId: 'c1', type: 'bath', time: TIME, wash: 'small', tags: [] };
    await client().createEntry(bath, 1);
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
    await client().createEntry(withNotes.feeding, 1);
    const echoed = create[0].body; // what the server received
    stubFetch(page({ id: 55, ...echoed }));
    const back = (await client().listFeedings('c1'))[0];
    expect(back.notes).toBe('spit up a lot');
  });
});

// A breast feed's `amount` is a subjective intake level, and Baby Buddy reads
// its `amount` field as a volume it sums into the child's feeding totals. So the
// level travels as a structural tag with `amount: null`, and comes back off the
// wire as a level again. Volumes are untouched by any of this.
describe('breastfeeding intake level <-> tag transport', () => {
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
  const page = (row: Record<string, unknown>) => ({ count: 1, next: null, previous: null, results: [row] });

  const atBreast = (amount: number | null, tags: string[] = []): Entry => ({
    id: 'f1', childId: 'c1', type: 'feeding', start: TIME, end: TIME, feedType: 'breast', method: 'left', amount, tags,
  });

  it('sends the level as a tag and never as an amount', async () => {
    for (const [level, tag] of [[1, 'intake:little'], [2, 'intake:some'], [3, 'intake:lot']] as const) {
      const calls = stubFetch({ id: 1 });
      await client().createEntry(atBreast(level), 1);
      expect(calls[0].body.amount).toBeNull();
      expect(calls[0].body.tags).toEqual([tag]);
    }
  });

  it('keeps the start-side tag alongside the level, distinctly', async () => {
    const calls = stubFetch({ id: 1 });
    await client().createEntry({ ...atBreast(3, ['right', 'cluster']), method: 'both' } as Entry, 1);
    expect(calls[0].body.tags).toEqual(['right', 'cluster', 'intake:lot']);
  });

  it('sends no level tag when the feed records no intake', async () => {
    const calls = stubFetch({ id: 1 });
    await client().createEntry(atBreast(null, ['cluster']), 1);
    expect(calls[0].body.amount).toBeNull();
    expect(calls[0].body.tags).toEqual(['cluster']);
  });

  it('replaces a stale level tag rather than shipping both', async () => {
    const calls = stubFetch({});
    await client().updateEntry({ ...atBreast(1, ['intake:lot', 'cluster']), serverId: 9 } as Entry, 1);
    expect(calls[0].body.tags).toEqual(['cluster', 'intake:little']);
  });

  it('leaves a volume feed alone, and strips any level tag it still carries', async () => {
    const calls = stubFetch({ id: 1 });
    await client().createEntry({ ...atBreast(90, ['intake:some']), method: 'bottle' } as Entry, 1);
    expect(calls[0].body.amount).toBe(90);
    expect(calls[0].body.tags).toEqual([]);
  });

  it('reads the level back off the tag, and keeps it out of the entry tags', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: null, notes: '', tags: ['intake:some', 'cluster'] }));
    const back = (await client().listFeedings('c1'))[0];
    expect(back.amount).toBe(2);
    expect(back.tags).toEqual(['cluster']);
  });

  it('round-trips every level through buildBody -> server echo -> list mapper', async () => {
    for (const level of [1, 2, 3]) {
      const create = stubFetch({ id: 55 });
      await client().createEntry(atBreast(level), 1);
      stubFetch(page({ id: 55, ...create[0].body }));
      expect((await client().listFeedings('c1'))[0].amount).toBe(level);
    }
  });

  it('buckets an untagged legacy 1 to 10 score by thirds', async () => {
    const expected: [number, number][] = [
      [1, 1], [2, 1], [3, 1],
      [4, 2], [5, 2], [6, 2], [7, 2],
      [8, 3], [9, 3], [10, 3],
    ];
    for (const [score, level] of expected) {
      stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: score, notes: '', tags: [] }));
      expect((await client().listFeedings('c1'))[0].amount).toBe(level);
    }
  });

  it('tolerates the arbitrary floats Baby Buddy allows in its amount field', async () => {
    // BB's `amount` is an unconstrained FloatField and its own UI writes into
    // it, so a feed at the breast can arrive holding anything at all.
    const expected: [number, number][] = [[0, 1], [3.5, 2], [7.5, 3], [120.5, 3], [-4, 1]];
    for (const [raw, level] of expected) {
      stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: raw, notes: '', tags: [] }));
      expect((await client().listFeedings('c1'))[0].amount).toBe(level);
    }
  });

  it('resolves a legacy score the same way in both directions of travel', async () => {
    // The asymmetry this pins: a legacy score sitting in local-only history and
    // pushed UP has to end up as the same level as the identical score pulled
    // DOWN untagged from the server. If the write bucket and the read bucket
    // disagree, the same feed means different things on two devices.
    for (const score of [1, 4, 5, 6, 7, 8, 9, 10]) {
      const calls = stubFetch({ id: 1 });
      await client().createEntry(atBreast(score), 1);
      const pushedTag = calls[0].body.tags[0];

      stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: score, notes: '', tags: [] }));
      const pulledLevel = (await client().listFeedings('c1'))[0].amount as number;

      expect(pushedTag).toBe(['intake:little', 'intake:some', 'intake:lot'][pulledLevel - 1]);
    }
  });

  it('sends a legacy score above 3 up as its by-thirds level, not as the top one', async () => {
    // Concretely: a local-only 5 is "Some", not "A lot".
    const calls = stubFetch({ id: 1 });
    await client().createEntry(atBreast(5), 1);
    expect(calls[0].body.tags).toEqual(['intake:some']);
    expect(calls[0].body.amount).toBeNull();
  });

  it('prefers the tag over a numeric amount when a feed somehow carries both', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: 9, notes: '', tags: ['intake:little'] }));
    expect((await client().listFeedings('c1'))[0].amount).toBe(1);
  });

  it('leaves an untagged feed with no amount unset', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'left breast', amount: null, notes: '', tags: [] }));
    expect((await client().listFeedings('c1'))[0].amount).toBeNull();
  });

  it('does not bucket a bottle feed: expressed milk is a real volume', async () => {
    stubFetch(page({ id: 1, start: ISO, end: ISO, type: 'breast milk', method: 'bottle', amount: 90, notes: '', tags: [] }));
    expect((await client().listFeedings('c1'))[0].amount).toBe(90);
  });

  it('hides the level tags from the tag picker', () => {
    for (const t of ['intake:little', 'intake:some', 'intake:lot']) expect(isHiddenTag(t)).toBe(true);
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
    await client().createEntry(entry, 1);
    expect(calls[0].url).toContain('/temperature/');
    expect(calls[0].body).toEqual({ child: 1, time: ISO, temperature: 37.4, notes: 'warm', tags: ['Fussy'] });
  });

  it('buildBody sends an empty-string notes to clear on a temperature update', async () => {
    const calls = stubFetch({});
    const entry: Entry = { id: 'tp2', serverId: 9, childId: 'c1', type: 'temperature', time: TIME, value: 36.8, tags: [] };
    await client().updateEntry(entry, 1);
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
    await client().createEntry(entry, 1);
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 77, ...create[0].body }] });
    const back = (await client().listTemperature('c1'))[0];
    expect(back).toMatchObject({ type: 'temperature', time: TIME, value: 38.1, notes: 'evening', serverId: 77 });
  });
});

// Medication is a POINT event on Baby Buddy's /api/medication/ resource: a
// required name + a single `time`, plus an optional dosage (number) + free-text
// dosage_unit + next_dose_interval duration + notes + tags. These exercise
// buildBody (via createEntry/updateEntry) and the listMedication mapper, plus the
// duration <-> seconds helpers the interval field rides on.
describe('medication serialization', () => {
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

  it('durationToSec parses the DRF [D ]HH:MM:SS shape and secToDuration reverses it', () => {
    expect(durationToSec('06:00:00')).toBe(21600);
    expect(durationToSec('00:30:00')).toBe(1800);
    expect(durationToSec('1 12:00:00')).toBe(129600);
    expect(durationToSec('900')).toBe(900); // bare-number fallback
    expect(durationToSec('nonsense')).toBeUndefined();
    expect(secToDuration(21600)).toBe('06:00:00');
    expect(secToDuration(1800)).toBe('00:30:00');
    expect(secToDuration(129600)).toBe('1 12:00:00');
  });

  it('buildBody sends name/dosage/dosage_unit to the medication endpoint on create', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'md1', childId: 'c1', type: 'medication', time: TIME, name: 'Paracetamol', dosage: 2.5, dosageUnit: 'mL', notes: 'for the fever', tags: ['Fussy'] };
    await client().createEntry(entry, 1);
    expect(calls[0].url).toContain('/medication/');
    expect(calls[0].body).toEqual({ child: 1, time: ISO, name: 'Paracetamol', dosage: 2.5, dosage_unit: 'mL', notes: 'for the fever', tags: ['Fussy'] });
  });

  it('buildBody omits unset dosage/unit/interval but always sends notes (blankable, like temperature)', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'md2', childId: 'c1', type: 'medication', time: TIME, name: 'Vitamin D', tags: [] };
    await client().createEntry(entry, 1);
    expect(calls[0].body).toEqual({ child: 1, time: ISO, name: 'Vitamin D', notes: '', tags: [] });
    // numeric/duration fields whose server nullability is unknown are omitted when unset
    for (const k of ['dosage', 'dosage_unit', 'next_dose_interval']) {
      expect(k in calls[0].body).toBe(false);
    }
    // notes is always present, so an empty string clears it on a PATCH edit
    expect(calls[0].body.notes).toBe('');
  });

  it('buildBody serializes next_dose_interval as a duration string when set', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'md3', childId: 'c1', type: 'medication', time: TIME, name: 'Ibuprofen', dosage: 5, dosageUnit: 'mL', nextDoseIntervalSec: 21600, tags: [] };
    await client().createEntry(entry, 1);
    expect(calls[0].body.next_dose_interval).toBe('06:00:00');
  });

  it('listMedication maps id/serverId/time/name/dosage/unit/interval/notes/tags', async () => {
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 20, time: ISO, name: 'Paracetamol', dosage: '2.50', dosage_unit: 'mL', next_dose_interval: '06:00:00', notes: 'for the fever', tags: ['Fussy'] }] });
    const [e] = await client().listMedication('c1');
    expect(e).toEqual({
      id: 'medication-20',
      serverId: 20,
      childId: 'c1',
      type: 'medication',
      time: TIME,
      name: 'Paracetamol',
      dosage: 2.5,
      dosageUnit: 'mL',
      nextDoseIntervalSec: 21600,
      notes: 'for the fever',
      tags: ['Fussy'],
    });
  });

  it('listMedication drops empty dosage/unit/notes to undefined and reads object-shaped tags', async () => {
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 21, time: ISO, name: 'Vitamin D', dosage: null, dosage_unit: '', notes: '', tags: [{ name: 'Sleepy' }] }] });
    const [e] = await client().listMedication('c1');
    expect(e.dosage).toBeUndefined();
    expect(e.dosageUnit).toBeUndefined();
    expect(e.nextDoseIntervalSec).toBeUndefined();
    expect(e.notes).toBeUndefined();
    expect(e.tags).toEqual(['Sleepy']);
  });

  it('round-trips a dose through buildBody -> server echo -> list mapper', async () => {
    const entry: Entry = { id: 'md4', childId: 'c1', type: 'medication', time: TIME, name: 'Ibuprofen', dosage: 5, dosageUnit: 'mL', notes: 'evening', tags: [] };
    const create = stubFetch({ id: 88 });
    await client().createEntry(entry, 1);
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 88, ...create[0].body }] });
    const back = (await client().listMedication('c1'))[0];
    expect(back).toMatchObject({ type: 'medication', time: TIME, name: 'Ibuprofen', dosage: 5, dosageUnit: 'mL', notes: 'evening', serverId: 88 });
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
    expect(noteToNoteBody(entry, 1)).toEqual({ child: 1, time: ISO, note: 'watch her temp', tags: ['Fussy'] });
  });

  it('buildBody sends a note to /notes/ with its body, stripping structural tags', async () => {
    const calls = stubFetch({ id: 1 });
    const entry: Entry = { id: 'n2', childId: 'c1', type: 'note', time: TIME, text: 'call pediatrician', tags: ['bath', 'Milestone'] };
    await client().createEntry(entry, 1);
    expect(calls[0].url).toContain('/notes/');
    expect(calls[0].body).toEqual({ child: 1, time: ISO, note: 'call pediatrician', tags: ['Milestone'] });
  });

  it('a bath still serializes as a bath on the shared endpoint (regression)', async () => {
    const calls = stubFetch({ id: 1 });
    const bath: BathEntry = { id: 'b9', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: [] };
    await client().createEntry(bath, 1);
    expect(calls[0].url).toContain('/notes/');
    expect(calls[0].body.tags).toEqual(['bath', 'big']);
  });

  it('round-trips a note through create -> server echo -> listChildNotes (lands in notes, not baths)', async () => {
    const entry: Entry = { id: 'n3', childId: 'c1', type: 'note', time: TIME, text: 'evening fuss', tags: ['Fussy'] };
    const create = stubFetch({ id: 55 });
    await client().createEntry(entry, 1);
    stubFetch({ count: 1, next: null, previous: null, results: [{ id: 55, ...create[0].body }] });
    const { baths, notes } = await client().listChildNotes('c1');
    expect(baths).toHaveLength(0);
    expect(notes[0]).toMatchObject({ type: 'note', time: TIME, text: 'evening fuss', tags: ['Fussy'], serverId: 55 });
  });
});

// Deleting a child on the server: a single DELETE /children/{slug}/. Baby
// Buddy cascades the child's feedings/sleep/changes/etc. server-side, so no
// per-entry cleanup calls are needed. Unlike deleteEntry/deleteMeasurement this
// is keyed by SLUG: Baby Buddy's ChildViewSet sets lookup_field = "slug" (only
// TagViewSet does the same), so a numeric id 404s here.
describe('deleteChild', () => {
  function stubFetch(response: unknown) {
    const calls: { url: string; method?: string }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return { ok: true, status: 204, json: async () => response, text: async () => '' } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }
  afterEach(() => vi.unstubAllGlobals());
  const client = () => new BabybuddyClient('https://x', 't');

  it('issues a DELETE to /children/{slug}/', async () => {
    const calls = stubFetch(undefined);
    await client().deleteChild({ ...CHILD, serverId: 5, slug: 'mira-doe' });
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toContain('/children/mira-doe/');
    expect(calls[0].url).not.toContain('/children/5/');
    expect(calls[0].method).toBe('DELETE');
  });

  it('looks the slug up by serverId when the child carries none', async () => {
    const calls: { url: string; method?: string }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: async () => ({
          count: 1,
          next: null,
          previous: null,
          results: [{ id: 5, first_name: 'Mira', birth_date: '2025-01-15', slug: 'mira-doe' }],
        }),
        text: async () => '',
      } as Response;
    });
    vi.stubGlobal('fetch', fn);

    await client().deleteChild({ ...CHILD, serverId: 5 });

    expect(calls).toHaveLength(2);
    expect(calls[0].url).toContain('/children/?limit=100');
    expect(calls[1].url).toContain('/children/mira-doe/');
    expect(calls[1].method).toBe('DELETE');
  });

  it('skips the network call for a child that was never pushed', async () => {
    const calls = stubFetch(undefined);
    await client().deleteChild(CHILD);
    expect(calls).toHaveLength(0);
  });

  // Another device got there first. The desired end state already holds, so
  // this is a no-op success: issuing a doomed DELETE would make the store
  // restore a child that no longer exists and claim the delete failed.
  it('treats a child already gone from the server as deleted, not as a failure', async () => {
    const calls: { url: string; method?: string }[] = [];
    const fn = vi.fn(async (url: string, init?: RequestInit) => {
      calls.push({ url, method: init?.method });
      return {
        ok: true,
        status: 200,
        json: async () => ({ count: 0, next: null, previous: null, results: [] }),
        text: async () => '',
      } as Response;
    });
    vi.stubGlobal('fetch', fn);

    await expect(client().deleteChild({ ...CHILD, serverId: 5 })).resolves.toBeUndefined();

    expect(calls).toHaveLength(1); // the lookup only
    expect(calls.some((c) => c.method === 'DELETE')).toBe(false);
  });
});

describe('milestone note serialization', () => {
  const MS: MilestoneEntry = {
    id: 'e1',
    childId: '5',
    type: 'milestone',
    key: 'first-steps',
    time: TIME,
    text: 'First steps',
    note: 'took three',
    tags: ['proud'],
  };

  it('isMilestoneNote is true only when the milestone tag is present', () => {
    expect(isMilestoneNote({ tags: ['milestone', 'mk:first-steps'] })).toBe(true);
    expect(isMilestoneNote({ tags: ['bath', 'small'] })).toBe(false);
    expect(isMilestoneNote({ tags: [] })).toBe(false);
    expect(isMilestoneNote({})).toBe(false);
  });

  it('milestoneToNoteBody writes the structural tags, keeps user tags, two-line body', () => {
    const body = milestoneToNoteBody(MS, 1);
    expect(body.child).toBe(1);
    expect(body.note).toBe('🎉 First steps\ntook three');
    expect(body.tags).toEqual(['milestone', 'mk:first-steps', 'proud']);
  });

  it('milestoneToNoteBody omits the second line when there is no note', () => {
    const body = milestoneToNoteBody({ ...MS, note: undefined }, 1);
    expect(body.note).toBe('🎉 First steps');
    expect(body.tags).toEqual(['milestone', 'mk:first-steps', 'proud']);
  });

  it('round-trips key, time, note, and user tags; drops structural tags', () => {
    const server = { id: 42, time: '2026-03-04T18:30:00.000Z', note: '🎉 First steps\ntook three', tags: ['milestone', 'mk:first-steps', 'proud'] };
    const back = noteToMilestoneEntry(server, '5');
    expect(back).toEqual({
      id: 'milestone-42',
      serverId: 42,
      childId: '5',
      type: 'milestone',
      key: 'first-steps',
      time: TIME,
      text: 'First steps',
      note: 'took three',
      tags: ['proud'],
    });
  });

  it('recovers a milestone with no user note (single body line)', () => {
    const server = { id: 7, time: '2026-03-04T18:30:00.000Z', note: '🎉 First word', tags: ['milestone', 'mk:first-word'] };
    const back = noteToMilestoneEntry(server, '5');
    expect(back.key).toBe('first-word');
    expect(back.text).toBe('First word');
    expect(back.note).toBeUndefined();
    expect(back.tags).toEqual([]);
  });

  it('isHiddenTag hides structural milestone tags but not user tags', () => {
    expect(isHiddenTag('milestone')).toBe(true);
    expect(isHiddenTag('mk:first-steps')).toBe(true);
    expect(isHiddenTag('bath')).toBe(true);
    expect(isHiddenTag('proud')).toBe(false);
  });

  it('noteToNoteBody strips milestone structural tags from a general note', () => {
    const note: NoteEntry = { id: 'n1', childId: '5', type: 'note', time: TIME, text: 'hi', tags: ['milestone', 'mk:x', 'keep'] };
    expect((noteToNoteBody(note, 1).tags as string[])).toEqual(['keep']);
  });
});

describe('listChildNotes three-way partition', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('splits milestones, baths, and general notes from one fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, time: '2026-03-04T18:30:00.000Z', note: '🎉 First steps', tags: ['milestone', 'mk:first-steps'] },
          { id: 2, time: '2026-03-04T18:00:00.000Z', note: 'Bath — small wash', tags: ['bath', 'small'] },
          { id: 3, time: '2026-03-04T17:00:00.000Z', note: 'plain note', tags: [] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const { baths, milestones, notes } = await client.listChildNotes('5');
    expect(milestones.map((m) => m.key)).toEqual(['first-steps']);
    expect(baths.map((b) => b.wash)).toEqual(['small']);
    expect(notes.map((n) => n.text)).toEqual(['plain note']);
  });

  it('classifies a note carrying both milestone and bath tags as a milestone', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 9, time: '2026-03-04T18:30:00.000Z', note: '🎉 First bath', tags: ['milestone', 'mk:first-bath', 'bath'] }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const { baths, milestones } = await client.listChildNotes('5');
    expect(milestones).toHaveLength(1);
    expect(baths).toHaveLength(0);
  });
});

describe('timers', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('lists timers, converting start to ms', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 4, child: 2, name: 'Sleep · v1 · nap', start: '2026-07-16T10:00:00Z' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://bb.test', 'tok');

    const timers = await client.listTimers();

    expect(timers).toEqual([
      { id: 4, child: 2, name: 'Sleep · v1 · nap', start: Date.parse('2026-07-16T10:00:00Z') },
    ]);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bb.test/api/timers/?limit=100');
  });

  it('coerces a missing child/name defensively', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ count: 1, next: null, previous: null, results: [{ id: 5, start: '2026-07-16T10:00:00Z' }] }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://bb.test', 'tok');
    const [t] = await client.listTimers();
    expect(t).toMatchObject({ id: 5, child: null, name: '' });
  });

  it('creates a timer with child, ISO start, and name', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 11 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://bb.test', 'tok');

    const id = await client.createTimer(2, Date.parse('2026-07-16T10:00:00Z'), 'Feeding · v1');

    expect(id).toBe(11);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bb.test/api/timers/');
    expect(init.method).toBe('POST');
    expect(JSON.parse(init.body)).toEqual({ child: 2, start: '2026-07-16T10:00:00.000Z', name: 'Feeding · v1' });
  });

  it('PATCHes name + start on update', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 200));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://bb.test', 'tok');

    await client.updateTimer(11, 'Sleep · v1 · nap', Date.parse('2026-07-16T10:00:00Z'));

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bb.test/api/timers/11/');
    expect(init.method).toBe('PATCH');
    expect(JSON.parse(init.body)).toEqual({ name: 'Sleep · v1 · nap', start: '2026-07-16T10:00:00.000Z' });
  });

  it('deletes a timer', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse(undefined, 204));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://bb.test', 'tok');

    await client.deleteTimer(11);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('https://bb.test/api/timers/11/');
    expect(init.method).toBe('DELETE');
  });
});
