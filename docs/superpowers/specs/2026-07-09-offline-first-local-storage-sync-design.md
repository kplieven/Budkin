# Offline-first local storage with later Baby Buddy sync

**Date:** 2026-07-09
**Status:** Approved, ready for planning

## Problem

The app is today a pure client of a Baby Buddy server. Core data — children,
entries, measurements — is **never persisted to disk**. It is fetched from the
server on every `hydrate()`/`refresh()` (`src/data/repository.ts` →
`loadFromServer`), or, in demo mode, re-seeded from a throwaway local seed
(`src/data/seed.ts`). Consequences:

- You **cannot use the app at all without a Baby Buddy server.** The only
  no-server option is ephemeral **demo mode** (`enterDemo`,
  `src/store/useAppStore.ts:470`), which seeds *fake* data and is discarded.
- `saveChild` (`useAppStore.ts:572`) and `saveMeasurement` (`useAppStore.ts:866`)
  push **only** when `conn && !conn.demo && !s.offline`. Offline (or demo), the
  write is **silently dropped** — no queue, no disk — and the next wholesale
  `refresh()` (`set({ ...data })`, `useAppStore.ts:407`) erases it from view.
  Only **entries** have an offline queue (`src/data/queue.ts`,
  `babybuddy.queue.v1`).
- `saveChild` **overwrites the child's local `id` with the server id in place**
  (`useAppStore.ts:640`). This is safe *only* because children are created
  online today with no local entries referencing them by `childId`.

## Goal

- Let anyone use the app fully with **no Baby Buddy configured** — add children,
  log activities, record measurements — all stored **durably on-device** and
  surviving restarts. A persistent **local mode**.
- Let a user later connect a Baby Buddy instance and **push all local data up**
  in one direction ("adopt"), after which the app runs as today's normal
  server-backed client.
- Make **offline child management and offline measurements** work for *connected*
  users too — durable, queued, flushed on reconnect — instead of vanishing.

## Decisions (from brainstorming)

1. **Sync model — one-way adopt into a fresh instance.** On connect, push local
   data *up*; then run as a normal client. No merge engine, no continuous
   two-way sync, no multi-device live sync.
2. **Entry point — promote demo → persistent local mode.** The "try it now" path
   becomes a first-class "Start now, connect Baby Buddy later" that stores *your*
   data durably. The fake-seed demo folds away; local mode starts empty.
3. **Non-empty server — detect & guard.** An empty server uploads cleanly. A
   server that already has data does **not** auto-upload (avoids duplicates); it
   defaults to using the server's existing data (local data preserved,
   recoverable), with an explicit **"Upload anyway"** override.
4. **Override upload — child-level dedup.** When overriding onto a non-empty
   server, match an existing server child by **first name + birth date** and
   attach the local child's entries/measurements to it rather than creating a
   duplicate child. Individual entries/measurements are still appended (they are
   not deduped).

## Constraints & context (verified)

- **Connection** is `{ demo: boolean; serverUrl: string; token: string }`
  (`src/data/repository.ts:21`), persisted as JSON in secure storage under
  `babybuddy.connection.v1` (`src/data/storage.ts`).
- **The repository is the only seam to the server.** ~12 free functions in
  `src/data/repository.ts`, each constructing a `BabybuddyClient` and
  early-returning on `conn.demo`. The store talks only to the repository.
- **Models** (`src/types/models.ts`): `Entry` (via `EntryBase`, line 49) and
  `Measurement` (line 147) each carry an optional `serverId?: number`. **`Child`
  (line 15) does not** — its `id` string *is* its identity, and is overwritten
  with the server id on sync.
- **Existing persistence pattern**: `src/data/queue.ts` and `src/data/timers.ts`
  are the template — AsyncStorage, JSON, guarded `load`/`save`/`clear`; timers
  are written via a `useAppStore.subscribe(...)` side-effect at the bottom of the
  store.
- **Wholesale replace**: `hydrate()` and `refresh()` do `set({ ...data })`
  (`useAppStore.ts:356`, `:407`), replacing `children`/`entries`/`measurements`
  with server data. `mergeQueuedEntries` (`useAppStore.ts:219`) re-injects queued
  entries into view on cold hydrate so they stay visible; there is no equivalent
  for children/measurements, and none on warm `refresh`.
- **Optimistic local-then-swap** already exists: entries/measurements create with
  a `Date.now()`-based local id, then patch in `serverId` when the push resolves
  (`commitWrite` `:546`; `saveMeasurement` `:897`).
- **Connection gating**: `connected` + the `src/app/index.tsx` redirect decide
  routing; demo sets `connected:true`. `enterDemo` (`:470`) is the current
  no-server escape hatch.
