# 0.15.0: per-child server data, then the History household view

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** In server mode, hold EVERY child's records rather than only the selected child's, then use that to give History an all-children view with a per-row child name.

**Why it matters:** Today, switching child in server mode triggers a network refetch, a sibling's history is empty offline, and `applyServerLoad` deletes the previous child's month-chunks from disk. Reminders that already loop every child are starved of data. Ask B is a lie without ask A.

**Tech Stack:** React Native 0.85 + Expo SDK 56, expo-router, Zustand v5, vitest (node env). Baseline at the time of writing: `main` @ `68b8bc5` (release 0.14.3), 69 test files, 1943 tests green.

---

## Global Constraints

- **This IS a git repository** (an older plan in this directory says otherwise; that is stale).
  Branch off `main`, never commit to `main` directly. Releases are merge commits carrying a
  lightweight tag; see the release flow at the bottom.
- **Verification Gate** (all three, at the end of every task):
  - `npm test` (vitest)
  - `npx tsc --noEmit`
  - `npm run lint`
  Note `npm test` does NOT typecheck, and `npm run lint` exits 0 even with warnings. Check all three.
- **`vitest.config.ts` matches `src/**/*.test.ts` ONLY, never `.tsx`.** There are no render tests and
  none can be added without a config and dependency change, which is out of scope. Put any rule you
  want tested in a pure `.ts` module. Existing precedents: `src/features/queue/queueView.ts`,
  `src/features/activity/queuedMarker.ts`, `src/features/timers/timerAttribution.ts`,
  `src/widgets/napLabels.ts`, `src/lib/logTargets.ts`.
- **zustand v5:** never return a NEW reference from a `useAppStore` selector (no inline
  `.filter`/`.map`/object literal). Select raw and derive in the render body. A violation blanks the
  web routes at runtime with "Maximum update depth exceeded" and NO test catches it.
