# Saved servers with one-tap reconnect

**Date:** 2026-06-23
**Status:** Approved, ready for planning

## Problem

Reconnecting to a previously-used Baby Buddy server means retyping the server
URL and pasting the API token every time (e.g. after using "Reconnect / change
server" in Settings, or after a token expiry). The app already persists a single
*active* connection but has no memory of servers used before.

## Goal

On the connect-to-server (onboarding) page, show previously-connected servers as
tappable rows. Tapping one reconnects with a single tap using the saved URL +
token. Each row has a delete button to forget that server.

## Non-goals

- No editing of a saved server in place (delete + reconnect re-saves it).
- No syncing the server list across devices.
- Demo mode is never saved as a server.

## Decisions (resolved during brainstorming)

- **Retry behavior: one-tap reconnect.** Tapping a saved server immediately
  connects using the stored URL + token. On failure, prefill both inputs and
  show the error so the user can fix the token.
- **Token is stored** in `expo-secure-store`, consistent with how the active
  token is already stored today.
- **Cap = 6** saved servers (keeps the SecureStore value small and the list tidy).
- **Delete is immediate** — no confirmation modal — with a "Removed" toast.
- **Placement: above the inputs** on the onboarding page (the fast path).
- **Icons:** reuse existing `clock` (leading "recently used") and `close` (delete)
  glyphs rather than adding new `server`/`trash` SVGs to `Icon.tsx`.

## Architecture

Four focused units. The store remains the only thing the UI talks to for
behavior; persistence and pure list logic live in a dedicated data module.

### 1. `src/data/servers.ts` (new) — persistence + pure list helpers

```ts
export interface SavedServer {
  serverUrl: string;   // as the user entered it (used for display + reconnect)
  token: string;       // stored in SecureStore, same as the active token today
  lastUsedAt: number;  // for most-recent-first ordering
}

export async function loadServers(): Promise<SavedServer[]>;
export async function persistServers(list: SavedServer[]): Promise<void>;

// Pure, independently testable:
export function upsertServer(list: SavedServer[], server: SavedServer): SavedServer[];
export function removeServer(list: SavedServer[], serverUrl: string): SavedServer[];
```

- SecureStore key: `babybuddy.servers.v1` (separate from the existing
  `babybuddy.connection.v1` active-connection key, which is untouched).
- I/O is guarded with the same try/catch-to-no-op pattern as `src/data/storage.ts`
  so unsupported platforms (e.g. web) degrade gracefully.
- `upsertServer`: dedupe by **normalized URL**, move the entry to the front,
  refresh its `token` and `lastUsedAt`, and cap the list at 6 (drop the oldest).
- `removeServer`: drop the entry whose normalized URL matches.
- **Normalization is shared with the client.** `normalizeServerUrl` is currently
  private in `src/api/client.ts`; export it and reuse it here so
  `babybuddy.home.lan` and `https://babybuddy.home.lan/` collapse to one entry
  and never diverge from how the client builds its base URL.

### 2. `src/store/useAppStore.ts` — store wiring

- New state: `savedServers: SavedServer[]` (initial `[]`).
- `hydrate()` loads `savedServers`. If a saved **real** (non-demo) active
  connection exists, upsert it into the list — a one-time migration so existing
  users immediately see their current server as a retry row.
- `connect()` success path: `upsertServer(...)`, persist, and update
  `savedServers` state. `enterDemo()` does **not** touch the list.
- New action `forgetServer(serverUrl)`: `removeServer(...)`, persist, update
  state, and `showToast('Removed')`.

Tapping a saved row reuses the existing `connect(url, token)` action — no new
connect path is needed.

### 3. `src/app/onboarding.tsx` — UI

A **"Previously connected"** section above the SERVER URL input, rendered only
when `savedServers.length > 0`. Each row uses existing surface/`input` styling:

- Leading `clock` icon, the host (URL with `https?://` stripped, matching
  `settings.tsx`), and a masked token `••••<last4>`.
- **Tap row** → set local `url`/`token` state to that server's values, then call
  `connect(url, token)`. On success the existing `useEffect(connected →
  router.replace('/(tabs)'))` redirects. On failure, the inputs are already
  prefilled with those values and `connectError` renders — the "fix the token"
  path falls out for free.
- **Per-row spinner:** local `pendingUrl` state renders an `ActivityIndicator`
  on the tapped row while `connecting` is true. The main Connect button keeps
  its own spinner.
- **Delete button** (`close` icon at the right edge): a nested `Pressable` so the
  touch is handled by the inner button and does not trigger the row's connect.
  Calls `forgetServer(serverUrl)`.

### 4. `src/data/servers.test.ts` (new) — unit tests

Vitest is already configured. Cover the pure helpers:

- `upsertServer` dedupes by normalized URL (scheme/trailing-slash variants collapse).
- Re-using a server moves it to the front and refreshes `token` + `lastUsedAt`.
- The list caps at 6, dropping the oldest.
- `removeServer` drops the matching entry (and is a no-op for an unknown URL).

## Data flow

```
onboarding tap saved row
  -> set local url/token state
  -> store.connect(url, token)
       success: upsertServer -> persistServers -> set savedServers
                connected=true -> redirect to /(tabs)
       failure: connectError set, inputs already prefilled

onboarding tap delete (close icon)
  -> store.forgetServer(url)
       removeServer -> persistServers -> set savedServers -> toast "Removed"

app launch
  -> store.hydrate()
       loadServers() -> set savedServers
       if real active connection: upsertServer (migration) -> persist
```

## Error handling

- All SecureStore reads/writes are guarded; failures degrade to no-ops (web, or
  storage unavailable), never crashes.
- Connect failure from a saved row is the same path as a manual connect: the
  existing `connectError` message renders and the prefilled inputs let the user
  correct the token.
- A 401/403 during launch hydrate continues to clear the *active* connection (as
  today); the saved-servers list is unaffected, so the server stays available as
  a retry row.

## Testing

- Unit tests for the pure list helpers (above) via vitest.
- Manual verification: connect to a server, disconnect via Settings, confirm the
  row appears on onboarding, tap to reconnect, and delete a row.
```
