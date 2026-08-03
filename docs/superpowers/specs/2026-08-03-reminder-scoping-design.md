# Reminder scoping: every child, not just the selected one

**Goal:** treatment reminders and the milestone catch-up nudge cover every child in the household,
not only the one the app happens to have selected.

This is item A4 of the 0.15.0 plan (`docs/superpowers/plans/2026-08-02-multichild-server-data.md`),
the last item left open in that queue. It was deferred deliberately: until 0.15.0 a server load held
only the child the last fetch asked for, so counting a sibling's doses read their history as empty
and the narrow scope was forced by the data. Since 0.15.0 every child's records are resident (see
`loadFromServer`), and what keeps the scope narrow is a product decision nobody had made. This spec
makes it.

Four other reminder kinds already cover every child (due date, age, nap, stale timer), and pumping is
account-wide on purpose. These two are the exception, and today a parent whose second child is on
antibiotics gets no alerts for them until they switch children in the app.

## Decisions

1. **Both rules widen together.** They share one mechanism: the selected-child fields on
   `ScheduleInput`. Widening one leaves the input half-migrated and makes the second pass re-touch
   the same files and the same tests.
2. **A treatment alert names its child, always:** `Mira · Paracetamol due`. Every other per-child
   reminder already names the child, and the stale-timer reminder already uses this exact
   `${child.first} · ${label}` shape. The copy does not depend on how many children are in
   treatment, so the same regimen reads the same way in a one-child household and a three-child one.
3. **The catch-up nudge fires once per child.** Two children with windows closing on the same morning
   get two alerts. The identifier already carries `child.id` and the deep link already targets that
   child's milestones page, so each alert taps through to the right place.
4. **`selectedChildId` leaves `ScheduleInput` entirely.** After the two rules widen, nothing in the
   scheduler reads it.

## Architecture

`scheduleSync.ts` projects the store into a `ScheduleInput`; `scheduled.ts` turns that into the
desired notification set and knows nothing about `Entry`. That split stays. The change is confined to
which children the projection covers and which children the two rules loop over.

Two routes were rejected:

- **Pass raw `entries` and derive inside `scheduled.ts`.** That module is deliberately ignorant of
  `Entry` (three field comments on `ScheduleInput` say so), and it would move the by-name dose
  attribution rule out of `selectors.ts`, where it is owned and tested.
- **Call `desiredScheduled` once per child and concatenate.** Pump reminders are account-wide and
  stale-timer reminders already iterate every timer, so this double-schedules both. It would need the
  rules split into account-wide and per-child halves first, which is a larger change than the one
  being made.

What remains is per-child maps on `ScheduleInput`, which is what `lastSleepEndByChild` and
`asleepChildIds` already are. The file gains no new idea.

## The input (`scheduleSync.ts`, and the `ScheduleInput` interface)

**`treatmentDoses` keeps its shape.** It is `Record<treatmentId, {today, lastAt}>`, and a treatment id
is already globally unique, so nothing about the field has to change. What changes is how it is
built.

This is the one hazard in the whole change. `treatmentDoseScalars` attributes a dose to a treatment by
trimmed, case-insensitive NAME, because a `MedicationEntry` carries no treatment reference that
survives sync. Handing it every treatment and every entry at once would let a dose logged for one
child settle a sibling's identically named regimen, and Paracetamol for two children is the ordinary
case, not a contrived one. So the scalars are computed **per child** over that child's treatments and
that child's entries, and the per-child results are merged into one map.

**`reachedMilestoneKeys: readonly string[]` becomes
`reachedMilestoneKeysByChild: Record<string, readonly string[]>`**, built by calling the existing
`reachedForChild(entries, childId)` once per child. That is N passes over `entries` where there is
one today. Accepted rather than optimised: `toInput` already walks that array on every reconcile, and
a household is one to four children. If it ever matters, the milestone accumulation folds into the
existing single pass, which is a local change to one function.

**`answeredMilestoneKeys` becomes `answeredMilestoneKeysByChild: Record<string, readonly string[]>`**,
which is `s.answeredMilestonePrompts` passed straight through. It is already keyed by child, so the
current code's `[s.selectedChildId] ?? []` lookup is the only thing being removed.