- **Home-screen widget** writes headlessly (no store) to the entry queue +
  timers (`src/widgets/napToggle.ts`), gated by
  `canQueueNap = !!connection && !connection.demo` (`src/widgets/snapshot.ts`).
- **Client child id assumptions**: `updateChild` does `Number(child.id)` and
  bails on a non-finite id (`src/api/client.ts:318`); server-loaded children are
  keyed by `String(serverId)`.
- Data volumes are small (a baby log is a few thousand rows over years), so
  whole-collection JSON rewrites are cheap and no relational DB is warranted.

## Non-goals (YAGNI)

- **Continuous two-way / multi-device sync.** After adopt it is a normal
  single-source server client.
- **Conflict resolution beyond the child-level dedup** on override. No
  entry-level dedup/merge.
- **Full offline *read* cache of server data.** Server mode still loads from the
  server; the durable store *could* back offline reads later, but v1 does not
  reconcile server↔local reads.
- **Server → local direction.** Adopt is local → server only.
- No new native dependency (no SQLite/MMKV/Realm). AsyncStorage JSON only.

---

## Design

### 1. Connection: `demo` flag → `local` / `server` mode

Replace the ephemeral `demo` boolean with a discriminated, persistent mode:

```ts
type Connection =
  | { mode: 'local' }                                       // no server, durable on-device
  | { mode: 'server'; serverUrl: string; token: string };
```

- Every `conn.demo` check (~15 sites) becomes a `mode` check. **The meaning
  flips inside the repository**: where `demo` meant *"no-op, nothing persists,"*
  `mode === 'local'` means *"read/write the durable local store."*
- **Migration** in `loadConnection` (`src/data/storage.ts`): map legacy
  `{demo:true}` → `{mode:'local'}` and `{demo:false, serverUrl, token}` →
  `{mode:'server', serverUrl, token}`. Existing users carry over seamlessly; old
  demo users (throwaway seed) land in an empty local store, which is acceptable.
- `connected` and the `src/app/index.tsx` redirect are unchanged: local mode
  sets `connected:true` and opens straight into the tabs, exactly as demo does
  today.
- `enterDemo` is replaced by `enterLocal()` — sets `{mode:'local'}`,
  `connected:true`, persists the connection, and leaves the (durable, possibly
  empty) store as-is instead of seeding fake data.

### 2. The durable local entity store

New persistence modules following the **exact `queue.ts`/`timers.ts` pattern**
(AsyncStorage, JSON, guarded `load`/`save`/`clear`):

- `babybuddy.children.v1`, `babybuddy.entries.v1`, `babybuddy.measurements.v1`,
  plus small `babybuddy.selectedChild.v1` / `babybuddy.lastFeed.v1`.
- Written via a Zustand `subscribe` side-effect (mirroring the timers persistence
  already at the bottom of the store): any change to those slices persists.
- Read on `hydrate` **when `mode === 'local'`** → the store's source of truth
  (replaces the demo-seed branch).
- In **server mode** the same store does double duty as offline-write durability
  (§4–§5). No new dependency.

### 3. Data model & ID reconciliation

The genuinely hard part, solved once.

- **Add `serverId?: number` to `Child`** (mirrors `Entry`/`Measurement`). The
  stable local `id` string becomes the **permanent primary key everywhere** —
  React keys, `childId` foreign refs, `selectedChildId`, the widget snapshot.
  `serverId` is a pure sync annotation.
  - Remove the in-place `child.id` overwrite (`useAppStore.ts:640`); set
    `serverId` instead.
  - `updateChildOnServer` / `client.updateChild` key off `child.serverId` rather
    than `Number(child.id)` (`client.ts:318`).
  - On server load, populate `serverId` on children (and keep a stable `id`), so
    server ops never depend on parsing `id`.
- **Refs are never rewritten in place.** Local records reference their parent by
  *local* `childId`. The only moment a local→server id mapping is needed is at
  **upload**. One primitive owns it — the **sync uploader**:

  ```
  uploadUnsynced(records):                    // used by BOTH adopt and flushQueue
    for each child with serverId == null:
        POST child → capture serverId, persist child.serverId
    for each entry/measurement with serverId == null:
        POST it, sending childId = its child's serverId    // transient remap
        capture + persist serverId
    // resumable & idempotent: any record already carrying a serverId is skipped
  ```

  After an upload completes and the app reloads from the server, everything is
  server-keyed and consistent — the local-id world retires. No fragile in-place
  swaps.
