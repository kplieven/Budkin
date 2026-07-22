# Nap suggestion reminder

## Goal

Notify a parent as their baby approaches the upper end of the typical wake
window for their age, suggesting a nap.

This is a fifth reminder kind on the mechanism built in
`2026-07-20-scheduled-reminders-design.md`. Android only, like the other four.

## Why this one needs more care than the other four

The existing reminders report facts. A due date is on the calendar, a timer is
running, a birthday has arrived, a pumping interval has elapsed. This one makes
a suggestion about how to care for a baby, and it derives that suggestion from
`NORMS.wakeWindow`, which the app itself labels "Common sleep-consultant
guidance" and explicitly annotates as "independent guidance, NOT medical
consensus (no European or WHO body defines named wake windows)".

The scheduled-reminders spec ruled out feed reminders on tone grounds, because
"a phone telling a parent they are late to feed their baby is a tone problem,
not a feature", and ruled out "any notification that nags about inactivity".
A nap nudge sits nearer that line than the other four do.

Three decisions follow from this, and they are the load-bearing ones:

1. It is **off by default**, unlike the three that ship on.
2. The copy **hedges and observes** rather than instructing.
3. The settings row **names the basis** where the parent opts in, echoing the
   disclaimer Insights already shows beside this same curve.

## Mechanic

Per child, anchored to the end of their most recent sleep entry:

```
band   = wakeWindowBand(ageDays)          // the NORMS.wakeWindow bucket
fireAt = lastSleepEnd + (band.hi - NAP_LEAD_MIN)
```

`NAP_LEAD_MIN` is 15. Firing at the band's upper bound would announce that the
parent is already late, and the overtired window has arrived by then. Fifteen
minutes of lead is enough to start a wind-down. The band's lower bound was
rejected as a fire point: it is when the nap window opens, not any kind of
maximum, and it would fire while most parents still read the baby as content.

Resulting fire points, awake-time by age:

| Age (`maxAgeDays`) | Band (min) | Fires at |
|---|---|---|
| to 30 days | 45 to 60 | 45 min awake |
| to 90 days | 60 to 90 | 1h 15m awake |
| to 180 days | 90 to 120 | 1h 45m awake |
| to 365 days | 120 to 180 | 2h 45m awake |

### When nothing is scheduled

Each of these falls out of existing state. None needs explicit cancellation
code, which is the same property the other four kinds rely on.

| Condition | Reason |
|---|---|
| `child.expected` | `birth` holds a due date, so there is no age |
| age > `NAP_MAX_AGE_DAYS` (365) | past where `NORMS.wakeWindow` has data |
| a sleep timer is running for the child | the baby is asleep right now |
| the child has an ongoing sleep ENTRY with no running timer (edited to "still ongoing", or a server record with no end) | the baby is asleep right now; `asleepChildIds` catches what the timer check alone would miss |
| no ended sleep entry for the child | there is no anchor |
| `fireAt <= now` | matches the other four kinds |
| `fireAt` outside 07:00 to 19:00 local | quiet hours, see below |

**The age ceiling stops where the data stops.** `bucketFor` falls back to the
last bucket for any age past its final `maxAgeDays`, so without an explicit
ceiling a three-year-old's parent would be nudged at 165 minutes awake, forever.
Extending to 18 months was considered and rejected: it would reuse a bucket the
cited source only defines up to 12 months, so the app would be extrapolating
past its own citation.

**A running sleep timer is resolved with `timer.childId ?? selectedChildId`**,
the pattern established at `useAppStore.ts:600`. `Timer.childId` is optional and
a timer started from the headless widget carries none, so comparing `childId`
alone would let a widget-started nap fail to suppress the nudge.

### Quiet hours

Fire times outside 07:00 to 19:00 local are **dropped, not deferred**. If the
window elapses at 21:00, surfacing it at 07:00 the next morning is meaningless:
the baby has slept the night, and the anchor that justified it is stale.

The boundary is the one `sleepTimer.ts` already uses to default a sleep entry's
`nap` flag (`hr >= 7 && hr < 19`), so "nap" means the same thing in both places.
07:00 exactly is inside, 19:00 exactly is outside.

This differs from the pumping reminder, which deliberately has no quiet hours.
That is not an inconsistency: pumping is a task the parent must do on a clock
regardless of the hour, and overnight is exactly when they need it. A nap
suggestion at 4am, after a night wake, is noise.

### Identifier

```
budkin:nap:<childId>:<fireAtMs>
```

Logging a sleep moves the anchor, which moves `fireAt`, which changes the
identifier, so `diffScheduled` cancels the stale alert and schedules the new one
with no special-case logic. The fire time must be in the identifier for the same
reason it is in the pumping one: title and body vary only by elapsed time, so
they carry too little signal for the diff to rely on.

## Copy

| | |
|---|---|
| Title | `Rowan may be ready for a nap` |
| Body | `Awake 1h 15m.` |
| Opens | `/timers` |

"May be ready", not "Time for a nap". The title hedges because the app is
working from a population rule of thumb and the parent is looking at an actual
baby. The body states the observation behind the suggestion so the parent can
weigh it, rather than issuing an instruction.

