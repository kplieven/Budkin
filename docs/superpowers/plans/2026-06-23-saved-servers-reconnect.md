# Saved Servers with One-Tap Reconnect — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remember every server the user successfully connects to and show them as one-tap retry rows (each with a delete button) on the onboarding page.

**Architecture:** A new `src/data/servers.ts` module owns saved-server persistence (expo-secure-store) plus pure, unit-tested list helpers. The Zustand store gains a `savedServers` array, loads it on hydrate (migrating the active connection in), upserts on successful `connect`, and exposes `forgetServer`. The onboarding screen renders the list above the inputs; tapping a row prefills the fields and calls the existing `connect` action.

**Tech Stack:** React Native 0.85 + Expo SDK 56, expo-router, Zustand, expo-secure-store, vitest (node env).

## Global Constraints

- **Not a git repository.** `git` is not initialized here. Replace every "commit"
  step with the **Verification Gate** below. Do **not** run `git init` unless the
  user asks.
- **Verification Gate** (run at the end of each task; all must pass):
  - `npm test` — vitest suite green.
  - `npx tsc --noEmit` — no type errors.
  - `npm run lint` — eslint clean.
- **No new Expo API surface.** Reuse `expo-secure-store` exactly as
  `src/data/storage.ts` already does (`getItemAsync` / `setItemAsync` /
  `deleteItemAsync`). Per `AGENTS.md`, do not introduce unverified Expo APIs.
- **Tokens are stored** in secure storage, consistent with the existing active
  token. Demo mode is **never** saved as a server.
- **Cap the saved list at 6**, most-recent-first.
- Follow existing code style: guarded try/catch-to-no-op storage, `@/`-aliased
  imports, theme tokens (`t.surface`, `t.line2`, `t.dim`, `t.faint`, `t.text`),
  `Txt`/`Icon` components.

---

## File Structure

- **Create** `src/data/servers.ts` — `SavedServer` type, SecureStore I/O
  (`loadServers`, `persistServers`), pure helpers (`upsertServer`,
  `removeServer`), `MAX_SERVERS`.
- **Create** `src/data/servers.test.ts` — unit tests for the helpers + I/O.
- **Modify** `src/api/client.ts` — export the currently-private
  `normalizeServerUrl` so the dedupe key matches how the client builds its base URL.
- **Modify** `src/store/useAppStore.ts` — `savedServers` state, `hydrate`,
  `connect`, new `forgetServer` action.
- **Modify** `src/store/useAppStore.test.ts` — mock `@/data/servers`, reset state,
  add saved-server tests.
- **Modify** `src/app/onboarding.tsx` — "Previously connected" section.

---

## Task 1: Saved-servers data module

**Files:**
- Modify: `src/api/client.ts` (export `normalizeServerUrl`, currently line 113)
- Create: `src/data/servers.ts`
- Test: `src/data/servers.test.ts`

**Interfaces:**
- Consumes: `normalizeServerUrl(raw: string): string` from `@/api/client`.
- Produces:
  - `interface SavedServer { serverUrl: string; token: string; lastUsedAt: number }`
  - `const MAX_SERVERS = 6`
  - `loadServers(): Promise<SavedServer[]>`
  - `persistServers(list: SavedServer[]): Promise<void>`
  - `upsertServer(list: SavedServer[], server: SavedServer): SavedServer[]`
  - `removeServer(list: SavedServer[], serverUrl: string): SavedServer[]`

- [ ] **Step 1: Export `normalizeServerUrl` from the client**

In `src/api/client.ts`, change the function declaration (line 113) from:

```ts
function normalizeServerUrl(raw: string): string {
```

to:

```ts
export function normalizeServerUrl(raw: string): string {
```

