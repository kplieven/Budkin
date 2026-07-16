# Milestone catch-up nudge

Date: 2026-07-16
Status: Approved for planning
Branch: feature/milestone-catch-up-nudge

## Summary

A gentle, home-screen awareness nudge that surfaces developmental milestones a
parent may not realize are milestones. Its only job: catch the case where a
milestone happened but went unlogged because the parent did not know to track
it. It is not a data-entry flow. It raises one question per milestone and then
gets out of the way, forever.

## Purpose and non-goals

The milestone catalog already exists (`src/lib/milestones.ts`, 27 milestones with
typical month ranges), along with a Milestones tab that lists them and an
"Around now" section for milestones whose typical window spans the child's
current age. A parent who does not know that, say, "waves bye-bye" is a tracked
milestone will simply never log it. This feature closes that gap by asking, once,
after the typical window has passed.

Non-goals:
- Not a precise data-capture tool. It does not prompt for dates or notes itself.
- Not a recurring reminder. It never re-asks about a milestone once answered.
- Not a notification. It is an in-app card only. No push, no OS permissions.

## Behavior

### What qualifies (the eligible set)

For the currently selected child, a milestone is eligible for the nudge when ALL
of the following hold:

1. The child's age in whole months is strictly greater than the milestone's
   `maxMonths` (its typical window has fully passed). This dovetails with the
   existing "Around now" section, which covers `minMonths <= age <= maxMonths`:
   a milestone hands off from "Around now" to the nudge the month after its
   window closes, with no gap and no overlap.
2. The milestone is not yet logged for this child.
3. The parent has not already answered the nudge for this milestone (this child).

Age comes from `ageMonths(child.birth, now)` (floored whole months). When there
is no selected child or age is unknown, the eligible set is empty and nothing
renders.

### The card

- Lives at the top of the home dashboard (`DashboardContent`, both phone and
  desktop layouts), in normal document flow above the activity content.
- Shows ONE eligible milestone at a time, chosen as the longest-overdue first
  (smallest `maxMonths`), since the longest-overdue are the most likely to have
  actually happened. A quiet "+N more to check" indicates how many remain.
- Wording is educational, carrying the milestone title, its typical age, and the
  question. Example: "Waves bye-bye. Most babies do this around 9 to 12 months.
  Has [name] done this yet?"

### Actions

- Yes, reached: opens the existing milestone sheet (`openMilestone(key)`) so the
  parent logs it through the normal flow (date and optional note), AND marks the
  prompt answered so it will not return.
- Not yet: marks the prompt answered. The card advances to the next eligible
  milestone (or disappears if none remain).
- Dismiss (the small x): same effect as "Not yet".

### One prompt per milestone, forever

Any of the three actions records the milestone key as answered for that child.
The answered set is persisted on device, so it survives app restarts and never
re-nags. A milestone that becomes logged (through the sheet or anywhere else)
also drops out naturally, because it is then "reached".

## Resolved decisions

These were open questions during design; the chosen resolutions are fixed here.

1. Retire-on-Yes even if the sheet is cancelled. Tapping "Yes, reached" marks the
   prompt answered immediately, before the sheet outcome is known. If the parent
   backs out without saving, the milestone is still retired from the nudge (it
   remains loggable on the Milestones tab). Rationale: the parent was asked and
   engaged, which satisfies "one prompt and that's it". Simpler state, no
   reopen-on-cancel bookkeeping.
2. Also fix the per-child scoping bug in the Milestones tab. Today
   `reachedByKey(entries)` and `MilestonesView` consider every child's entries,
   so in local mode one child's logged milestones count as reached for another.
   The nudge must be per-child-correct, and it shares this detection, so both the
   nudge and the tab are moved to child-scoped entries in this work. This is a
   targeted correctness fix in the code being touched, not a broad refactor.
3. Volume handling: show one at a time with a remaining count, rather than a
   recency cutoff. Because prompts are one-and-done and cleared permanently, the
   set drains on its own; a wall of cards never appears even for an older or
   newly-added child, since only one shows at a time.
4. Ordering: longest-overdue first (ascending `maxMonths`).

## Architecture

Small, independently testable units. Each lists purpose, interface, and
dependencies.

### 1. Pure selector: `overdueUnlogged`

- File: `src/lib/milestones.ts` (new export alongside `aroundNow`).
- Purpose: compute the eligible, ordered list from plain inputs.
- Interface:
  `overdueUnlogged(ageMonths: number | null, reached: Map<string, MilestoneEntry>, dismissed: Set<string> | string[]): MilestoneDef[]`
  Returns unreached, undismissed defs where `ageMonths > maxMonths`, sorted by
  `maxMonths` ascending. Empty when `ageMonths` is null.
