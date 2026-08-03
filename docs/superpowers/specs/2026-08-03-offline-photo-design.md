# A child photo picked offline survives the reconnect

**Status:** approved 2026-08-03, not yet implemented.

**Goal:** a photo set on a child while offline is uploaded when the connection
comes back, instead of being dropped with an apology.

## Why

Today every deferred save loses the photo, and 0.14.3 made that honest rather
than silent: the toast reads `Saved · photo not saved` or
`Updated · photo not removed`. Two things stand in the way, and both have to go:

1. **A queued op is JSON on disk and cannot carry a file.** `PendingOp` is
   serialized into AsyncStorage, so a `PickedPhoto` (which carries a `Blob` on
   web and an `expo-file-system` `File` on native) cannot ride along.
2. **The picked URI lives in Android's evictable cache.** Even a path recorded
   on disk can point at nothing by the time the flush runs, because the cache
   directory is exactly the place the system reclaims under storage pressure.

The second problem is the load-bearing one, and fixing it also repairs a latent
bug nobody has reported yet: in **local mode** a child's photo is only ever the
cache URI, so it breaks whenever Android reclaims the file, with no server copy
to fall back on.

## Scope

Four paths currently drop a photo. Three are in:

| when | today | after |
| --- | --- | --- |
| offline edit of a synced child | op queued, photo dropped | op queued plus a pending-photo record; the replay sends the photo |
| offline create | queued for `uploadUnsynced`, photo dropped | record written; `pushChild` carries it |
| expecting child, even created online | held back, `confirmBirth` pushes without it | record written; `confirmBirth` carries it |
| edit of a never-pushed child, even online | `updateChild` returns early on `serverId == null`, photo dropped | record written; whichever push claims that child later carries it |
| online push fails | photo lost, toast says so | **unchanged, out of scope** |

The fourth row is easy to miss. `BabybuddyClient.updateChild` returns
`undefined` before doing anything when `serverId == null` (`client.ts:877`), so
editing an offline-created or expecting child is a server no-op even with a full
connection. Its photo is deferred exactly like an offline one.

An online push failure loses the whole edit, not just the photo, because an
online edit is queued nowhere. That is a separate, pre-existing gap and the
toast already names it.

An offline photo REMOVAL is in scope on the same mechanism, so
`Updated · photo not removed` goes away too.

**Native only.** On web the picked URI is a `blob:` URL that dies on reload,
there is no document directory, and AsyncStorage is `localStorage` there, whose
roughly 5MB quota two base64 photos would exhaust. Web keeps today's warning.

## Design

### 1. The file is copied at pick time

`pickChildPhoto` copies the picked asset into
`<Paths.document>/childPhotos/photo-<epochMs>.<ext>` and returns a `PickedPhoto`
whose `uri` and `nativeFile` point at the COPY, never at the cache original.

Copying at pick time rather than at save time is deliberate. It keeps
`saveChild` synchronous, which matters in a store where four separate 0.14.x and
0.15.x bugs were mid-flight write races, and it means every path downstream
handles plain serializable data. The costs are one extra file write per pick
(roughly 600KB) and an orphaned file when the user picks a photo and then
cancels the sheet. The sweep below collects those.

`PickedPhoto` gains `durable: boolean`. It is `false` on web and when the copy
throws. That is a recorded fact rather than something inferred from the URI's
prefix: this codebase has been bitten before by inferring state that should have
been written down (see the `heldBack` note in `src/types/models.ts`).

### 2. The pending photo is recorded in its own store

`src/data/pendingPhotos.ts`, AsyncStorage under `budkin.pendingPhotos.v1`, a map
from LOCAL child id to:

```ts
type PendingPhoto =
  | { kind: 'set'; uri: string; name: string; type: string }
  | { kind: 'remove' };
```

Its own store rather than a field on `Child` or on `PendingOp`, for two reasons
that are not stylistic:

