/**
 * What a press of the offline banner does.
 *
 * Two surfaces render that banner: the phone dashboard's floating strip
 * (`src/app/(tabs)/index.tsx`) and the desktop top bar's pill
 * (`src/shell/TopBar.tsx`). They look nothing alike and they answer to the same
 * rule, so the rule lives here rather than twice in two `.tsx` files where it
 * could quietly drift apart. Kept in a `.ts` for the usual reason:
 * `vitest.config.ts` only matches `.test.ts`, so anything living in a component
 * file is untestable by convention here.
 *
 * The rule itself: the banner reports a backlog, so its press should show the
 * user that backlog. Retrying is what the queue screen's own button is for, and
 * that one re-checks the connection before it flushes, so nothing is lost by
 * moving the press one screen along. What IS gained is that the user can see
 * what is waiting before deciding to do anything about it.
 *
 * The two exceptions below are both the same failure: a press that navigates
 * nowhere. Rather than let each surface guess, both ask this module and fall
 * back to the retry the banner used to do.
 */

/** The offline queue screen, the banner's destination. */
export const QUEUE_ROUTE = '/settings/queue';

/**
 * What a press does.
 *
 * `open-queue` navigates to {@link QUEUE_ROUTE}. `retry` is the older behaviour,
 * kept for the cases where navigating would go nowhere: re-check the connection
 * and say so.
 */
export type OfflineBannerAction = 'open-queue' | 'retry';

/**
 * Whether `usePathname()` is currently sitting on the queue screen.
 *
 * Only the desktop pill needs this: `_layout.tsx` wraps `DesktopShell` around
 * the whole navigator, so that pill rides every route including its own
 * destination. The phone banner belongs to `/` alone and can answer `false`
 * outright.
 *
 * A plain equality check, exactly like `screenTitleFor` in `src/shell/labels.ts`
 * which already keys the top bar's title off this same path. `/settings/queue`
 * sits in no route group, so `usePathname()` returns it verbatim.
 */
export function isQueueRoute(pathname: string): boolean {
  return pathname === QUEUE_ROUTE;
}

/**
 * Navigate, or retry in place.
 *
 * `serverMode` is `connection?.mode === 'server'`. Local mode retries and does
 * NOT navigate: `src/app/settings/index.tsx` deliberately hides its Offline
 * queue row there because nothing is ever queued in local mode, and a banner
 * that navigated anyway would put back the dead end that row's absence removes.
 * The banner still appears in local mode (`setNetworkOnline` is called from
 * `_layout.tsx` whatever the connection mode), so this branch is reachable and
 * has to do something useful. Re-checking the connection is that something, and
 * it is what the banner already did.
 *
 * `atQueue` retries for a different reason: the destination is already on
 * screen, so navigating is a no-op and reads as a button that does nothing.
 */
export function offlineBannerAction(opts: { serverMode: boolean; atQueue: boolean }): OfflineBannerAction {
  if (!opts.serverMode) return 'retry';
  if (opts.atQueue) return 'retry';
  return 'open-queue';
}

/**
 * The banner's `accessibilityLabel`, which has to say what the press does.
 *
 * One label covers the whole banner, so the offline state has to be in it: a
 * screen reader that reaches this element announces the label alone and never
 * the "Offline, changes will sync when reconnected" text inside it. "Offline
 * queue" is the destination's own title (`src/shell/labels.ts`), so the label
 * names the screen the user lands on.
 */
export function offlineBannerA11yLabel(action: OfflineBannerAction): string {
  return action === 'open-queue' ? 'Offline, open the offline queue' : 'Retry connection';
}