**`selectedChildId` is deleted** from `ScheduleInput`, and `state.selectedChildId ===
previous.selectedChildId` is deleted from the subscriber's slice gate. The comment above that gate
(`scheduleSync.ts:185-196`) exists only to justify the entry for these two rules and is rewritten to
record that nothing reads the selection any more.

The doc comments on `treatments`, `reachedMilestoneKeysByChild` and `answeredMilestoneKeysByChild`
currently assert the single-child scoping and its history. They are load-bearing and get rewritten,
not deleted.

## The rules (`scheduled.ts`)

**`treatmentReminders`** loops every treatment instead of filtering to one child:

- Resolve the treatment's own child. Skip the treatment when that child is missing (an orphan
  treatment whose child was deleted, which `deleteChild` purges as of 0.15.2 but which a stale record
  could still produce) or when that child is `expected`. The `expected` gate moves from a single
  check on the selected child to one check per treatment, which is the same rule applied where it
  belongs: a treatment cannot be dosed against a due date, and `resolveLogDeepLink` refuses to open
  anything for an expected child, so the alert's own tap target would refuse to service it.
- `isTreatmentActiveToday(treatment, todayMidnight, treatment.childId)`, which still covers the
  paused flag and the fromDate/toDate range.
- The empty-name guard is unchanged.

**`treatmentNote`** takes the child and titles the alert `${child.first} · ${name} due`. The child is
resolved once in `treatmentReminders` and threaded through `treatmentEveryHoursReminders` and
`treatmentTimesOfDayReminders`, which already receive the whole `input`, rather than each of them
looking the child up again. Identifier, body, and the deep link are untouched.

**The catch-up branch** in `desiredScheduled` loops `input.children` and calls `milestoneReminders`
for each, passing that child's own two key lists. `milestoneReminders` gains no new behaviour: its
grouping by fire instant still collapses several milestones for ONE child into one alert, which is
what it was for.

## What changes on a device

- **Every pending treatment alert is rescheduled once**, on the first reconcile after the upgrade,
  because its title gains the child prefix and `diffScheduled` reschedules on a title change. The
  identifiers do not move, so nothing is cancelled and re-created under a new id. This is the same
  path a renamed child already takes.
- **Switching children no longer rebuilds the reminder set**, since nothing in the desired set reads
  the selection. That removes a native round trip per switch.
- **`treatmentDoseGiven`'s "a missing scalar means never considered" fallback stops being reachable
  for siblings.** It exists because `scheduleSync` handed over only the selected child's scalars, so a
  missing key meant the app had never looked rather than that no dose was logged. Every child's
  treatments now have keys. The fallback stays, because it is still the right answer for a treatment
  deleted mid-flight, but its comment is corrected.

## Testing

`vitest` runs in the node environment over `src/**/*.test.ts`, so all of this is testable directly.

Four existing assertions encode the narrow behaviour and are rewritten, not preserved:

- `scheduleSync.test.ts:496` "scopes dose scalars to the selected child"
- `scheduled.test.ts:914` "schedules nothing while the selected child is expected"
- `scheduled.test.ts:1173` "only ever covers the selected child"
- `scheduled.test.ts:1387`, a stale comment asserting that server mode holds one child's entries

Deleting `selectedChildId` from `ScheduleInput` also touches every fixture that sets it, across
`scheduled.test.ts`, `scheduleSync.test.ts`, `applySchedule.android.test.ts`, `sync.test.ts` and
`register.android.test.ts`. Those are mechanical field removals, not behaviour changes.

New coverage:

- A sibling's active regimen produces alerts while another child is selected.
- Both children's alerts carry their own child's name in the title.
- The `expected` gate applies per treatment: an expecting child's regimen is silent while a born
  sibling's regimen still fires.
- **A dose logged for one child does not settle a sibling's identically named treatment.** This is the
  cross-attribution hazard and the single most important new test.
- Two children with milestone windows closing the same morning produce two alerts, each deep-linking
  to its own child.
- A child switch produces no reconcile, which is the observable half of removing the gate entry.

## Out of scope

- Pumping stays account-wide. It is the parent's activity, not a child's.
- Nap, due-date, age and stale-timer reminders already cover every child and are untouched.
- No change to notification channels, permission handling, or the delivered-notification sweep beyond
  the one corrected comment.
- `answeredMilestonePrompts` is not purged when a child is deleted. That is a separate open question
  raised while closing 0.15.2 and is deliberately not bundled here.