(No other change — `BabybuddyClient`'s constructor keeps using it as before.)

- [ ] **Step 2: Write the failing test**

Create `src/data/servers.test.ts`:

```ts
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  loadServers,
  persistServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from '@/data/servers';

// In-memory stand-in for the native expo-secure-store module.
const mem = vi.hoisted(() => ({ store: new Map<string, string>() }));
vi.mock('expo-secure-store', () => ({
  getItemAsync: vi.fn(async (k: string) => mem.store.get(k) ?? null),
  setItemAsync: vi.fn(async (k: string, v: string) => {
    mem.store.set(k, v);
  }),
  deleteItemAsync: vi.fn(async (k: string) => {
    mem.store.delete(k);
  }),
}));

const srv = (serverUrl: string, token = 'tok-' + serverUrl, lastUsedAt = 1): SavedServer => ({
  serverUrl,
  token,
  lastUsedAt,
});

beforeEach(() => {
  mem.store.clear();
});

describe('upsertServer', () => {
  it('adds a new server to the front', () => {
    const list = upsertServer([srv('https://a.lan')], srv('https://b.lan'));
    expect(list.map((s) => s.serverUrl)).toEqual(['https://b.lan', 'https://a.lan']);
  });

  it('dedupes by normalized URL (scheme/trailing slash collapse)', () => {
    const list = upsertServer([srv('https://a.lan')], srv('a.lan/'));
    expect(list).toHaveLength(1);
    expect(list[0].serverUrl).toBe('a.lan/'); // newest entry wins
  });

  it('moves a re-used server to the front and refreshes token + lastUsedAt', () => {
    const start = [srv('https://a.lan', 'old', 1), srv('https://b.lan', 'b', 2)];
    const list = upsertServer(start, srv('https://a.lan', 'new', 99));
    expect(list.map((s) => s.serverUrl)).toEqual(['https://a.lan', 'https://b.lan']);
    expect(list[0].token).toBe('new');
    expect(list[0].lastUsedAt).toBe(99);
  });

  it('caps the list at MAX_SERVERS, dropping the oldest', () => {
    let list: SavedServer[] = [];
    for (let i = 0; i < 8; i++) list = upsertServer(list, srv(`https://s${i}.lan`));
    expect(list).toHaveLength(6);
    expect(list[0].serverUrl).toBe('https://s7.lan'); // newest first
    expect(list.some((s) => s.serverUrl === 'https://s0.lan')).toBe(false); // oldest dropped
  });
});

describe('removeServer', () => {
  it('removes the matching server (normalized)', () => {
    const list = removeServer([srv('https://a.lan'), srv('https://b.lan')], 'a.lan/');
    expect(list.map((s) => s.serverUrl)).toEqual(['https://b.lan']);
  });

  it('is a no-op for an unknown URL', () => {
    const start = [srv('https://a.lan')];
    expect(removeServer(start, 'https://z.lan')).toEqual(start);
  });
});

describe('persistence', () => {
  it('returns [] when nothing is saved', async () => {
    expect(await loadServers()).toEqual([]);
  });

  it('round-trips saved servers', async () => {
    const list = [srv('https://a.lan'), srv('https://b.lan')];
    await persistServers(list);
    expect(await loadServers()).toEqual(list);
  });
});
```

- [ ] **Step 3: Run the test to verify it fails**

Run: `npm test -- servers`
Expected: FAIL — `Cannot find module '@/data/servers'` (module doesn't exist yet).

- [ ] **Step 4: Implement `src/data/servers.ts`**

Create `src/data/servers.ts`:

```ts
/**
 * Saved-server history (server URL + token), persisted via expo-secure-store.
 *
 * Distinct from the single active connection in `storage.ts`: this is the list
 * of servers the user has successfully connected to, surfaced as one-tap retry
 * rows on the onboarding page. Tokens are stored, consistent with how the active
 * token is already stored. All SecureStore calls are guarded so unsupported
 * platforms (e.g. web) degrade to no-ops rather than crashing.
 */

import * as SecureStore from 'expo-secure-store';

import { normalizeServerUrl } from '@/api/client';

export interface SavedServer {
  /** server URL as the user entered it (used for display + reconnect) */
  serverUrl: string;
  /** API token, stored in secure storage */
  token: string;
  /** epoch ms of the last successful connect (most-recent-first ordering) */
  lastUsedAt: number;
}

const KEY = 'babybuddy.servers.v1';

/** Maximum number of servers kept in the history list. */
export const MAX_SERVERS = 6;

export async function loadServers(): Promise<SavedServer[]> {
  try {
    const s = await SecureStore.getItemAsync(KEY);
    return s ? (JSON.parse(s) as SavedServer[]) : [];
  } catch {
    return [];
  }
}

export async function persistServers(list: SavedServer[]): Promise<void> {
  try {
    await SecureStore.setItemAsync(KEY, JSON.stringify(list));
  } catch {
    /* unsupported platform — skip persistence */
  }
}

/**
 * Add or refresh a server: dedupe by normalized URL, move it to the front, and
 * cap the list at MAX_SERVERS (dropping the oldest).
 */
