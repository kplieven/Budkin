import { describe, expect, it } from 'vitest';

import { agoMinutes, agoValue, spokenAgo, spokenDur, statusLabels, widgetTitle } from '@/widgets/statusLabels';

/** A full tile: born child, a nap running, activity on the board. */
const full = {
  childName: 'Ada',
  childCount: 1,
  age: '3 months old',
  side: 'left' as const,
  expected: false,
  fedMin: 120,
  sleepMin: 200,
  napping: true,
  diaperMin: 45,
  today: 'since midnight · 4 feeds · 5 changes',
};

/** The tile with no snapshot behind it: every row draws the placeholder, and the
 *  side is unknown rather than left. */
const empty = {
  childName: undefined,
  childCount: undefined,
  age: '',
  side: null,
  expected: false,
  fedMin: null,
  sleepMin: null,
  napping: false,
  diaperMin: null,
  today: 'since midnight · 0 feeds · 0 changes',
};

describe('statusLabels drawn side line', () => {
  it('is what the tile has always drawn, for either side', () => {
    expect(statusLabels(full).sideText).toBe('start Left');
    expect(statusLabels({ ...full, side: 'right' }).sideText).toBe('start Right');
  });

  // The tile keeps drawing it for an expected child; only the spoken clause goes.
  it('survives for an expected child, whose root label drops the clause', () => {
    expect(statusLabels({ ...full, expected: true }).sideText).toBe('start Left');
  });
});

describe('statusLabels root label', () => {
  it('reads the tile top to bottom, then names the tap', () => {
    expect(statusLabels(full).root).toBe(
      'Ada, 3 months old, next feed on the left. Fed 2 hours ago. Sleep 3 hours 20 minutes, napping. Diaper 45 minutes ago. Since midnight, 4 feeds, 5 changes. Open Budkin.',
    );
  });

  // "start Left" is legible only because it is drawn in the feed colour above a
  // Fed row in that same colour. Speech keeps none of that, and a flattened
  // "start left" parses as an imperative missing its object.
  it('says which side the next feed begins on, not the drawn shorthand', () => {
    expect(statusLabels(full).root).toContain('Ada, 3 months old, next feed on the left.');
    expect(statusLabels({ ...full, side: 'right' }).root).toContain('next feed on the right.');
    expect(statusLabels(full).root).not.toContain('start Left');
  });

  it('names the child in a one-child household too, because the tile draws the name', () => {
    expect(statusLabels({ ...full, childCount: 2 }).root).toBe(statusLabels(full).root);
  });

  it('speaks the drawn middle dot as the pause it stands for', () => {
    const root = statusLabels(full).root;
    expect(root).not.toContain('·');
    expect(root).toContain('Since midnight, 4 feeds, 5 changes.');
  });

  it('carries the napping signal on the sleep row, as the tile does', () => {
    expect(statusLabels(full).root).toContain('Sleep 3 hours 20 minutes, napping.');
    expect(statusLabels({ ...full, napping: false }).root).toContain('Sleep 3 hours 20 minutes.');
  });

  it('drops a row the tile has no value for rather than speaking the placeholder', () => {
    expect(statusLabels({ ...full, fedMin: null }).root).toBe(
      'Ada, 3 months old, next feed on the left. Sleep 3 hours 20 minutes, napping. Diaper 45 minutes ago. Since midnight, 4 feeds, 5 changes. Open Budkin.',
    );
  });

  it('falls back to the app name when no child matches, never to an empty name', () => {
    expect(statusLabels({ ...full, childName: '' }).root).toContain('Budkin, 3 months old, next feed on the left.');
  });

  it('omits the age clause when the tile draws none', () => {
    expect(statusLabels(empty).root).toBe('Budkin. Since midnight, 0 feeds, 0 changes. Open Budkin.');
  });

  // `nextStartSide` defaults to left with nothing to go on, so the tile draws
  // `start Left` on an empty tile. Speaking it would present that default as a
  // fact, on the one tile where every other row is honestly a placeholder.
  it('does not speak a side it does not know, though the tile still draws one', () => {
    const labels = statusLabels(empty);
    expect(labels.root).not.toContain('next feed');
    expect(labels.sideText).toBe('start Left');
  });

  it('still speaks the side once a snapshot supplies one', () => {
    expect(statusLabels({ ...empty, side: 'right' as const }).root).toContain('next feed on the right');
  });

  // A child who is not born has no next feed. The tile draws the line anyway,
  // but this label already drops rows the tile draws.
  it('drops the side clause entirely for an expected child', () => {
    expect(statusLabels({ ...empty, childName: 'Wren', childCount: 2, age: 'Due in 3 weeks', expected: true }).root).toBe(
      'Wren, Due in 3 weeks. Since midnight, 0 feeds, 0 changes. Open Budkin.',
    );
  });

  it('speaks the awkward durations in full words', () => {
    expect(statusLabels({ ...full, fedMin: 78, sleepMin: 200, diaperMin: 4320 }).root).toContain(
      'Fed 1 hour 18 minutes ago. Sleep 3 hours 20 minutes, napping. Diaper 3 days ago.',
    );
  });

  // A contentDescription has no width, so there is nothing to save by cutting it.
  it('never truncates the name', () => {
    expect(statusLabels({ ...full, childName: 'Bartholomew-Alexander' }).root).toContain('Bartholomew-Alexander, 3 months old');
  });
});

