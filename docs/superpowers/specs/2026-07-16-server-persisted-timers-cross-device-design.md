# Server-persisted timers across devices

**Date:** 2026-07-16
**Status:** Approved, ready for planning

## Problem

Running timers are the one piece of state Budkin keeps **purely on-device**.
A timer is a stopwatch that has not been committed as an entry yet; it lives in
the `timers: Timer[]` array and is mirrored to AsyncStorage
(`babybuddy.timers.v1`, `src/data/timers.ts`) on every change by a store
`subscribe` (`src/store/useAppStore.ts:1875`). The module comment states the
assumption directly: "the Baby Buddy server has no matching record."

Consequences:

- A timer started on your phone is invisible on your tablet or on the web app.
- If you start a sleep timer on one device and pick up another, you cannot see
  it, stop it, or trust that it is still running.

Everything else (children, entries, measurements) already syncs to the user's
Baby Buddy instance with `serverId` stamping and an offline op-log
(`src/data/pendingOps.ts`). Timers sit outside all of it.

## Goal

Persist a running timer to the user's Baby Buddy instance so it is visible and
stoppable from every device signed into the **same account**. Reuse the existing
offline-first machinery rather than inventing a parallel one. Keep the entry
commit exactly as it is today (fully local, then synced), so stopping a timer
never depends on the network.

## Decisions (from brainstorming)

1. **Sharing model: same account, many devices.** One Baby Buddy login/token on
   phone + tablet + web. This maps cleanly onto Baby Buddy's user-scoped timers
   (`/api/timers/` returns the requesting user's timers). Cross-caregiver
   visibility (different accounts) is explicitly out of scope.
2. **Freshness: on focus / refresh.** No polling loop. A device picks up server
   timers on the sync moments Budkin already has: foreground, pull-to-refresh,
   reconnect. A timer's elapsed display derives from its `start`, so a device's
   clock is correct the instant it learns the start time; polling would only
   affect how fast it notices a timer appearing, disappearing, or being edited.
3. **Fidelity: structural details plus `amount`.** Carry the fields that define
   the entry's shape (`saveAs`/`activity`, `feedType`, `method`, `startSide`,
   `nap`, the tummy `milestone` flag) and the scalar `amount`. Do **not** carry
   freeform notes or tags; those stay on the device where they were typed.
4. **Mechanism: server mirror via native `/api/timers/` (Approach A).** The BB
   timer mirrors the local running timer. The entry commit stays local. Two
   alternatives were rejected: (B) using BB's timer-to-entry conversion on stop,
   which forces a second, online-only stop path for no real gain; and (C)
   encoding timers as ghost Notes, which pollutes the notes stream Budkin already
   partitions three ways and orphans records on a crash.

## What Baby Buddy gives us

`/api/timers/` exists and supports create (POST), list (GET), and per-id
operations. A timer has native `child`, `name`, `start`, `duration`, `user`
fields (plus end/active state). Two facts shape the design:

- Timers are **scoped to the `user`** of the API token. Same account on many
  devices means one user, so every such device sees the same timers. This is why
  the same-account model works with no server-side changes.
- A BB timer is **thin**: `child` and `start` are native, but there is no field
  for Budkin's structural metadata. The single free-form field is `name`.

`PATCH` and `DELETE` on `/api/timers/{id}/` are expected (standard DRF CRUD) but
will be **verified against the target instance** during implementation. Fallback
if `PATCH` is ever unavailable: `DELETE` + re-`POST`.

## Data model

`Timer` (`src/types/models.ts`) gains one field:

```ts
serverId?: number;
```

Its meaning is identical to `Child`/`Entry`/`Measurement`: `serverId == null`
means "not on the server yet" (created offline, or push still pending). No other
`Timer` field changes.

## Encoding: structural metadata in `name`

`child` and `start` ride natively on the BB timer, so `name` carries only the
structural fields. Encoding is a compact, human-readable token string (not a
JSON blob) so Baby Buddy's own web UI still shows something legible:

```
"Feeding · breast/left"     "Sleep · nap"     "Tummy"     "Pumping · 90"
```

- The first token maps to `saveAs` (reverse of `ACTIVITY_LABEL`).
- The remaining tokens are a small, enumerable vocabulary (feed type, method,
  side, nap flag, tummy milestone flag) plus the numeric `amount` where present.
- Only freeform notes and tags stay device-local; everything that shapes the
  committed entry, including `amount`, travels, so a cross-device stop produces
  the same entry.
