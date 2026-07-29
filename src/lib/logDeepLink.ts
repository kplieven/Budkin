/**
 * The routing decision behind `budkin://log/<type>`, split out of
 * `app/log/[type].tsx` so it can be unit-tested: vitest runs under node with
 * `include: ['src/**\/*.test.ts']`, so a .tsx route has no test harness. Same
 * split as `scheduled.ts` and `scheduleSync.ts`: pure decision, thin caller.
 */

import { ALL_ACTIVITIES } from '@/lib/activities';
import type { ActivityType, Treatment } from '@/types/models';

export type LogDeepLinkAction =
  /** not connected, still expecting, or an activity we do not log */
  | { kind: 'none' }
  /** open the Quick-Log sheet for this activity */
  | { kind: 'sheet'; activity: ActivityType }
  /** seed a medication draft from this treatment and open the confirm sheet */
  | { kind: 'treatment'; treatmentId: string }
  /** the treatment picker, or the manual form when the child has no active treatments */
  | { kind: 'medicationLog' };

export function resolveLogDeepLink(params: {
  type: string | undefined;
  treatment: string | undefined;
  connected: boolean;
  expected: boolean;
  selectedChildId: string;
  treatments: Treatment[];
}): LogDeepLinkAction {
  // Logging against a child who is still expected would stamp an activity onto
  // a due date rather than a birth date. Same guard timer.tsx mirrors.
  if (!params.connected || params.expected) return { kind: 'none' };
  const activity = params.type as ActivityType;
  if (!ALL_ACTIVITIES.includes(activity)) return { kind: 'none' };
  if (activity !== 'medication') return { kind: 'sheet', activity };

  const id = params.treatment?.trim();
  if (!id) return { kind: 'medicationLog' };

  // Resolve the treatment HERE rather than handing the id straight to
  // `logMedicationFromTreatment`: that action returns silently when the id is unknown
  // or the name is blank, which would leave the parent on a dead tap. A pending
  // notification outlives the treatment it names, since the treatment can be deleted or
  // renamed to blank in the window between the alert being scheduled and being
  // tapped. Falling back gives them the normal picker instead. A treatment that was
  // paused in that same window is NOT special-cased here: the parent tapped an
  // alert that named that treatment, reconciliation already cancels a paused
  // treatment's pending alerts on the next store write so the window is narrow, and
  // the current behaviour (still seeding the confirm sheet from it) is
  // defensible as is.
  const treatment = params.treatments.find((c) => c.id === id);
  if (!treatment || !treatment.name.trim()) return { kind: 'medicationLog' };
  // A delivered notification can outlive a child switch, staying in the tray
  // after the parent selects someone else. Seeding the sheet from a treatment that
  // belongs to whoever was selected when the alert fired, rather than to
  // whoever is selected now, would misattribute the dose. Fall back exactly
  // like an unknown treatment.
  if (treatment.childId !== params.selectedChildId) return { kind: 'medicationLog' };
  return { kind: 'treatment', treatmentId: treatment.id };
}
