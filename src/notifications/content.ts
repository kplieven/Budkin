/**
 * Pure shaping + reconcile logic for per-timer Android notifications. No native
 * calls and no I/O, so it is trivially unit-testable. The store subscriber
 * (`sync.ts`) turns `state.timers` into the desired notification set here, diffs
 * it against what was last posted, and dispatches the post/dismiss work to the
 * platform-split module.
 */

import { ACTIVITY_LABEL } from '@/lib/activities';
import type { Timer } from '@/types/models';

/** Android channel id, shared by the channel *creation* (register.android) and the
 *  channel-aware *trigger* (postNotification.android) so a typo can't silently
 *  route notifications to a noisy fallback channel. */
export const TIMER_CHANNEL_ID = 'timers';

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

export function buildTimerNotification(timer: Timer, childName: string): TimerNotification {
  const label = ACTIVITY_LABEL[timer.saveAs];
  return {
    identifier: timer.id,
    title: childName ? `${childName} · ${label}` : label,
    body: `Started ${formatClock(timer.start)}`,
    data: { url: '/timers', timerId: timer.id },
  };
}

export function desiredTimerNotifications(timers: Timer[], childName: string): TimerNotification[] {
  return timers.map((t) => buildTimerNotification(t, childName));
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
