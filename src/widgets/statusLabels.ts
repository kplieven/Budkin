/**
 * Pure label logic for the Status widget: the root contentDescription, the four
 * quick-log buttons, and the one header line whose drawn and spoken forms differ.
 *
 * Kept out of `StatusWidget.tsx` because `vitest.config.ts` only matches
 * `.test.ts`: anything living in a component file is untestable by convention
 * here (same reason `napLabels.ts` and `today.ts` exist).
 *
 * Why the tile needs this at all. The widget tree is rasterised to a bitmap
 * before Android ever sees it (`RNWidget.java`: `drawViewToBitmap`, then
 * `setImageViewUri`), so TalkBack can read NOTHING a `TextWidget` draws. Two
 * strings survive, and only two: the ROOT element's `accessibilityLabel`, lifted
 * separately by `WidgetFactory.buildWidgetFromRoot` and applied with
 * `setContentDescription`, and the label on any element that ALSO carries a
 * `clickAction`, read inside the `hasKey("clickAction")` branch of
 * `WidgetFactory.buildWidget`. A label on a plain `TextWidget` is silently
 * dropped. So a 2x3 tile showing a baby's whole day has exactly five strings to
 * work with: the root, and the four buttons.
 *
 * Everything the root says is built from the same VALUES the tile draws from,
 * never from a second reading of the snapshot. Where the two forms differ, both
 * come out of this module from one input, which is the `napLabels` and
 * `childAttribution` shape: `sideText` here is the drawn line and the root's
 * clause is the spoken one, from a single `side`.
 *
 * They differ wherever the bitmap's constraints are not speech's:
 *
 *  - the drawn " · " becomes ", ", because a screen reader announcing "middle
 *    dot" is noise and a comma is the pause the dot stands for
 *    (`childAttribution`'s reasoning);
 *  - a row whose value is the tile's placeholder is dropped, not spoken, since
 *    a lone dash announces as "dash" or as nothing;
 *  - the compact durations are expanded, because "1h18m ago" is one unspaced
 *    token an engine reads as "one h eighteen m ago" and the compaction exists
 *    only to fit a width speech does not have;
 *  - the name is never capped, for the same reason `napLabels` caps only the
 *    name it DRAWS: a contentDescription has no width.
 */

import { fmtAgoShort } from '@/lib/format';

/** The four quick-log buttons, in the order the tile draws them. */
export type StatusButton = 'feeding' | 'diaper' | 'sleep' | 'timer';

export interface StatusLabels {
  /** the header's next-side line, for the tile to DRAW */
  sideText: string;
  /** the root contentDescription: the tile read top to bottom */
  root: string;
  /** each button's contentDescription, harvested because they carry a clickAction */
  buttons: Record<StatusButton, string>;
}

/**
 * The app's own name, used for the header when no child matches and for the
 * root's action hint. A literal rather than `Constants.expoConfig?.name` so this
 * module stays pure and reachable from vitest; the development variant ships a
 * different display name, but a screen-reader user with both installed is told
 * apart by the launcher, not by this tile.
 */
const APP_NAME = 'Budkin';

/**
 * The tile's header name. Exported because `StatusWidget` DRAWS this same value:
 * one source, so the header a sighted user reads and the one a screen reader
 * hears cannot diverge. `buildWidgetSnapshot` writes '' whenever no child
 * matches the selected id, and an empty accessible name is worse than no name at
 * all, so the fallback is not optional.
 */
export function widgetTitle(childName: string | undefined): string {
  return childName || APP_NAME;
}

/**
 * Whole minutes between `ms` and `now`, or null when there is no timestamp.
 *
 * The one place the arithmetic happens: the drawn value and the spoken one are
 * two renderings of THIS integer, so they cannot disagree about the fact. Floored
 * at zero because an entry can carry a start the user set ahead of the clock, and
 * neither "-1m ago" nor "minus one minutes ago" is ever right; `fmtAgoShort` and
 * `fmtDur` floor for the same reason.
 */
export function agoMinutes(ms: number | null | undefined, now: number): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.round((now - ms) / 60000));
}

/** A stat row's drawn "x ago", or null when there is nothing to measure. */
export function agoValue(min: number | null): string | null {
  return min == null ? null : `${fmtAgoShort(min)} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * A span of minutes in words: "30 minutes", "1 hour", "3 hours 20 minutes".
 *
 * The spoken counterpart of `fmtDur`, rounding the same way so the tile and the
 * label render one total identically. Stops at hours because `fmtDur` does and
 * because nothing here spans a day: the sleep figure is one rhythm window,
 * capped at 24 hours by construction.
 */
export function spokenDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return plural(m, 'minute');
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${plural(h, 'hour')} ${plural(rest, 'minute')}` : plural(h, 'hour');
}

/**
 * How long ago, in words: the spoken counterpart of `agoValue`.
 *
 * The branch shape is `fmtAgo`'s (`src/lib/format.ts`), which is not reusable
 * directly because it is abbreviated too. It differs in one place: past a day
 * this drops the hour remainder, because "3 days 4 hours ago" is more precision
 * than a reading that old can carry.
 */
export function spokenAgo(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m === 0) return 'just now';
  if (m < 1440) return `${spokenDur(m)} ago`;
  return `${plural(Math.floor(m / 1440), 'day')} ago`;
}

