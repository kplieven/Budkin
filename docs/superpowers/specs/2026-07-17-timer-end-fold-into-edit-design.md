# Fold "Ended earlier…" into the timer edit sheet

Date: 2026-07-17

## Problem

Stopping a running timer at a past time lives in its own control on the timers
screen: an "Ended earlier…" disclosure button below the action row, which
expands an ephemeral editor (quick chips, a clock adjuster, a summary line and
its own save button). It duplicates machinery the edit sheet already has, and it
gives the timers card two competing save buttons.

Meanwhile the edit sheet renders the end value as dead text. `TimeEntry.tsx:176`
special-cases timer edits to a plain `Txt` reading "now", so the one place a user
would naturally go to change when something ended is the one place that will not
let them.

## Goal

Delete the "Ended earlier…" control. Make the sheet's "now" pill tappable, so
editing it to an earlier time and saving stops the timer and logs it. Say so on
the save button.

## What already works

The store needs almost nothing. `save()` (`useAppStore.ts:1699`) short-circuits
to `saveTimerDetails()` while `fromTimerId && te.ongoing`, keeping the timer
live and persisting only metadata. Once `ongoing` flips false it falls through
to the entry-creation path, which drops the source timer (`:1847`) and deletes
its server mirror (`:1865`). `LogSheet.tsx:210` already flips the button to
"Stop & save" in that state.

So the feature is reachable today via the "lasted" pill, which calls
`setTimerLasted` and flips `ongoing` false. Only the end pill is fenced off.

`setEndedAbs` has the right semantics for this. With the timer-edit order
`['end', 'start', 'lasted']`, `reorder(order, 'end')` leaves the order
unchanged, so `derivedField` stays `'lasted'`: the start stays pinned at the
timer's real start, the end is the pinned value, and the duration derives from
the pair. The end pill will not render dimmed, because `derived === 'end'` is
false.

## Design

### 1. Timers screen (`src/app/(tabs)/timers.tsx`)

Deletion only.

- Remove the "Ended earlier…" `Pressable` (lines 226-256) and the editor block
  it toggles (258-312).
- Remove the `endEditFor` and `endCandidate` state (70-74).
- Drop `fmtClock` and `fmtDur` from the format import (line 14). `fmtAgo` and
  `fmtElapsedClock` stay.

The card's "Stop & save" button is untouched and still stops at now.

### 2. Time entry (`src/features/log/TimeEntry.tsx`)

Delete the `timerEdit ?` branch at lines 176-179. Control then falls through to
the pills that already exist, which render "now" while ongoing, `fmtClock(end)`
once an end is pinned, and focus the end panel on press. No new pill code.

Add a timer-specific end panel, gated on `isInterval && timerEdit && editing ===
'end'`. It parallels the existing split at lines 297 and 301, where "lasted"
already has a timer variant beside the general one. The general end panel
(220-250) stays untouched, so there is no regression surface on normal log
sheets.

A separate block is needed rather than a widened condition because the general
panel hides the `TimeAdjuster` while ongoing (`{!te.ongoing && ...}`), and
editing "now" downward from a live timer is the entire point.

Panel contents:

- `Now` chip, calling `setEnded(0)`. Ends at now, stops on save.
- `Still running` chip, calling `setOngoing`, selected while `te.ongoing`. The
  way back to live.
- The existing end anchors ("When last feed started"), calling `setEndedAbs`.
- Helper line: "Saving stops the timer and logs it."
- `TimeAdjuster` in clock mode, `value={end}`, `onChange` clamped to
  `[start, now]`. Its own ±1/5/15m steps replace the removed editor's
  −5m/−15m/−30m chips, and it already clamps forward motion to `now`.

Resulting states:

| Interaction | Result | Button |
| --- | --- | --- |
| untouched | timer stays live | Save details |
| `Now` chip | stops at now | Stop & save |
| `Still running` chip | stays live | Save details |
| clock set to 15:14 | stops at 15:14 | Stop & save · ended 15:14 |

### 3. Log sheet (`src/features/log/LogSheet.tsx`)

Extend the `saveLabel` ternary at line 210. When `fromTimerId && !te.ongoing &&
te.endAbs != null`, read ``Stop & save · ended ${fmtClock(te.endAbs)}``.
Otherwise the current "Stop & save" stands.

Keying on `te.endAbs` is exact, and avoids a fuzzy "is the end approximately
now" time comparison. It also leaves the pre-existing "lasted" route reading
plain "Stop & save", unchanged from today.

Add `fmtClock` to the imports; the file does not import it yet.

### 4. Store (`src/store/useAppStore.ts`)

Removing the disclosure leaves `stopTimer`'s `endMs` parameter with no callers.
The new route never touches `stopTimer`: it goes through `save()`, which builds
an entry and drops the timer. Leaving `endMs` would ship an untriggerable second
stop path carrying its own clamping rules, free to drift from the sheet's.
`data/timers.ts:20` records that this feature already left one round of dead code
behind (a persisted `stagedEnd` field), which is the argument against doing it
again.

- Narrow the signature to `stopTimer: (id: string) => void` (`:277`).
- Drop the clamp at `:1935`; `resolvedEnd` becomes `now`.
- Update the comments at `:276` and `:1933` that name the removed editor.

## Testing

- Delete the `stopTimer(id, endMs?)` describe block (`useAppStore.test.ts:1964`).
  It covers only the dead argument.
- Add: timer edit, `setEndedAbs(earlier)`, `save()` creates an entry ending at
  that time, preserving the timer's original start, and removes the timer from
  `timers`.
- Add: timer edit, `setEndedAbs(earlier)`, then the `Still running` chip
  (`setOngoing`), `save()` keeps the timer running and creates no entry.
- Keep the existing coverage of the ongoing route (`save()` to
  `saveTimerDetails`) passing unchanged.

## Out of scope

- The general (non-timer) end panel and its chips.
- The "lasted" route and `setTimerLasted`.
- Server mirroring behaviour, which the entry-creation path already handles.

## Implementation note

Per `AGENTS.md`, check https://docs.expo.dev/versions/v56.0.0/ before writing
code. This change introduces no new Expo API surface: it uses `Pressable`,
`View` and existing in-repo components (`Chip`, `TimeAdjuster`, `Txt`), all
already used in these files.