- **`reconcileChildren` would eat it.** A child with a `serverId` is replaced
  wholesale by the server's copy on every refresh (`useAppStore.ts:879`), so a
  local-only field on that record survives exactly until the next refresh, which
  can easily land before the flush. A never-pushed child is kept whole, so the
  field would survive there, which means a `Child`-record home works for two of
  the three paths and silently fails for the third. A separate store is
  unaffected by reconciliation by construction.
- **One pending photo per child is the correct invariant.** The op log appends
  without dedup on purpose (two offline renames are two renames), so putting the
  photo there makes two offline photo edits upload two files. A map keyed by
  child id overwrites, which is what re-picking a photo means.

Every mutation re-reads the stored map before writing it back, for the same
reason `removePendingOp` re-reads: a write landing during a flush must not be
clobbered by the flush's stale snapshot.

The map is NOT mirrored into store state. Nothing needs it synchronously: the
avatar reads `child.picture`, and the flush paths are already async.

### 3. Modules

- **`src/lib/photoFile.ts` (new).** `persist`, `reopen`, `discard`, `sweep`.
  Imports `expo-file-system` and `Platform`, nothing else. Every function is a
  no-op returning the not-durable answer on web.
- **`src/lib/photo.ts`.** The picker, now calling `persist`. It keeps its
  `expo-image-picker` import, which is why the file-system half is a separate
  module: the store must be able to import the file half without pulling the
  picker in.
- **`src/data/pendingPhotos.ts` (new).** As above, modelled on `pendingOps.ts`.
- **`src/store/useAppStore.ts`.** Records on save, reads on flush, clears on
  success. Detailed below.
- **`src/data/sync.ts`.** `UploadDeps.pushChild` returns `{ id, picture }`
  instead of a bare `number`, so `uploadUnsynced` can stamp the server's URL
  over the local file path. Its `slug` is deliberately still dropped: the
  existing comment at `useAppStore.ts:815` explains why that is self-healing,
  and widening the change to cover it means rewriting that rationale for no
  reported symptom.

The API layer needs NO change. `updateChildOnServer` and `pushChildToServer`
already accept a `PhotoChange`, and a `PickedPhoto` rebuilt by `reopen` carries
the `nativeFile` that `pictureInit` wants.

One consequence worth naming: `buildChildForm` passes no filename for the native
part, so Baby Buddy stores the file under the name on disk. After this change
that is `photo-<epochMs>.jpg` rather than the picker's cache name, which is an
improvement and not a regression.

### 4. Store changes

**One rule for both `saveChild` branches:** record whenever this save will not
itself upload the photo. A save uploads only when online AND the child is
already on the server (edit), or when online AND the child is not expecting
(create). Everything else defers, so everything else records. Concretely:

- edit: record iff server mode, durable, and NOT (online and `serverId != null`)
- create: record iff server mode, durable, and (offline OR expecting)

Stating it as one rule is what closes the fourth row of the scope table. Gating
the edit branch on `serverId != null`, the way the existing `photoDropped` does,
would have left a photo re-picked on an offline-created child stranded behind
the create's older record.

`photoDropped` survives, but now means only "the photo is not durable" (web, or
a failed copy), which is the one case that still warrants the warning toast.
Local mode records nothing: there is no server to owe a photo to, and the
durable copy alone is what that mode needed.

**A removal always overwrites the record, and never merely adds to it.** With
`serverId != null` it becomes `{kind:'remove'}`, because the server has to be
told. With `serverId == null` the record is CLEARED instead, because a create
carries no photo anyway. Both discard the pending file. Getting this wrong is a
live bug rather than a tidiness point: pick a photo offline, then remove it
offline, and a stale `set` record would upload the photo the user just deleted.

For the same reason `setPendingPhoto` returns the record it replaced, so the
caller can discard that file immediately instead of leaving it for the sweep.
Re-picking a photo ten times offline should not hold ten files until the next
launch.

The key is the LOCAL child id, which is safe because those ids no longer mutate
on push: a create stamps `serverId` and deliberately leaves `id` alone, so the
key written at save time is still the key at flush time.

