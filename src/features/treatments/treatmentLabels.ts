/**
 * Small pure label helpers for a treatment, shared by the picker sheet and the
 * settings management list so the two never drift. No em-dashes in UI copy.
 */

import type { Treatment, TreatmentTimeOfDay } from '@/types/models';

const TIME_OF_DAY_LABEL: Record<TreatmentTimeOfDay, string> = {
  morning: 'Morning',
  noon: 'Noon',
  evening: 'Evening',
  night: 'Night',
};

/** Fixed order the four times of day read in, regardless of pick order. Also the
 *  chronological order their slots fire in, which is why `treatmentReminders` in
 *  src/notifications/scheduled.ts reuses this rather than keeping its own copy. */
export const TIME_OF_DAY_ORDER: TreatmentTimeOfDay[] = ['morning', 'noon', 'evening', 'night'];

/** A short human summary of the treatment's schedule, e.g. "Every 6 hours" or
 *  "Morning, Evening". Empty string when a mode has nothing chosen yet. */
export function treatmentScheduleLabel(treatment: Treatment): string {
  if (treatment.scheduleMode === 'everyHours') {
    if (treatment.everyHours == null) return '';
    return `Every ${treatment.everyHours} ${treatment.everyHours === 1 ? 'hour' : 'hours'}`;
  }
  const chosen = TIME_OF_DAY_ORDER.filter((tod) => treatment.timesOfDay?.includes(tod));
  return chosen.map((tod) => TIME_OF_DAY_LABEL[tod]).join(', ');
}

/** The dose amount + unit as one string, e.g. "2.5 mL", or "" when no amount. */
export function treatmentDosageLabel(treatment: Treatment): string {
  if (treatment.dosage == null) return '';
  return [String(treatment.dosage), treatment.dosageUnit].filter(Boolean).join(' ');
}
