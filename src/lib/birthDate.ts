/** Local midnight today, epoch ms. The ceiling for any birth date. */
export function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid, non-future local date and convert to
 *  epoch ms (local midnight). Shared by the child sheet and the first-run setup form
 *  so both accept exactly the same input. */
export function clampBirth(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const y = Math.min(now.getFullYear(), Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), midnight());
}

/** How far ahead a due date may sit. Roughly ten months, comfortably past a
 *  full-term pregnancy while still rejecting a typo like the year 2999. */
const MAX_DUE_DAYS = 300;

/** Local midnight MAX_DUE_DAYS from today. Built with setDate rather than by adding
 *  milliseconds: 300 days of ms crosses a DST boundary in most timezones and lands
 *  at 23:00 or 01:00 instead of midnight. */
function dueCeiling(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  d.setDate(d.getDate() + MAX_DUE_DAYS);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid DUE date. Same rules as clampBirth except
 *  the ceiling: up to MAX_DUE_DAYS ahead instead of pinned to today. Past dates pass
 *  through untouched, so an already-overdue pregnancy keeps its real date rather than
 *  being silently rewritten. */
export function clampDueDate(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const maxYear = now.getFullYear() + 2;
  const y = Math.min(maxYear, Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), dueCeiling());
}
