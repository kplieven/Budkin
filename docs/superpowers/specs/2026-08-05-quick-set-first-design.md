# Quick set leads the time panels again

Date: 2026-08-05
Status: Implemented
Supersedes: `2026-07-17-time-entry-clock-first-quick-set-design.md`

## Problem

The 2026-07-17 design put the exact `TimeAdjuster` first in each time panel and
demoted the smart anchors to a "Quick set" strip below it. It named the risk it
was taking:

> The risk is that moving the smart anchors below the clock turns them into an
> overlooked footer, since reading order is the strongest discoverability
> signal and demoting the anchors spends it.

The risk landed. The anchors went unused after that change.

The diagnosis is worth recording, because it is not quite "the chips were hard
to find". The panel handed you a complete, editable answer at the top, so the
task was finished before your eye ever reached the chips. That is a
task-completion failure more than a discovery failure, which is why only
sequence fixes it. A louder footer would still be a footer.

## Design

Panel order is now: Quick set strip, then the exact `TimeAdjuster`. Three
changes, all pointing the same way:

1. **Order.** The strip leads, directly under the readout pills.
2. **No "Quick set" caption.** A small dim header over a shelf is how secondary
   content gets marked, which is the wrong signal once the strip leads. Chips
   sitting directly under the value they set need no announcement, and no other
   chip row in the app has one. It also returns about 20px of the roughly 49px
   the reorder costs the clock, which is what keeps most of the 2026-07-17
   below-the-fold win.
3. **Full `Chip` sizing** (`padH 15, padV 10, radius 13, size 14`), replacing
   the compact `StripChip` preset. Not for salience: the difference is 5px of
   height and 1px of type, and it was never going to out-shout a 46px bordered
   input. It goes because "deliberately smaller than the primary controls" is
   now a lie about the hierarchy, and because it removes an exception to the
   app's chip vocabulary. `StripChip` is deleted.

Spacing carries the grouping: the readout's `marginBottom` drops 13 to 10 and
the panels' internal `gap` rises 10 to 14, so the strip reads as part of the
value it sets and the editor sits apart as the escape hatch its own doc comment
already calls it.

### What deliberately did not change

- **The `TimeAdjuster` card keeps its border and background.** Quieting it was
  considered and rejected: that border is what groups the input, the six
  nudges, and the day stepper into one object.
- **No progressive disclosure.** Hiding the clock behind an `Exact…` toggle
  (as the Timers card does) would make the strip the unambiguous only stop, but
  costs a tap on every exact edit, which is the cost the 2026-07-17 design
  existed to remove.
- **Anchor visibility rules, store setters, clamping, `selected` states, and
  label copy.** Untouched. This is presentational.

### The timer-edit End panel

Its caption ("Set an end to stop the timer and log it.") now leads the whole
panel rather than sitting under the clock. It warns that setting an end stops
the timer, and a Quick set chip does exactly that, so it has to precede the
chips as well as the editor. It is grouped tight (`gap 8`) with the strip it
qualifies.

### `TimeAdjuster` margin

`TimeAdjuster` carried its own `marginBottom: 12`, which existed because the
strip always followed it. It is now last in every panel, where that margin was
trailing dead space, so the margin moves out to the callers. `timers.tsx` picks
it up on the wrapper around the `Exact…` adjuster so that card is unchanged.

## Verification

- `npx tsc --noEmit`: no new errors. The 10 `/(tabs)` route-union errors are the
  known stale `.expo/types` artifacts in the primary repo.
- `npx eslint` on the three changed files: clean.
- `npx vitest run`: 2062 passed, 73 files. No test changes were needed, which is
  the expected outcome for a presentational change.
- Expo web plus headless Playwright at a 390px viewport, all four panel shapes.
  Measured that the chips sit above the clock input in each, and that no
  "Quick set" text renders:

  | Panel | chips y | clock input y |
  | --- | --- | --- |
  | Interval Start | 642 | 708 |
  | Interval End | 642 | 708 |
  | Point "When" | 347 | 413 |
  | Timer-edit End | 420 (caption 398) | 486 |

  Chip heights measure 39px, confirming full `Chip` sizing. With four anchors at
  390px the fourth chip starts at x=372 and peeks at the edge, which is the
  intended swipe cue. Timers card action buttons still land at y=483 with
  `Exact…` open, confirming the margin move changed nothing there.
