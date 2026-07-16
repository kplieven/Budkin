# Time-Entry — one focused panel instead of three chip rows

**Date:** 2026-07-16
**Status:** Approved, ready for planning

## Problem

`TimeEntry.tsx` (the app's signature entry component) models an interval as
three quantities, Started / Ended / Lasted, where the user pins any two and the
third is derived (`src/store/selectors.ts`: `DEFAULT_ORDER = ['end', 'lasted',
'start']`, so a fresh interval has End and Lasted active and Start derived).

That model is currently exposed **three times over, all at once**:

1. The **readout pills** at the top (`Start → End`, plus a `lasted` pill), each
   tappable to open an inline precise editor.
2. The **precise editor** (`TimeAdjuster.tsx`): text input + six nudge chips
   (±1/5/15m) + a day stepper.
3. **Three standalone chip rows** below: *Ended* (Now/15m/30m/1h/Still ongoing),
   *Lasted* (10/20/30/45m), *Started* (Now + 5/10/15/30/45m ago + up to three
   smart anchors).

On screen simultaneously that is the pills, roughly 18 chips across three
labelled rows, and potentially an open editor. The user's complaint is **visual
overwhelm**: too much competing for attention at once. Both the chip path and
the precise-editing path see real use (~50/50), so neither can simply be deleted
or buried.

## Goal

Cut the number of control sets visible at once without slowing entry: show the
pills as an always-visible summary, and reveal the controls for **exactly one
quantity at a time** in a single focused panel. Keep quick presets where a nudge
cannot replicate them (smart anchors) and drop the ones a nudge makes redundant.

## Constraints & context (verified)

- **The selector / derived-field math stays untouched.** `DEFAULT_ORDER`,
  `derivedField`, `isActive`, `reorder`, `overruleLasted`, `teStart/teEnd/
  teDurationMin` and the `te.order` model are all unchanged. This is a
  presentation-layer change; every existing test in `src/store/selectors.test.ts`
  must stay green.
- **Focusing a pill already pins its quantity.** The existing `tap()` in
  `TimeEntry.tsx` calls `setStartedAt` / `setEndedAbs` / `setLasted`, which
  reorders `te.order` so the focused quantity becomes active and the derived
  field recomputes. The new panel model reuses this exactly.
- **The timer-edit variant is gated on `fromTimerId != null`** (`timerEdit`). A
  running timer has no end/duration, so Ended never applies; stopping happens on
  save via `setTimerLasted` / `setOngoing`. Normal new-entry sheets (including
  "Still ongoing") are unaffected by that gate.
- **Existing smart-anchor selectors:** `lastFeedEndMinAgo`, `lastWakeMinAgo`
  (last sleep end), `lastDiaperMinAgo` in `src/store/selectors.ts`. Two new
  selectors are needed for the Ended anchors: `lastFeedStartMinAgo` and
  `lastSleepStartMinAgo`, mirroring the existing "end" ones. Diaper is a point
  event, so `lastDiaperMinAgo` is reused for both Started and Ended.
- **Point entries (diaper)** have a single quantity (`shape: 'point'`, the
  "When" pill) and today already render one chip row plus a smart-anchors row
  plus the editor accordion. There is no three-row problem to solve, only a
  styling-consistency opportunity.
- Style: no em-dashes in UI copy (project convention).

## Non-goals (YAGNI)

- No change to how entries are saved, synced, or shaped.
- No new bottom-sheet, segmented-control, or navigation chrome. The existing
  pills are the selector.
- No redesign of `TimeAdjuster`'s nudge steps or clock parsing.
- No change to which activity types use interval vs point shape.

## Design

### Interaction model

The pills row `[Start] → [End]  ·  lasted [x]` is the **always-visible summary
and the selector**. Nothing renders above it. Exactly one quantity is *focused*
at a time (`editing` state), and only that quantity's panel renders below the
pills.

- **Focused pill:** filled with the activity accent (reuses `ValuePill active`).
- **Derived pill:** dimmed (reuses `ValuePill dimmed`), value still shown.
- **Tapping any pill** focuses it: pins that quantity via the existing `tap()`
  path (so the derived field recomputes) and swaps the panel below.
- For intervals, `editing` is **never null** (a panel is always open). Point
  entries have a single always-open panel.

This replaces "three chip rows + pills + maybe an editor" with "pills + one
panel", roughly a two-thirds cut in simultaneous controls.

### Panels

Each panel is that one quantity's controls: quick chips (only where useful) +
the nudge row + text input, merged into a single block (today the chip row and
the editor accordion are separate). **All fixed-offset presets are removed**
(the `Now`/`Xm ago`/`15m`/`30m`/`1h`/`10-45m` chips), because the ±1/5/15m nudge
buttons plus the text input already reach any value. What is kept: the `Now`
chip, `Still ongoing`, and the smart anchors (a nudge cannot replicate those).

```
ENDED  (default focus)              STARTED                          LASTED
[Now] [Still ongoing]               [Now]                            [−15][−5][−1][+1][+5][+15]
[fed started 8m] [napped 1h]*       [fed ended 12m][woke 40m][diaper] ✏ [ 0:21 ]
[−15][−5][−1][+1][+5][+15] ◀Today▶  [−15][−5][−1][+1][+5][+15] ◀Today▶
✏ [ 7:41 ]   · 3m ago               ✏ [ 7:12 ]   · 45m ago
      *shown only when start < t ≤ now
```

- **Ended** (clock mode): `[Now]` + `[Still ongoing]` + Ended anchors + nudge row
  + day stepper + text input + relative readout.
- **Started** (clock mode): `[Now]` + Started anchors + nudge row + day stepper +
  text input + relative readout.
- **Lasted** (duration mode): nudge row + text input only. No presets, no
  anchors, no relative readout (the value already *is* the duration). Long
  durations (e.g. a 2h nap) are typed into the input; Lasted is now mostly the
  derived middle quantity, fine-tuned on the rare occasion it is focused.

### Relative readout (the "accumulated nudge" feedback)

On the **clock** panels, a live label shows the resolved value's distance from
now, updating on every nudge, anchor tap, or typed value: `now`, `45m ago`,
`1h 20m ago`. Because Start ≤ End ≤ now, the value is always at or before now,
so the label is always an "ago" (or "now"). This restores the information the
removed `Xm ago` chips carried, and satisfies the requested behaviour: nudging
−15m three times from Now reads **"45m ago"**. It is derived purely from
`now - value`, so there is no per-focus baseline state to track. Duration mode
shows no such label.

### Smart anchors (symmetric)

- **Started anchors** = when the *previous* activity **ended**: last feed ended
  (`lastFeedEndMinAgo`), last nap ended / woke (`lastWakeMinAgo`), last diaper
  changed (`lastDiaperMinAgo`). These exist today. Each renders when its value
  is available.
- **Ended anchors** = when the *next* activity **started**: last feed started
  (`lastFeedStartMinAgo`, new), last sleep started (`lastSleepStartMinAgo`, new),
  last diaper changed (`lastDiaperMinAgo`, reused). Each renders **only when its
  timestamp lands after the current resolved start and at or before now**
  (`start < t ≤ now`), so it can never produce a negative or future interval.
  When start is still derived it slides with end, so valid anchors stay visible;
  the conditional only hides an anchor once start is explicitly pinned past it.
  (The alternative, always-show-and-clamp, was considered and rejected: a chip
  that silently rewrites a second quantity is more surprising than one that is
  simply absent when it would be invalid.)

### States and transitions

- **Default focus (new interval): Ended.** End defaults to Now, so the panel
  opens showing `[Now]` selected plus any valid Ended anchors. The primary flow
  becomes: accept/adjust End, then tap the Start pill and set Start (via anchor,
  nudge, or type); Lasted derives.
- **Still ongoing:** the toggle in the Ended panel. Turning it on sets
  `ongoing`, so End renders as plain "now" text (not a pill) and Lasted renders
  as "running · Xm so far" (neither focusable). Focus therefore **auto-moves to
  Start**, the only editable quantity. Turning it off returns focus to the
  quantity the user then picks. This reuses the existing `activeEditor`
  invalidation (`te.ongoing && (editing === 'end' || editing === 'lasted')`).
- **Point (diaper):** one quantity, no switching. The single "When" panel stays
  open under the When pill: `[Now]` + smart anchors + nudge row + day stepper +
  text input + relative readout. Same panel styling as the interval clock
  panels.
- **Timer-edit variant (`timerEdit`):** focusable pills are Start and the
  "running" Lasted (no Ended, since stopping happens on save). **Default focus =
  Started** (correcting a running timer's start is the usual reason to open it).
  The Lasted panel keeps the `Still running` chip (`setOngoing`) and the note
  ("Pick a length to stop the timer and log it." / "Saving stops the timer and
  logs it."), and its duration writes go through `setTimerLasted`.

## Components & boundaries

- **`TimeEntry.tsx`** restructures: the three `SubLabel` + chip-row blocks
  collapse into a single panel renderer keyed on `editing`. For intervals,
  `editing` is initialised to `'end'` (or `'start'` in timer-edit) and never set
  to null; tapping a pill switches it rather than toggling it closed. The pill
  readout row is unchanged in structure (still `Start → End` on the first line,
  `lasted` on the second). The ongoing auto-focus rule lives here.
- **`TimeAdjuster.tsx`** stays the editor half of each panel (text input + nudge
  row + day stepper). It gains the **relative readout** label (clock mode only)
  and hosts the panel's kept chips (`Now`, `Still ongoing` / `Still running`, and
  the smart anchors). Two shapes to weigh during planning: extend `TimeAdjuster`
  to accept an optional `chips`/`anchors` slot and a `showRelative` flag, or wrap
  it in a small `FocusedPanel` component in `TimeEntry.tsx`. Prefer whichever
  keeps `TimeAdjuster` a pure controlled editor; a thin wrapper in `TimeEntry`
  that renders chips above `<TimeAdjuster>` is the likely answer, with the
  relative readout added to `TimeAdjuster` since it needs `value` + `now`.
- **`src/store/selectors.ts`** gains `lastFeedStartMinAgo` and
  `lastSleepStartMinAgo`, mirroring the existing `*EndMinAgo` selectors.

## Error handling & edge cases

- **Clamping is unchanged:** start editor clamps to `min(ms, end)`, end editor to
  `max(ms, start)`, nudges clamp to `≤ now` (clock) and `≥ 1` (duration), all as
  today in `TimeEntry.tsx` / `TimeAdjuster.tsx`.
- **No valid Ended anchors:** the Ended panel simply shows `[Now]` +
  `[Still ongoing]` + editor. Empty anchor sets never leave a dangling label.
- **Switching focus mid-type:** committing the text input on blur/submit already
  writes through `onChange`; switching pills focuses the new quantity and its
  panel, consistent with today's accordion behaviour.
- **Cross-midnight:** the day stepper stays in the clock panels (Ended, Started,
  point When); Lasted (duration) has none, unchanged.

## Testing

- **Selectors:** existing `selectors.test.ts` stays green (no math change). Add
  unit tests for `lastFeedStartMinAgo` / `lastSleepStartMinAgo` alongside the
  existing "min ago" selector tests.
- **Ended-anchor visibility:** a pure predicate (`start < t ≤ now`) should be
  unit-tested directly (visible when after start and not future; hidden when at
  or before start; hidden when future).
- **Component behaviour** (interval): default focus is Ended; tapping the Start
  pill focuses Start and shows its panel; only one panel renders at a time;
  toggling Still ongoing moves focus to Start and drops the End/Lasted pills to
  their ongoing display.
- **Timer-edit:** default focus is Started; no Ended panel is reachable; the
  Lasted panel shows the "Still running" chip and the stop-and-log note.
- **Relative readout:** `now - value` renders `now` / `Xm ago` / `Hh Mm ago`
  correctly and updates after a nudge.

## Tradeoff (accepted)

Setting **two** quantities now costs one extra tap (tap the other pill to switch
panels) versus everything being visible at once today. Single-quantity
completions (the common case, e.g. a feed that just ended: accept End = Now,
maybe one anchor for Start) are the same or fewer taps. The smart anchors and the
live relative readout offset the removal of the fixed-offset chips. This
regression was called out and accepted in brainstorming.
