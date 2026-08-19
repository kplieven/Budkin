/** Shaping and reconcile logic for per-timer Android notifications. Unlike the
 *  scheduled reminders, these are diffed against an in-memory `prev`. */

import { ACTIVITY_LABEL } from '@/lib/activities';
import { withChildParam } from '@/lib/deepLink';
import type { Child, Timer } from '@/types/models';

/** Shared by the channel creation and the channel-aware trigger, so a typo cannot
 *  silently route notifications to a noisy fallback channel. */
export const TIMER_CHANNEL_ID = 'timers';

/** Separate from TIMER_CHANNEL_ID on purpose: that one is LOW importance, so
 *  reusing it would make every reminder silent. Separate channels also let a user
 *  mute reminders in Android settings without losing the timer display. */
export const REMINDER_CHANNEL_ID = 'reminders';

export interface TimerNotification {
  /** stable id = timer.id, so posts update in place and dismissals are exact */
  identifier: string;
  title: string;
  body: string;
  data: { url: string; timerId: string };
}

/** "14:45", local 24-hour clock. */
export function formatClock(ms: number): string {
  const d = new Date(ms);
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** Shapes a notification from a name the caller has ALREADY resolved. Only the
 *  headless widget task needs this: it runs with a snapshot holding one child's
 *  name and no roster. */
export function buildNamedTimerNotification(timer: Timer, childName: string): TimerNotification {
  const label = ACTIVITY_LABEL[timer.saveAs];
  return {
    identifier: timer.id,
    title: childName ? `${childName} · ${label}` : label,
    body: `Started ${formatClock(timer.start)}`,
    // From `childId`, not the name above: the widget caller resolves that name
    // from a one-child snapshot, so only the id is trustworthy in both callers.
    data: { url: withChildParam('/timers', timer.childId), timerId: timer.id },
  };
}

/** Matched strictly on `timer.childId`. The selected child is deliberately NOT a
 *  fallback, so a running timer keeps its name when the user switches child. */
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
