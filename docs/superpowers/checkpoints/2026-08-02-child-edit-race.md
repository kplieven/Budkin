# 0.14.2 — a refresh landing during a child edit silently reverted it

Off `main` @ `5118893` (release 0.14.1). Final: 69 test files, 1943 tests, lint clean, tsc clean.

## Why this exists: 0.14.1 did not fix the reported bug

The user reported that updating a child's photo on Android did nothing. 0.14.1 fixed a real upload
bug (expo/fetch cannot serialize React Native's `{uri, name, type}` FormData part) that was NOT the
cause of what they were seeing. The evidence available at the time (photo does not sync, works on
web) fit that hypothesis, and it shipped without confirming it was THE cause.

**The detail that falsified it:** the avatar never changed AT ALL, not even briefly. An optimistic
local write happens before any network call, so a transport failure cannot explain that. Asking one
question ("does it appear and then revert, or never appear?") before shipping would have caught it.

## Root cause, reproduced before fixing

1. `src/app/_layout.tsx` calls `refresh()` whenever `AppState` becomes `active`.
2. The OS image picker is a separate activity, so picking a photo backgrounds the app and returning
   fires a refresh. **This is why the bug is Android-only:** a browser file picker never backgrounds
   the app, which is why web always worked.
3. `refresh` snapshotted `children` BEFORE the fetch and passed it to `applyServerLoad`.
4. `reconcileChildren` rebuilt every matched child as `{ ...sc, id: local.id, color: local.color }`,
   taking every other field from the server.

A refresh resolving after the save therefore reverted it. Ten tests asserting the buggy behaviour
landed first, in their own commit, so the fix had to invert them.

**Scope was far wider than photos:** `picture`, `first`, `last`, `birth` and `gender` were all
reverted, and a child CREATED in that window disappeared entirely, because the pre-fetch snapshot did
not contain it.

Never visible even briefly because the sheet exits over 220ms with a 200ms scrim fade, and the avatar
is behind it.

## Why children were the only unprotected slice

`applyServerLoad` already guarded everything else against exactly this: entries via
`mergeQueuedEntries`, with `loadQueue()` deliberately re-read AFTER the fetch precisely so a
mid-flight write is not lost, plus `mergeHeldBackEntries`; measurements via `mergeUnsynced`;
treatments via `mergeTreatments`; timers via the null guard; degraded slices via
`carryOverIncomplete`. Children had `reconcileChildren` and nothing else. `flushUnsynced` already
used a functional `set` with the comment "so a create that landed during the await isn't dropped by a
wholesale replace"; `refresh` did the opposite.

## The fix

`refresh` passes both the pre-fetch snapshot and the current local state. A child whose current
record differs field-wise from the snapshot, or is missing from it, was written while the fetch was
in flight, so it keeps its whole local record. Every other child reconciles as before, so a rename
made in Baby Buddy's own web UI still arrives.

Whole-record rather than a field allowlist, and it cannot strand a `serverId`: that is the match key,
so for a matched child the local and server values are equal by construction. `slug` must be local
because the fresh slug arrives on the PATCH RESPONSE, not on this GET; taking the answer's slug would
restore the key derived from the old name, which 404s the next rename or delete.

`adopt` had half the same defect (it snapshotted before its post-upload fetch) and was fixed.
It does NOT get the snapshot-diff half, and the residual is named rather than papered over: a
mid-GET edit is still reverted and a mid-GET stamped create still dropped. Pre-existing, accepted,
unreachable in practice because adopt runs inside a modal sheet with no path to save a child.

## Offline photo honesty

An offline photo change cannot be uploaded on reconnect: a queued op is JSON on disk and cannot carry
a file, and the picked URI lives in Android's evictable cache. Rather than show a photo that would be
blanked later, both paths now say so:

| case | toast |
|---|---|
| online edit / create | `Updated` / `Saved` |
| offline edit, synced child, set | `Updated · photo not saved` |
| offline edit, synced child, remove | `Updated · photo not removed` |
| offline create, photo set | `Saved · photo not saved` |
| local mode, or a child with no serverId | unchanged |

## Residuals, named not hidden

- An offline edit of a still-UNPUSHED child does not warn, though it ends at the same photo-dropping
  `pushChild`. The gate matches the pending-op branch, which is right for the immediate behaviour
  (not deleting the only copy), but the seam is real.
- An EXPECTING child created online with a photo is held back, then pushed by `confirmBirth` without
  it.
- A measurement created mid-refresh whose push stamps a `serverId` before the apply is still dropped
  by `mergeUnsynced`, which only merges `serverId == null` rows. Same class, not reachable
  deterministically in a test without controlling push timing.

All three close properly only with the same change: copy the picked file out of the cache directory
at pick time and record that path on the op. That is the next item if photos matter more.

## Process note

Two releases in a row shipped a fix for this report. The first was aimed at the wrong layer because
a plausible mechanism was found and not falsified against the actual symptom. The reproduction-first
order used here (tests asserting the bug, in their own commit, before any fix) is what should have
happened the first time.
