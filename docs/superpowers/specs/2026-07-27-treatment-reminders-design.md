# Treatment reminders

## Goal

Notify a parent when a dose of a treatment (a `Cure`) is due.

This is a sixth reminder kind on the mechanism built in
`2026-07-20-scheduled-reminders-design.md`. Android only, like the other five.

## What makes this one different

The five existing reminders are driven by facts the app derives for itself: a
due date on the calendar, a timer that is running, a birthday that has arrived,
an elapsed pumping interval, a wake window nearing its end. This one is driven
by a schedule the **user authored**. A `Cure` carries its own `scheduleMode`,
its own slots or interval, its own start and end dates, and its own paused flag.

Two consequences shape everything below:

1. There is no tone problem here. The nap spec had to hedge because it gives
   advice from a curve the app itself labels as not medical consensus. A
   treatment reminder only ever reports back the schedule the parent typed in.
   That is why this one ships **on** by default, unlike naps and pumping.
2. Doses attach to cures **by name**, not by id. `dosesForCure` matches on a
   trimmed, lowercased name because a `MedicationEntry` carries no reference to
   the cure it came from and cannot be given one (Baby Buddy has no such field,
   so a `cureId` would be dropped the moment the dose round-trips). Everything
   this feature knows about "was this dose given" inherits that constraint.

## The tap contract

**A notification tap opens something. It never writes.** It should land the
parent one press from done, with that press theirs to make.

This rule is not new. All five existing reminders already obey it: their targets
are `/`, `/timers` and `/history`, none of which commit anything. It is written
down here because this feature is the first to make the "one press from done"
half of it real, and because the alternative was actively considered and
rejected for the nap reminder.

The rejected alternative was letting a nap tap start a sleep timer outright.
There is precedent for it: `app/timer.tsx` is a deep link that starts a timer,
and `widgets/napToggle.ts` starts one headlessly. Two things ruled it out. A
notification body, unlike a widget button, is not labelled with what it does, so
a write on tap would have to be spelled out in the copy to avoid being a
surprise, and taps get made by accident on a locked phone. More specifically,
the nap reminder fires `NAP_LEAD_MIN` (15 minutes) *before* the window closes,
so the baby is not asleep when it arrives; a tap at 15:10 on a nudge that fired
at 14:45 would stamp a sleep start 25 minutes late, and sleep start times feed
the very wake-window calculation that produced the reminder. An accidental sleep
timer is then quiet until `STALE_AFTER_MIN.sleep` trips 14 hours later.

The confirm sheet is the shape that satisfies the rule: seeded, read-only, with
a time picker, committing only on save.

## Mechanic

One builder per `Cure.scheduleMode`, both pure and `now`-parametrised, in
`src/notifications/scheduled.ts`. Both are bounded by `CURE_AHEAD` occurrences
per cure so a parent with several treatments cannot flood the OS queue.

```
CURE_AHEAD    = 8     // max occurrences scheduled per cure, both modes
CURE_MAX_DAYS = 14    // hard bound on the timesOfDay day walk
```

`CURE_AHEAD` is a per-cure occurrence count rather than a fixed number of days,
which gives sparse schedules more lookahead for free: a once-a-day cure reaches
eight days ahead, a four-slot cure reaches two. `CURE_MAX_DAYS` exists only so
the day walk terminates for a cure whose `timesOfDay` is empty and which would
otherwise never accumulate an occurrence.

### Fixed times of day

Slots fire at their wall-clock hour, from the existing
`CURE_TIME_OF_DAY_HOUR` map (morning 08, noon 12, evening 18, night 22).

Walk forward day by day from today, stopping at `CURE_AHEAD` occurrences,
`CURE_MAX_DAYS` days, or the cure's `toDate`, whichever comes first. Within each
day, take the cure's chosen slots in chronological order and skip any instant
already past.

Each instant is built with `setHours(hour, 0, 0, 0)` on **that day's own
midnight**, never as midnight plus `n * 86400000`. This is the same reason
`timeOfDaySlotMs` is written the way it is: adding a fixed number of
milliseconds drifts by an hour across a DST boundary, which would move the
08:00 dose to 07:00 or 09:00 for half the year.

For **today only**, skip the *k*th slot when `dosesToday >= k`, where *k* is the
1-based position of the slot among today's chosen slots in chronological order,
counted from the start of the day rather than from now. (So on a
morning+noon+evening cure, the evening slot is *k* = 3 even when morning and
noon have already passed.) This is `cureDueState`'s
counting rule expressed forward rather than backward. Counting rather than
matching slot-to-dose is what makes a late dose behave: on a morning+evening
cure, one dose given at 19:00 settles the earlier owed slot and leaves the later
one owed, where a per-slot "any dose after this slot clears it" rule would let
that single dose silently clear both. Future days are unaffected: their
`dosesToday` is zero by definition.