- A version marker is baked into the grammar so the format can evolve.
- The payload stays well under Baby Buddy's ~255-char `name` limit.
- The parser **tolerates an unrecognized `name`** (for example a timer created
  in Baby Buddy's own UI): it falls back to a generic timer of the inferred
  activity, still stoppable from Budkin.

## New surfaces

- **`src/api/client.ts`**: `listTimers()`, `createTimer(childServerId, startISO,
  name)`, `updateTimerName(id, name)`, `deleteTimer(id)`.
- **`src/data/serverTimers.ts`** (new, pure): `encodeTimerName(timer)`,
  `decodeTimerName(name)`, and `serverTimerToTimer(bbTimer, childIdForServerId)`
  to reconstruct a local `Timer` from a BB timer. This mirrors the existing
  notes/bath serialization split already living next to the client.
- **`src/store/useAppStore.ts`**: background server mirror wired into the timer
  actions, plus the pull/reconcile step, following the optimistic pattern of
  `commitWrite`.

## Lifecycle to server

All local behavior is unchanged; each action gains a background server mirror.

- **Start** (`startQuickTimer` and the log-sheet `fromTimerId` path): add the
  local timer as today. If online + server mode, fire `POST /api/timers/` in the
  background and stamp `serverId` on success. If offline, leave `serverId == null`;
  the existing reconnect flush pushes it (same "push all `serverId == null`" rule
  already used for children/entries).
- **Edit** (`saveTimerDetails`): patch locally as today. If the timer has a
  `serverId` and we are online, `PATCH` the re-encoded `name`. If offline, enqueue
  an update op.
- **Stop / discard** (`stopTimer`, `discardTimer`): unchanged locally, the entry
  still commits through the current offline-first path. Additionally `DELETE` the
  mirror (or enqueue a delete op if offline). The server timer is never used to
  build the entry, so stopping works with zero network.

## Pull + reconcile

On foreground / pull-to-refresh / reconnect, after fetching entries, also
`GET /api/timers/` and reconcile against the local array:

- Local timer **with** `serverId`, still on server: keep it; refresh structural
  fields and `start` from the server copy (another device may have edited or
  re-anchored it) while **preserving local-only notes/tags**.
- Local timer **with** `serverId`, **gone** from server: it was stopped or
  discarded elsewhere; remove it locally. Its committed entry arrives via the
  normal entry sync.
- Local timer with `serverId == null`: leave alone (pending push).
- Server timer not matched locally: reconstruct a `Timer` (decode `name`, map the
  child FK back to the local child id) and add it.

**No sync loop is possible**: everything a pull adds or updates carries a
`serverId`, so the "push all `serverId == null`" flush never re-sends it. If a
server timer references a child not present locally, skip it; it resolves once
that child syncs.

## Offline op-log

Extend the `PendingOp` union (`src/data/pendingOps.ts`) with two timer variants:

```ts
| { op: 'update'; entity: 'timer'; payload: Timer }
| { op: 'delete'; entity: 'timer'; serverId: number }
```

**Create needs no op**: a `serverId == null` timer is itself the "needs create"
signal, drained by the reconnect flush like children/entries. Flush order on
reconnect: POST the `serverId == null` timers (stamp ids), then replay queued
timer update/delete ops in the same loop that already replays the other entity
ops. An offline edit of a still-unsynced timer also needs no op: the eventual
create encodes the current (edited) local name.

## Edge cases

1. **Start-then-immediately-stop race** (stop fires before the create POST
   returns): at stop the timer is still `serverId == null`, so there is nothing
   to delete yet, but the in-flight POST could leave an orphan. The create's
   resolve callback checks whether the timer still exists locally; if it was
   stopped or discarded meanwhile, it immediately `DELETE`s the just-created
   server timer. Same shape as `commitWrite`'s existing `.then(serverId => ...)`
   callback, plus an existence guard.
2. **Duplicate timers across devices** (two devices each start a feeding timer):
   after sync both exist with distinct `serverId`s and both show up. Budkin
   already allows concurrent timers, so nothing breaks. v1 reflects the truth
   rather than auto-merging. Accepted limitation; a future version could de-dupe
   by (activity, child, approximate start).
3. **Foreign timers made in Baby Buddy's own UI**: decode falls back to a generic
   timer of the inferred activity; still stoppable from Budkin.
4. **Disconnect / switch-server reset**: the existing "strip `serverId`s" path
   (`src/store/useAppStore.ts` around line 684) must also strip timers'
   `serverId`s, so they never point at another server's ids.

## Pull-to-refresh on the timers page

`src/app/(tabs)/timers.tsx` is still a live route (reached from Home's live-timer
card, the "Timers" link, and the widget deep link), just no longer a bottom tab.
Its `ScrollView` (`timers.tsx:342`) has no pull-to-refresh today. Wrap it the
same way `src/app/(tabs)/index.tsx` does: native `RefreshControl` bound to the
store's `refresh()`, plus `useWebPullToRefresh` for web. Because `refresh()` will
now also pull and reconcile server timers, pulling down here surfaces a timer
started on another device and clears one stopped elsewhere.

## Testing

- **Pure units** (vitest, alongside existing `*.test.ts`):
  - `encodeTimerName` / `decodeTimerName`: round-trip each activity + structural
    combo including `amount`; tolerate unknown/foreign/oversized names; version
    marker.
  - `serverTimerToTimer`: child FK to local id mapping, decode.
  - `reconcile`: the four cases (keep-and-refresh while preserving local
    notes/tags; remove-when-gone; keep-unsynced; add-new) plus the no-loop
    invariant (added timers carry `serverId`).
  - `pendingOps`: the two new timer variants round-trip.
- **Store** (`src/store/useAppStore.test.ts`): start online stamps `serverId`;
  start offline then reconnect flush POSTs; edit online `PATCH`es; edit offline
  queues and replays; stop/discard online `DELETE`s, offline queues; the
  start-then-immediately-stop orphan cleanup; pull reconcile adds server timers
  and removes a locally-synced timer gone from the server.
- **Client** (`src/api/client.test.ts`): the four new HTTP methods (verb, URL,
  payload).
- **Manual verify**: start a timer on the app, pull-to-refresh on web (or a
  second device) and see it appear; stop it and see it clear.

## Out of scope

- Cross-caregiver (different account) timer visibility.
- Real-time / polled updates while the app is idle in the foreground.
- Carrying freeform notes/tags across devices.
- Auto-merging duplicate timers.