- **`AGENTS.md`:** read the exact Expo SDK 56 docs (https://docs.expo.dev/versions/v56.0.0/) before
  writing code touching an Expo API.
- **No em-dashes** in comments, commit messages or UI copy.
- **Comments in `useAppStore.ts` and `repository.ts` are load-bearing.** Several encode invariants
  that are not otherwise expressed. If you change behaviour, change the comment; if a comment turns
  out to be false, fix it rather than working around it. Three false comments were found and
  corrected in the 0.14.x series.
- **Line numbers anywhere in this document are indicative only.** Locate by symbol name.

---

## Item A: per-child data in server mode

### What already shipped, do not redo it

`LoadResult.incompleteSlices` (0.14.1) is the partial-load guard. A per-type fetch that fails
degrades to `[]`, and without the guard `applyServerLoad` replaced entries wholesale and
`saveEntries` deleted month-chunks that emptied, permanently losing history. The guard reports which
SLICES degraded per child, a 404 counts as an answer rather than an absence, and coverage is enforced
by an exhaustiveness assertion over `ActivityType` and `MeasurementKind`. **It fails closed:** an
unreported failure deletes rows, so any new per-type fetch MUST route its catch through `orEmpty`.

That was the first of three commits scoped for this item. Two remain.

### The framing

Make server mode behave like local mode (hold all children), NOT a keyed side-cache. The codebase
already assumes the all-children shape: `src/store/selectors.ts` documents `entries` as "a single
flat, globally-scoped array holding every child's records", the entity store chunks by MONTH not by
child, `uploadUnsynced` already walks every child, and three of six reminder kinds already loop
`input.children`. A side-cache would build a second data model to preserve a deviation nothing wants,
and the reminder work would have to reassemble the union anyway.

### Request cost, measured

Account-wide, once: `listChildren`, `listGenders`, `listTimers` = **3**.
Per child: 9 in the entry `Promise.all` plus 4 measurement kinds = **13**.
So **3 + 13N**. N=1 is 16 (today), N=3 is 42, N=5 is 68.

Today's shape is five sequential rounds with peak in-flight 9. A naive
`Promise.all(children.map(...))` would take peak concurrency to 9N, and peak concurrency is what
kills a self-hosted gunicorn (default `2*cores+1`, so 9 workers on a Pi). There is no concurrency
limiter anywhere in the repo, and no incremental/since-timestamp fetching in `src/api/client.ts`.

### Design decisions, already made

- **Eager, all children, one round trip.** Not lazy: lazy is what ships today and is precisely what
  makes a sibling empty offline.
- **Cap concurrency at 8** via a local `mapWithLimit` helper in `repository.ts` (about 15 lines, no
  dependency, same closure style as the existing `pageAll`). Eight keeps a multi-child load at or
  below the load a single-child refresh already imposes, so the cost scales in wall-clock rather than
  in peak concurrency.
- **No cap on N.** A "fall back to selected-child-only above N" rule adds a second load path with its
  own failure semantics, which is what `applyServerLoad`'s atomic single-`set()` design exists to
  avoid.
- **Do not re-chunk storage.** Chunk keys stay month-only. At roughly 450 entries per child over four
  months, five children is about 150KB per row, far under the ~2MB Android CursorWindow cliff that
  `src/data/entityStore.ts` documents.
- **Do not change `limit=` values or add pagination.** That changes what data the app HAS, which is a
  separate product question.

### Tasks

- [ ] **A1. Fan out the fetch to every child.** `loadFromServer` in `src/data/repository.ts`.
      `preferredChildServerId` stops being a fetch selector and becomes only the seed for
      `LoadResult.selectedChildId`. Build the task list as `children.flatMap(...)` and run it through
      `mapWithLimit(tasks, 8)`. `listChildren` / `listGenders` / `listTimers` stay one call each.
      Keep `incompleteSlices` correct per child.
- [ ] **A2. Apply all children.** `applyServerLoad` and `adopt`'s hand-rolled duplicate in
      `src/store/useAppStore.ts`. Both must keep the existing rules: explicit keys AFTER the `...data`
      spread (`timers`, `lastFeed` already do this), `mergeQueuedEntries` / `mergeHeldBackEntries` /
      `mergeUnsynced` / `mergeTreatments` / `carryOverIncomplete` all still applied, and the
      0.14.2 mid-flight-edit guard for children preserved.
- [ ] **A3. Delete the refetch that only existed for the old invariant.** There are exactly TWO
      `void get().refresh()` calls in `useAppStore.ts`: one at the end of `hydrate` (**keep it**, it
      is the initial load) and one at the end of `selectChild`, guarded by
      `connection?.mode === 'server'` (**delete this one**), along with its rationale comment, which
      is entirely about the single-child invariant. `deleteChild` does NOT refetch: an earlier
      scoping pass claimed it did, and that is stale. Verify with
      `grep -n "get().refresh()" src/store/useAppStore.ts` before touching anything.
- [ ] **A4 (optional, deferrable).** Widen the reminder scoping that was forced by the single-child
      invariant: `treatmentDoses` / `reachedMilestoneKeys` / `answeredMilestoneKeys` in
      `src/notifications/scheduleSync.ts`, and `treatmentReminders` / the milestone catch-up branch in
      `src/notifications/scheduled.ts`. Leaving these alone is SAFE (conservative, not wrong).
- [ ] **A5. Repair the stale comments.** Roughly 18 blocks assert the single-child invariant, in
      `repository.ts`, `useAppStore.ts`, `scheduleSync.ts` and `scheduled.ts`. One of them
      (`scheduleSync.ts`) already carries a stale LINE reference. These are load-bearing here.

### Test cost: about 11 rewritten, not 50-70

An earlier estimate of 50-70 was wrong by roughly 5x, because the whole display layer already scopes
through `entriesForChild` / `measurementsForChild` and the nap projection is already multi-child.

Must be rewritten:
- `src/data/repository.test.ts`, `describe('loadFromServer child selection')`: 5 tests.
- `src/store/useAppStore.test.ts`, `describe("switching child refetches that child's records (server mode)")`
  gives 6 tests, of which 5 (the "keeps resetting the insights cache" one survives).
- `src/store/useAppStore.test.ts`, `describe('cache-first hydrate (server mode)')`: 1 of 3.

**Typecheck fan-out is the hidden cost:** there are **119** `vi.mocked(loadFromServer)` sites in
`useAppStore.test.ts` (verified 2026-08-02), a large fraction of them hand-written inline
`LoadResult` literals with no shared factory.
Anything that makes a `LoadResult` field REQUIRED breaks all of them under `tsc --noEmit` (tests are
in tsc scope). Prefer optional fields with a documented "absent means X" contract, as
`incompleteSlices` did.

Untouched and worth knowing: `scheduleSync.test.ts`'s nap anchor projection is ALREADY multi-child
and asserts `{ c1: ..., c2: ... }`.

### Open questions, with recommended defaults

- **Does `selectChild` keep a refresh as a freshness pull?** Default: **remove it.** With the data
  resident, refreshing on every child switch costs 13N requests per tap. Foreground and
  pull-to-refresh remain.
- **Does a per-child 401/403 fail the whole load?** `listChildren` is the only uncaught call; all 13N
  per-child calls swallow theirs. Default: **leave it.** With the guard in place, "all empty" becomes
  "carry over the previous data", so the failure is benign. Document it.
- **Does `mergeLastFeed`'s merge-never-replace rule survive?** Default: **keep the merge.** It is
  correct under both regimes and changing it buys nothing.

---

## Item B: the History household view

**Blocked on Item A. Do not attempt it first.** In server mode today, an all-children toggle would
show a sibling ONLY their running timer and any entries stuck unsynced on the queue, because
`applyServerLoad` replaces `entries` wholesale and re-admits only queued and held-back records. A
twin parent would read that as "Ivo has done nothing all week". After Item A this becomes roughly a
40-line change to one screen.

**Do NOT ship a local-mode-only version gated on `selectServerMode`.** Every other gate on that
predicate hides something self-evidently about the server; a household view is about the family, so
the gate is unexplainable at the point of use, and it front-loads a design that has to survive
unchanged when server mode catches up.

### Design decisions, already made

- **Presentation: a text suffix ` · Name`, gated at 2+ children.** No avatar, no coloured dot. This
  matches the timer cards shipped in 0.14.0 and the offline queue rows. **Note:** the original ask
  said "child chip per row", so confirm with the user before building if you want the richer visual.
- **Reuse, do not reimplement.** `attributionFor` (`src/features/queue/queueView.ts`) is the shared
  RULE and already takes `string | undefined`, so it handles both `Entry.childId` (required) and
  `Timer.childId` (optional) with one call. `timerChildSuffix`
  (`src/features/timers/timerAttribution.ts`) is the shared PRESENTATION, returning
  `{ drawn: ' · Mara', spoken: ', Mara' }` so the visible and spoken forms cannot drift. Rename it to
  something neutral (it lives under `features/timers/` and would now serve History too).
- **Where the name goes: appended to the ACTIVITY LABEL** in `src/features/activity/TimelineEntry.tsx`,
  not as its own element. Row height is a pure function of duration, so nothing content-derived can
  move it, but only if the name stays on the existing single line. The dashboard timer card carries a
  comment explaining this exact choice. The label `<Txt>` will need `numberOfLines` and `flexShrink`
  adding.
- **`timelineRowLabel`** (`src/features/activity/queuedMarker.ts`) MUST take the spoken form. Its own
  doc states the contract: nothing is drawn that is not also announced.
- **The toggle is session-local `useState` in `history.tsx`, NOT in `TimelineFilter`.**
  `filterItems` is a pure subtractive filter over items that never sees `children` or the selection;
  the toggle is additive and changes what `items` is BUILT FROM, upstream of the filter. Keeping it
  out avoids a type change, ~15 literal sites, and a `tsc` break, and leaves `filter.test.ts`
  untouched. `history.tsx` states the session-local rule for filters explicitly.
- **"Clear filters" must NOT reset it.** There are two hard-coded cleared-state literals
  (`HistoryFilters.tsx` and `history.tsx`). If the toggle ever moves into `TimelineFilter`, those
  literals decide this BY ACCIDENT. Mandatory review point.
- **The household gate:** `eligibleTargetChildren(children).length > 1` (from `src/lib/logTargets.ts`),
  matching the log sheet. An expecting child owns no activity, so counting them would show a toggle
  that adds zero rows.
- **Timers under the toggle:** `children.flatMap((c) => timersForChild(timers, c.id))`, matching
  `timersForChild`'s documented per-child rule, rather than the raw `timers` array (which the Timers
  tab uses deliberately and which would include unowned legacy timers unattributed).