### Every N hours

A grid anchored to the last logged dose, structurally identical to
`pumpReminders`:

```
first  = max(1, ceil((now - anchor) / interval))
fireAt = anchor + n * interval        for n = first .. first + CURE_AHEAD
```

Deriving the first occurrence from `now` rather than blindly from the anchor is
what makes the grid self-healing: if every scheduled occurrence has already
passed (the app sat closed for a day), it re-enters the grid on phase instead of
scheduling nothing.

### Re-anchoring, and the reset lever

The grid re-anchors on every logged dose, because logging writes the store and
the write triggers a reconcile. So the normal way to correct a drifting reminder
is simply to log the dose, including after the fact with its real time.

That leaves one gap, the same one pumping has: a parent who gives a dose and
forgets to log it gets a reminder that is early, with no way to nudge it.
Pumping solves this by stamping `pumpingEnabledAt` when the toggle is switched
on, so toggling off and on rebases the phase to now. Treatments get the same
lever, via a single global `treatmentRemindersEnabledAt`:

```ts
if (lastDoseAt == null) return [];                                  // FIRST
const anchor = Math.max(lastDoseAt, treatmentRemindersEnabledAt ?? 0);
```

**The order of those two lines is load-bearing.** The null check must come
first. A plain `Math.max(lastDoseAt ?? 0, enabledAt ?? 0)`, which is what
`pumpReminders` does, would manufacture a grid for a cure that has never been
dosed, directly contradicting the decision recorded below. The stamp may only
ever move an **existing** grid forward, never bring one into being.

Two limits worth stating plainly:

- The stamp is **global**, so toggling off and on rebases every interval
  treatment at once. That is acceptable because the toggle it hangs off is
  itself global, and because the precise, per-treatment correction remains
  "log the dose". It should not be presented in the UI as a per-cure fix.
- The stamp does **not** affect `timesOfDay` cures at all. Their instants come
  from the wall clock, not from a phase, so there is nothing for a rebase to
  shift. Toggling off and on cannot move an 08:00 dose, and should not.

### When nothing is scheduled

No reminder is produced when any of these hold:

