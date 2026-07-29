# Scheduled reminders

## Goal

Notify a parent when their expected baby's due date arrives, and use the same
mechanism for three other reminders worth interrupting someone for: a timer left
running, a pumping interval, and the baby's age milestones.

Android only. `register.ts` and `postNotification.ts` already no-op off Android
and the new modules follow that split, so nothing changes on web or iOS.

## Why this is one feature and not four

All four reduce to the same primitive: a notification scheduled for a known
future instant, cancelled if the state that justified it changes. Even the
forgotten-timer alert fits, because "four hours after this timer started" is a
fixed timestamp the moment the timer starts. Building them as four independent
code paths would mean four places to remember every cancellation, and there are
more of those than they first appear: birth confirmed, due date edited, child
deleted, timer stopped on another device and arriving via sync. Miss one and the
app announces a due date for a baby born three weeks ago.

## What exists today

`src/notifications/` posts *immediate*, store-derived notifications for running
timers on a `LOW` importance channel. Every post reflects current state; nothing
is scheduled ahead. The module already has the shape this work needs, a pure
`content.ts` that computes a desired set and diffs it, plus a `sync.ts` store
subscriber that applies the delta, so this extends that pattern rather than
introducing a new one.

## Architecture

A pure module computes the desired set of scheduled notifications from store
state. A platform module reconciles that set against what the OS actually holds.

```ts
// src/notifications/scheduled.ts: pure, no native calls
export type ReminderKind = 'due' | 'stale' | 'age' | 'pump';

export interface ScheduledNotification {
  identifier: string;
  kind: ReminderKind;
  title: string;
  body: string;
  /** epoch ms */
  fireAt: number;
  data: { url: string };
}

export function desiredScheduled(state: ScheduleInput, now: number): ScheduledNotification[];

export function diffScheduled(
  existing: { identifier: string; title: string; body: string }[],
  desired: ScheduledNotification[],
): { toSchedule: ScheduledNotification[]; toCancel: string[] };
```

`ScheduleInput` is a narrow projection of the store (children, timers,
notification prefs, last pumping entry) rather than the whole state, so the pure
layer does not depend on store internals and the tests construct it directly.

Every reminder except the stale-timer and pumping ones fires at 09:00 local. That
hour is a fixed constant, not a user setting; making it configurable adds a
picker and a migration for something nobody has asked to move.

### Two things that differ from the existing timer sync

**The OS is the source of truth, not an in-memory `prev`.** `sync.ts` keeps
`prev` in a module variable, which is correct for immediate sticky notifications
re-derived on every launch. Scheduled notifications outlive the process. The app
can be killed for weeks while Android still holds a pending due-date alert, and a
fresh `prev = []` would schedule a second copy on the next launch. The reconcile
step therefore reads `getAllScheduledNotificationsAsync()`, which returns
`identifier`, `content`, and `trigger` per pending request, and diffs against
that.

**Identifiers encode what justifies them.**

| Kind | Identifier |
|---|---|
| Due date | `budkin:due:<childId>:<lead\|day>:<fireAtMs>` |
| Stale timer | `budkin:stale:<timerId>:<fireAtMs>` |
| Age milestone | `budkin:age:<childId>:<slug>:<fireAtMs>` |
| Pumping | `budkin:pump:<anchorMs>:<n>:<fireAtMs>` |

Encoding the fire time means editing a due date changes the identifier, so the
diff cancels the stale alert and schedules the new one with no special-case
logic. `diffScheduled` also compares `title` and `body`, so renaming a child
rewrites pending notifications instead of leaving a stale name in the tray.

Every identifier carries the `budkin:` prefix and the reconciler ignores anything
without it, so it can never cancel a timer notification it does not own. Timer
notifications use a bare `timer.id`, so there is no collision today, but the
prefix makes that guarantee structural rather than incidental.

## Platform decisions

**A new `reminders` channel at `DEFAULT` importance.** The existing `timers`
channel is deliberately `LOW`: silent, no heads-up, because it is a persistent
status rather than an alert. Reusing it would make every reminder here silent,
which defeats the point. A separate channel also lets a user mute reminders in
Android settings without losing the timer display.

**No exact alarms, deliberately.** Android 12+ requires `SCHEDULE_EXACT_ALARM`
for exact-time delivery, and on 13+ that needs a special user grant. The
auto-granted alternative, `USE_EXACT_ALARM`, is restricted by Google Play to apps
whose core purpose is alarms or calendars. Budkin has timers, but they are
stopwatches, not alarms, so claiming it risks a Play review problem for no real
benefit. Inexact delivery means a 09:00 alert may land later if the phone is
dozing, which is acceptable for all four reminders. Consequently `app.json` needs
no permission changes. `RECEIVE_BOOT_COMPLETED` is added automatically by
expo-notifications, so scheduled alerts survive the reboots a multi-month due
date will certainly span.

