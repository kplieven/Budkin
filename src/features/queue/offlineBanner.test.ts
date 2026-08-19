import { describe, expect, it } from 'vitest';

import {
  QUEUE_ROUTE,
  isQueueRoute,
  offlineBannerA11yLabel,
  offlineBannerAction,
} from '@/features/queue/offlineBanner';
import { screenTitleFor } from '@/shell/labels';

describe('offlineBannerAction', () => {
  it('opens the queue in server mode', () => {
    expect(offlineBannerAction({ serverMode: true, atQueue: false })).toBe('open-queue');
  });

  it('retries in local mode, where the queue screen is unreachable', () => {
    // Settings hides the Offline queue row in local mode because the screen is
    // permanently empty there, so navigating would send the user to a dead end.
    expect(offlineBannerAction({ serverMode: false, atQueue: false })).toBe('retry');
  });

  it('retries when the queue screen is already open', () => {
    // The desktop pill rides every route. Navigating to the route already on screen is
    // a no-op that reads as a broken button.
    expect(offlineBannerAction({ serverMode: true, atQueue: true })).toBe('retry');
  });

  it('retries in local mode on the queue screen too', () => {
    expect(offlineBannerAction({ serverMode: false, atQueue: true })).toBe('retry');
  });
});

describe('isQueueRoute', () => {
  it('recognises the offline queue route', () => {
    // The literal, not `QUEUE_ROUTE`: comparing the constant with itself only restates
    // the implementation. This pins it to the path the route file actually serves.
    expect(isQueueRoute('/settings/queue')).toBe(true);
  });

  it('rejects every other route the desktop pill rides on', () => {
    expect(isQueueRoute('/')).toBe(false);
    expect(isQueueRoute('/settings')).toBe(false);
    expect(isQueueRoute('/settings/notifications')).toBe(false);
    expect(isQueueRoute('/history')).toBe(false);
  });
});

describe('offlineBannerA11yLabel', () => {
  it('names the destination as that screen is titled', () => {
    // The label is the whole announcement: a screen reader that reaches the banner
    // reads it and never the text inside. Checked against `screenTitleFor` so renaming
    // the destination cannot leave the banner announcing a name that no longer exists.
    expect(offlineBannerA11yLabel('open-queue').toLowerCase()).toContain(
      screenTitleFor(QUEUE_ROUTE).toLowerCase(),
    );
  });

  it('does not name the destination when the press goes nowhere', () => {
    // `retry` is exactly the cases that navigate nowhere, so a label naming the queue
    // screen would promise a press that never opens it.
    expect(offlineBannerA11yLabel('retry').toLowerCase()).not.toContain(
      screenTitleFor(QUEUE_ROUTE).toLowerCase(),
    );
  });

  it('says something different for each action', () => {
    // The two surfaces render the same banner for both actions, so a shared label
    // would leave a screen reader describing the wrong one.
    expect(offlineBannerA11yLabel('open-queue')).not.toBe(offlineBannerA11yLabel('retry'));
  });
});