**`flushPendingOps`, child update op.** Look the record up by local child id and
pass it as the `PhotoChange`. On success, stamp the returned `picture` over the
local file path (the replay currently re-stamps only `slug`), clear the record
and discard the file.

**`uploadUnsynced` via `buildUploadDeps`.** `pushChild` looks the record up the
same way, passes it, and returns the server's `picture` alongside the id so
`uploadUnsynced` can stamp it.

**`confirmBirth`.** Same lookup on its own `pushChildToServer` call.

**`deleteChild`.** Clear the record and discard the file, but only once the
delete is known to have succeeded, so the restore path has something to restore.

**Hydrate.** After children load, `sweep` deletes every file in `childPhotos/`
that neither a child's `picture` nor a pending record points at. This is what
collects cancelled sheets, crashes, and terminal 404s, in one pass, off the
critical path.

**Disconnect.** `clearPendingPhotos` alongside the existing `clearPendingOps`
call at `useAppStore.ts:2617`, followed by a sweep with an empty keep set.

### 5. Optimistic display

The picked photo now shows as the avatar the moment it is saved, offline
included, because the URI it points at is a real file that survives a reboot.
Removal applies `picture: null` immediately for the same reason.

The accepted wart: for a child ALREADY on the server, a refresh landing between
the save and the reconnect flush reverts the avatar to the server's old picture,
because `reconcileChildren` takes the server's record wholesale. The flush then
uploads and it settles. The photo itself is never at risk, only what is drawn
for a moment, and the alternative (protecting `picture` through reconciliation)
means teaching reconciliation about a second source of truth, which is how the
0.14.2 bug happened.

## Error handling

| failure | behaviour |
| --- | --- |
| copy throws at pick time | `durable: false`; deferred saves keep today's warning toast; online saves behave exactly as now |
| file missing at flush time | push the child WITHOUT the photo, so the name and birthday still land; drop the record. Silent: the avatar is visibly broken already, and a document-directory file going missing has no ordinary cause |
| upload fails, retryable | record STAYS, file stays, retried on the next flush. This is the case that must not clear |
| op replay 404s (terminal) | drop the record and the file with the op. The child is gone server-side and nothing will ever accept the photo |

## Testing

Real node coverage:

- `src/data/pendingPhotos.test.ts`: load, set, overwrite the same child, clear
  one, clear all, corrupt JSON reading as `{}`, and the re-read-before-write
  behaviour under a concurrent write.
- `src/store/useAppStore.test.ts`, mocking `@/lib/photoFile` and
  `@/data/pendingPhotos`: each of the four in-scope paths records and then
  uploads; a retryable failure leaves the record; a 404 drops it; `deleteChild`
  drops it; an offline removal on a synced child records `{kind:'remove'}` and
  blanks `picture` immediately; an offline removal on a never-pushed child
  CLEARS a pending set rather than leaving it to upload; re-picking overwrites
  and discards the replaced file; a non-durable photo keeps the warning toast
  and records nothing.
- `src/data/sync.test.ts`: the `pushChild` return widening.

**The gap, stated plainly.** No test in this repo can reach the actual file
copy: `expo-file-system`'s `File` is a native module, and `vitest` runs in node.
The mocked seam pins the CONTRACT (that a deferred save records the durable URI,
and that the flush reopens exactly that URI) and cannot pin the copy. This is
the same class of gap where 0.14.3's bug lived, after being flagged when 0.14.1
shipped and accepted anyway.

So the acceptance test is on device and must actually be run before this is
called done:

> Airplane mode on. Change a child's photo. Force-quit the app. Reopen it.
> Confirm the avatar still shows the new photo. Airplane mode off. Confirm the
> photo lands on the server.

The force-quit is the point of the test: it is what distinguishes a durable file
from a cache URI that merely has not been reclaimed yet.

## Out of scope

- Web durability. Named above, with the reason.
- The online-push-failure path, which loses more than the photo and needs its
  own answer.
- Any pending or uploading affordance on the avatar. The photo shows
  immediately and settles quietly.
- Compressing or resizing on native. The picker already crops square at
  `quality: 0.7`; only web re-crops in the client.
