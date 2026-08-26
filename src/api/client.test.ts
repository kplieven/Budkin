import { convertFormDataAsync } from 'expo/src/winter/fetch/convertFormData';
import { installFormDataPatch } from 'expo/src/winter/FormData';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  ApiError,
  BabybuddyClient,
  bathRhythmFromNote,
  bathRhythmToNoteBody,
  bathToNoteBody,
  childBody,
  treatmentToNoteBody,
  durationToSec,
  fromDateStr,
  toDateStr,
  genderFromNote,
  genderToNoteBody,
  HIDDEN_TAGS,
  isBathNote,
  isBathRhythmNote,
  isTreatmentNote,
  isGenderNote,
  isHiddenTag,
  isMilestoneNote,
  mapProfile,
  milestoneToNoteBody,
  noteToBathEntry,
  noteToTreatment,
  noteToMilestoneEntry,
  noteToNoteBody,
  noteToNoteEntry,
  secToDuration,
} from '@/api/client';
import type { BathEntry, Child, Treatment, Entry, MilestoneEntry, NoteEntry, PickedPhoto } from '@/types/models';

/** Fetch `Response` stand-in: `request()` is private, so fetch is the seam to mock. */
function jsonResponse(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const TIME = Date.parse('2026-03-04T18:30:00.000Z');

// Stand-ins for client.ts's module-private toISO/fromISO, so the bath tests can
// assert against them without widening client.ts's exports.
const toISO = (ms: number) => new Date(ms).toISOString();
const fromISO = (s: string) => new Date(s).getTime();

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
});

// On native the bundle does NOT run React Native's fetch: expo's Metro config
// injects `expo/src/winter/runtime.native.ts`, which patches `FormData` and swaps
// `globalThis.fetch` for expo/fetch. That encoder serializes the multipart itself
// and only understands a string, a Blob, or an object exposing `bytes()`. React
// Native's `{ uri }` file descriptor throws there, so a photo upload never left the
// device. These tests run the real encoder over the real FormData patch.
//
// The two imports at the top of this file are unversioned paths into expo's
// internals, resolving only because expo ships no `exports` map, so an SDK bump
// could move them. If they break, RE-POINT them: a hand-written stand-in would
// only ever encode what we already believe.
describe('child photo upload serializes under expo/fetch', () => {
  afterEach(() => vi.unstubAllGlobals());

  /** RN's FormData reduced to the `_parts` array expo's patch writes to. Local to
   *  the test: `installFormDataPatch` mutates the prototype it is handed. */
  class RNFormData {
    _parts: [string, unknown][] = [];
  }
  installFormDataPatch(RNFormData as unknown as typeof FormData);

  const PICTURE_BYTES = new TextEncoder().encode('\xff\xd8JPEG-BYTES');

  /** A file object shaped like `expo-file-system`'s `File`: `bytes()` plus the
   *  name/type the encoder writes into the part headers. The real `File` is a
   *  native module and cannot load here. */
  const photo = (): PickedPhoto => ({
    uri: 'file:///cache/ImagePicker/cropped-42.jpg',
    name: 'a.jpg',
    type: 'image/jpeg',
    nativeFile: {
      name: 'cropped-42.jpg',
      type: 'image/jpeg',
      bytes: async () => PICTURE_BYTES,
    },
    durable: true,
  });

  function captureInit(response: unknown) {
    const calls: RequestInit[] = [];
    vi.stubGlobal('FormData', RNFormData);
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        calls.push(init ?? {});
        return jsonResponse(response);
      }),
    );
    return calls;
  }

  /** Native encodes the multipart ITSELF, so the body is already a Uint8Array
   *  rather than a FormData for `fetch` to encode. */
  function wireOf(init: RequestInit): string {
    return new TextDecoder().decode(init.body as unknown as Uint8Array);
  }

  function declaredBoundary(init: RequestInit): string | undefined {
    const ct = (init.headers as Record<string, string> | undefined)?.['Content-Type'];
    return /boundary=(.+)$/.exec(ct ?? '')?.[1];
  }

  it('a photo PATCH encodes the picture part as bytes, alongside the name fields', async () => {
    const child: Child = { ...CHILD, serverId: 5, slug: 'mira-doe' };
    const calls = captureInit({ picture: 'https://x/media/mira.jpg', slug: 'mira-doe' });
    await new BabybuddyClient('https://x', 't').updateChild(child, { kind: 'set', photo: photo() });

    const wire = wireOf(calls[0]);
    expect(wire).toContain('name="picture"');
    expect(wire).toContain('JPEG-BYTES');
    // A rename made in the same save rides this body too, so it is lost with it.
    expect(wire).toContain('name="first_name"');
    expect(wire).toContain('Mira');

    // THE REGRESSION. Handing `fetch` the FormData instead reached Baby Buddy,
    // returned 200 and applied nothing, silently losing the photo and the name.
    // So the body must be BYTES and the request must carry its own boundary:
    // without both, the upload is a no-op.
    expect(calls[0].body).toBeInstanceOf(Uint8Array);
    const boundary = declaredBoundary(calls[0]);
    expect(boundary).toBeTruthy();
    expect(wire).toContain(`--${boundary}`);
  });

  it('names the native part after the file, not after the picked name (web sends the latter)', async () => {
    // expo's FormData patch keeps `append`'s third argument only for a real
    // `Blob`, so a filename cannot be supplied for this part.
    const calls = captureInit({ id: 9 });
    await new BabybuddyClient('https://x', 't').createChild(CHILD, photo());

    expect(wireOf(calls[0])).toContain('filename="cropped-42.jpg"');
  });

  it('a create-with-photo POST encodes the picture part as bytes', async () => {
    const calls = captureInit({ id: 9, slug: 'mira-doe', picture: 'https://x/media/mira.jpg' });
    await new BabybuddyClient('https://x', 't').createChild(CHILD, photo());

    const wire = wireOf(calls[0]);
    expect(wire).toContain('JPEG-BYTES');
    // The create path carries the same defect and the same fix.
    expect(calls[0].body).toBeInstanceOf(Uint8Array);
    expect(wire).toContain(`--${declaredBoundary(calls[0])}`);
  });

  it('a photo with no file behind it fails as a photo problem, not as an unreachable server', async () => {
    const calls = captureInit({ id: 9 });
    const unreadable: PickedPhoto = { uri: 'file:///cache/gone.jpg', name: 'a.jpg', type: 'image/jpeg', durable: false };

    await expect(new BabybuddyClient('https://x', 't').createChild(CHILD, unreadable)).rejects.toThrow(
      "Couldn't read the selected photo.",
    );
    expect(calls).toHaveLength(0); // raised before the request, so nothing to blame on the network
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

  // birth_date is date-only ('YYYY-MM-DD') and the rest of the app treats birth as
  // LOCAL midnight. Parsing with `new Date(s)` lands on UTC midnight instead, which
  // west of UTC displays the birthday a day early, walks the server value back a day
  // on every edit round-trip and breaks the adopt dedup.
  it('parses birth_date as local midnight, matching how the app serializes it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 7, first_name: 'A', birth_date: '2025-03-04' }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');

    const children = await client.listChildren();

    expect(children[0].birth).toBe(new Date(2025, 2, 4).getTime());
  });

  // The avatar tint is purely local: Baby Buddy has no color field on a child, so
  // anything set here would be fabricated from the server's list position and would
  // move under the child whenever that ordering changed. The store owns it instead.
  it('does not invent an avatar color from the list position', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 7, first_name: 'A', birth_date: '2024-01-01' },
          { id: 8, first_name: 'B', birth_date: '2024-01-01' },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');

    const children = await client.listChildren();

    expect(children[0]).not.toHaveProperty('color');
    expect(children[1]).not.toHaveProperty('color');
  });

  // A parsed birth date must come back out as the same calendar day, or every edit
  // round-trip (rename, gender, photo) walks birth_date backwards on the server.
  it('round-trips a date-only string through fromDateStr + toDateStr unchanged', () => {
    expect(toDateStr(fromDateStr('2025-03-04'))).toBe('2025-03-04');
  });
});