- `treatmentReminders` is off.
- The platform is not Android (`permission.ts`'s stub is a permanent no).
- The cure is paused (`active: false`).
- Today falls outside `fromDate`..`toDate` (`isCureActiveToday` already decides
  this).
- The cure belongs to a child other than `selectedChildId`. This is forced, not
  chosen: in server mode `s.entries` only ever holds the child the last fetch
  loaded, so dose history for anyone else is unreliable. `napReminders` gates on
  the same constraint and documents the same reason.
- The cure is `everyHours` with no `everyHours` value set, so there is no
  schedule to be late against.
- The cure is `everyHours` and **has never been dosed**. "Every 8 hours" means
  eight hours after the last dose; with no last dose there is no defined next
  instant, and any anchor invented for one is a guess. The in-app UI still
  surfaces it (`cureDueState` returns `due: 1` for exactly this case, so the
  Medication tile reads "Amoxicillin due"), so the parent is not left unaware.
  They simply get no push for a time the app made up. Logging dose one starts
  the grid.

### Identifier

```
budkin:cure:{cureId}:{fireAt}
```

Keyed on `cure.id`, not on the name: the id survives a rename, and a rename must
not orphan pending alerts. The name still reaches the diff through the title, and
`diffScheduled` already compares both title and body, so renaming a treatment
reschedules its alerts with the new copy.

That rename safety is complete only for a `timesOfDay` cure. For an `everyHours`
cure, dose ATTRIBUTION is still by name (`dosesForCure`, keyed on `cure.name`,
not `cure.id`, for the reason given above): the moment the cure is renamed, the
doses already logged under the old name stop matching, `lastAt` goes back to
null, and `cureEveryHoursReminders` returns `[]` for it, cancelling the whole
pending grid on the next reconcile. The identifier surviving the rename does not
help here, since there is no grid left to keep an identifier for. The in-app
Medication tile does not share this blind spot: `cureDueState` re-derives `due`
from the renamed cure's current name each render, so it still reads the cure as
due. The two diverge until the next dose is logged under the new name, which
re-anchors the grid. This is a forced consequence of name-based attribution
(a Baby Buddy medication record carries no reference back to its cure and cannot
be given one), not something fixed here.

`fireAt` is in the identifier for the same reason it is in the pumping one.
Changing `everyHours`, or re-anchoring the grid, recomputes `fireAt` for the same
cure. Without it in the identifier the diff would see no change and Android's
already-pending alarm would stay at the old spacing. Commit `bf7c0a5` was
exactly this bug for pumping. It remains stable while `now` advances, because
`fireAt` derives from the anchor and the interval, which move only when they
actually move.

## Copy

| Field | Value |
| --- | --- |
| Title | `${cure.name.trim()} due` |
| Body | the dosage when the cure has one, else `Tap to log the dose.` |
| `data.url` | `/log/medication?cure={cure.id}` |

The dosage comes from the existing `cureDosageLabel`, so the lock screen reads
"5 mg" without the parent opening the app, which is the single most useful thing
this notification can carry. When the cure has no dosage recorded there is
nothing to say, so it falls back to the instruction.

### Where the tap lands

`/log/medication` is already a deep-link target: `src/app/log/[type].tsx` opens
the Quick-Log sheet for any member of `ALL_ACTIVITIES`, and `medication` is one.
The only change is the new `cure` query parameter.

With it present, the route calls the existing `logMedicationFromCure(cureId)`
rather than the bare `openSheet('medication')`. That store action already does
precisely what this feature wants and needs no modification: it seeds `medName`,
`medDosage`, `medUnit` and (for interval cures) `medNextDoseIntervalSec` from
the cure, then opens the sheet in **confirm mode**, a read-only summary plus a
time picker. Its own comment records the contract this spec depends on: "No
entry is written here; save() commits it once the user confirms."

So tapping "Omeprazol due" lands on a sheet that already says Omeprazol, 5 mg,
with only the time left to adjust and Log left to press. This is why the body
copy needs no change: "Tap to log the dose" stays literally true.

`logMedicationFromCure` returns early when the id matches no cure, and when the
cure's name is blank. The route must therefore fall back to `openMedicationLog()`
when the parameter is absent, unparseable, or names a cure that no longer
exists, so a stale notification still opens a usable sheet rather than nothing.
See the edge case below.

### The other five

No change. All five already land somewhere that writes nothing, which is the
contract, and none of them has a cheap prefill available:

- **Pumping** and **nap** both point at `/timers`, which is correct. Staging an
  activity there is not currently possible without new UI: the screen offers one
  `startQuickTimer` button and a set of save-as chips applied to an
  already-running timer, so there is no per-activity start control to focus.
- **Timer left running** also points at `/timers`. Landing on the specific timer
  would be a genuine improvement, since the alert concerns exactly one, but the
  Timers screen reads no route parameters today. Deferred rather than dismissed.
- **Due date** and **age milestone** are informational and land correctly.

One notification per treatment per due moment. Two treatments due at 08:00
produce two notifications, each naming its own medication. Naming the drug is
the whole value of the alert; a combined "2 doses due" would force the parent
into the app to learn which, and would key the identifier on the instant rather
than the cure.

## Settings

A sixth row on `settings/notifications.tsx`, in the existing rows array:

```
Treatments        When a dose of a treatment is due.        [on]
```

Default **on**, joining due date, timer left running, and age milestones rather
than the two that ship off. It reports a schedule the parent authored rather
than offering advice, and it is inert until they create a treatment, so
defaulting it on cannot surprise anyone who does not use the feature.

No interval chip row, unlike pumping. The interval already lives on the cure
itself, set in the cure editor.

## Files

| File | Change |
| --- | --- |
| `src/notifications/scheduled.ts` | `'cure'` in `ReminderKind`; `CURE_AHEAD`, `CURE_MAX_DAYS`; `cureReminders()`; `cures`/`cureDoses` on `ScheduleInput`; `treatmentReminders` + `treatmentRemindersEnabledAt` on `ReminderPrefs`; call from `desiredScheduled` |
| `src/notifications/scheduleSync.ts` | project `cures` and the per-cure dose scalars; add both new prefs to the change gate |
| `src/data/prefs.ts` | `treatmentReminders`, `treatmentRemindersEnabledAt` |
| `src/store/useAppStore.ts` | both prefs in state, defaults, `hydrate`; `'treatmentReminders'` in the `setReminderPref` key union, stamping `treatmentRemindersEnabledAt` on switch-on and clearing it on switch-off exactly as `pumpingReminders` does |
| `src/app/settings/notifications.tsx` | the Treatments row |
| `src/app/log/[type].tsx` | read the `cure` query param; call `logMedicationFromCure` when it resolves, else fall back to `openMedicationLog()` |

`scheduled.ts` stays ignorant of `Entry`. `ScheduleInput` receives derived
scalars today (`lastPumpAt`, `lastSleepEndByChild`) rather than raw entries, and
this follows that shape:

```ts
cures: Cure[];
cureDoses: Record<string, { today: number; lastAt: number | null }>;
```

`today` is doses logged since local midnight, `lastAt` the most recent dose
instant, both derived in `scheduleSync` from the same name matching
`dosesForCure` uses. This keeps the name-attribution rule in one place and keeps
the selected-child scoping in the file that already documents why it exists.

## Testing

`cureReminders` is pure and `now`-parametrised, so all of this is plain unit
testing in `scheduled.test.ts`:

- each `timesOfDay` slot fires at its mapped hour
- the 08:00 slot stays at 08:00 across a spring-forward and an autumn-back
  boundary
- today's *k*th slot is suppressed when `dosesToday >= k`, and the counting
  case specifically: one dose on a morning+evening cure leaves exactly one slot
  scheduled
- a paused cure, and one outside `fromDate`..`toDate`, produce nothing
- a cure belonging to a non-selected child produces nothing
- an `everyHours` cure with no logged dose produces nothing
- an `everyHours` grid anchors on the last dose and re-anchors when it moves
- `treatmentRemindersEnabledAt` later than `lastDoseAt` moves the grid forward
- `treatmentRemindersEnabledAt` set while `lastDoseAt` is null still produces
  nothing (the ordering guard above)
- `treatmentRemindersEnabledAt` does not shift a `timesOfDay` cure
- output is capped at `CURE_AHEAD` per cure, and a cure with empty `timesOfDay`
  terminates rather than walking forever
- the identifier changes when the anchor or interval changes, and does not
  change as `now` advances

Plus pref persistence and the switch-on stamp in `useAppStore.test.ts`, and the
`cures`/`cureDoses` projection and change gate in `scheduleSync.test.ts`.

For the tap target, in the `log/[type].tsx` tests:

- a `cure` param naming a live cure seeds the confirm sheet from it and writes
  no entry
- a missing, malformed, or unknown `cure` param falls back to
  `openMedicationLog()` rather than opening nothing
- a `cure` param naming a blank-named cure also falls back, since
  `logMedicationFromCure` refuses it

## Edge cases

- **Two active cures sharing a name for one child.** Each counts the other's
  doses, so both fall silent. This is existing `cureDueState` behaviour that
  follows from name attribution, not something this feature introduces, and it
  is not fixed here.
- **A dose logged with a future timestamp.** The anchor jumps forward and the
  grid follows it. Correcting the entry corrects the grid, since `lastAt` is
  recomputed from the entries each reconcile.
- **A dose backdated behind the current anchor.** `lastAt` is a max over the
  cure's doses, so the anchor does not move backward unless the latest entry
  itself is edited earlier.
- **Switching child.** The previous child's cure alerts are cancelled on the
  next reconcile, because their cures no longer match `selectedChildId`.
  `selectedChildId` is already in the `scheduleSync` change gate.
- **`toDate` reached.** The day walk stops there, so no slot is scheduled past
  the end of the regimen.
- **The cure is deleted, renamed to blank, or paused between the notification
  being scheduled and being tapped.** The pending alert still carries its
  `cure` id. `logMedicationFromCure` refuses an unknown id and a blank name, so
  the route falls back to `openMedicationLog()`: the parent gets the normal
  picker or manual form rather than a dead tap. Reconciliation cancels such
  alerts on the next store write, so this only covers the window between the
  cure changing and the app next reconciling.

## Out of scope

- A per-cure reminder toggle. The global switch plus the existing per-cure
  `active` (pause) flag covers it without adding a field that would have to
  round-trip through the cure-tagged-note sync encoding.
- Grouping several due doses into one combined notification.
- Any follow-up or repeat for a missed dose. One alert per dose: a second buzz
  invites double-dosing, and the app cannot know the dose was not given.
- Quiet hours. Unlike the nap nudge, which guards 07:00 to 19:00 because a nap
  suggestion at night is nonsense, a 22:00 `night` slot or a 03:00 interval dose
  is deliberate. Suppressing a medication time the parent explicitly set would
  be the wrong call.
- A "treatment finished" notification when `toDate` passes.
- Replacing name-based dose attribution with anything stronger.
- Notification action buttons (Android categories plus response handling,
  including the headless case). They would let a labelled button write while the
  body stays passive, which is the one design that satisfies the tap contract
  *and* gives one-tap timer starts. Worth revisiting if the "open, never write"
  rule starts to feel like too many presses; not needed for this feature, whose
  confirm sheet is already one press from done.
- Staging an activity on the Timers screen, and focusing the stale-timer alert
  on its specific timer. Both need UI or route-param work on a screen this
  feature does not otherwise touch.