describe('statusLabels buttons with one child', () => {
  it('says what each tap logs, unnamed', () => {
    expect(statusLabels(full).buttons).toEqual({
      feeding: 'Log a feed',
      diaper: 'Log a diaper change',
      sleep: 'Log sleep',
      timer: 'Start a timer',
    });
  });
});

describe('statusLabels buttons with a sibling', () => {
  it('names the child the button will log against', () => {
    expect(statusLabels({ ...full, childCount: 2 }).buttons).toEqual({
      feeding: 'Ada, log a feed',
      diaper: 'Ada, log a diaper change',
      sleep: 'Ada, log sleep',
      timer: 'Ada, start a timer',
    });
  });

  it('names the child in a household of three', () => {
    expect(statusLabels({ ...full, childCount: 3 }).buttons.feeding).toBe('Ada, log a feed');
  });

  it('never truncates the name', () => {
    expect(statusLabels({ ...full, childName: 'Bartholomew-Alexander', childCount: 2 }).buttons.sleep).toBe(
      'Bartholomew-Alexander, log sleep',
    );
  });
});

describe('statusLabels buttons fall back to unnamed', () => {
  // A snapshot written before `childCount` existed still parses, so the count
  // arrives undefined until the app next writes. Saying less is the safe direction.
  it('when the count is missing, even with a name', () => {
    expect(statusLabels({ ...full, childCount: undefined }).buttons.feeding).toBe('Log a feed');
  });

  // `buildWidgetSnapshot` writes '' when no child matches the selected id.
  it('when the name is empty', () => {
    expect(statusLabels({ ...full, childName: '', childCount: 2 }).buttons.timer).toBe('Start a timer');
  });

  it('when the device holds no children', () => {
    expect(statusLabels({ ...empty, childName: 'Ada', childCount: 0 }).buttons.diaper).toBe('Log a diaper change');
  });
});

describe('widgetTitle', () => {
  it('is the child name when there is one', () => {
    expect(widgetTitle('Ada')).toBe('Ada');
  });

  it('is the app name when there is not', () => {
    expect(widgetTitle('')).toBe('Budkin');
    expect(widgetTitle(undefined)).toBe('Budkin');
  });
});

describe('agoMinutes', () => {
  const now = 1_700_000_000_000;

  it('is null when there is no timestamp, so both readers can say nothing', () => {
    expect(agoMinutes(null, now)).toBeNull();
    expect(agoMinutes(undefined, now)).toBeNull();
  });

  it('counts whole minutes back from now', () => {
    expect(agoMinutes(now - 45 * 60000, now)).toBe(45);
    expect(agoMinutes(now - 78 * 60000, now)).toBe(78);
  });

  // An entry can carry a start the user set ahead of the clock, and "-1m ago" is
  // never the right thing to show. Same floor `fmtAgoShort` and `fmtDur` apply.
  it('floors a timestamp in the future at zero', () => {
    expect(agoMinutes(now + 5 * 60000, now)).toBe(0);
  });
});

describe('agoValue draws what the tile has always drawn', () => {
  it('is null when there is nothing to measure, so the caller can draw its placeholder', () => {
    expect(agoValue(null)).toBeNull();
  });

  it('keeps the compact form the bitmap needs', () => {
    expect(agoValue(45)).toBe('45m ago');
    expect(agoValue(78)).toBe('1h18m ago');
    expect(agoValue(4320)).toBe('3d ago');
    expect(agoValue(0)).toBe('0m ago');
  });
});

// The compact forms exist only because the bitmap has a width. A
// contentDescription has none, and "1h18m ago" is one unspaced token a speech
// engine reads as "one h eighteen m ago".
describe('spokenAgo', () => {
  it('says just now for the current minute', () => {
    expect(spokenAgo(0)).toBe('just now');
  });

  it('counts minutes, singular and plural', () => {
    expect(spokenAgo(1)).toBe('1 minute ago');
    expect(spokenAgo(45)).toBe('45 minutes ago');
    expect(spokenAgo(59)).toBe('59 minutes ago');
  });

  it('counts hours, dropping a zero minute remainder', () => {
    expect(spokenAgo(60)).toBe('1 hour ago');
    expect(spokenAgo(120)).toBe('2 hours ago');
    expect(spokenAgo(78)).toBe('1 hour 18 minutes ago');
    expect(spokenAgo(121)).toBe('2 hours 1 minute ago');
  });

  it('counts whole days past a day, without an hour remainder', () => {
    expect(spokenAgo(1440)).toBe('1 day ago');
    expect(spokenAgo(4320)).toBe('3 days ago');
    expect(spokenAgo(4500)).toBe('3 days ago');
  });
});

describe('spokenDur', () => {
  it('says a zero total as a zero, matching what the tile draws', () => {
    expect(spokenDur(0)).toBe('0 minutes');
  });

  it('counts minutes, singular and plural', () => {
    expect(spokenDur(1)).toBe('1 minute');
    expect(spokenDur(30)).toBe('30 minutes');
  });

  it('counts hours, dropping a zero minute remainder', () => {
    expect(spokenDur(60)).toBe('1 hour');
    expect(spokenDur(200)).toBe('3 hours 20 minutes');
  });

  // `widgetToday` hands over a float; the drawn `fmtDur` rounds it, so this must
  // round the same way or the two disagree about the same total.
  it('rounds the way fmtDur does', () => {
    expect(spokenDur(199.6)).toBe('3 hours 20 minutes');
  });
});