**Permission is never requested at launch.** The reconciler checks
`getPermissionsAsync()` and silently skips scheduling when not granted. The
request happens only where there is context: when a due date is saved in setup,
and from the notification settings screen, which shows an enable prompt while
permission is missing. A cold-launch permission dialog with no explanation is
worse than the feature arriving a day later.

## The four reminders

### Due date

Two alerts at 09:00 local, seven days before the due date and on the day itself.
Nothing after. Roughly half of babies arrive after their due date, and
`ageOrDueLabel` already caps its countdown at "Due any day now" rather than
counting up, so going quiet afterwards matches a stance the app has already
taken.

| Alert | Title | Body |
|---|---|---|
| Lead-up | `Rowan is due next week` | `Budkin is ready when they are.` |
| Day-of | `Today is Rowan's due date` | `Tap when your baby arrives.` |

Both open `/`, where the confirm-birth sheet lives. The lead-up is skipped when
the due date is entered within seven days of it, and nothing is ever scheduled
into the past. Expecting children always have a name, since `setup/baby.tsx`
requires one to save, so the copy can rely on it.

Cancellation needs no code. When `expected` flips false the child leaves the
due-date branch of the desired set; when the date is edited the identifier
changes; when the child is deleted it leaves the set entirely.

### Forgotten timer

One alert per running timer at `timer.start + threshold`. Only four activities
are interval-shaped and therefore timer-capable.

| Activity | Typical duration | Stale after |
|---|---|---|
| Tummy time | 18m | 45m |
| Pumping | 15m | 2h |
| Feeding | 18m | 3h |
| Sleep | 90m | 14h |

Sleep needs the wide margin because a night sleep entry legitimately runs twelve
hours, and a false alarm at 3am is far worse than a late catch.

Copy follows the existing timer notification style, `Rowan · Sleep`, with the
body `Running for 14 hours. Still going?`, opening `/timers`. The identifier
carries the timer id, so stopping the timer on another device cancels the alert
as soon as the change arrives via sync. It also carries the fire time, which
matters because editing a running timer's start moves when the alert is due
without changing either the title or the body; without the timestamp in the
identifier the diff would see no change and leave the old alert in place.

A threshold already passed at reconcile time is not scheduled. If the app was
closed, the OS already fired the alert scheduled when the timer started.

### Age milestones

At 09:00 local on 1 week, 1 month, 3 months, 6 months, 9 months, and 1 year, then
yearly birthdays.

Quarterly after the first month gives the parent a pattern they can anticipate,
rather than intervals that look arbitrary. The obvious alternative spine, the
well-baby visit schedule of roughly 1, 2, 4, 6, 9, and 12 months, is rejected on
purpose: those are also the vaccination dates, and a notification landing on them
invites a parent to read "Rowan is 2 months old today" as a reminder about an
appointment. That is a medical implication the app has not earned.

**Copy constraint:** these stay purely celebratory. No mention of checkups,
appointments, vaccinations, or development expectations, and the cadence must not
be changed to shadow a clinical one.

| Slug | Title |
|---|---|
| `1w` | `Rowan is one week old today.` |
| `1m` | `Rowan is one month old today.` |
| `3m`, `6m`, `9m` | `Rowan is three / six / nine months old today.` |
| `1y` | `Happy first birthday, Rowan.` |
| `2y`+ | `Happy 2nd birthday, Rowan.` |

Expected children are excluded, since `birth` holds a due date rather than a
birth date. Confirming a birth replaces it with the real date, which changes
every identifier and reschedules the whole set automatically.

Month arithmetic clamps to the last day of short months, so a baby born on 31
January gets a three-month milestone on 30 April. Only occurrences within the
next twelve months are scheduled, and each launch extends the horizon.

### Pumping reminder

Off by default, enabled with an interval on the notification settings screen.
Anchored to the last pumping entry rather than a fixed clock, so logging a pump
pushes the next reminder out. No overnight quiet hours, because overnight is
exactly when a pumping parent needs it.

```
anchor    = max(last pumping entry end, pumpingEnabledAt)
firstFire = smallest anchor + n * interval that is still in the future
```

The next eight occurrences are scheduled rather than one. A repeating reminder
built from one-shot triggers needs the app to reschedule after each fire, and
eight keeps the chain alive through roughly a day of the app never being opened.
Deriving the first fire from `now` rather than blindly from the anchor is what
makes it self-healing: if every scheduled occurrence has already passed, the next
launch re-enters the grid on phase instead of scheduling nothing. Because the
grid stays anchored, identifiers are stable as `now` advances and only churn when
an occurrence actually passes.

Copy is `Time to pump` with body `Tap to log a session.`, opening `/timers`. The
body deliberately avoids naming an elapsed time: occurrence `n` fires `n *
interval` after the last pump, so a fixed "last pumped 3 hours ago" would be
wrong for every occurrence after the first.

## Settings

A `Notifications` row in `settings.tsx` opens its own screen, so the settings
page does not become a wall of switches and each toggle has room for a line of
explanation.

