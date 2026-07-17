# Clock-first time panels with a compact "Quick set" strip

Date: 2026-07-17
Status: Approved design, pending implementation plan

## Problem

When editing a start or stop time in the timer-edit sheet, the exact time
controls sit too low. Each editing panel in `src/features/log/TimeEntry.tsx`
renders its smart-anchor chips first as a `flexWrap` row that wraps to two or
three lines (labels like `When last feed ended (2h)` are wide), then the precise
`TimeAdjuster` below. The tall anchor row pushes the clock input down toward or
below the fold.

The user wants the exact controls to appear first, directly under the readout
pills. The risk is that moving the smart anchors below the clock turns them into
an overlooked footer, since reading order is the strongest discoverability
signal and demoting the anchors spends it.

Key reframe (from the user): the real issue is vertical space, not the relative
importance of the anchors. The anchors matter; they are just too tall. If the
anchor row's height is capped, the clock can lead and the anchors can stay fully
visible at the same time. The tension mostly dissolves.

## Goal

Within the affected editing panels:

1. Render the exact `TimeAdjuster` first, directly under the readout pills.
2. Replace the tall wrapping anchor row with a single-line,
   horizontally-scrollable "Quick set" strip whose height is one line
   regardless of how many anchors exist.
3. Keep the anchors discoverable without adding a native dependency.

## Non-goals

- No change to any store setter, selector, anchor-visibility rule, or clamping
  logic. This is a presentational reordering plus a container swap plus copy.
- No new native dependency (no gradient or masked-view library). The repo has
  none, and it is sensitive to declared-but-uninstalled native deps blocking
  `expo start`.
- No touching the two duration ("Lasted") panels (see Scope).

## Design

### Panel layout

Each affected panel's internal order becomes:

1. `TimeAdjuster` (the exact clock field, the `-15m ... +15m` step chips, and,
   in clock mode, the day stepper). Leads the panel.
2. Caption, only where one already exists (the timer-edit End panel). It moves
   to sit just under the clock so it stays tied to the act of setting a time.
3. The "Quick set" strip of smart anchors.

### The "Quick set" strip

- A small dim `Quick set` label (roughly `weight 600`, `size 11.5`,
  `color t.dim`), then a horizontal `ScrollView`
  (`horizontal`, `showsHorizontalScrollIndicator={false}`) containing the
  anchor `Chip`s laid out nowrap with `gap: 8`.
- Discoverability affordance, dependency-free: when the chips overflow the
  width, the `ScrollView` naturally clips the trailing chip so it peeks at the
  right edge. That peek is the honest "there is more, swipe" cue. On React
  Native Web the same overflow behavior produces the same peek. The `Quick set`
  label plus the peek plus the chips' distinct styling carry discovery. A soft
  edge-fade could be layered in later with a translucent `hexA(t.surface)`
  sliver, but it is not required and is out of scope.
- Strip chips are slightly smaller than the primary controls to read as
  secondary shortcuts, using the `Chip` props that already exist:
  `padV={8}`, `padH={12}`, `fontSize={13}`, `radius={11}`. No new component
  is needed for the chips themselves.
- The strip markup and scroll behavior are extracted once into a local
  `QuickSetStrip` helper inside `TimeEntry.tsx`, so all four panels share
  identical behavior and stay DRY. The helper renders the label plus the
  horizontal `ScrollView`; each panel passes its own chips as children.

### Scope: which panels

Apply the clock-first order and the Quick set strip to the four panels that have
a genuine smart-anchor row for a time value:

1. Start panel (`isInterval && editing === 'start'`).
2. Regular End panel (`isInterval && !timerEdit && editing === 'end'`).
3. Timer-edit End panel (`isInterval && timerEdit && editing === 'end'`).
4. Non-interval "When" panel (`!isInterval`).

Excluded:

- Non-timer "Lasted" panel: renders only a `TimeAdjuster`, no chips.
- Timer-edit "Lasted" panel: has only a `Still running` mode toggle, which is
  not a smart anchor, and it edits a duration rather than a clock time.
  Reordering a lone mode toggle buys nothing.

Note on the regular End panel: it renders the `TimeAdjuster` only when
`!te.ongoing`. In clock-first order the adjuster (when present) leads and the
strip follows. When `ongoing`, there is no clock, so only the strip shows, which
is correct.

### Label shortening

Anchor labels get compact copy so more fit per line. Use the existing `·`
middot separator (already used in the file, for example `running · ...`); do not
use em-dashes.

| Today | New |
| --- | --- |
| `When last feed ended (2h)` | `Feed ended · 2h` |
| `When they woke (45m)` | `Woke · 45m` |
| `When last diaper changed (1h)` | `Diaper · 1h` |
| `When last feed started (2h)` | `Feed started · 2h` |
| `When last sleep started (3h)` | `Sleep started · 3h` |

`Now`, `Still running`, and `Still ongoing` stay as they are; they are already
short.

The non-interval "When" panel currently shows anchor labels without an "ago"
value (`When last feed ended`, `When they woke`, `When last diaper changed`).
Shorten these to match the wording above (`Feed ended`, `Woke`, `Diaper`),
keeping their current no-"ago" form unless it reads better with the value; the
implementation plan will pin the exact per-panel strings.

Centralize the shortened copy in small pure helpers in `src/lib/format.ts` so
the wording is consistent across panels and unit-testable in the repo's Vitest
style.

## Testing and verification

- No behavior change: store setters, anchor-visibility selectors, and clamping
  logic are untouched, so the existing `src/store/selectors.test.ts` and
  `src/store/useAppStore.test.ts` stay green.
- The repo's tests are all pure-logic (`.test.ts`) under Vitest; there is no
  component/render-test harness. So the only new automated coverage is Vitest
  tests for the extracted label helpers in `src/lib/format.ts`.
- Functional verification runs the app on web (Expo web plus headless
  Playwright, per the established project recipe): confirm the clock-first order,
  the strip scrolling with a peeking chip when anchors overflow, and the
  shortened labels, in both the timer-edit sheet and a regular interval edit.

## Files touched

- `src/features/log/TimeEntry.tsx`: reorder the four panels, add the local
  `QuickSetStrip` helper, swap the wrapping anchor rows for the strip, apply the
  compact chip props, move the timer-edit End caption under the clock, and use
  the new label helpers.
- `src/lib/format.ts`: add pure helpers for the shortened anchor labels.
- `src/lib/format.test.ts`: cover the new label helpers.

## Implementation notes

- Follow `AGENTS.md`: check the versioned Expo v56 docs before writing code.
  The strip uses React Native's core `ScrollView`, which is stable, but confirm
  any prop details against the pinned version.
- Preserve every existing `selected` state, `onPress` handler, and the
  `endAnchors` / start-anchor derivation exactly; only their container, order,
  size, and label text change.