export function upsertServer(list: SavedServer[], server: SavedServer): SavedServer[] {
  const key = normalizeServerUrl(server.serverUrl);
  const rest = list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
  return [server, ...rest].slice(0, MAX_SERVERS);
}

/** Remove the server whose normalized URL matches (no-op if absent). */
export function removeServer(list: SavedServer[], serverUrl: string): SavedServer[] {
  const key = normalizeServerUrl(serverUrl);
  return list.filter((s) => normalizeServerUrl(s.serverUrl) !== key);
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npm test -- servers`
Expected: PASS — all `servers` tests green.

- [ ] **Step 6: Verification Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass. (Replaces the commit step — no git here.)

---

## Task 2: Store wiring

**Files:**
- Modify: `src/store/useAppStore.ts`
- Test: `src/store/useAppStore.test.ts`

**Interfaces:**
- Consumes: `loadServers`, `persistServers`, `upsertServer`, `removeServer`,
  `SavedServer` from `@/data/servers` (Task 1).
- Produces (on the store):
  - state `savedServers: SavedServer[]`
  - action `forgetServer: (serverUrl: string) => void`
  - `connect` now upserts the connected server; `hydrate` loads the list and
    migrates the active real connection into it.

- [ ] **Step 1: Add the failing tests**

In `src/store/useAppStore.test.ts`:

(a) Add `servers` to the hoisted mock state — change the `vi.hoisted` object (currently starts at line 11) to include a `servers` field:

```ts
const h = vi.hoisted(() => ({
  q: [] as unknown[],
  timers: [] as unknown[],
  servers: [] as unknown[],
  pushed: [] as unknown[],
  updated: [] as unknown[],
  deleted: [] as unknown[],
  measPushed: [] as unknown[],
  measUpdated: [] as unknown[],
  measDeleted: [] as unknown[],
  pushFails: false,
}));
```

(b) Add a mock for `@/data/servers` next to the other `vi.mock` calls (e.g. after the `@/data/storage` mock at line 27):

```ts
vi.mock('@/data/servers', () => ({
  loadServers: vi.fn(async () => h.servers),
  persistServers: vi.fn(async (list: unknown[]) => {
    h.servers = list;
  }),
  // simple URL-equality stand-ins (the store tests use identical URLs)
  upsertServer: (list: any[], server: any) => {
    const rest = list.filter((s) => s.serverUrl !== server.serverUrl);
    return [server, ...rest].slice(0, 6);
  },
  removeServer: (list: any[], url: string) => list.filter((s) => s.serverUrl !== url),
}));
```

(c) In `beforeEach`, reset the new mock state and seed `savedServers`. Add
`h.servers = [];` alongside the other `h.* = []` resets, and add
`savedServers: [],` to the `useAppStore.setState({ ... })` reset object.

(d) Add a new describe block at the end of the file:

```ts
describe('saved servers', () => {
  it('connect adds the connected server to the retry list', async () => {
    useAppStore.setState({ savedServers: [], connected: false });
    await s().connect('https://a.lan', 'tok');
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('https://a.lan');
    expect(h.servers).toHaveLength(1); // persisted
  });

  it('forgetServer removes a server, persists, and toasts', () => {
    useAppStore.setState({
      savedServers: [
        { serverUrl: 'https://a.lan', token: 't', lastUsedAt: 1 },
        { serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 },
      ],
    });
    s().forgetServer('https://a.lan');
    expect(s().savedServers.map((x) => x.serverUrl)).toEqual(['https://b.lan']);
    expect(h.servers).toEqual([{ serverUrl: 'https://b.lan', token: 't', lastUsedAt: 2 }]);
    expect(s().toast).toBe('Removed');
  });

  it('hydrate loads saved servers and migrates the active connection', async () => {
    h.servers = [];
    vi.mocked(loadConnection).mockResolvedValueOnce({ demo: false, serverUrl: 'http://x', token: 't' });
    await s().hydrate();
    expect(s().savedServers.map((x) => x.serverUrl)).toContain('http://x');
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npm test -- useAppStore`
Expected: FAIL — `forgetServer is not a function` / `savedServers` undefined / migration assertion fails.

- [ ] **Step 3: Add `savedServers` state + `forgetServer` to the type definitions**

In `src/store/useAppStore.ts`:

(a) Add the import after the `@/data/storage` import (line 28):

```ts
import {
  loadServers,
  persistServers,
  removeServer,
  upsertServer,
  type SavedServer,
} from '@/data/servers';
```

(b) In `interface AppState`, add the field next to the connection state (after
`queueCount: number;`):

```ts
  /** servers the user has connected to before (one-tap retry list) */
  savedServers: SavedServer[];
```

(c) In `interface AppActions`, add next to `disconnect` (after `disconnect: () => void;`):

```ts
  forgetServer: (serverUrl: string) => void;
```

(d) In the `create(...)` initial state, add after `queueCount: 0,`:

```ts
  savedServers: [],
```

- [ ] **Step 4: Load + migrate saved servers in `hydrate`**

In `hydrate` (currently lines 196-202), replace:

```ts
  hydrate: async () => {
    const conn = await loadConnection();
    const q = await loadQueue();
    // Running timers are local-only (the server has no matching record), so
    // restore them from on-device storage regardless of how the rest of the
    // state is loaded below.
    const savedTimers = await loadTimers();
    if (!conn) {
```

with:

```ts
  hydrate: async () => {
    const conn = await loadConnection();
    const q = await loadQueue();
    // Running timers are local-only (the server has no matching record), so
    // restore them from on-device storage regardless of how the rest of the
    // state is loaded below.
    const savedTimers = await loadTimers();
    let savedServers = await loadServers();
    // Migration: ensure the active real server is in the retry list for users
    // who connected before the saved-servers feature existed.
    if (conn && !conn.demo && conn.serverUrl) {
      savedServers = upsertServer(savedServers, {
        serverUrl: conn.serverUrl,
        token: conn.token,
        lastUsedAt: Date.now(),
      });
      void persistServers(savedServers);
    }
    set({ savedServers }); // merges; later set() calls in this fn keep it
    if (!conn) {
```

(The early `set({ savedServers })` relies on Zustand's shallow merge — every
later `set()` in `hydrate` preserves `savedServers`.)

- [ ] **Step 5: Upsert on successful `connect`**

In `connect` (currently lines 246-253), replace:

```ts
    try {
      const data = await loadFromServer(conn);
      set({ connection: conn, connected: true, connecting: false, ...data });
      void saveConnection(conn);
      void get().flushQueue();
    } catch (e) {
```

with:

```ts
    try {
      const data = await loadFromServer(conn);
      const savedServers = upsertServer(get().savedServers, {
        serverUrl,
        token,
        lastUsedAt: Date.now(),
      });
      set({ connection: conn, connected: true, connecting: false, savedServers, ...data });
      void saveConnection(conn);
      void persistServers(savedServers);
      void get().flushQueue();
    } catch (e) {
```

- [ ] **Step 6: Add the `forgetServer` action**

In `src/store/useAppStore.ts`, add immediately after the `disconnect` action
(after its closing `},` near line 294):

```ts
  forgetServer: (serverUrl) => {
    const next = removeServer(get().savedServers, serverUrl);
    set({ savedServers: next });
    void persistServers(next);
    get().showToast('Removed');
  },
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npm test -- useAppStore`
Expected: PASS — new saved-server tests green, all existing store tests still green.

- [ ] **Step 8: Verification Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

---

## Task 3: Onboarding "Previously connected" UI

**Files:**
- Modify: `src/app/onboarding.tsx`

**Interfaces:**
- Consumes: `savedServers` + `forgetServer` + `connect` + `connecting` from the
  store (Task 2); `SavedServer` type from `@/data/servers`.
- Produces: UI only — no new exports.

There is no component test harness in this repo (vitest runs in node; no RN
testing-library), so this task is verified by the **Verification Gate** plus the
**Manual verification** checklist below — matching how the rest of the screens
are covered.

- [ ] **Step 1: Add the type import**

In `src/app/onboarding.tsx`, add after the `useAppStore` import (line 11):

```ts
import type { SavedServer } from '@/data/servers';
```

- [ ] **Step 2: Read the new store values and add local pending state**

After the existing store selectors (after `const enterDemo = useAppStore((s) => s.enterDemo);`, line 24), add:

```ts
  const savedServers = useAppStore((s) => s.savedServers);
  const forgetServer = useAppStore((s) => s.forgetServer);
  const [pendingUrl, setPendingUrl] = useState<string | null>(null);
```

- [ ] **Step 3: Clear the pending row when a connect attempt ends**

After the existing redirect effect (lines 26-28), add:

```ts
  // When a connect attempt finishes (success redirects away; failure surfaces
  // connectError), stop showing the per-row spinner.
  useEffect(() => {
    if (!connecting) setPendingUrl(null);
  }, [connecting]);
```

- [ ] **Step 4: Add the `tryServer` handler**

Before the `const input = { ... }` style object (line 30), add:

```ts
  // Tapping a saved row prefills the inputs (so a failed reconnect leaves the
  // fields ready to fix) and reuses the normal connect action.
  const tryServer = (srv: SavedServer) => {
    setUrl(srv.serverUrl);
    setToken(srv.token);
    setPendingUrl(srv.serverUrl);
    connect(srv.serverUrl, srv.token);
  };
```

- [ ] **Step 5: Render the "Previously connected" section**

Insert this block between the intro paragraph `</Txt>` (line 69) and the
`<View style={{ marginTop: 26 }}>` that holds `SERVER URL` (line 71):

```tsx
      {savedServers.length > 0 && (
        <View style={{ marginTop: 26 }}>
          <Txt weight={700} size={13} color={t.dim} style={{ marginBottom: 8 }}>
            PREVIOUSLY CONNECTED
          </Txt>
          {savedServers.map((srv) => {
            const host = srv.serverUrl.replace(/^https?:\/\//, '');
            const busy = pendingUrl === srv.serverUrl && connecting;
            return (
              <Pressable
                key={srv.serverUrl}
                onPress={() => tryServer(srv)}
                disabled={connecting}
                style={{
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  minHeight: 60,
                  borderRadius: 15,
                  backgroundColor: t.surface,
                  borderWidth: 1.5,
                  borderColor: t.line2,
                  paddingHorizontal: 14,
                  paddingVertical: 10,
                  marginBottom: 10,
                }}
              >
                <Icon name="clock" color={t.dim} size={20} />
                <View style={{ flex: 1 }}>
                  <Txt weight={600} size={15} numberOfLines={1}>
                    {host}
                  </Txt>
                  <Txt weight={500} size={12.5} color={t.dim} style={{ marginTop: 2 }}>
                    {'••••'}
                    {srv.token.slice(-4)}
                  </Txt>
                </View>
                {busy ? (
                  <ActivityIndicator color={t.dim} />
                ) : (
                  <Pressable
                    onPress={() => forgetServer(srv.serverUrl)}
                    hitSlop={10}
                    style={{ padding: 6 }}
                  >
                    <Icon name="close" color={t.faint} size={18} />
                  </Pressable>
                )}
              </Pressable>
            );
          })}
        </View>
      )}
```

(The inner delete `Pressable` becomes the touch responder, so tapping the ✕ does
not trigger the row's `onPress`/connect.)

- [ ] **Step 6: Verification Gate**

Run: `npm test && npx tsc --noEmit && npm run lint`
Expected: all pass.

- [ ] **Step 7: Manual verification**

Run the app (`npm run start`, or the user's normal device/sim flow):

1. Connect to a server (real or local test server). Confirm it lands in the app.
2. Settings → "Reconnect / change server" → you're back on onboarding and the
   server now appears under **PREVIOUSLY CONNECTED** with a masked token.
3. Tap the row → it reconnects in one tap (spinner on the row), lands in the app.
4. Disconnect again, tap the ✕ on the row → it disappears and a "Removed" toast
   shows; the row's connect does **not** fire.
5. Enter demo mode → confirm demo is **not** added to the list.

---

## Self-Review

**1. Spec coverage:**
- `servers.ts` module (type, key `babybuddy.servers.v1`, cap 6, shared
  `normalizeServerUrl`, guarded I/O, pure helpers) → Task 1. ✓
- Store: `savedServers` state, hydrate load + migration, connect upsert,
  `forgetServer` + toast, demo not saved → Task 2. ✓
- Onboarding: section above inputs, gated on non-empty list, leading `clock`,
  masked token, host strip, tap = prefill + connect, per-row spinner, nested
  delete `Pressable` → Task 3. ✓
- Unit tests for pure helpers → Task 1; store wiring tests → Task 2. ✓
- Error handling (guarded storage; failed reconnect prefilled) → Tasks 1 & 3. ✓

**2. Placeholder scan:** No TBD/TODO; every code step is complete. ✓

**3. Type consistency:** `SavedServer { serverUrl, token, lastUsedAt }`,
`upsertServer(list, server)`, `removeServer(list, serverUrl)`,
`forgetServer(serverUrl)` are used identically across Tasks 1–3. The store-test
mock of `@/data/servers` deliberately uses simple URL equality (documented), while
the real module and `servers.test.ts` exercise normalized dedupe. ✓
