import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  BabybuddyClient,
  bathToNoteBody,
  childBody,
  mapProfile,
  nativePicturePart,
  noteToBathEntry,
} from '@/api/client';
import type { BathEntry, Child, PickedPhoto } from '@/types/models';

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

  it('PATCHes /children/<serverId>/ using serverId, regardless of the local id shape', async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ picture: null }));
    vi.stubGlobal('fetch', fetchMock);
    const client = new BabybuddyClient('https://example.com', 'tok');
    const child: Child = { ...CHILD, id: 'local-abc', serverId: 42 };

    await client.updateChild(child);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url] = fetchMock.mock.calls[0];
    expect(url).toBe('https://example.com/api/children/42/');
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