- **The desktop rail** (`src/shell/TimelineRail.tsx`) renders `TimelineEntry` too. Make the new prop
  OPTIONAL (precedent: `queued?: boolean`) and have the rail pass nothing; it is single-child by
  design, so a name there would be noise. A required prop is a `tsc` error at that call site.

### Tasks

- [ ] **B1.** Rename/move the suffix helper so History and the timer cards share it.
- [ ] **B2.** Add the toggle to `history.tsx` (session-local state, feeding the `items` construction)
      and a chip in `HistoryFilters.tsx`.
- [ ] **B3.** Thread the optional suffix prop into `TimelineEntry`, appended to the activity label,
      and into `timelineRowLabel` so it is announced.
- [ ] **B4.** Verify tapping a sibling's row still edits the right child. This should already hold:
      `openEdit` seeds `sheetChildIds` from the RECORD's child, `save()` falls back to
      `existing?.childId`, fan-out is impossible on an edit, and the sheet header names the child.
      Confirm with a test rather than assuming.

### Tests

`src/features/activity/filter.test.ts` (5 describes) stays untouched if the toggle is NOT in
`TimelineFilter`. `queuedMarker.test.ts` has 5 exact-string tests on `timelineRowLabel`.
`timerAttribution.test.ts` already pins the 2+ gate, the deleted child, and `undefined`.

---

## Explicitly DROPPED: per-widget child configuration

Do not build this without a fresh decision from the user. It was scoped twice and dropped on evidence.

- 5 to 6 days, of which about a day ships with NO possible test coverage (a React screen, and
  `vitest` cannot reach `.tsx`) and about 1.5 days cannot be automated at all (device-only).