describe('updateChild', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('returns undefined and skips the network call when the child has no serverId', async () => {
    // `id` deliberately looks numeric to prove the source of truth is `serverId`,
    // not a parse of the (stable, server-independent) `id`.
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

  // Baby Buddy DERIVES the slug from the child's name, so a rename MOVES it
  // (verified live: first_name Gregory -> Gregor moved gregory-hill -> gregor-hill).
  // A cached slug goes stale the moment a rename lands and the next request keyed by
  // it 404s silently. The fresh slug comes back in the PATCH response, so hand it to
  // the caller to store.
  it('returns the fresh slug from the PATCH response so a rename cannot stale it', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ picture: null, slug: 'mirabel-doe' }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, first: 'Mirabel', serverId: 42, slug: 'mira-doe' };

    const res = await client.updateChild(child);

    expect(res?.slug).toBe('mirabel-doe');
  });

  // A pushed child only learns its numeric id, never its slug. Look the slug up
  // rather than sending a numeric id that would 404.
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

  // An empty lookup is positive evidence the child is GONE (another device deleted
  // it), not a reason to guess at a URL.
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

  // The POST response carries the slug for both the JSON and the multipart (photo)
  // body. Capturing it lets a child created this session be updated or deleted
  // before the next refresh fills the slug in.
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
  it('encodes a quick wash as a tagged note the tags own as the source of truth', () => {
    const entry: BathEntry = { id: 'e1', childId: 'c1', type: 'bath', time: TIME, wash: 'quick', tags: [] };
    expect(bathToNoteBody(entry, 3)).toEqual({
      child: 3,
      time: toISO(TIME),
      note: 'Quick wash',
      tags: ['bath', 'bath:quick'],
    });
  });

  it('encodes a full bath and keeps user tags after the structural ones', () => {
    const entry: BathEntry = { id: 'e2', childId: 'c1', type: 'bath', time: TIME, wash: 'full', tags: ['Fussy'] };
    expect(bathToNoteBody(entry, 3)).toEqual({
      child: 3,
      time: toISO(TIME),
      note: 'Full bath',
      tags: ['bath', 'bath:full', 'Fussy'],
    });
  });

  it('never writes the legacy bare tags back, even when the entry carried them', () => {
    const entry: BathEntry = { id: 'e3', childId: 'c1', type: 'bath', time: TIME, wash: 'full', tags: ['big', 'small', 'Fussy'] };
    expect(bathToNoteBody(entry, 3).tags).toEqual(['bath', 'bath:full', 'Fussy']);
  });

  it('normalizes a legacy big wash value still sitting in the offline queue or pending-ops log before serializing', () => {
    // A queue/pendingOps entry written by a pre-rename build reaches here only via
    // an untyped JSON.parse, which the cast reproduces.
    const entry = { id: 'e4', childId: 'c1', type: 'bath', time: TIME, wash: 'big', tags: [] } as unknown as BathEntry;
    expect(bathToNoteBody(entry, 3)).toEqual({
      child: 3,
      time: toISO(TIME),
      note: 'Full bath',
      tags: ['bath', 'bath:full'],
    });
  });

  it('reads a note back into a bath entry, deriving wash from the tags', () => {
    const note = { id: 42, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Full bath', tags: ['bath', 'bath:full', 'Fussy'] };
    expect(noteToBathEntry(note, 'c1')).toEqual({
      id: 'bath-42',
      serverId: 42,
      childId: 'c1',
      type: 'bath',
      time: fromISO('2026-03-04T18:30:00Z'),
      wash: 'full',
      tags: ['Fussy'],
    });
  });

  it('reads a pre-migration note through the legacy bare big tag', () => {
    const note = { id: 43, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath, big wash', tags: ['bath', 'big'] };
    expect(noteToBathEntry(note, 'c1').wash).toBe('full');
  });

  it('treats a note with neither full marker as a quick wash', () => {
    const note = { id: 7, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'Bath, small wash', tags: ['bath', 'small'] };
    expect(noteToBathEntry(note, 'c1').wash).toBe('quick');
  });

  it('strips both tag vocabularies from the entry tags', () => {
    const note = { id: 8, child: 'c1', time: '2026-03-04T18:30:00Z', note: 'x', tags: ['bath', 'big', 'bath:full', 'Fussy'] };
    expect(noteToBathEntry(note, 'c1').tags).toEqual(['Fussy']);
  });
});

