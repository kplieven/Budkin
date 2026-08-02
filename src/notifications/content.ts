/**
 * Pure shaping + reconcile logic for per-timer Android notifications. No native
 * calls and no I/O, so it is trivially unit-testable. The store subscriber
 * (`sync.ts`) turns `state.timers` into the desired notification set here, diffs
 * it against what was last posted, and dispatches the post/dismiss work to the
 * platform-split module.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { Child, Timer } from '@/types/models';

/** Android channel id, shared by the channel *creation* (register.android) and the
 *  channel-aware *trigger* (postNotification.android) so a typo can't silently
 *  route notifications to a noisy fallback channel. */
export const TIMER_CHANNEL_ID = 'timers';

/** Android channel id for SCHEDULED reminders (due date, stale timers, age
 *  milestones, pumping). Separate from TIMER_CHANNEL_ID on purpose: that one is
 *  LOW importance because a running timer is a persistent status, and reusing it
 *  would make every reminder here silent. It also lets a user mute reminders in
 *  Android settings without losing the timer display. */
export const REMINDER_CHANNEL_ID = 'reminders';

export interface TimerNotification {
  /** stable id = timer.id, so posts update in place and dismissals are exact */
  identifier: string;
  title: string;
  body: string;
  data: { url: string; timerId: string };
}

/** "14:45" — local 24-hour clock (nl-BE), timezone-agnostic in tests via local Date input. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Shapes a notification from a name the caller has ALREADY resolved. Only the
 *  headless widget task uses this: it runs with a snapshot holding one child's
 *  name and no roster to look the timer's own child up in. Everything with a
 *  roster goes through `buildTimerNotification`, which resolves the name itself
 *  and so cannot title a timer with the wrong child. */
export function buildNamedTimerNotification(timer: Timer, childName: string): TimerNotification {
  const label = ACTIVITY_LABEL[timer.saveAs];
  return {
    identifier: timer.id,
    title: childName ? `${childName} · ${label}` : label,
    body: `Started ${formatClock(timer.start)}`,
    data: { url: '/timers', timerId: timer.id },
  };
}

/** Titles a timer with ITS OWN child, matched strictly on `timer.childId`. That
 *  is the rule `staleReminders` uses, and for the same reason: the selected child
 *  is deliberately NOT a fallback, so a running timer keeps its name when the
 *  user switches child. A timer no child matches gets the bare label. */
export function buildTimerNotification(timer: Timer, children: Child[]): TimerNotification {
  const child = children.find((c) => c.id === timer.childId);
  return buildNamedTimerNotification(timer, child?.first ?? '');
}

export function desiredTimerNotifications(timers: Timer[], children: Child[]): TimerNotification[] {
  return timers.map((t) => buildTimerNotification(t, children));
}

export function diffTimerNotifications(
  prev: TimerNotification[],
  next: TimerNotification[],
): { toPost: TimerNotification[]; toDismiss: string[] } {
  const prevById = new Map(prev.map((n) => [n.identifier, n]));
  const nextIds = new Set(next.map((n) => n.identifier));
  const toPost = next.filter((n) => {
    const p = prevById.get(n.identifier);
    return !p || p.title !== n.title || p.body !== n.body;
  });
  const toDismiss = prev.filter((n) => !nextIds.has(n.identifier)).map((n) => n.identifier);
  return { toPost, toDismiss };
}
