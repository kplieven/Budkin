import { describe, expect, it } from 'vitest';

import {
  buildTimerNotification,
  desiredTimerNotifications,
  diffTimerNotifications,
  formatClock,
  type TimerNotification,
} from '@/notifications/content';
import type { Timer } from '@/types/models';

// Build timestamps from a LOCAL Date so formatClock (local getHours/getMinutes)
// round-trips deterministically regardless of the machine's timezone.
const at = (h: number, m: number) => new Date(2026, 0, 1, h, m).getTime();

const timer = (over: Partial<Timer> = {}): Timer => ({
  id: 't1',
  activity: 'feeding',
  name: 'Feeding',
  start: at(14, 45),
  saveAs: 'feeding',
  ...over,
});

describe('formatClock', () => {
  it('formats afternoon as 12-hour with PM', () => {
    expect(formatClock(at(14, 45))).toBe('2:45 PM');
  });
  it('formats midnight hour as 12 AM and pads minutes', () => {
    expect(formatClock(at(0, 5))).toBe('12:05 AM');
  });
  it('formats noon as 12 PM', () => {
    expect(formatClock(at(12, 0))).toBe('12:00 PM');
  });
});

describe('buildTimerNotification', () => {
  it('shapes title/body/identifier/data from the timer and child', () => {
    expect(buildTimerNotification(timer(), 'Ellie')).toEqual({
      identifier: 't1',
      title: 'Ellie · Feeding',
      body: 'Started 2:45 PM',
      data: { url: '/timers', timerId: 't1' },
    });
  });
  it('uses saveAs (not activity) for the label', () => {
    expect(buildTimerNotification(timer({ saveAs: 'pumping' }), 'Ellie').title).toBe('Ellie · Pumping');
  });
  it('omits the separator when there is no child name', () => {
    expect(buildTimerNotification(timer(), '').title).toBe('Feeding');
  });
});

describe('diffTimerNotifications', () => {
  const a: TimerNotification = {
    identifier: 't1',
    title: 'Ellie · Feeding',
    body: 'Started 2:45 PM',
    data: { url: '/timers', timerId: 't1' },
  };

  it('posts brand-new notifications', () => {
    expect(diffTimerNotifications([], [a])).toEqual({ toPost: [a], toDismiss: [] });
  });
  it('is a no-op when content is unchanged', () => {
    expect(diffTimerNotifications([a], [a])).toEqual({ toPost: [], toDismiss: [] });
  });
  it('dismisses notifications whose timer is gone', () => {
    expect(diffTimerNotifications([a], [])).toEqual({ toPost: [], toDismiss: ['t1'] });
  });
  it('re-posts when the content changed for the same id', () => {
    const a2 = { ...a, body: 'Started 3:10 PM' };
    expect(diffTimerNotifications([a], [a2])).toEqual({ toPost: [a2], toDismiss: [] });
  });
});

describe('desiredTimerNotifications', () => {
  it('maps every timer to a notification', () => {
    const out = desiredTimerNotifications([timer(), timer({ id: 't2', saveAs: 'sleep' })], 'Ellie');
    expect(out.map((n) => n.identifier)).toEqual(['t1', 't2']);
    expect(out[1].title).toBe('Ellie · Sleep');
  });
});