// `/api/tags/` returns { name, color, last_used } objects while entries carry tag
// NAMES (string[]). HIDDEN_TAGS names structural tags the picker must never surface
// or let the user create.
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

// The real `/api/profile/` shape (per babybuddy/api/serializers.py): account fields
// nest under a `user` object, `language`/`timezone` are top-level on the profile
// itself (NOT under a `settings` sub-object, despite the backing model being named
// `Settings`), and `dashboard_refresh_rate` is a real field on that model but is
// excluded from `ProfileSerializer.Meta.fields`, so a stock server never sends it.
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

// Per-entry free-text `notes` on the five real activity resources. Bath is excluded:
// its note body is structural.
describe('per-entry notes', () => {
  const ISO = '2026-03-04T18:30:00.000Z';

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
    // NAP_START_MIN/NAP_START_MAX, silently reverting a manual "Night" choice.
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
    const bath: BathEntry = { id: 'b1', childId: 'c1', type: 'bath', time: TIME, wash: 'quick', tags: [] };
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

// A breast feed's `amount` is a subjective intake level, and Baby Buddy reads its
// `amount` field as a volume it sums into the child's feeding totals. So the level
// travels as a structural tag with `amount: null` and comes back off the wire as a
// level again. Volumes are untouched by any of this.
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
    // A legacy score pushed UP has to end up as the same level as the identical
    // score pulled DOWN untagged. If the write bucket and the read bucket disagree,
    // the same feed means different things on two devices.
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

// Temperature is a POINT event on /api/temperature/: a decimal reading + a single
// `time` + notes + tags.
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

// Medication is a POINT event on /api/medication/ (present in Baby Buddy master,
// absent from the published docs): a required name + a single `time`, plus an
// optional dosage (number) + free-text dosage_unit + next_dose_interval duration
// + notes + tags.
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

// General notes ride on the SAME `/api/notes/` endpoint as baths, discriminated only
// by the `bath` tag.
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
    expect(calls).toHaveLength(1); // single fetch, no double-read of /notes/
    expect(calls[0].url).toContain('/notes/');
    expect(baths).toHaveLength(1);
    expect(baths[0]).toMatchObject({ type: 'bath', wash: 'quick', serverId: 1 });
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
    const bath: BathEntry = { id: 'b9', childId: 'c1', type: 'bath', time: TIME, wash: 'full', tags: [] };
    await client().createEntry(bath, 1);
    expect(calls[0].url).toContain('/notes/');
    expect(calls[0].body.tags).toEqual(['bath', 'bath:full']);
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

// Baby Buddy cascades the child's feedings/sleep/changes/etc. server-side, so a
// single DELETE suffices. Unlike deleteEntry/deleteMeasurement it is keyed by SLUG:
// ChildViewSet sets lookup_field = "slug" (only TagViewSet does the same), so a
// numeric id 404s here.
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

  // Another device got there first, so the desired end state already holds. Issuing
  // a doomed DELETE would make the store restore a child that no longer exists and
  // claim the delete failed.
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
    expect(baths.map((b) => b.wash)).toEqual(['quick']);
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

describe('treatment <-> note serialization', () => {
  const baseTreatment: Treatment = {
    id: 'cu1',
    childId: 'c1',
    name: 'Omeprazol',
    scheduleMode: 'timesOfDay',
    timesOfDay: ['morning', 'evening'],
    dosage: 2.5,
    dosageUnit: 'mL',
    fromDate: new Date(2026, 2, 1).getTime(),
    toDate: new Date(2026, 2, 20).getTime(),
    condition: 'reflux',
    notes: 'with food',
    active: true,
  };

  /** Encode, then decode as the server would hand it back. */
  const roundTrip = (treatment: Treatment, id = 77): Treatment => {
    const body = treatmentToNoteBody(treatment, 5) as any;
    return noteToTreatment({ id, time: body.time, note: body.note, tags: body.tags }, treatment.childId);
  };

  it('round-trips every field of a times-of-day treatment', () => {
    const out = roundTrip(baseTreatment);
    expect(out).toMatchObject({
      id: 'treatment-77',
      serverId: 77,
      childId: 'c1',
      name: 'Omeprazol',
      scheduleMode: 'timesOfDay',
      timesOfDay: ['morning', 'evening'],
      dosage: 2.5,
      dosageUnit: 'mL',
      fromDate: baseTreatment.fromDate,
      toDate: baseTreatment.toDate,
      condition: 'reflux',
      notes: 'with food',
      active: true,
    });
  });

  it('round-trips an interval treatment', () => {
    const out = roundTrip({ ...baseTreatment, scheduleMode: 'everyHours', everyHours: 6, timesOfDay: undefined });
    expect(out.scheduleMode).toBe('everyHours');
    expect(out.everyHours).toBe(6);
  });

  it('round-trips a sporadic treatment on its own cooldown tag, distinct from an interval one', () => {
    const out = roundTrip({ ...baseTreatment, scheduleMode: 'sporadic', everyHours: 6, timesOfDay: undefined });
    expect(out.scheduleMode).toBe('sporadic');
    expect(out.everyHours).toBe(6);
  });

  it('never writes the `every:` tag for a sporadic treatment, so an older client cannot mistake its cooldown for a recurring interval', () => {
    const body = treatmentToNoteBody({ ...baseTreatment, scheduleMode: 'sporadic', everyHours: 6, timesOfDay: undefined }, 5) as any;
    expect(body.tags).not.toContain('treatment:every:6');
    expect(body.tags).toContain('treatment:cooldown:6');
  });

  it('round-trips a sporadic treatment with no cooldown hours set', () => {
    const out = roundTrip({ ...baseTreatment, scheduleMode: 'sporadic', everyHours: undefined, timesOfDay: undefined });
    expect(out.scheduleMode).toBe('sporadic');
    expect(out.everyHours).toBeUndefined();
  });

  it('round-trips a paused treatment', () => {
    expect(roundTrip({ ...baseTreatment, active: false }).active).toBe(false);
    expect(roundTrip(baseTreatment).active).toBe(true);
  });

  it('round-trips an open-ended treatment (no to date) and one with no dose', () => {
    const out = roundTrip({ ...baseTreatment, toDate: undefined, dosage: undefined, dosageUnit: undefined });
    expect(out.toDate).toBeUndefined();
    expect(out.dosage).toBeUndefined();
    expect(out.dosageUnit).toBeUndefined();
  });

  it('carries the schedule in tags and marks the note with the `treatment` tag', () => {
    const body = treatmentToNoteBody(baseTreatment, 5) as any;
    expect(body.tags).toEqual(['treatment', 'treatment:tod:morning', 'treatment:tod:evening']);
    expect(body.child).toBe(5);
    expect(treatmentToNoteBody({ ...baseTreatment, scheduleMode: 'everyHours', everyHours: 8, timesOfDay: undefined }, 5) as any)
      .toMatchObject({ tags: ['treatment', 'treatment:every:8'] });
    expect(treatmentToNoteBody({ ...baseTreatment, scheduleMode: 'sporadic', everyHours: 8, timesOfDay: undefined }, 5) as any)
      .toMatchObject({ tags: ['treatment', 'treatment:sporadic', 'treatment:cooldown:8'] });
    expect((treatmentToNoteBody({ ...baseTreatment, active: false }, 5) as any).tags).toContain('treatment:paused');
  });

  it('keeps NO free text in tags, so a treatment cannot pollute the server tag list', () => {
    // Baby Buddy tag names are globally unique and shared by every record, so a
    // medication name or unit in a tag would mint a new tag per treatment.
    const body = treatmentToNoteBody(baseTreatment, 5) as any;
    for (const tag of body.tags) {
      expect(tag === 'treatment' || tag.startsWith('treatment:')).toBe(true);
      expect(tag).not.toContain('Omeprazol');
      expect(tag).not.toContain('mL');
      expect(tag).not.toContain('reflux');
    }
  });

  it('writes a body whose first line reads as plain English for other clients', () => {
    const body = treatmentToNoteBody(baseTreatment, 5) as any;
    expect(String(body.note).split('\n')[0]).toBe('Omeprazol, 2.5 mL, morning, evening');
  });

  it('dates the note at the regimen start', () => {
    const body = treatmentToNoteBody(baseTreatment, 5) as any;
    expect(new Date(body.time).getTime()).toBe(baseTreatment.fromDate);
  });

  it('degrades to the tag-borne schedule when the body was hand-edited away', () => {
    // A user editing the note in Baby Buddy's own UI must not destroy the treatment.
    const out = noteToTreatment(
      { id: 9, time: '2026-03-01T00:00:00.000Z', note: 'Omeprazol for reflux', tags: ['treatment', 'treatment:tod:noon', 'treatment:paused'] },
      'c1',
    );
    expect(out.name).toBe('Omeprazol for reflux');
    expect(out.timesOfDay).toEqual(['noon']);
    expect(out.active).toBe(false);
    expect(out.dosage).toBeUndefined();
  });

  it('degrades the same way when the payload line is not valid JSON', () => {
    const out = noteToTreatment(
      { id: 9, time: '2026-03-01T00:00:00.000Z', note: 'Omeprazol\nbudkin-treatment-v1:{oops', tags: ['treatment', 'treatment:every:6'] },
      'c1',
    );
    expect(out.name).toBe('Omeprazol');
    expect(out.everyHours).toBe(6);
  });

  it('falls back to the note time (floored to local midnight) for a missing start date', () => {
    const noon = new Date(2026, 2, 1, 12, 30).getTime();
    const out = noteToTreatment({ id: 9, time: new Date(noon).toISOString(), note: 'x', tags: ['treatment'] }, 'c1');
    expect(out.fromDate).toBe(new Date(2026, 2, 1).getTime());
  });

  it('isTreatmentNote keys off the treatment tag only', () => {
    expect(isTreatmentNote({ tags: ['treatment'] })).toBe(true);
    expect(isTreatmentNote({ tags: ['treatment:tod:noon'] })).toBe(false);
    expect(isTreatmentNote({ tags: [] })).toBe(false);
    expect(isTreatmentNote({})).toBe(false);
  });

  it('hides every treatment structural tag from the tag picker', () => {
    for (const t of ['treatment', 'treatment:tod:morning', 'treatment:every:6', 'treatment:paused', 'treatment:sporadic', 'treatment:cooldown:6']) {
      expect(isHiddenTag(t)).toBe(true);
    }
    expect(isHiddenTag('treatmentwash')).toBe(false);
  });
});

describe('treatment endpoints', () => {
  afterEach(() => vi.unstubAllGlobals());

  it('listChildNotes drops treatment notes instead of leaking them into general notes', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, time: '2026-03-04T17:00:00.000Z', note: 'plain note', tags: [] },
          { id: 2, time: '2026-03-01T00:00:00.000Z', note: 'Omeprazol', tags: ['treatment', 'treatment:tod:morning'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const { notes, baths, milestones } = await client.listChildNotes('5');
    expect(notes.map((n) => n.text)).toEqual(['plain note']);
    expect(baths).toHaveLength(0);
    expect(milestones).toHaveLength(0);
  });

  it('listChildTreatments filters server-side by tag and re-checks locally', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 2, time: '2026-03-01T00:00:00.000Z', note: 'Omeprazol', tags: ['treatment', 'treatment:tod:morning'] },
          // An instance that ignored the tag filter must not turn this into a treatment.
          { id: 3, time: '2026-03-01T00:00:00.000Z', note: 'plain note', tags: [] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const treatments = await client.listChildTreatments('5');
    expect(fetchMock.mock.calls[0][0]).toContain('tags=treatment');
    expect(treatments.map((c) => c.name)).toEqual(['Omeprazol']);
  });

  it('createTreatment POSTs a note and returns its id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ id: 321 }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const treatment: Treatment = { id: 'cu1', childId: 'c1', name: 'Nurofen', scheduleMode: 'everyHours', everyHours: 6, fromDate: new Date(2026, 2, 1).getTime(), active: true };
    expect(await client.createTreatment(treatment, 5)).toBe(321);
    expect(fetchMock.mock.calls[0][0]).toContain('/notes/');
    expect(fetchMock.mock.calls[0][1].method).toBe('POST');
  });

  it('updateTreatment PATCHes the backing note, and no-ops with no server id', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const treatment: Treatment = { id: 'cu1', childId: 'c1', name: 'Nurofen', scheduleMode: 'everyHours', everyHours: 6, fromDate: new Date(2026, 2, 1).getTime(), active: true };
    await client.updateTreatment(treatment, 5);
    expect(fetchMock).not.toHaveBeenCalled();
    await client.updateTreatment({ ...treatment, serverId: 88 }, 5);
    expect(fetchMock.mock.calls[0][0]).toContain('/notes/88/');
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH');
  });

  it('deleteTreatment DELETEs the backing note', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({}, 204));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').deleteTreatment(88);
    expect(fetchMock.mock.calls[0][0]).toContain('/notes/88/');
    expect(fetchMock.mock.calls[0][1].method).toBe('DELETE');
  });
});

