import { describe, expect, it } from 'vitest';

import {
  QUEUE_ROUTE,
  isQueueRoute,
  offlineBannerA11yLabel,
  offlineBannerAction,
} from '@/features/queue/offlineBanner';

describe('offlineBannerAction', () => {
  it('opens the queue in server mode', () => {
    expect(offlineBannerAction({ serverMode: true, atQueue: false })).toBe('open-queue');
  });

  it('retries in local mode, where the queue screen is unreachable', () => {
    // `src/app/settings/index.tsx` hides the Offline queue row in local mode
    // because the screen is permanently empty there, so navigating would send
    // the user to a dead end.
    expect(offlineBannerAction({ serverMode: false, atQueue: false })).toBe('retry');
  });

  it('retries when the queue screen is already open', () => {
    // The desktop pill rides every route. Navigating to the route already on
    // screen is a no-op that reads as a broken button.
    expect(offlineBannerAction({ serverMode: true, atQueue: true })).toBe('retry');
  });

  it('retries in local mode on the queue screen too', () => {
    expect(offlineBannerAction({ serverMode: false, atQueue: true })).toBe('retry');
  });
});

describe('isQueueRoute', () => {
  it('recognises the offline queue route', () => {
    expect(isQueueRoute('/settings/queue')).toBe(true);
    expect(isQueueRoute(QUEUE_ROUTE)).toBe(true);
  });

  it('rejects every other route the desktop pill rides on', () => {
    expect(isQueueRoute('/')).toBe(false);
    expect(isQueueRoute('/settings')).toBe(false);
    expect(isQueueRoute('/settings/notifications')).toBe(false);
    expect(isQueueRoute('/history')).toBe(false);
  });
});

describe('offlineBannerA11yLabel', () => {
  it('announces the destination when the press navigates', () => {
    expect(offlineBannerA11yLabel('open-queue')).toBe('Offline, open the offline queue');
  });

  it('keeps announcing a retry when the press retries', () => {
    expect(offlineBannerA11yLabel('retry')).toBe('Retry connection');
  });

  it('says something different for each action', () => {
    // The two surfaces render the same banner for both actions, so a shared
    // label would leave a screen reader describing the wrong one.
    expect(offlineBannerA11yLabel('open-queue')).not.toBe(offlineBannerA11yLabel('retry'));
  });
});
