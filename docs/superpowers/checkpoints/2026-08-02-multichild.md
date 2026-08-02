# Batch run ledger — 2026-08-02, multi-child pain points

Umbrella branch: `worktree-multichild-integration` (off `main` @ `cae85ba`)
Baseline: 62 test files, 1678 tests, all passing.
Final: 68 test files, 1844 tests, lint clean, `tsc --noEmit` clean. 24 commits, 53 files.

Origin: an audit of what hurts when the app is used with more than one child. Thirteen
improvements were proposed and eleven were taken in this run.

## Resolved at checkpoint (user-answered)

- **Scope:** batches 1 to 5 only. Per-child server data, the History household view and
  per-widget child configuration are DEFERRED (see below).
- **Multi-child logging** is offered only for the shared-routine set: `feeding, sleep, diaper,
  bath, tummy`. Excluded: pumping (duplicating it double-counts milk volume), temperature and
  measurements (one reading cannot belong to two children), medication, note, milestone.
- **Child indicator** is a text suffix ` · Name`, shown only at 2+ children, reusing
  `attributionFor`. No avatar, no colored dot.
- **Integration:** one umbrella branch, per-item commits.

## Decisions stated at checkpoint, not overridden

- `Timer.childId` stays OPTIONAL. A required type would lie about data already on disk, since
  AsyncStorage JSON is cast and never validated.
- Existing avatar colors are FROZEN. No de-collision migration.
- Reminders already pending in the OS keep their old childless URLs. No migration; "no child in
  the link" is a permanent first-class case, not a transitional one.
- Multi-select is create-only, hidden in edit mode.
- Expecting children are excluded from any child picker.

## Shipped

| Ask | Commit(s) |
|---|---|
| Edits keep their own child | `f880609` |
| Timer notifications titled per the timer's own child | `b08ff5f`, `acddab6` |
| Nap widget names the child | `6793af4`, `51fc462`, `129a2f4` |
| Avatar tints assigned once, never by list position | `aa49602` |
| Every timer stamped with an owner, adoption rule retired | `dc10352` |
| `deleteChild` clears only that child's timers | `daeda95` |
| Lasted-X stop files under the timer's owner | `4e4c40f`, `042fab0` |
| Child on every running-timer card | `74a5d0e` |
| Deep links carry `?child=` | `d3a3ca4`, `ce7a826` |
| Log sheet owns its target child, multi-child logging | `efe4bf0`, `348b90e`, `cf815a5`, `29b1fb2`, `e7072cc`, `184862d` |
| `lastFeed` per child, start side scoped | `b3274ba`, `fc3aea3`, `6c5dc73` |

## Bugs found DURING the run, not in the original list

1. **Lasted-X timer stop lost the owner.** `save()` with `fromTimerId` set and `editingId` null
   left `existing` null, so the entry took `selectedChildId`. Reproduced empirically. Fixed in
   `4e4c40f`.
2. **`reconcileChildren` reissued a sibling's tint.** The accumulator was seeded only with
   never-pushed locals, so a new server child listed BEFORE its matched sibling could not see that
   sibling's preserved color. Baby Buddy sorts `/api/children/` by name, so adding a second child
   whose name sorts first hit this. Fixed before merge in `aa49602`.
3. **Queue writes raced on correlated push failures.** `pushEntryToServer(...).catch(...)` called
   `enqueueEntry` per entry. Two clone POSTs from one tap fail together, and on a 401 or 500 the
   `offline` flag never flips, so every multi-child save took this path deterministically. The
   losing entry was in none of the three sets `applyServerLoad` rebuilds from, so the next
   `refresh()` deleted it. Fixed by serializing the four leaf mutators in `queue.ts` (`e7072cc`).
4. **Derive-on-read migration did not survive a restart.** `hydrate` set `lastFeed` to a fresh `{}`,
   the persistence subscription fired, and `saveLastFeed({})` overwrote the v1 key, destroying the
   legacy value on the first hydrate rather than the first save. The bath-rhythm precedent did not
   transfer because its legacy value lives in a DIFFERENT storage key. Fixed in `6c5dc73`.

## DEFERRED, not fixed. Report to the user before picking these up.

- **Per-child data in server mode (ask 11).** `loadFromServer` fetches ONE child. Making server mode
  behave like local mode costs 3 + 13N HTTP requests per foreground refresh (42 at three children,
  68 at five, issued concurrently), against typically self-hosted instances, with no incremental
  fetching anywhere in the client. It also needs an explicit "a partial load must never shrink the
  persisted set" guard: each per-type request degrades to `[]` on failure and `saveEntries` deletes
  month-chunks that become empty, so one timed-out request would wipe a sibling's offline cache
  from disk. Roughly 50 to 70 existing tests assert the behaviour being removed.
- **History household view (ask 12).** BLOCKED on the above. Without it, an "all children" toggle
  renders a silently incomplete timeline in server mode, which is worse than today's honest scoping.
- **Per-widget child configuration (ask 10B).** Achievable within `react-native-android-widget`
  0.20.3 with only a `widgetFeatures` key in `app.json` (no native module, no new config plugin),
  but the cost is in this repo's data model: a snapshot version bump, a widgetId to childId store,
  `WIDGET_DELETED` handling that does not exist today, a per-widget debounce key, and a config
  screen living outside expo-router with no store. Wants its own plan.

## Known wrinkles left in place (deliberate)

- Timer child ordering is inconsistent app-wide: notifications say "Mara · Sleep" (child first,
  ungated), cards say "SLEEP RUNNING · MARA" (child last, gated at 2+). Both orderings pre-date
  this run.
- On a narrow phone in server mode the Home eyebrow can ellipsise the child name ahead of the sync
  badge. Pre-existing truncation priority; the name is what gets cut.
- `deleteChild` never purges `treatments` (only children, entries, measurements). Pre-existing.
  It does not purge `lastFeed` either, consistent with `bathRhythms`.
- `loadTimers` returns `[]` on a failed read with no `blockedByFailedRead` guard, so the next
  `set` can persist an empty list over real timers. Pre-existing, not widened.
- The headless widget task enqueues from another process, which the in-process queue chain cannot
  order. Pre-existing, and it writes one entry at a time.
