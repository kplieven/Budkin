# Rhythm settings run ledger — 2026-07-22

Umbrella branch: `feat/rhythm-settings-typed-inputs` (off `main` @ `de01d45`)
Worktree: `.claude/worktrees/rhythm-settings-typed-inputs`
Baseline: 38 test files, 943 tests, all passing. `tsc --noEmit` clean.

Unrelated in-flight tree state left uncommitted on `main`'s working tree
(`src/features/activity/TimelineEntry.tsx`, the running-timer history
treatment). Deliberately NOT carried onto this branch: the worktree is what
keeps it out of these commits.

## Request, verbatim

1. "I'm not a fan of the naps start/end selector. Feels clunky. What do you
   think of a regular input field that parses the time? Could it be a native
   timepicker on the apps?"
2. "I'm not a fan of the big wash rhythm picker. Only 1-7? Why not just an
   input field as well? Maybe just a +/- input that you can write in?"

## Resolved at checkpoint (user-answered)

- **1 / nap window control:** typed field on ALL platforms. No native picker.
  Reuse the existing `TimeAdjuster` / `parseClockInput` house control rather
  than inventing one. Rejected the native picker because `@expo/ui` is
  installed but unused (would be the app's first native-module UI), web is a
  shipping target needing a fallback, and a native picker follows OS locale so
  US users would get AM/PM against the app's hard-24h everywhere else.
- **2 / wash rhythm maximum:** soft cap of 30, up from 7. Minimum stays 1.
- **Integration:** one umbrella branch, one commit per item.

## Decisions stated at checkpoint, not overridden

- Items are SEQUENTIAL, not parallel. Both edit adjacent JSX in the same
  "Rhythm" group of `src/app/settings.tsx`, share its import block, and have
  adjacent constants in `selectors.ts` and adjacent setters in
  `useAppStore.ts`. Parallel branches would manufacture conflicts.
- Zero stays forbidden for the wash rhythm. `[].every()` is vacuously true, so
  0 would pin "big wash due" on permanently (`selectors.ts:203-208`).
- Both controls use `TimeAdjuster`'s draft pattern (local text state, commit on
  blur, discard unparseable). Required, not stylistic: `clampSmallWashesPerBig`
  returns the DEFAULT 3 on NaN rather than the previous value, so a naive
  `onChangeText` -> setter would reset a user's 5 to 3 and persist it the
  instant the field was cleared.

## Work items

| ID | Item | Batch | Status |
|----|------|-------|--------|
| 1 | Nap window start/end: chip strip -> typed time field | 1 | **committed** `2317c2e` |
| 2 | Wash rhythm: 1-7 chips -> typed +/- stepper, max 30 | 2 | **committed** `a075350` |

### Item 1 review verdict: APPROVED

Diff matched the predicted file set exactly (`settings.tsx`, `selectors.ts`,
`selectors.test.ts`). 948 tests pass (943 + 5 new `parseMinuteOfDay` cases),
`tsc` clean.

Verified in a browser rather than on the implementer's word, since it reported
no visual check: typing `715` commits 07:15, which the old half-hour grid could
not express; invalid `7:75` reverts to the stored 19:00 instead of persisting
garbage; and the midnight wrap survives, with `napWindowStartMin: 1200` /
`napWindowEndMin: 360` persisted un-reordered. Two 175px fields side by side at
430px, 258px at desktop inside the 560px body.

`NAP_WINDOW_STEP_MIN` removal was clean: `settings.tsx` was its only consumer.

### Item 2 review verdict: APPROVED

Diff covered the predicted set plus one file outside it, self-reported:
`useAppStore.ts:125`, a doc comment that also said "range 1..7". Comment-only,
no logic, and no overlap with item 1's actual diff. Accepted.

948 tests pass (unchanged: the three tests asserting the old 7 moved to 30
rather than being added to), `tsc` clean, lint clean apart from a pre-existing
warning in the untouched `src/data/sync.test.ts`.

Verified in a browser, specifically the trap this brief was written around:
typing 12, then clearing the field and blurring, leaves **12** rather than
silently resetting to the default 3. Also confirmed 500 clamps to 30 with `+`
disabling, 1 disables `−`, the summary singularises to "After every 1 small
wash", and only the clamped value reaches localStorage.

One cosmetic note, raised by the implementer and checked: at desktop the value
field stretches to ~398px for a one or two digit number. Left as is, because
`src/components/Stepper.tsx` (the app's existing +/- control, shipping in
LogSheet) has exactly this shape, 54px buttons around a `flex: 1` value. Making
this one narrower would make it the odd one out.

## Not done

Neither item has a test at the screen level, because the repo has no component
test harness at all (every test is a pure-logic vitest file; there is no
`.test.tsx` anywhere). The draft/commit behaviour of both controls rests on the
browser runs recorded above.
