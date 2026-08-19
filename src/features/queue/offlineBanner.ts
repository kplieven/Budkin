/**
 * What a press of the offline banner does.
 *
 * Two surfaces render the banner (the dashboard's floating strip and the desktop
 * top bar's pill) and must answer to the same rule. Kept in a `.ts` because vitest
 * only matches `.test.ts` here, so logic in a component file would be untestable.
 */

export const QUEUE_ROUTE = '/settings/queue';

export type OfflineBannerAction = 'open-queue' | 'retry';

/** Only the desktop pill needs this: it rides every route, including its own destination. */
export function isQueueRoute(pathname: string): boolean {
  return pathname === QUEUE_ROUTE;
}

/**
 * Local mode never navigates: nothing is queued there, so the screen is unreachable
 * by design and `refresh()` returns early for non-server connections. The press
 * shows a toast and stops, which is the point: it avoids a dead end.
 */
export function offlineBannerAction(opts: { serverMode: boolean; atQueue: boolean }): OfflineBannerAction {
  if (!opts.serverMode) return 'retry';
  if (opts.atQueue) return 'retry';
  return 'open-queue';
}

/**
 * One label covers the whole banner, so the offline state has to be in it: a screen
 * reader announces the label alone, never the text inside.
 */
export function offlineBannerA11yLabel(action: OfflineBannerAction): string {
  return action === 'open-queue' ? 'Offline, open the offline queue' : 'Retry connection';
}
