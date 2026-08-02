/**
 * The routing decision behind `budkin://log/<type>`, split out of
 * `app/log/[type].tsx` so it can be unit-tested: vitest runs under node with
 * `include: ['src/**\/*.test.ts']`, so a .tsx route has no test harness. Same
 * split as `scheduled.ts` and `scheduleSync.ts`: pure decision, thin caller.
 */

import { ALL_ACTIVITIES } from '@/lib/activities';
import { resolveDeepLinkChild } from '@/lib/deepLink';
import type { ActivityType, Child, Treatment } from '@/types/models';

/**
 * `selectChildId` rides ALONGSIDE the destination rather than replacing it: the
 * link names both a child and a thing to open, and the route does both, in that
 * order. Undefined means leave the selection alone, which is the common case
 * (the link names nobody, or it names whoever is already selected).
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
  /** `?child=<localId>`. Absent for a launcher shortcut, which is built before
   *  any child exists, and for a reminder scheduled by a build that predates it. */
  child?: string;
  connected: boolean;
  /** whether the SELECTED child is expected, which is who the link runs against
   *  when it names nobody. A link that names a child is judged on that child's
   *  own flag, read from `children` below. */
  expected: boolean;
  selectedChildId: string;
  /** the roster `child` is resolved against. Omitted only by callers whose links
   *  never carry one. */
  children?: Child[];
  treatments: Treatment[];
}): LogDeepLinkAction {
  if (!params.connected) return { kind: 'none' };
  // This route opens a WRITE surface, so a child the roster no longer holds is
  // refused rather than quietly retargeted at whoever is selected. A
  // navigation-only reminder does the opposite and just proceeds (see
  // `childToSelectOnOpen`); logging a feed against the wrong baby is not the
  // same kind of mistake as landing on the wrong tab.
  const named = resolveDeepLinkChild(params.child, params.children ?? []);
  if (named.kind === 'unknown') return { kind: 'none' };
  // Logging against a child who is still expected would stamp an activity onto
  // a due date rather than a birth date. Same guard timer.tsx mirrors.
  if (named.kind === 'named' ? named.child.expected : params.expected) return { kind: 'none' };
  // Everything below judges ownership by the child this tap is FOR.
  const childId = named.kind === 'named' ? named.child.id : params.selectedChildId;
  const selectChildId = childId === params.selectedChildId ? undefined : childId;

  const activity = params.type as ActivityType;
  if (!ALL_ACTIVITIES.includes(activity)) return { kind: 'none' };
  if (activity !== 'medication') return { kind: 'sheet', activity, selectChildId };

  const id = params.treatment?.trim();
  if (!id) return { kind: 'medicationLog', selectChildId };

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
  if (!treatment || !treatment.name.trim()) return { kind: 'medicationLog', selectChildId };
  // A delivered notification can outlive a child switch, staying in the tray
  // after the parent selects someone else. Seeding the sheet from a treatment that
  // belongs to whoever was selected when the alert fired, rather than to
  // whoever this tap is for, would misattribute the dose. Fall back exactly
  // like an unknown treatment. An alert that names its child clears this by
  // construction, since `childId` is then the treatment's own child.
  if (treatment.childId !== childId) return { kind: 'medicationLog', selectChildId };
  return { kind: 'treatment', treatmentId: treatment.id, selectChildId };
}
