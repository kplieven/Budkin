/**
 * Pure label logic for the Status widget.
 *
 * The widget tree is rasterised to a bitmap before Android ever sees it
 * (`RNWidget.java`: `drawViewToBitmap`, then `setImageViewUri`), so TalkBack can read
 * NOTHING a `TextWidget` draws. Two kinds of string survive: the ROOT element's
 * `accessibilityLabel`, lifted separately by `WidgetFactory.buildWidgetFromRoot`, and
 * the label on any element that ALSO carries a `clickAction`. A label on a plain
 * `TextWidget` is silently dropped. So the whole tile has five strings to work with:
 * the root and the four buttons.
 *
 * The root is built from the same VALUES the tile draws from, never a second reading of
 * the snapshot, and differs only where the bitmap's constraints are not speech's.
 */

import { fmtAgoShort } from '@/lib/format';

export type StatusButton = 'feeding' | 'diaper' | 'sleep' | 'timer';

export interface StatusLabels {
  /** the header's next-side line, for the tile to DRAW */
  sideText: string;
  /** the root contentDescription: the tile read top to bottom */
  root: string;
  /** each button's contentDescription, harvested because they carry a clickAction */
  buttons: Record<StatusButton, string>;
}

/** A literal rather than `Constants.expoConfig?.name` so this module stays pure. */
const APP_NAME = 'Budkin';

/**
 * Exported because `StatusWidget` draws this same value, so the drawn header and the
 * spoken one cannot diverge. `buildWidgetSnapshot` writes '' when no child matches, and
 * an empty accessible name is worse than none, so the fallback is not optional.
 */
export function widgetTitle(childName: string | undefined): string {
  return childName || APP_NAME;
}

/** The drawn value and the spoken one are two renderings of this integer. Floored at
 *  zero because an entry can carry a start the user set ahead of the clock. */
export function agoMinutes(ms: number | null | undefined, now: number): number | null {
  if (ms == null) return null;
  return Math.max(0, Math.round((now - ms) / 60000));
}

export function agoValue(min: number | null): string | null {
  return min == null ? null : `${fmtAgoShort(min)} ago`;
}

function plural(n: number, unit: string): string {
  return `${n} ${unit}${n === 1 ? '' : 's'}`;
}

/**
 * The spoken counterpart of `fmtDur`, rounding the same way so the tile and the label
 * render one total identically. Stops at hours because the sleep figure is one rhythm
 * window, capped at 24 hours by construction.
 */
export function spokenDur(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m < 60) return plural(m, 'minute');
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${plural(h, 'hour')} ${plural(rest, 'minute')}` : plural(h, 'hour');
}

/**
 * The spoken counterpart of `agoValue`. Past a day this drops the hour remainder, where
 * `fmtAgo` keeps it: "3 days 4 hours ago" is more precision than a reading that old can
 * carry.
 */
export function spokenAgo(min: number): string {
  const m = Math.max(0, Math.round(min));
  if (m === 0) return 'just now';
  if (m < 1440) return `${spokenDur(m)} ago`;
  return `${plural(Math.floor(m / 1440), 'day')} ago`;
}

/**
 * Lowercase so it can sit after a name. The wording is the launcher shortcuts'
 * `longLabel` (`plugins/quickLogShortcuts.js`), which fires the same deep links.
 */
const BUTTON_ACTION: Record<StatusButton, string> = {
  feeding: 'log a feed',
  diaper: 'log a diaper change',
  sleep: 'log sleep',
  timer: 'start a timer',
};

/** Drawn by `StatusWidget` and spoken here from this one source. */
export const ROW_LABEL = { fed: 'Fed', sleep: 'Sleep', diaper: 'Diaper' } as const;

/** The drawn separator spoken as the pause it stands for, per `childAttribution`. */
function spoken(drawn: string): string {
  return drawn.split(' · ').join(', ');
}

function sentence(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * Every string a screen reader can reach on the Status tile, plus the one line the tile
 * draws differently from how it says it.
 *
 * The root names the child unconditionally, the buttons only from two children up.
 * There it stops being cosmetic: `buttonUri` stamps each deep link with the child the
 * bitmap was drawn for, and with a frozen bitmap and a 30-minute refresh floor the
 * selection can have moved on since, so the name is the only warning that a tap will log
 * against someone else.
 */
export function statusLabels(opts: {
  childName: string | undefined;
  /** undefined in a snapshot written before the field existed */
  childCount: number | undefined;
  /** the header's age line, exactly as drawn, '' when the tile draws none */
  age: string;
  /** null when there is no snapshot at all: the tile still DRAWS `start Left` because
   *  `nextStartSide` defaults there, but the label refuses to speak a default as fact. */
  side: 'left' | 'right' | null;
  /** selected child not born yet, which is what silences the side clause */
  expected: boolean;
  /** null where the tile draws its placeholder */
  fedMin: number | null;
  diaperMin: number | null;
  sleepMin: number | null;
  napping: boolean;
  /** the summary line under the rows, exactly as drawn */
  today: string;
}): StatusLabels {
  const sideText = `start ${opts.side === 'right' ? 'Right' : 'Left'}`;
  // Spoken in full rather than as the drawn shorthand. "start Left" is legible on the
  // tile only because it is drawn in the feed colour above a Fed row in that colour, and
  // TalkBack flattens the capital, leaving "start left" to parse as an imperative
  // missing its object.
  const sideClause = opts.expected || opts.side == null ? '' : `next feed on the ${opts.side}`;
  const header = [widgetTitle(opts.childName), opts.age, sideClause].filter(Boolean).join(', ');
  const rows = [
    opts.fedMin != null ? `${ROW_LABEL.fed} ${spokenAgo(opts.fedMin)}` : null,
    // The napping signal rides on the value, as it does on the tile: a label reading
    // "Napping" beside a whole-window total would claim to BE the nap's length.
    opts.sleepMin != null ? `${ROW_LABEL.sleep} ${spokenDur(opts.sleepMin)}${opts.napping ? ', napping' : ''}` : null,
    opts.diaperMin != null ? `${ROW_LABEL.diaper} ${spokenAgo(opts.diaperMin)}` : null,
  ].filter((r): r is string => r != null);
  // One clause per drawn line, in drawn order, each its own sentence so the reader
  // pauses between them.
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