describe('gender <-> note serialization', () => {
  afterEach(() => vi.unstubAllGlobals());

  const AT = new Date(2026, 2, 4, 10, 0).getTime();

  it('encodes gender as a tagged note with readable body', () => {
    const body = genderToNoteBody('girl', 5, AT) as any;
    expect(body.child).toBe(5);
    expect(body.tags).toEqual(['gender', 'g:girl']);
    expect(body.note).toBe('Gender: girl');
    expect(new Date(body.time).getTime()).toBe(AT);
  });

  it('round-trips every supported gender', () => {
    for (const g of ['girl', 'boy'] as const) {
      expect(genderFromNote(genderToNoteBody(g, 5, AT))).toBe(g);
    }
  });

  it('reads an unknown or missing g: tag as not recorded', () => {
    expect(genderFromNote({ tags: ['gender'] })).toBeUndefined();
    expect(genderFromNote({ tags: ['gender', 'g:martian'] })).toBeUndefined();
    // A legacy `g:other` note degrades to "Not set" rather than to a broken value.
    expect(genderFromNote({ tags: ['gender', 'g:other'] })).toBeUndefined();
    expect(genderFromNote({})).toBeUndefined();
  });

  it('isGenderNote keys off the gender tag only', () => {
    expect(isGenderNote({ tags: ['gender'] })).toBe(true);
    expect(isGenderNote({ tags: ['g:girl'] })).toBe(false);
    expect(isGenderNote({ tags: [] })).toBe(false);
  });

  it('hides the gender structural tags from the tag picker', () => {
    expect(isHiddenTag('gender')).toBe(true);
    expect(isHiddenTag('g:girl')).toBe(true);
    expect(isHiddenTag('gendered')).toBe(false);
  });

  it('listChildNotes drops gender notes instead of showing them in the Notes tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, time: '2026-03-04T17:00:00.000Z', note: 'plain note', tags: [] },
          { id: 2, time: '2026-03-04T10:00:00.000Z', note: 'Gender: girl', tags: ['gender', 'g:girl'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const { notes } = await new BabybuddyClient('https://example.com', 'tok').listChildNotes('5');
    expect(notes.map((n) => n.text)).toEqual(['plain note']);
  });

  it('listGenders keys the whole account by child server id in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, child: 5, time: '2026-03-04T10:00:00.000Z', note: 'Gender: girl', tags: ['gender', 'g:girl'] },
          { id: 2, child: 7, time: '2026-03-03T10:00:00.000Z', note: 'Gender: boy', tags: ['gender', 'g:boy'] },
          { id: 3, child: 9, time: '2026-03-02T10:00:00.000Z', note: 'plain', tags: [] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const map = await new BabybuddyClient('https://example.com', 'tok').listGenders();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('tags=gender');
    expect(map.get(5)).toBe('girl');
    expect(map.get(7)).toBe('boy');
    expect(map.has(9)).toBe(false);
  });

  it('listGenders lets the newest note win when a child has a stale duplicate', async () => {
    // Results come back newest-first, so the first one seen per child wins.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 2, child: 5, time: '2026-03-04T10:00:00.000Z', note: 'Gender: boy', tags: ['gender', 'g:boy'] },
          { id: 1, child: 5, time: '2026-03-01T10:00:00.000Z', note: 'Gender: girl', tags: ['gender', 'g:girl'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const map = await new BabybuddyClient('https://example.com', 'tok').listGenders();
    expect(map.get(5)).toBe('boy');
  });

  it('setChildGender PATCHes the existing note rather than adding a second one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ count: 1, next: null, previous: null, results: [{ id: 44, child: 5, tags: ['gender', 'g:girl'] }] }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildGender(5, 'boy', AT);
    expect(fetchMock.mock.calls[1][0]).toContain('/notes/44/');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
  });

  it('setChildGender POSTs when the child has no gender note yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 99 }));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildGender(5, 'girl', AT);
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual(['gender', 'g:girl']);
  });

  it('setChildGender DELETEs the note when the gender is cleared', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ count: 1, next: null, previous: null, results: [{ id: 44, child: 5, tags: ['gender', 'g:girl'] }] }),
      )
      .mockResolvedValueOnce(jsonResponse({}, 204));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildGender(5, undefined, AT);
    expect(fetchMock.mock.calls[1][0]).toContain('/notes/44/');
    expect(fetchMock.mock.calls[1][1].method).toBe('DELETE');
  });

  it('setChildGender writes nothing when clearing a gender that was never set', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildGender(5, undefined, AT);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('bath rhythm <-> note serialization', () => {
  afterEach(() => vi.unstubAllGlobals());

  const AT = new Date(2026, 2, 4, 10, 0).getTime();

  it('encodes the rhythm as a tagged note with readable body', () => {
    const body = bathRhythmToNoteBody({ fullEveryDays: 3, quickEveryDays: 1 }, 5, AT) as any;
    expect(body.child).toBe(5);
    expect(body.tags).toEqual(['bath:rhythm', 'bath:rhythm:full:3', 'bath:rhythm:quick:1']);
    expect(body.note).toBe('Bath rhythm: full bath every 3 days, quick wash daily');
    expect(new Date(body.time).getTime()).toBe(AT);
  });

  it('spells a 0 interval out as off rather than as every 0 days', () => {
    const body = bathRhythmToNoteBody({ fullEveryDays: 7, quickEveryDays: 0 }, 5, AT) as any;
    expect(body.tags).toEqual(['bath:rhythm', 'bath:rhythm:full:7', 'bath:rhythm:quick:0']);
    expect(body.note).toBe('Bath rhythm: full bath every 7 days, quick wash off');
  });

  it('round-trips a rhythm, 0 included', () => {
    for (const r of [
      { fullEveryDays: 3, quickEveryDays: 1 },
      { fullEveryDays: 0, quickEveryDays: 2 },
      { fullEveryDays: 30, quickEveryDays: 0 },
    ]) {
      expect(bathRhythmFromNote(bathRhythmToNoteBody(r, 5, AT))).toEqual(r);
    }
  });

  // The whole reason the marker is `bath:rhythm` and not `bath`: a rhythm note read as
  // a wash would land a phantom bath on the timeline and reset the cadence it describes.
  it('is never mistaken for a bath entry', () => {
    const body = bathRhythmToNoteBody({ fullEveryDays: 3, quickEveryDays: 1 }, 5, AT);
    expect(isBathNote(body)).toBe(false);
    expect(isBathRhythmNote(body)).toBe(true);
  });

  it('isBathRhythmNote keys off the marker tag only', () => {
    expect(isBathRhythmNote({ tags: ['bath:rhythm'] })).toBe(true);
    expect(isBathRhythmNote({ tags: ['bath:rhythm:full:3'] })).toBe(false);
    expect(isBathRhythmNote({ tags: ['bath'] })).toBe(false);
    expect(isBathRhythmNote({ tags: [] })).toBe(false);
  });

  // Halves are read independently so a note written by a future build that renamed one
  // of them still yields the half this build understands.
  it('reads each interval independently, omitting one it cannot parse', () => {
    expect(bathRhythmFromNote({ tags: ['bath:rhythm', 'bath:rhythm:full:4'] })).toEqual({ fullEveryDays: 4 });
    expect(bathRhythmFromNote({ tags: ['bath:rhythm', 'bath:rhythm:quick:2'] })).toEqual({ quickEveryDays: 2 });
    expect(bathRhythmFromNote({ tags: ['bath:rhythm', 'bath:rhythm:full:soon'] })).toBeUndefined();
  });

  it('reads a note with no interval tags as nothing recorded', () => {
    expect(bathRhythmFromNote({ tags: ['bath:rhythm'] })).toBeUndefined();
    expect(bathRhythmFromNote({})).toBeUndefined();
  });

  it('hides the rhythm structural tags from the tag picker', () => {
    expect(isHiddenTag('bath:rhythm')).toBe(true);
    expect(isHiddenTag('bath:rhythm:full:3')).toBe(true);
    expect(isHiddenTag('bath:rhythmic')).toBe(false);
  });

  it('listChildNotes drops rhythm notes instead of showing them in the Notes tab', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 1, time: '2026-03-04T17:00:00.000Z', note: 'plain note', tags: [] },
          {
            id: 2,
            time: '2026-03-04T10:00:00.000Z',
            note: 'Bath rhythm: full bath every 3 days, quick wash daily',
            tags: ['bath:rhythm', 'bath:rhythm:full:3', 'bath:rhythm:quick:1'],
          },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const res = await new BabybuddyClient('https://example.com', 'tok').listChildNotes('5');
    expect(res.notes.map((n) => n.text)).toEqual(['plain note']);
    expect(res.baths).toEqual([]);
  });

  it('listBathRhythms keys the whole account by child server id in one request', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 3,
        next: null,
        previous: null,
        results: [
          { id: 1, child: 5, time: '2026-03-04T10:00:00.000Z', tags: ['bath:rhythm', 'bath:rhythm:full:3', 'bath:rhythm:quick:1'] },
          { id: 2, child: 7, time: '2026-03-03T10:00:00.000Z', tags: ['bath:rhythm', 'bath:rhythm:full:5', 'bath:rhythm:quick:0'] },
          { id: 3, child: 9, time: '2026-03-02T10:00:00.000Z', tags: [] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const map = await new BabybuddyClient('https://example.com', 'tok').listBathRhythms();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0][0]).toContain('tags=bath%3Arhythm');
    expect(map.get(5)).toEqual({ fullEveryDays: 3, quickEveryDays: 1 });
    expect(map.get(7)).toEqual({ fullEveryDays: 5, quickEveryDays: 0 });
    expect(map.has(9)).toBe(false);
  });

  it('listBathRhythms lets the newest note win when a child has a stale duplicate', async () => {
    // Results come back newest-first, so the first one seen per child wins.
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 2,
        next: null,
        previous: null,
        results: [
          { id: 2, child: 5, time: '2026-03-04T10:00:00.000Z', tags: ['bath:rhythm', 'bath:rhythm:full:2', 'bath:rhythm:quick:1'] },
          { id: 1, child: 5, time: '2026-03-01T10:00:00.000Z', tags: ['bath:rhythm', 'bath:rhythm:full:9', 'bath:rhythm:quick:1'] },
        ],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const map = await new BabybuddyClient('https://example.com', 'tok').listBathRhythms();
    expect(map.get(5)).toEqual({ fullEveryDays: 2, quickEveryDays: 1 });
  });

  it('setChildBathRhythm PATCHes the existing note rather than adding a second one', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({ count: 1, next: null, previous: null, results: [{ id: 44, child: 5, tags: ['bath:rhythm'] }] }),
      )
      .mockResolvedValueOnce(jsonResponse({}));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildBathRhythm(5, { fullEveryDays: 4, quickEveryDays: 1 }, AT);
    expect(fetchMock.mock.calls[1][0]).toContain('/notes/44/');
    expect(fetchMock.mock.calls[1][1].method).toBe('PATCH');
    expect(JSON.parse(fetchMock.mock.calls[1][1].body).tags).toEqual([
      'bath:rhythm',
      'bath:rhythm:full:4',
      'bath:rhythm:quick:1',
    ]);
  });

  it('setChildBathRhythm POSTs when the child has no rhythm note yet', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(jsonResponse({ count: 0, next: null, previous: null, results: [] }))
      .mockResolvedValueOnce(jsonResponse({ id: 99 }));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://example.com', 'tok').setChildBathRhythm(5, { fullEveryDays: 3, quickEveryDays: 1 }, AT);
    expect(fetchMock.mock.calls[1][1].method).toBe('POST');
  });

  // A plain note the user hand-tagged `bath:rhythm` in Baby Buddy's own UI passes the
  // server-side tag filter, so the read has to reject it on its missing interval tags
  // rather than treat it as a rhythm that turns every cadence into the default.
  it('ignores a marker-only note that carries no intervals', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({
        count: 1,
        next: null,
        previous: null,
        results: [{ id: 1, child: 5, time: '2026-03-04T10:00:00.000Z', tags: ['bath:rhythm'] }],
      }),
    );
    vi.stubGlobal('fetch', fetchMock);
    const map = await new BabybuddyClient('https://example.com', 'tok').listBathRhythms();
    expect(map.has(5)).toBe(false);
  });
});

