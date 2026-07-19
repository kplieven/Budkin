# The expecting child state

## Goal

Let a parent add their baby before the birth, so Budkin is set up and waiting
rather than something to configure in the first exhausted week. The onboarding
wizard currently answers "not yet" with an acknowledgement screen and creates no
child at all, which is a placeholder: this replaces it.

This is the follow-up promised in
`docs/superpowers/specs/2026-07-18-onboarding-setup-wizard-design.md`.

## Why it was deferred

A `Child` requires a birth date, and a future one propagates further than it
first appears: into four age displays, milestone prompts, growth curves, the
insights range floor, and the Baby Buddy sync payload. That reach is what made
it the larger of the two pieces and worth its own spec.

## Data model

`Child` gains one optional field:

```ts
/** true while the baby is not yet born; `birth` then holds the DUE date */
expected?: boolean;
```

`birth` stays a required `number`, so no existing code path has to cope with a
missing date. The field is deliberately overloaded, which is a risk, so nothing
reads `child.expected` inline for display. One helper owns the meaning:

```ts
// src/lib/format.ts
ageOrDueLabel(birth: number, expected: boolean, now: number): string
```

Not expected, it returns today's `ageStr`. Expected, it counts down:

| Days until `birth` | Label |
|---|---|
| 15 or more | `Due in 6 weeks` (whole weeks) |
| 2 to 14 | `Due in 9 days` |
| 1 | `Due tomorrow` |
| 0 or fewer | `Due any day now` |

It never counts up past the due date. A parent looking at an overdue counter on
their home screen does not need "8 days overdue"; the confirm button is right
there instead. It takes primitives rather than a `Child` so the Android widget,
which cannot import store types, calls the same function.

Rejected alternatives (decided during brainstorming):

- **A separate `dueDate` field** with `birth` left unset: cleaner semantics, but
  it makes `birth` optional across the entire codebase to serve one transient
  state.
- **No expecting state at all**, the shipped placeholder: an expecting parent
  adds the baby once born. Rejected because it is the case the user actually
  asked about.

## Where the countdown appears

Four sites call `ageStr(child.birth, now)` today and all move to
`ageOrDueLabel`:

| Site | File |
|---|---|
| Home header | `src/app/(tabs)/index.tsx:207` |
| Desktop sidebar | `src/shell/Sidebar.tsx:139` |
| Child switcher rows | `src/features/childSwitcher/ChildSwitcher.tsx:64` |
| Android status widget | `src/widgets/StatusWidget.tsx:69` |

The widget snapshot (`src/widgets/snapshot.ts`) gains `expected: boolean`
alongside its existing `birth`, since the widget renders outside React and reads
only that payload.

## Home while expecting

`DashboardContent` already early-returns `NoChildCard` when there is no child.
It gains a second early return: when the selected child is expected, it renders
an `ExpectingCard` instead of the activity tiles. Logging a feed or a nap
against an unborn baby is meaningless, and hiding the tiles is what stops junk
data rather than merely discouraging it.

The card shows the countdown, one calm line, and a **They've arrived** button.
That button opens a single-field sheet: birth date, prefilled with today,
because most people confirm on or near the day. Confirming calls a new store
action `confirmBirth(id, birth)`.

Putting both early returns in `DashboardContent` rather than in the Home route
is deliberate: it is rendered by both the phone Home screen and the desktop
shell's main region, so one change covers both layouts.

## Sync hold-back

An expected child must never reach Baby Buddy, whose `birth_date` is a real
date. Three guards, all on the local side:

- `saveChild` skips `pushChildToServer` when the child being created is expected
- `uploadUnsynced` (`src/data/sync.ts`) excludes expected children from both the
  push list and its progress count
- `matchServerChild` (`src/data/sync.ts:126`) excludes them, so an expected
  child never adopts a server row by name and birthday

`confirmBirth` is the release valve. Afterwards the child is an ordinary
unsynced local child (`serverId == null`), and the existing reconnect flush
picks it up with no special casing. This is why the transition lives in one
store action rather than being spread across the two screens that can trigger
it.

## Waiting states

Growth, Insights and Milestones all key off an age that does not exist yet.
While the selected child is expected, each renders a shared `WaitingForBirth`
line in place of its content.

The tab bar keeps its shape. Removing tabs would make the bar visibly reshape
when the birth is confirmed, which reads as the app breaking rather than as
progress.

Notes and History are untouched. Notes is free text with no age dependency, so
scan dates, name shortlists and hospital-bag lists all work during pregnancy.
History needs nothing: with the tiles hidden there is nothing to log, so its
existing empty state is already correct.

## Creating an expected child

Two entry points, both writing the same fields:

- **The wizard**: `src/app/setup/baby.tsx`'s "Not yet" branch stops being an
  acknowledgement and becomes a name plus due date form, mirroring the born
  branch's layout.
- **The child sheet**: `ChildSheet` gains a born/expecting toggle that swaps its
  Birthday field for Due date. Without this, a second baby on the way could only
  be added by wiping the app and redoing onboarding.

Due dates need their own clamp. `clampBirth` pins to today or earlier, which is
exactly wrong here. A sibling `clampDueDate` in `src/lib/birthDate.ts` keeps
`clampBirth`'s 1900 lower bound and its month and day validation, but replaces
the "no later than today" ceiling with "no later than 300 days from today". Past
dates therefore pass through untouched, so an already-overdue pregnancy reads
"Due any day now" rather than being silently rewritten to today.

Editing an expected child through the sheet and flipping the toggle to born is a
second, equivalent way to confirm a birth. Both paths route through
`confirmBirth` so the transition has one implementation.

## Testing

Most of this is pure logic and belongs in vitest:

- `ageOrDueLabel` across every boundary: weeks out, 14 versus 15 days, 1 day,
  today, and overdue. Also that it never returns a negative age.
- `clampDueDate`: a future date passes through, a date beyond 300 days is
  clamped, a past date is left alone, garbage falls back sanely.
- `uploadUnsynced` excludes expected children from the push list AND the count.
- `matchServerChild` never matches an expected child.
- `confirmBirth` clears the flag, sets the real birth, and leaves the child
  sync-eligible.

Then a web run driving the whole arc: create an expecting child through the
wizard, see the countdown on Home with no tiles, check Growth and Milestones
show the waiting state, confirm the birth, and see the tiles appear. Plus a
check that an expected child never appears in a server push.

## Scope

Roughly fifteen files. It is one coherent feature rather than several, so it
stays one spec, but the implementation plan will run to eight or ten tasks,
larger than the wizard's.

Explicitly NOT in scope: due-date notifications or reminders, pregnancy-specific
tracking (appointments, kick counts, weight), and any change to Baby Buddy's own
data model. An expected child is a local placeholder that becomes an ordinary
child at birth, and nothing more.