- **`mergeUnsynced`** generalizes today's `mergeQueuedEntries`: when server mode
  reloads wholesale, any local record with `serverId == null` (an un-flushed
  offline create) is merged *back* into view instead of dropped — across
  children, entries, and measurements. Applied on both cold `hydrate` and warm
  `refresh` (today's asymmetry — no merge on `refresh` — is fixed).

### 4. Write & persistence flow

The rule: **optimistic write → durable local store (persisted) → sync now or
mark pending.** Nothing is ever dropped.

| Operation | Local mode | Server + online | Server + offline |
|---|---|---|---|
| Create child / measurement / entry | write store (done — source of truth) | write store + push, stamp `serverId` | write store, leave `serverId` null → **pending** *(today: dropped)* |
| Edit an already-synced record | write store | write store + `PATCH` (keyed off `serverId`) | write store + record a pending **update** op |
| Delete | remove from store | remove + `DELETE` (needs `serverId`) | if it had a `serverId`: remove + record a pending **delete** op (tombstone); if `serverId == null`: just drop it locally — nothing to sync |

This means `saveChild`, `saveMeasurement`, and `commitWrite` all gain a
`mode === 'local'` branch (write store, no server) and a server-offline branch
(persist as pending), in addition to the existing server-online path.

### 5. Pending-sync representation (absorbs `queue.ts`)

- **Pending creates need no separate queue** — they are exactly the durable-store
  records with `serverId == null`. `flushQueue` becomes `uploadUnsynced()`
  scanning for them. This unifies children + entries + measurements under one
  mechanism.
- **Pending updates/deletes** to *already-synced* records cannot be derived, so a
  small op-log `babybuddy.pendingOps.v1` holds them
  (`{ op: 'update' | 'delete', entity, id, serverId, … }`), replayed on
  reconnect. These ops only ever target records that already carry a `serverId`,
  which are disjoint from the `serverId == null` creates — so op-replay and
  create-flush do not interact. (An offline edit to a not-yet-uploaded record
  simply mutates the durable store in place; deleting one just drops it locally.)
- This **absorbs the existing entry-only `queue.ts`.** **Migration**: on upgrade,
  drain anything already in `babybuddy.queue.v1` into the durable store (as
  `serverId == null` creates) so a user mid-offline loses nothing; then retire
  the key.
- The pending **indicator** (today `queueCount`, shown at
  `src/app/(tabs)/index.tsx` and `src/shell/TopBar.tsx`) generalizes to a count
  of *all* unsynced records + pending ops.

> **Alternative considered:** keep `queue.ts` and merely widen it to all entity
> types. Lower-risk (leaves tested code intact) but re-introduces two homes for
> "unsynced." The unified model is recommended and is the whole point of a
> durable store; the migration above covers the tested-code risk.

### 6. The adopt sequence (local → fresh server)

Triggered from **Settings → "Connect Baby Buddy"** (in local mode), or the
onboarding connect form when local data exists:

```
1. Enter URL + token → validate via listChildren (as connect() does today).
2. Emptiness check — does the server already have children/entries?
     ├─ EMPTY      → confirm "Upload N children, M entries, K measurements?"
     └─ NON-EMPTY  → GUARD: "This server already has data…"
                       • default: Use server data  → switch to server mode,
                                  loadFromServer; local data preserved,
                                  not uploaded (recoverable later from Settings)
                       • override: Upload anyway    → uploader runs WITH
                                  child-level dedup (match first+birth; attach
                                  entries to the existing server child)
3. uploadUnsynced() — children → entries → measurements, in dependency order,
     stamping serverId per record as it lands  (progress: "Uploading 12/48").
4. On FULL success → persist {mode:'server', …}, switch mode, loadFromServer
     (everything now server-keyed & consistent) → toast "Synced N items".
```

**Failure / interruption handling:**

- Each record's `serverId` is **persisted as it uploads**, so a network drop or
  app kill mid-upload is **resumable** — re-running skips anything already
  carrying a `serverId` (idempotent; no duplicates on retry to the *same*
  server).
- The app **only flips to server mode after a fully-successful upload.** A
  partial upload leaves it safely in *local* mode with a **"Retry sync"**
  affordance — never a half-adopted server state.
- **Server-switch guard.** A `serverId` is meaningful only for the server it was
  uploaded to. Record which server an in-progress adoption targets (e.g. a
  `pendingAdoptionTarget`); if the user abandons it and later targets a
  *different* server, **clear the stale `serverId`s before uploading** — so
  retry-same-server stays duplicate-free *and* switch-server does not wrongly
  skip records.

### 7. UX touchpoints

- **Onboarding** (`src/app/onboarding.tsx`): the `enterDemo` "try it" button
  becomes a first-class **"Start now — connect Baby Buddy later"** → `enterLocal()`.
  The URL+token form stays as the "I already run Baby Buddy" path; the
  "Previously connected" list is unchanged.
- **Settings** (`src/app/settings.tsx`): in **local mode**, add a **"Connect Baby
  Buddy"** entry that launches the adopt flow, plus a small data summary
  ("N children, M entries on this device") and a way to re-attempt upload of
  preserved local data. In **server mode**, today's host/token/disconnect UI is
  unchanged. `toggleOffline` (simulate) stays for testing.
- **Adopt flow UI**: a small state machine — form → checking → confirm-or-guard →
  uploading (with progress) → done — housing the emptiness confirm, the
  non-empty warning + "Upload anyway", and "Retry sync" on partial failure.

### 8. Home-screen widget (headless path)

`src/widgets/napToggle.ts` / `snapshot.ts` write directly to storage with no
store running, gated on `!connection.demo`. This must move to the new
persistence model + `mode` check so a widget-started nap in **local mode** also
persists to the durable store (as a `serverId == null` create), and the server
gate becomes `mode === 'server'`. The `WidgetSnapshot` carries whatever the
headless path needs to make the same mode decision the store would.

### 9. Child photos in local mode

Photos are stored as local file URIs (`Child.picture`). On adopt they upload via
the existing multipart `PhotoChange` path (`pushChildToServer` already accepts a
`PhotoChange`). Edge: the picked file must still exist on disk at adopt time (see
Edge cases).

## Edge cases

- **Interrupted adopt** → resumable via persisted per-record `serverId`; app
  stays in local mode until full success; "Retry sync" re-runs the uploader.
- **Abandon adopt, then connect a different server** → stale `serverId`s cleared
  before the new upload (§6 server-switch guard).
- **Non-empty server, user picks "Use server data"** → local data is **not**
  deleted; it stays in the durable store, flagged unsynced, uploadable later from
  Settings.
- **Override onto non-empty server** → child matched by first+birth is reused;
  entries/measurements are appended and *can* duplicate (accepted — the user was
  warned; no entry-level merge exists).
- **Offline-created child then offline entries for it** → all reference the
  child's stable local `id`; on reconnect the uploader pushes the child first,
  then its entries with the child's new `serverId` (§3). No ref rewriting.
- **Photo file missing at adopt time** (OS cleared the cache dir) → upload that
  child without a picture; do not fail the whole adopt. Log/skip gracefully.
- **Legacy `babybuddy.queue.v1` present on upgrade** → drained into the durable
  store, then the key retired (§5).
- **Corrupt persisted JSON** → guarded reads fall back to empty (mirrors
  `loadPrefs`/`loadTimers`).
- **Connecting with no local data at all** (a brand-new user who connects
  immediately) → adopt degenerates to today's plain `connect()`: nothing to
  upload, switch to server mode and load.

## Testing (vitest — matches the existing data-layer test style)

- **Local-store modules**: `load`/`save`/`clear` round-trip; corrupt-JSON
  graceful fallback (mirrors `prefs.test`).
- **`uploadUnsynced`**: child-before-entries ordering; `serverId` stamping;
  `childId` → server-id remap; resumability (skips already-stamped); idempotent
  retry (no duplicates to the same server); child-level dedup on override
  (first+birth match); partial failure leaves a valid local-mode state.
- **`mergeUnsynced`**: unsynced local records survive a wholesale server reload;
  no duplicates once synced; applied on both `hydrate` and `refresh`.
- **Connection migration**: `{demo}` → `{mode}` mapping; legacy
  `babybuddy.queue.v1` drained.
- **Offline child/measurement**: created offline → persisted → flushed on
  reconnect with correct `serverId` + ref remap.
- **Non-empty guard**: empty → upload; non-empty → use-server (local preserved) /
  override-with-dedup; server-switch `serverId` reset.
- **Store actions**: `saveChild` / `saveMeasurement` / `commitWrite` branch
  correctly per `mode` and connectivity.

## Implementation phases (for the plan)

Each is roughly independently shippable and builds on the prior:

1. **Foundation** — durable local entity store + `Child.serverId` + connection
   `mode` migration + `enterLocal`. Makes local mode real and fixes the vanish
   bug for local mode.
2. **Offline durability** — unified pending model (`serverId == null` creates +
   `pendingOps` log) + offline child/measurement + `mergeUnsynced` +
   `queue.ts` absorption + widget headless path.
3. **Adopt** — `uploadUnsynced` + emptiness guard + child-level dedup + adopt UX
   (onboarding + Settings), including failure/resumability and the server-switch
   guard.
