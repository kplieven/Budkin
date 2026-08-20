/**
 * Month-grid math for the inline day picker. Pure, and local-time throughout:
 * every date is built from local parts, so the cell labelled 3 is the 3rd
 * wherever the user is, and its timestamp is that day's local midnight.
 */

export interface MonthCell {
  /** local midnight of the day this cell stands for */
  ms: number;
  day: number;
  /** false for the neighbouring-month days that pad the grid out to whole weeks */
  inMonth: boolean;
}

/** Monday-first, matching the DD/MM/YYYY dates the app writes elsewhere. */
export const WEEKDAY_INITIALS = ['M', 'T', 'W', 'T', 'F', 'S', 'S'];

const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

/** Local midnight on the 1st of the month containing `ms`. */
export function startOfMonth(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), 1).getTime();
}

/** Local midnight of the day containing `ms`. */
export function startOfDay(ms: number): number {
  const d = new Date(ms);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

/** Step a month anchor by whole months. Feed it a `startOfMonth` value: day-of-month
 *  is dropped, so Jan 31 + 1 month is Feb 1 rather than rolling into March. */
export function addMonths(monthMs: number, delta: number): number {
  const d = new Date(monthMs);
  return new Date(d.getFullYear(), d.getMonth() + delta, 1).getTime();
}

export function monthLabel(monthMs: number): string {
  const d = new Date(monthMs);
  return `${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
}

/**
 * The six-week grid for the month containing `monthMs`, padded with the
 * neighbouring months' days. Always 42 cells: a fixed height means opening the
 * picker on a 4-row February and paging to a 6-row March does not shove the
 * buttons under it up and down.
 */
export function monthGrid(monthMs: number): MonthCell[] {
  const first = new Date(startOfMonth(monthMs));
  const year = first.getFullYear();
  const month = first.getMonth();
  const lead = (first.getDay() + 6) % 7; // getDay is Sunday-first; the grid is not

  const cells: MonthCell[] = [];
  for (let i = 0; i < 42; i++) {
    const d = new Date(year, month, i - lead + 1);
    cells.push({ ms: d.getTime(), day: d.getDate(), inMonth: d.getMonth() === month });
  }
  return cells;
}

/** The date of `dayMs` carrying the time-of-day of `timeMs` — what picking a day
 *  in the calendar means: move the entry, keep the clock reading. */
export function withDate(timeMs: number, dayMs: number): number {
  const t = new Date(timeMs);
  const d = new Date(dayMs);
  return new Date(d.getFullYear(), d.getMonth(), d.getDate(), t.getHours(), t.getMinutes(), t.getSeconds(), t.getMilliseconds()).getTime();
}