**The existing `spanLabel` in `scheduled.ts` must not be reused here.** It
assumes every value is a whole number of hours or under an hour, which holds for
`STALE_AFTER_MIN` but not for these: it would render 75 minutes as "1.25 hours".
Use `fmtDur` from `@/lib/format`, which already produces "1h 15m" and is what
the rest of the app formats durations with.

## Where the band comes from

`norms.ts` gains one narrow export:

```ts
export function wakeWindowBand(ageDays: number): NormBucket | null;
```

`bucketFor` stays private. The alternative, copying the four buckets into
`scheduled.ts`, would let the notification silently drift from the curve the
Insights tab shows the parent, which is the one place they can see the basis for
the nudge. One source, two consumers.

This adds a dependency from `notifications/` to `features/insights/`. That is
acceptable: `norms.ts` is a pure data module importing only a type, so the pure
layer stays testable with no native mocks and no store access.

## Settings

`Prefs` gains one field:

```ts
napSuggestions: boolean;   // default false
```

Off by default. The three calendar-driven reminders ship on because they are
inert facts, and pumping ships off because it serves a subset of parents. This
ships off for a third reason: it is advice, from a source the app labels as not
medical consensus, and advice should be asked for.

The row on the notifications screen carries that basis at the point of opt-in:

> **Nap suggestions**
> Suggests a nap as your baby approaches the typical wake window for their age.
> General guidance, not medical advice.

Insights shows a disclaimer beside this curve. A push notification derived from
the same curve should not carry less framing than the chart does.

## Files

| File | Change |
|---|---|
| `src/features/insights/norms.ts` | export `wakeWindowBand(ageDays)` |
| `src/notifications/scheduled.ts` | `'nap'` kind, `napReminders`, `NAP_LEAD_MIN`, `NAP_MAX_AGE_DAYS`, daytime predicate |
| `src/notifications/scheduled.test.ts` | cases below |
| `src/notifications/scheduleSync.ts` | `lastSleepEndByChild` and `selectedChildId` in `toInput`, gate on `napSuggestions` |
| `src/data/prefs.ts` | `napSuggestions` |
| `src/store/useAppStore.ts` | `napSuggestions` state and setter |
| `src/app/settings/notifications.tsx` | toggle row |

`ScheduleInput` gains:

```ts
lastSleepEndByChild: Record<string, number>;
asleepChildIds: Record<string, true>;
selectedChildId: string;
```

keeping the pure layer's narrow-projection property: it still never imports
store types.

`scheduleSync.ts` computes `lastSleepEndByChild` and `asleepChildIds` in the
same pass over `entries` it already uses for `lastPumpAt`: a `type === 'sleep'`
entry with a non-null `end` updates the per-child maximum in
`lastSleepEndByChild`; one with `end == null` (ongoing) marks the child in
`asleepChildIds`, whether or not a running `Timer` also exists for it — an
entry can be ongoing with no timer at all, e.g. one edited to "still ongoing",
or a server sleep record with no end. Its slice gate gains `napSuggestions`;
`entries` and `timers` are already gated.

## Testing

`desiredScheduled` stays pure over `(input, now)`, so these are plain vitest
cases with no native mocks, as `scheduled.test.ts` already does for the other
four kinds.

- Fire point correct for each of the four age buckets.
- Every suppression row above, one case each.
- Quiet hours at the exact boundaries: a fire time landing at 07:00 is kept, at
  19:00 is dropped.
- A newer sleep entry re-anchors: identifier changes, so the diff yields one
  cancel and one schedule.
- A sleep timer with no `childId` suppresses the nudge for `selectedChildId`.
- Two children awake at once get independent reminders, and one napping does not
  suppress the other's.
- Age exactly 365 days is included, 366 is not.
- `napSuggestions: false` yields nothing regardless of state.

## Edge cases

| Case | Behaviour |
|---|---|
| Permission denied | Silent no-op, as with the other four |
| Baby wakes and the parent does not log it | No new anchor, so no nudge. The app never guesses a wake it was not told about |
| Sleep entry edited to a new end time | Anchor moves, identifier changes, reminder reschedules |
| Child deleted | Leaves the desired set entirely |
| Timezone change | Fire time and the quiet-hours check are computed at schedule time from local hours. The next launch recomputes, matching the other kinds |
| Child with no sleep history yet | Nothing scheduled until the first sleep is logged and ended |

## Out of scope

- iOS and web delivery. The stubs stay no-ops.
- Per-child wake window overrides. The norm curve covers the age range and a
  per-child prefs shape does not exist yet.
- Learning the wake window from the child's own logged sleep. Noisy on sparse
  data and unpredictable for the parent, who cannot see why the time moved.
- Parent-configurable quiet hours. The 07:00 to 19:00 default matches the app's
  existing day/night boundary, and nobody has asked to move it.
- Any escalation or repeat. One nudge per wake window, or it becomes exactly the
  nagging the scheduled-reminders spec ruled out.
