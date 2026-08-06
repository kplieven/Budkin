/**
 * Six weeks of plausible logging behind the demo seed's single day.
 *
 * `makeSeed` covers today richly, which is enough to explore the app but not to
 * photograph it: Insights asks for about a week of sleep before it draws the
 * rhythm heatmap, its trend charts want a few days, and a growth curve needs
 * more than one point. Captured against the bare seed, those screens show empty
 * states, which is the opposite of what a store listing should say.
 *
 * Screenshot tooling only. Nothing here ships in the app, and it never touches
 * a Baby Buddy server: the output is written to local storage as Local mode data.
 *
 * Deterministic on purpose (fixed-seed PRNG): re-running the capture must not
 * silently change what the screenshots show.
 */

import { MILESTONE_BY_KEY } from '@/lib/milestones';
import { entryTimestamp, type Entry, type Measurement } from '@/types/models';

const M = 60000;
const HOUR = 3600000;
const DAY = 86400000;

/** mulberry32: small, fast, and identical across runs. */
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export interface History {
  entries: Entry[];
  measurements: Measurement[];
}

/**
 * @param now    the instant the seed is built at (see buildFixture.ts)
 * @param childId whose history this is
 * @param birth  the child's birth, for the growth series
 * @param days   how many days BEFORE today to fill; today is left to `makeSeed`
 */
