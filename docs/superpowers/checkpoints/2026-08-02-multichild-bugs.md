# Batch run ledger — 2026-08-02, multi-child bug fixes (0.14.1)

Umbrella branch: `worktree-multichild-bugs` (off `main` @ `f4a9aaf`, release 0.14.0)
Baseline: 68 test files, 1844 tests. Final: 69 files, 1910 tests, lint clean, `tsc --noEmit` clean.

Origin: a user bug report (Android child photos) plus three items deferred by the 0.14.0 run, which
were re-scoped against the current tree. The re-scope changed the plan substantially.

## Resolved at checkpoint (user-answered)

- **Photo fix approach:** pass a real file object with `bytes()` (expo-file-system's `File`).
  The `EXPO_PUBLIC_USE_RN_FETCH` escape hatch and a separate XHR path were both considered and declined.
- **Scope:** bugs first, then asks 11 and 12. Per-widget child configuration (10B) DROPPED on the evidence.
- **Release:** patch for the bugs (this), then a minor for the features.

## The photo bug, diagnosed

PRE-EXISTING, not a 0.14.0 regression. The feature landed before 0.13.0 and 0.14.0's diff on those
files is limited to the colour work.

On native, `globalThis.fetch` is expo/fetch, because Expo's Metro config force-injects
`expo/src/winter/runtime.native.ts` unless `EXPO_PUBLIC_USE_RN_FETCH` is set (it is not, anywhere).
`buildChildForm` appended React Native's `{uri, name, type}` descriptor, which expo/fetch's serializer
cannot read: it accepts a string, a `Blob`, or an object with `bytes()`, and otherwise throws
`Unsupported FormDataPart implementation`. So NO HTTP REQUEST WAS EVER MADE. A bare `catch` in
`request()` then reported it as "Couldn't reach server", and `.catch(() => {})` in `saveChild`
swallowed even that. The photo vanished locally because `reconcileChildren` takes the server's
`picture: null` over the optimistic URI.

Proved by executing expo's serializer branch against the exact object the code built, without a device.

Collateral, also fixed: create-with-photo failed entirely; a rename in the same save was lost too.
NOT fixed, documented: offline replay still drops the photo. A `PendingOp` is JSON on disk and cannot
carry a file, and the picked URI lives in Android's evictable cache directory, so a real fix must copy
the file to the document directory at pick time. Both `updateChildOnServer`'s default `{kind:'none'}`
and `uploadUnsynced`'s `pushChild` are affected.

## Shipped

| Item | Commits |
|---|---|
| Android child photo upload | `1819e83` |
| Partial-load guard (live data loss) | `defeb6e`, `e4b3d75`, `9ad752e` |
| Status widget speaks to screen readers | `9f90273`, `3047711` |
| Dead code, stale docs, one false comment | `d29d1bd`, `e494a30`, `adb80be`, `78d9b48`, `a52a772` |

## The partial-load guard, and why it took three passes

**The bug:** every per-type fetch degrades to `[]` with no signal, `applyServerLoad` replaces entries
wholesale, and `saveEntries` deletes month-chunks that became empty. One timed-out request could
permanently delete a month of history, AT A SINGLE CHILD. A passing test asserted the wrong side of it.

**First attempt (per-child) was blocked in review**, and rightly. One boolean for nine endpoints meant
an endpoint that fails on EVERY load marked the child incomplete forever. `/api/medication/` 404s on
any Baby Buddy older than the medication release, so connecting to one would have shown a BLANK
history permanently, and new records from other devices would never arrive. That is worse than the bug
being fixed, and not rare.

**Shipped shape is per-slice.** `LoadResult.incompleteSlices?: Record<serverChildId, LoadSlice[]>`,
naming the DEGRADED slices. A 404 is an answer, not an absent one, so it is not counted. A degraded
slice the device holds no rows for is taken as-is.

**The signal FAILS CLOSED**: a failure that is not reported is read as a real answer and its rows are
deleted. That is enforced, not merely documented: an exhaustiveness assertion over `ActivityType` and
`MeasurementKind` fails if any type has no fetch reporting it, and `tsc` refuses a new activity type
before the test even runs.

Accepted residual, documented on the field: a slice failing with something other than a 404 stays at
the rows already held until the endpoint answers again. Bounded to that slice; it cannot present as an
empty app.

## Corrections to the previous ledger

- **`docs/superpowers/checkpoints/2026-08-02-multichild.md` over-counted ask 11 by ~5x.** It claimed
  50-70 tests would need rewriting; the real figure is 11. The display layer is already fully
  child-scoped and the nap scheduler is already multi-child.
- **The headless widget task is NOT another process.** `HeadlessJsTaskWorker` uses the app's own
  `ReactHost` and passes `isAllowedInForeground` true, so `queue.ts`'s serialization chain does order
  widget writes against app writes whenever the app is warm. The only unordered case is a cold headless
  boot. The previous comment discouraged relying on a guarantee that holds; corrected in `78d9b48`.

## Still deferred

- **Ask 11 (per-child server data)** and **ask 12 (History household view)**: next, as 0.15.0. Ask 11
  splits into an eager fan-out plus deleting the now-redundant refetches; ask 12 becomes roughly 40
  lines afterwards and remains a trap before it.
- **Ask 10B (per-widget child config): DROPPED.** 5-6 days, about a day of it untestable by
  construction, Android-only, and it reintroduces the misattribution it exists to remove, because
  Android recycles widget ids and restores app data without them. 0.14.0 already removed the sharp half
  of the complaint: the tile names its child and its buttons carry `?child=`.

## Not verified on hardware

The photo fix is proven against expo's real serializer in the test suite, not on a device. Installing
the 0.14.1 APK and adding a photo is the honest final check.