/**
 * What each button's tap does, lowercase so it can sit after a name.
 *
 * The wording is the launcher shortcuts' `longLabel` (`plugins/quickLogShortcuts.js`),
 * which fires the same three deep links, so the same action is described the
 * same way wherever the user meets it. The timer button has no shortcut and
 * matches `src/app/timer.tsx`, which starts a timer and opens the Timers screen.
 */
const BUTTON_ACTION: Record<StatusButton, string> = {
  feeding: 'log a feed',
  diaper: 'log a diaper change',
  sleep: 'log sleep',
  timer: 'start a timer',
};

/** The row labels, drawn by `StatusWidget` and spoken here from this one source. */
export const ROW_LABEL = { fed: 'Fed', sleep: 'Sleep', diaper: 'Diaper' } as const;

/** The drawn separator spoken as the pause it stands for, per `childAttribution`. */
function spoken(drawn: string): string {
  return drawn.split(' · ').join(', ');
}

/** Sentence case, so a clause lifted out of the tile can start one. */
function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Every string a screen reader can reach on the Status tile, plus the one line
 * the tile draws differently from how it says it.
 *
 * The root names the child unconditionally, the buttons only from two children
 * up. That is not an inconsistency, it is the same drawn/spoken parity rule
 * applied twice: the header DRAWS the name, so the root speaks it; the buttons
 * draw only "Feed" or "Sleep", and a name there is attribution, which
 * `attributionFor` keeps silent when the answer is never in doubt. From two
 * children up it stops being cosmetic: `buttonUri` stamps each deep link with
 * the child the bitmap was drawn for, and with a frozen bitmap and a 30-minute
 * refresh floor the selection can have moved on since, so the name is the only
 * warning that a tap will log against someone other than the current child.
 */
export function statusLabels(opts: {
  /** the selected child's first name, '' when no child matches */
  childName: string | undefined;
  /** how many children the device holds, undefined in a snapshot written before the field existed */
  childCount: number | undefined;
  /** the header's age line, exactly as drawn, '' when the tile draws none */
  age: string;
  /** which breast the next feed begins on; both the drawn and the spoken form come from this.
   *  null when there is no snapshot at all, i.e. nothing is known yet. The tile still DRAWS
   *  `start Left`, because `nextStartSide` defaults there, but the label refuses to speak a
   *  default as though it were a fact. */
  side: 'left' | 'right' | null;
  /** selected child not born yet, which is what silences the side clause */
  expected: boolean;
  /** minutes since the last feed and the last change, null where the tile draws its placeholder */
  fedMin: number | null;
  diaperMin: number | null;
  /** the window's sleep total in minutes, null where the tile draws its placeholder */
  sleepMin: number | null;
  /** a nap is running, the signal the drawn value carries after its separator */
  napping: boolean;
  /** the summary line under the rows, exactly as drawn */
  today: string;
}): StatusLabels {
  const sideText = `start ${opts.side === 'right' ? 'Right' : 'Left'}`;
  // Spoken in full rather than as the drawn shorthand. "start Left" is legible
  // on the tile only because it is drawn in the feed colour directly above a Fed
  // row in that same colour, and because Home draws the identical fact inside
  // the feeding card; speech keeps none of those, and TalkBack flattens the
  // capital, leaving "start left" to parse as an imperative missing its object.
  //
  // Dropped outright for a child who is not born, who has no next feed, and when
  // there is no snapshot at all, where `left` is `nextStartSide`'s default rather
  // than anything the app knows. The tile draws the line in both cases, but a
  // label that already drops placeholder rows is being consistent here, not
  // making an exception: the empty tile draws dashes for every other row, and
  // this is the one place a default would read as data.
  const sideClause = opts.expected || opts.side == null ? '' : `next feed on the ${opts.side}`;
  const header = [widgetTitle(opts.childName), opts.age, sideClause].filter(Boolean).join(', ');
  const rows = [
    opts.fedMin != null ? `${ROW_LABEL.fed} ${spokenAgo(opts.fedMin)}` : null,
    // The napping signal rides on the value, exactly as it does on the tile: a
    // label reading "Napping" beside a whole-window total would claim to BE the
    // nap's length. See `widgetToday`.
    opts.sleepMin != null ? `${ROW_LABEL.sleep} ${spokenDur(opts.sleepMin)}${opts.napping ? ', napping' : ''}` : null,
    opts.diaperMin != null ? `${ROW_LABEL.diaper} ${spokenAgo(opts.diaperMin)}` : null,
  ].filter((r): r is string => r != null);
  // One clause per drawn line, in drawn order, each its own sentence so the
  // reader pauses between them. The tap is named last, matching the app's own
  // "..., view timers" and "..., switch child" labels.
  const root = [header, ...rows, opts.today, `Open ${APP_NAME}`]
    .map((part) => `${sentence(spoken(part))}.`)
    .join(' ');

  const named = (opts.childCount ?? 1) >= 2 ? (opts.childName ?? '') : '';
  const button = (kind: StatusButton) =>
    named ? `${named}, ${BUTTON_ACTION[kind]}` : sentence(BUTTON_ACTION[kind]);

  return {
    sideText,
    root,
    buttons: { feeding: button('feeding'), diaper: button('diaper'), sleep: button('sleep'), timer: button('timer') },
  };
}