// A write fired right before an installed PWA's webview is frozen (locking the phone
// the moment after Save) is a normal fetch that the OS cancels, dropping the entry to
// the offline queue with no "offline" signal. `keepalive` tells the browser to
// complete the request regardless. Web only, writes only, never FormData (photo
// uploads can exceed keepalive's 64KB body budget).
describe('write requests survive a page freeze (keepalive)', () => {
  afterEach(() => vi.unstubAllGlobals());

  const client = () => new BabybuddyClient('https://x', 't');
  const entry: Entry = { id: 'f1', childId: 'c1', type: 'feeding', start: TIME, end: TIME, feedType: 'breast', method: 'left', amount: null, tags: [] };

  function captureInit(response: unknown) {
    const calls: RequestInit[] = [];
    const fn = vi.fn(async (_url: string, init?: RequestInit) => {
      calls.push(init ?? {});
      return { ok: true, status: 200, json: async () => response, text: async () => JSON.stringify(response) } as Response;
    });
    vi.stubGlobal('fetch', fn);
    return calls;
  }

  it('sets keepalive on a write when running on web (document present)', async () => {
    vi.stubGlobal('document', {}); // stand in for a browser/PWA environment
    const calls = captureInit({ id: 1 });
    await client().createEntry(entry, 1);
    expect(calls[0].keepalive).toBe(true);
  });

  it('does NOT set keepalive on a read, even on web', async () => {
    vi.stubGlobal('document', {});
    const calls = captureInit({ count: 0, next: null, previous: null, results: [] });
    await client().listChildren();
    expect(calls[0].keepalive).toBeFalsy();
  });

  it('does NOT set keepalive off web (native has no such freeze, and no document)', async () => {
    const calls = captureInit({ id: 1 }); // no document stub -> typeof document === 'undefined'
    await client().createEntry(entry, 1);
    expect(calls[0].keepalive).toBeFalsy();
  });
});

