# 0.15.2: an offline photo survives the reconnect

Off `main` @ `216b54a` (release 0.15.1). 73 test files, 2054 tests, tsc clean, no new lint.

Twenty commits: the offline photo (its own plan and spec, tasks 1 to 8), plus the four smaller items
left over from the 0.15.0 queue.

## The photo

A photo set on a child while offline used to be dropped with an apology (`Saved · photo not saved`).
Two things stopped it surviving: a queued op is JSON on disk and cannot carry a file, and the URI the
picker hands back lives in Android's cache directory, which the system reclaims under pressure.

The fix has two halves:

- **The file is copied to the document directory at pick time**, not at save time. That costs one
  extra write per pick and orphans a file when the sheet is then cancelled, and it buys a synchronous
  `saveChild` (this store has shipped several mid-flight write races) and plain serializable data on
  every path downstream. `PickedPhoto.durable` records whether the copy happened; it is never
  inferred from the URI's prefix.
- **`pendingPhotos`, an AsyncStorage map keyed by local child id**, records what a child owes the
  server. Its own store rather than a field on `Child` (which `reconcileChildren` replaces wholesale
  on every refresh) or an entry in the op log (which appends without dedup, so two offline picks
  would upload twice). Keying by local id is safe because those ids do not mutate.

All three deferred push paths read it: the op replay, `uploadUnsynced` on reconnect, and
`confirmBirth` for an expecting child. A record is cleared only on a confirmed upload or a terminal
404, swept at `hydrate` for orphans, and cleared on disconnect.

`photoDropped` changed meaning rather than name: it now means "could not be made durable" (web, or a
failed copy), which is the one case that still warrants the warning.

It also fixed a case nobody had reported: in local mode the cache URI was the only copy a photo ever
had, so it broke whenever Android reclaimed the file and there was no server copy to fall back on.

## Device verification

Task 8 existed because nothing above can exercise the real file copy: `expo-file-system`'s `File` is
a native module and vitest runs in node. This is the same gap 0.14.3's bug lived in after being
flagged and accepted at 0.14.1.

The user built and ran it, and reported the offline photo flow works. Recorded as reported: the flow
was confirmed working on device, not step-by-step against each of the six scripted steps.

## Review pass

Three defects were found after the plan's tasks were complete and fixed on the branch:

- `ca4761f` a pending photo could outlive its child or its server.
- `e3520c4` an undurable offline delete settled a pending photo it had no business settling.
- `ff85227` a pending photo was cleared even when the upload that landed was not the one recorded.

## The four other queue items

- `ec71d47` `deleteChild` now purges the child's treatments, and restores them if the delete fails.
  `lastFeed` is still not purged, which stays consistent with `bathRhythms`.
- `8312d41` a measurement created while a refresh was in flight is no longer dropped by
  `mergeUnsynced`, which only merges `serverId == null` rows.
- `46e1f61` and `fc52059` `adopt`'s post-upload reload no longer reverts a write made during it. The
  earlier comment claiming the gap was unreachable was wrong, and is corrected at the call site.

## Still open

- **A4 in the 0.15.0 plan, the reminder scoping**, is still not done. `treatmentDoses`,
  `reachedMilestoneKeys` and `answeredMilestoneKeys` in `scheduleSync.ts` remain scoped to
  `selectedChildId`. The plan marked this optional and deferrable, and leaving it is conservative
  rather than wrong, so it was left deliberately.
- The step checkboxes inside `plans/2026-08-03-offline-photo.md` were never ticked as the tasks ran.
  Same as every earlier plan in this repo: the commits and this checkpoint are the record.
