/** The routing decision behind `budkin://log/<type>`, split out of `app/log/[type].tsx`
 *  so it can be unit-tested. */

import { ALL_ACTIVITIES } from '@/lib/activities';
import { resolveDeepLinkChild } from '@/lib/deepLink';
import type { ActivityType, Child, Treatment } from '@/types/models';

/**
 * `selectChildId` rides alongside the destination rather than replacing it: the link
 * names both a child and a thing to open, and the route does both, in that order.
 */
export type LogDeepLinkAction =
  /** not connected, still expecting, an activity we do not log, or a child we no longer have */
  | { kind: 'none' }
  /** open the Quick-Log sheet for this activity */
  | { kind: 'sheet'; activity: ActivityType; selectChildId?: string }
  /** seed a medication draft from this treatment and open the confirm sheet */
  | { kind: 'treatment'; treatmentId: string; selectChildId?: string }
  /** the treatment picker, or the manual form when the child has no active treatments */
  | { kind: 'medicationLog'; selectChildId?: string };

export function resolveLogDeepLink(params: {
  type: string | undefined;
  treatment: string | undefined;
  /** `?child=<localId>`. Absent for a launcher shortcut, which is built before any child
   *  exists, and for a reminder scheduled by a build that predates it. */
  child?: string;
  connected: boolean;
  /** whether the SELECTED child is expected, which is who the link runs against when it
   *  names nobody. A link that names a child is judged on that child's own flag. */
  expected: boolean;
  selectedChildId: string;
  children?: Child[];
  treatments: Treatment[];
}): LogDeepLinkAction {
  if (!params.connected) return { kind: 'none' };
  // This route opens a WRITE surface, so a child the roster no longer holds is refused
  // rather than retargeted at whoever is selected. A navigation-only reminder does the
  // opposite: landing on the wrong tab is not the mistake logging a feed against the
  // wrong baby is.
  const named = resolveDeepLinkChild(params.child, params.children ?? []);
  if (named.kind === 'unknown') return { kind: 'none' };
  // Logging against a child who is still expected would stamp an activity onto a due date
  // rather than a birth date. Same guard timer.tsx mirrors.
  if (named.kind === 'named' ? named.child.expected : params.expected) return { kind: 'none' };
  const childId = named.kind === 'named' ? named.child.id : params.selectedChildId;
  const selectChildId = childId === params.selectedChildId ? undefined : childId;

  const activity = params.type as ActivityType;
  if (!ALL_ACTIVITIES.includes(activity)) return { kind: 'none' };
  if (activity !== 'medication') return { kind: 'sheet', activity, selectChildId };

  const id = params.treatment?.trim();
  if (!id) return { kind: 'medicationLog', selectChildId };

  // Resolved here rather than by `logMedicationFromTreatment`, which returns silently on
  // an unknown id or blank name and would leave the parent on a dead tap. A pending
  // notification outlives the treatment it names.
  const treatment = params.treatments.find((c) => c.id === id);
  if (!treatment || !treatment.name.trim()) return { kind: 'medicationLog', selectChildId };
  // A delivered notification can sit in the tray across a child switch. Seeding the sheet
  // from a treatment belonging to whoever was selected when the alert fired, rather than
  // to whoever this tap is for, would misattribute the dose.
  if (treatment.childId !== childId) return { kind: 'medicationLog', selectChildId };
  return { kind: 'treatment', treatmentId: treatment.id, selectChildId };
}
