/**
 * Small pure label helpers for a cure, shared by the picker sheet and the
 * settings management list so the two never drift. No em-dashes in UI copy.
 */

import type { Cure, CureTimeOfDay } from '@/types/models';

const TIME_OF_DAY_LABEL: Record<CureTimeOfDay, string> = {
  morning: 'Morning',
  noon: 'Noon',
  evening: 'Evening',
  night: 'Night',
};

/** Fixed order the four times of day read in, regardless of pick order. */
const TIME_OF_DAY_ORDER: CureTimeOfDay[] = ['morning', 'noon', 'evening', 'night'];

/** A short human summary of the cure's schedule, e.g. "Every 6 hours" or
 *  "Morning, Evening". Empty string when a mode has nothing chosen yet. */
export function cureScheduleLabel(cure: Cure): string {
  if (cure.scheduleMode === 'everyHours') {
    if (cure.everyHours == null) return '';
    return `Every ${cure.everyHours} ${cure.everyHours === 1 ? 'hour' : 'hours'}`;
  }
  const chosen = TIME_OF_DAY_ORDER.filter((tod) => cure.timesOfDay?.includes(tod));
  return chosen.map((tod) => TIME_OF_DAY_LABEL[tod]).join(', ');
}

/** The dose amount + unit as one string, e.g. "2.5 mL", or "" when no amount. */
export function cureDosageLabel(cure: Cure): string {
  if (cure.dosage == null) return '';
  return [String(cure.dosage), cure.dosageUnit].filter(Boolean).join(' ');
}