- Dependencies: the `MILESTONES` catalog and `MilestoneDef` type only. No store,
  no React. Pure and unit-testable in isolation.

### 2. Persistence module: `milestonePrompts`

- File: `src/data/milestonePrompts.ts` (new; mirrors `src/data/prefs.ts` and
  `src/data/timers.ts`).
- Purpose: load and save the per-child set of answered milestone keys.
- Shape stored: `Record<childId, string[]>` under an AsyncStorage key such as
  `babybuddy.milestonePrompts.v1`.
- Interface: `loadMilestonePrompts(): Promise<Record<string, string[]>>` and
  `saveMilestonePrompts(map): Promise<void>` (or a merge-style save consistent
  with the existing modules). Failures are caught and logged, returning an empty
  map, matching `prefs.ts`.
- Dependencies: AsyncStorage only.

### 3. Store slice

- File: `src/store/useAppStore.ts`.
- State: `dismissedMilestonePrompts: Record<string, string[]>` (keyed by
  childId), hydrated on init from `loadMilestonePrompts()` alongside the existing
  prefs/timers hydration.
- Action: `dismissMilestonePrompt(key: string)` appends `key` to the selected
  child's list (idempotent, no duplicates), updates state, and persists via
  `saveMilestonePrompts`. Used by all three card actions; "Yes, reached" calls it
  in addition to `openMilestone(key)`.
- Reached-detection: the milestone reached-lookup is scoped to the selected
  child. The cleanest form is to pass child-scoped entries into `reachedByKey`
  (that is, `entries.filter(e => e.childId === selectedChildId)`), so the helper
  itself stays unchanged and both the nudge and `MilestonesView` share the fix.
- Dependencies: the persistence module, existing `openMilestone`.

### 4. Component: `MilestoneNudge`

- File: `src/features/milestones/MilestoneNudge.tsx` (new).
- Purpose: render the single top-of-eligible card and wire the three actions.
- Reads (raw selectors, deriving in render to avoid returning fresh refs from a
  selector, per the zustand v5 rule this codebase follows): `entries`, `now`,
  selected `child`, `dismissedMilestonePrompts`, plus the `openMilestone` and
  `dismissMilestonePrompt` actions.
- Derives: child-scoped `reached` via `reachedByKey`, `ageMonths(child.birth,
  now)`, then `overdueUnlogged(...)`. Renders nothing when the list is empty.
- Actions: Yes -> `dismissMilestonePrompt(key)` then `openMilestone(key)`; Not
  yet / x -> `dismissMilestonePrompt(key)`.
- Dependencies: the selector, the store, theme, shared `Txt` / button primitives
  already used across the app.

### 5. Wiring

- File: `src/features/dashboard/DashboardContent.tsx`.
- Render `<MilestoneNudge />` at the top of the dashboard body so it appears in
  both the phone and desktop layouts. Confirm exact insertion point during
  implementation so it sits above the activity content and below any header.

## Data flow

1. Store hydrates `dismissedMilestonePrompts` from AsyncStorage on init.
2. `MilestoneNudge` derives the eligible list each render from age, child-scoped
   reached map, and the dismissed set.
3. A card action calls `dismissMilestonePrompt(key)` (and, for Yes,
   `openMilestone(key)`), which updates state and persists.
4. The re-render recomputes the eligible list; the answered milestone is gone,
   the next (if any) takes its place.

## Edge cases

- No selected child, or a child with an unknown/future birth date yielding a null
  or non-positive age: eligible set empty, nothing renders.
- All eligible milestones answered: nothing renders.
- A milestone logged elsewhere (Milestones tab) while a nudge is pending for it:
  it becomes reached and drops out on the next render, no double prompt.
- Switching the selected child: the derivation is per selected child, so the card
  reflects the newly selected child immediately.
- A milestone answered as "Not yet" and later actually logged: logging removes it
  regardless of the answered set; the answered set only prevents nudging, never
  prevents logging.

## Testing

- `src/lib/milestones.test.ts`: `overdueUnlogged` cases: age null -> empty; a
  milestone strictly past `maxMonths` and unlogged and undismissed -> included; a
  milestone at exactly `maxMonths` (still in window) -> excluded; a logged one ->
  excluded; a dismissed one -> excluded; ordering by `maxMonths` ascending.
- `src/store/useAppStore.test.ts`: `dismissMilestonePrompt` appends per selected
  child and is idempotent; persistence is invoked; reached-detection is scoped to
  the selected child (a milestone logged for child A does not count for child B).
- Keep to the existing test style and helpers in those files.

## Out of scope

- Push / OS notifications.
- Editing or authoring the milestone catalog or its typical ranges.
- Any recency-cutoff or auto-expiry policy beyond one-and-done.
- Changes to the milestone sheet or the logging flow itself.