export function makeHistory(now: number, childId: string, birth: number, days = 42): History {
  const rand = rng(0x8ad10c);
  const jitter = (mins: number) => Math.round((rand() * 2 - 1) * mins) * M;
  const pick = <T,>(xs: T[]) => xs[Math.floor(rand() * xs.length)];

  const entries: Entry[] = [];
  let n = 0;
  const id = () => `h${++n}`;

  const midnight = (d: number) => {
    const x = new Date(now - d * DAY);
    x.setHours(0, 0, 0, 0);
    return x.getTime();
  };

  /**
   * Today is generated too, but only up to four hours ago. Leaving today empty
   * made the "total sleep per day" trend plunge to nothing on its last point,
   * which reads as a broken chart rather than a day still in progress. The
   * four-hour margin keeps the seed's own afternoon entries the most recent
   * ones, so the home screen still says what it was written to say.
   */
  const cutoff = now - 4 * HOUR;

  for (let d = 0; d <= days; d++) {
    const day = midnight(d);

    // Night sleep, logged as one stretch that runs into the next morning.
    const nightStart = day + 19 * HOUR + 40 * M + jitter(35);
    entries.push({
      id: id(), childId, type: 'sleep', nap: false, tags: [],
      start: nightStart,
      end: nightStart + 10 * HOUR + 20 * M + jitter(70),
    });

    // Three naps, shorter and later as the weeks go by.
    for (const [h, m] of [[9, 15], [12, 10], [15, 40]] as const) {
      const start = day + h * HOUR + m * M + jitter(30);
      entries.push({
        id: id(), childId, type: 'sleep', nap: true, tags: [],
        start,
        // Long enough that the day's total lands inside the typical-range band
        // the app draws, so Insights reads "in typical range" rather than below it.
        end: start + (55 + Math.round(rand() * 55)) * M,
      });
    }

    // Roughly three-hourly feeds, mostly breast, one evening bottle.
    let side: 'left' | 'right' = d % 2 ? 'left' : 'right';
    for (let i = 0; i < 7; i++) {
      const start = day + (6 * HOUR + 45 * M) + i * (2 * HOUR + 50 * M) + jitter(25);
      if (start > now) break;
      const bottle = i === 5;
      side = side === 'left' ? 'right' : 'left';
      entries.push(
        bottle
          ? { id: id(), childId, type: 'feeding', tags: [], start, end: start + (14 + Math.round(rand() * 8)) * M, feedType: 'formula', method: 'bottle', amount: 90 + Math.round(rand() * 5) * 10 }
          : { id: id(), childId, type: 'feeding', tags: [], start, end: start + (12 + Math.round(rand() * 13)) * M, feedType: 'breast', method: side, amount: null },
      );
    }

    // Diapers, a couple of them solid.
    for (let i = 0; i < 7; i++) {
      const time = day + (7 * HOUR + 10 * M) + i * (2 * HOUR + 20 * M) + jitter(30);
      if (time > now) break;
      const solid = i === 1 || i === 5;
      entries.push({
        id: id(), childId, type: 'diaper', tags: [], time,
        wet: true, solid, color: solid ? pick(['yellow', 'brown'] as const) : null,
      });
    }

    // A pumping session or two.
    const pumpStart = day + 21 * HOUR + jitter(40);
    entries.push({
      id: id(), childId, type: 'pumping', tags: [],
      start: pumpStart, end: pumpStart + (15 + Math.round(rand() * 6)) * M,
      amount: 70 + Math.round(rand() * 4) * 10,
    });

    // Daily tummy time.
    const tummyStart = day + 10 * HOUR + 30 * M + jitter(45);
    entries.push({
      id: id(), childId, type: 'tummy', tags: [],
      start: tummyStart, end: tummyStart + (5 + Math.round(rand() * 8)) * M,
    });

    // Baths: the seed owns the last four days (its own full/quick rhythm), so
    // only fill in behind it, keeping the same every-third-day cadence.
    if (d >= 5) {
      entries.push({
        id: id(), childId, type: 'bath', tags: [],
        time: day + 18 * HOUR + 30 * M + jitter(20),
        wash: d % 3 === 1 ? 'full' : 'quick',
      });
    }

    // The occasional temperature check.
    if (d % 11 === 0) {
      entries.push({
        id: id(), childId, type: 'temperature', tags: [],
        time: day + 17 * HOUR + jitter(60),
        value: Number((36.5 + rand() * 0.6).toFixed(1)),
      });
    }
  }

  // A few notes at daytime hours. The seed's own two land at whatever offset
  // from `now` it hardcodes (one of them in the small hours), and two entries
  // leave most of the Notes tab empty.
  const notes: [string, number][] = [
    ['Slept through from 20:30 to 06:15 for the first time. We both cried.', now - 1 * DAY - 3 * HOUR],
    ['Health visitor came by, happy with the weight. Next check in a month.', now - 3 * DAY - 2 * HOUR],
    ['Found her hands today and would not stop staring at them.', now - 5 * DAY - 4 * HOUR],
    ['Switched to the bigger bottle teat, much less fussing after feeds.', now - 8 * DAY - 5 * HOUR],
  ];
  for (const [text, time] of notes) {
    entries.push({ id: id(), childId, type: 'note', tags: [], text, time });
  }

  // Reached milestones, plausible for a twelve-week-old. `first-laugh` is dated
  // today so it lines up with the seed's own "first real giggle" note.
  const milestones: [string, number][] = [
    ['lifts-head', now - 33 * DAY],
    ['first-smile', now - 26 * DAY],
    ['coos', now - 9 * DAY],
    ['first-laugh', now - 2 * HOUR],
  ];
  for (const [key, time] of milestones) {
    entries.push({ id: id(), childId, type: 'milestone', tags: [], key, time, text: MILESTONE_BY_KEY[key].title });
  }

  // Weekly weight, fortnightly length and head, from birth up to the values the
  // seed already reports for the last few days.
  const measurements: Measurement[] = [];
  let mi = 0;
  const mid = () => `hm${++mi}`;
  const ageDays = Math.round((now - birth) / DAY);
  for (let d = 0; d <= ageDays - 3; d += 7) {
    const t = birth + d * DAY;
    const k = d / ageDays;
    measurements.push({ id: mid(), childId, kind: 'weight', value: Number((3.35 + k * 1.8 + (rand() - 0.5) * 0.06).toFixed(2)), date: t });
    if (d % 14 === 0) {
      measurements.push({ id: mid(), childId, kind: 'height', value: Number((50 + k * 7.6).toFixed(1)), date: t });
      measurements.push({ id: mid(), childId, kind: 'head', value: Number((34.8 + k * 4).toFixed(1)), date: t });
    }
  }

  return {
    // Anything the day loop generated past the cutoff (tonight's sleep, this
    // evening's pumping) belongs to a day that has not happened yet.
    entries: entries.filter((e) => e.type === 'milestone' || e.type === 'note' || entryTimestamp(e) <= cutoff),
    measurements,
  };
}