This means moving `src/app/settings.tsx` to `src/app/settings/index.tsx` and
adding `src/app/settings/notifications.tsx`. The `/settings` route is unchanged,
so nothing that links to it breaks.

`Prefs` in `src/data/prefs.ts` gains:

```ts
dueDateReminders: boolean;      // default true
staleTimerReminders: boolean;   // default true
ageMilestones: boolean;         // default true
pumpingReminders: boolean;      // default false
pumpingIntervalMin: number;     // default 180
pumpingEnabledAt: number | null;
```

`savePrefs` already merges partial patches, so each toggle persists its own field
without clobbering the others. Pumping defaults off because it applies to a
subset of parents and needs an interval choice; the rest default on so the
feature is not invisible, which is safe given the reconciler never prompts for
permission on its own.

## Files

| File | Change |
|---|---|
| `src/notifications/scheduled.ts` | new, pure desired-set and diff |
| `src/notifications/scheduled.test.ts` | new |
| `src/notifications/scheduleSync.ts` | new, store subscriber plus launch run |
| `src/notifications/applySchedule.android.ts` | new, read / schedule / cancel |
| `src/notifications/applySchedule.ts` | new, no-op stub |
| `src/notifications/content.ts` | add `REMINDER_CHANNEL_ID` |
| `src/notifications/register.android.ts` | create `reminders` channel, generalise tap routing |
| `src/data/prefs.ts` | six new `Prefs` fields |
| `src/app/settings.tsx` | move to `settings/index.tsx`, add Notifications row |
| `src/app/settings/notifications.tsx` | new |
| `src/app/setup/baby.tsx` | request permission when a due date is saved |

`register.android.ts` currently routes only `data.url === '/timers'`. It
generalises to navigating whatever `data.url` the notification carries, which is
always app-generated.

`scheduleSync.ts` mirrors `sync.ts`, subscribing to the store and gating on the
slices that matter (children, timers, entries, prefs) so the per-second `now`
tick does not trigger a rebuild. Scheduling is absolute, so a launch-time run
plus state-change runs is sufficient; the desired set does not need to be
recomputed as the clock advances.

## Testing

`desiredScheduled` and `diffScheduled` are pure over `(state, now)`, so they test
with plain vitest and no native mocks, exactly as `content.test.ts` does. Cases:

- Due date lead-up and day-of at the right instants; lead-up skipped when the due
  date is entered inside seven days; nothing scheduled into the past.
- Due-date alerts disappear when `expected` flips false, when the date is edited,
  and when the child is deleted.
- Each stale-timer threshold; a timer already past its threshold is not
  scheduled.
- Age cadence including the twelve-month horizon bound, yearly milestones past
  1y, and month clamping for a 31 January birth date.
- Pumping occurrence grid, re-anchoring when a pump is logged, and self-healing
  when every scheduled occurrence has passed.
- Diff: additions, removals, and title/body changes producing a reschedule.
- Prefix isolation: a non-`budkin:` identifier in the existing set is never
  cancelled.

## Edge cases

| Case | Behaviour |
|---|---|
| Permission denied | Silent no-op. Everything else keeps working. |
| Device reboot | Survives via `RECEIVE_BOOT_COMPLETED`, added automatically. |
| Doze mode | Delivery may be late. Accepted, see the exact-alarm decision. |
| Force stop or app update | Expo documents no guarantee. The launch-time reconcile repairs the set, since it reads OS state fresh rather than trusting a cached copy. |
| Multiple children | Due-date and age reminders cover every child, not only the selected one. |
| Timezone change | Fire times are computed as local 09:00 when scheduled. A move across timezones shifts the wall-clock time until the next launch, which recomputes and reschedules. |

## Implementation order

The four reminders share one mechanism, so the pure layer lands once and each
reminder is then additive. This sequences into four shippable steps:

1. `scheduled.ts`, `applySchedule.*`, `scheduleSync.ts`, and the `reminders`
   channel, with the due-date reminder as the only entry in the desired set.
   This is the requested feature and it stands alone.
2. Stale timers. Pure addition to `desiredScheduled`, no new UI.
3. Age milestones. Also pure, and the largest test surface because of the month
   clamping and horizon rules.
4. The settings move, the notifications screen, and the pumping reminder, which
   is the only one needing new UI and new `Prefs` fields.

Steps 2 and 3 ship with their toggles defaulting on and no way to turn them off
until step 4. That is acceptable because the Android channel already provides a
mute, and it keeps the settings refactor out of the critical path.

## Out of scope

- iOS and web delivery. The stubs stay no-ops.
- Sync backlog warnings. Considered and dropped; that belongs in-app, not as a
  push, because a failed sync is not time-critical.
- Feed reminders. Newborn guidance is feeding on demand, not on a clock, and a
  phone telling a parent they are late to feed their baby is a tone problem, not
  a feature.
- Milestone catch-up push. `2026-07-16-milestone-catch-up-nudge-design.md`
  explicitly decided that stays an in-app card. Reversing it needs its own
  discussion.
- Any notification that nags about inactivity.