- **It reintroduces the misattribution it exists to remove.** Android recycles widget ids and restores
  app data without them, so a fresh tile can silently inherit a deleted tile's child, and with
  `configuration_optional` no picker opens to reveal it.
- 43 of 89 widget tests would need touching.
- 0.14.0 already removed the sharp half of the original complaint: the tile names its child at 2+
  children, and its quick-log buttons carry `?child=` so a tap logs against the child the tile DREW.
- The Android surface really is cheap (one `widgetFeatures` key in `app.json`; the library ships the
  config-screen API, the manifest activity and the Java stub). The cost is entirely in this repo's
  data model: a snapshot version bump, a widgetId→childId store, `WIDGET_DELETED` handling that does
  not exist, a per-widget debounce key, and a config screen outside expo-router with no store.

---

## Separate smaller items, independent of A and B

- [x] **Show a version somewhere in the app.** Nothing displays one today. During the 0.14.x photo
      investigation neither the user nor the assistant could confirm which build was installed, which
      cost real time twice. Settings is the obvious home. Cheapest item here by far.
      Shipped in 0.15.1: foot of Settings, and the connect screen, which is reachable when Settings
      is not.
- [x] **An offline photo cannot survive reconnect.** A queued op is JSON on disk and cannot carry a
      file, and the picked URI lives in Android's evictable cache directory. Both the edit and create
      paths now SAY so in the toast (`Saved · photo not saved`) rather than dropping it silently, but
      the real fix is to copy the picked file to the document directory at pick time and record that
      path on the op. Same root cause covers an EXPECTING child's photo, which is held back and then
      pushed by `confirmBirth` without it.
      Shipped in 0.15.2, verified on device. See `checkpoints/2026-08-03-offline-photo.md`.
- [x] **A measurement created mid-refresh can still be dropped.** If its push stamps a `serverId`
      before the apply, `mergeUnsynced` (which only merges `serverId == null` rows) discards it. Same
      class as the child bug fixed in 0.14.2, not reachable deterministically in a test without
      controlling push timing.
      Fixed in 0.15.2 (`8312d41`).
- [x] **`adopt` has a narrower version of the same mid-flight defect.** Its local reads now happen
      after the await, but it gets no snapshot diff, so an edit during its post-upload GET is still
      reverted and a create stamped during it is still dropped. Very low severity: adopt runs inside a
      modal sheet with `busy` set and no path to save a child. Documented at the call site.
      Fixed in 0.15.2 (`46e1f61`). The comment claiming it was unreachable was wrong, and `fc52059`
      corrects it.
- [x] **`deleteChild` never purges `treatments`** (only children, entries, measurements). Nor
      `lastFeed`, which is consistent with `bathRhythms`. Pre-existing.
      Treatments purged in 0.15.2 (`ec71d47`), and restored if the delete fails. `lastFeed` is
      deliberately still not purged.

---

## Release flow (do not auto-run; the user asks for it explicitly)

Versions are lightweight git tags on `Merge branch '<feat>' into main (release X.Y.Z)` merge commits
on `main`. `package.json` and `app.json` both stay at 1.0.0.

1. Merge to `main` with `--no-ff` and `-F <msgfile>` (note: `git merge -F -` does NOT read stdin).
2. `git tag X.Y.Z` on the merge commit, then TWO pushes: the commit, then the tag.
3. `TAG=X.Y.Z docker compose build`
4. `TAG=X.Y.Z docker compose push`, then verify with `docker manifest inspect`.
5. Local preview APK named after the merge commit's short sha:
   `eas build --platform android --profile preview --local --output ~/Downloads/budkin-builds/budkin-preview-<sha>.apk`
6. `ln -sfn budkin-preview-<sha>.apk budkin.apk` in that directory, then confirm a 200 and the full
   byte count from `http://192.168.0.56:8000/budkin.apk`.

If `main` is checked out in the primary repo while you work in a worktree, do NOT move the `main` ref
directly. Merge in a temporary detached worktree and push the resulting commit straight to
`refs/heads/main`. In zsh use `"${SHA}:refs/heads/main"`, since a bare `$SHA:refs/...` triggers the
`:r` modifier.

## Where the history is

- `docs/superpowers/checkpoints/2026-08-02-multichild.md`: the 0.14.0 batch (11 multi-child items).
- `docs/superpowers/checkpoints/2026-08-02-multichild-bugs.md`: 0.14.1.
- `docs/superpowers/checkpoints/2026-08-02-child-edit-race.md`: 0.14.2.
- `docs/superpowers/checkpoints/2026-08-02-photo-multipart.md`: 0.14.3, including how three releases
  were needed for one bug and what the process failure was.
- `docs/superpowers/checkpoints/2026-08-03-offline-photo.md`: 0.15.2, the offline photo and the four
  smaller items that closed this queue. A4 above is the only item left open, deliberately.
