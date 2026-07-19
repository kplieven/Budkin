/** Local midnight today, epoch ms. The ceiling for any birth date. */
export function midnight(): number {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d.getTime();
}

/** Clamp raw Y/M/D text fields to a valid, non-future local date and convert
 *  to epoch ms (local midnight). No date-picker dependency, just numeric
 *  TextInputs validated on save. Shared by the child sheet and the first-run
 *  setup form so both accept exactly the same input. */
export function clampBirth(yStr: string, mStr: string, dStr: string): number {
  const now = new Date();
  const y = Math.min(now.getFullYear(), Math.max(1900, parseInt(yStr, 10) || now.getFullYear()));
  const mo = Math.min(12, Math.max(1, parseInt(mStr, 10) || 1));
  const maxDay = new Date(y, mo, 0).getDate(); // days in month `mo` (1-12)
  const d = Math.min(maxDay, Math.max(1, parseInt(dStr, 10) || 1));
  return Math.min(new Date(y, mo - 1, d).getTime(), midnight());
}
