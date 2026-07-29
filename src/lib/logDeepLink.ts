/**
 * The routing decision behind `budkin://log/<type>`, split out of
 * `app/log/[type].tsx` so it can be unit-tested: vitest runs under node with
 * `include: ['src/**\/*.test.ts']`, so a .tsx route has no test harness. Same
 * split as `scheduled.ts` and `scheduleSync.ts`: pure decision, thin caller.
 */

import { ALL_ACTIVITIES } from '@/lib/activities';
import type { ActivityType, Cure } from '@/types/models';

export type LogDeepLinkAction =
  /** not connected, still expecting, or an activity we do not log */
  | { kind: 'none' }
  /** open the Quick-Log sheet for this activity */
  | { kind: 'sheet'; activity: ActivityType }
  /** seed a medication draft from this cure and open the confirm sheet */
  | { kind: 'cure'; cureId: string }
  /** the cure picker, or the manual form when the child has no active cures */
  | { kind: 'medicationLog' };

export function resolveLogDeepLink(params: {
  type: string | undefined;
  cure: string | undefined;
  connected: boolean;
  expected: boolean;
  selectedChildId: string;
  cures: Cure[];
}): LogDeepLinkAction {
  // Logging against a child who is still expected would stamp an activity onto
  // a due date rather than a birth date. Same guard timer.tsx mirrors.
  if (!params.connected || params.expected) return { kind: 'none' };
  const activity = params.type as ActivityType;
  if (!ALL_ACTIVITIES.includes(activity)) return { kind: 'none' };
  if (activity !== 'medication') return { kind: 'sheet', activity };

  const id = params.cure?.trim();
  if (!id) return { kind: 'medicationLog' };

  // Resolve the cure HERE rather than handing the id straight to
  // `logMedicationFromCure`: that action returns silently when the id is unknown
  // or the name is blank, which would leave the parent on a dead tap. A pending
  // notification outlives the cure it names, since the cure can be deleted or
  // renamed to blank in the window between the alert being scheduled and being
  // tapped. Falling back gives them the normal picker instead. A cure that was
  // paused in that same window is NOT special-cased here: the parent tapped an
  // alert that named that treatment, reconciliation already cancels a paused
  // cure's pending alerts on the next store write so the window is narrow, and
  // the current behaviour (still seeding the confirm sheet from it) is
  // defensible as is.
  const cure = params.cures.find((c) => c.id === id);
  if (!cure || !cure.name.trim()) return { kind: 'medicationLog' };
  // A delivered notification can outlive a child switch, staying in the tray
  // after the parent selects someone else. Seeding the sheet from a cure that
  // belongs to whoever was selected when the alert fired, rather than to
  // whoever is selected now, would misattribute the dose. Fall back exactly
  // like an unknown cure.
  if (cure.childId !== params.selectedChildId) return { kind: 'medicationLog' };
  return { kind: 'cure', cureId: cure.id };
}