// Away from the home LAN the server address often black-holes: `fetch` neither
// resolves nor rejects until the platform's socket timeout, minutes on some stacks.
// `request()` therefore arms an AbortController: 10s for a GET, 20s for a mutation
// (aborting a write the server actually committed re-queues it and risks a
// duplicate). The abort surfaces as ApiError(0, ...) with a message distinct from
// the unreachable one; status 0 keeps every existing catch working.
describe('requests abort instead of hanging on a black-holed server', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const entry: Entry = { id: 'f1', childId: 'c1', type: 'feeding', start: TIME, end: TIME, feedType: 'breast', method: 'left', amount: null, tags: [] };

  /** Never settles on its own, rejecting only once the abort signal fires: how a
   *  black-holed socket behaves. */
  function stubBlackHoleFetch() {
    vi.stubGlobal(
      'fetch',
      vi.fn(
        (_url: string, init?: RequestInit) =>
          new Promise<Response>((_resolve, reject) => {
            init?.signal?.addEventListener('abort', () => reject(new Error('aborted')));
          }),
      ),
    );
  }

  it('a GET rejects with the timeout ApiError after its 10s budget, not before', async () => {
    vi.useFakeTimers();
    stubBlackHoleFetch();
    let outcome: unknown = 'pending';
    const guard = new BabybuddyClient('https://x', 't').listChildren().catch((e: unknown) => {
      outcome = e;
      return e;
    });
    await vi.advanceTimersByTimeAsync(9999);
    expect(outcome).toBe('pending'); // one tick short of the budget: still waiting
    await vi.advanceTimersByTimeAsync(1);
    const err = await guard;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: 'Server took too long to respond.' });
  });

  it('a mutation gets the longer 20s budget: alive past the GET deadline, aborted at 20s', async () => {
    vi.useFakeTimers();
    stubBlackHoleFetch();
    let outcome: unknown = 'pending';
    const guard = new BabybuddyClient('https://x', 't').createEntry(entry, 1).catch((e: unknown) => {
      outcome = e;
      return e;
    });
    await vi.advanceTimersByTimeAsync(10000);
    expect(outcome).toBe('pending'); // the GET budget must not abort a write
    await vi.advanceTimersByTimeAsync(10000);
    const err = await guard;
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, message: 'Server took too long to respond.' });
  });

  it('clears the abort timer once the request settles (no stray timer left armed)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ count: 0, next: null, previous: null, results: [] }));
    vi.stubGlobal('fetch', fetchMock);
    await new BabybuddyClient('https://x', 't').listChildren();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('a plain network failure still reads as unreachable, not as a timeout', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Network request failed')));
    await expect(new BabybuddyClient('https://x', 't').listChildren()).rejects.toMatchObject({
      status: 0,
      message: "Couldn't reach server. Check the URL and your connection.",
    });
  });

  // The user-facing copy above blames the connection whatever went wrong, and `fetch`
  // also rejects for reasons that are nothing to do with it (a body it cannot
  // serialize, say). Keeping the original as `cause` is the only trace of those.
  it('keeps the underlying failure as the ApiError cause', async () => {
    const underlying = new Error('Unsupported FormDataPart implementation');
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(underlying));
    const err = await new BabybuddyClient('https://x', 't').listChildren().catch((e: unknown) => e);
    expect((err as Error).cause).toBe(underlying);
  });
});
