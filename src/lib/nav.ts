import { router, type Href } from 'expo-router';

/**
 * Dismiss a screen that has its own back chevron.
 *
 * `router.back()` alone is only correct when the screen was pushed. React
 * Navigation drops a GO_BACK that no navigator can handle ("The action
 * 'GO_BACK' was not handled by any navigator"), so on a screen that IS the
 * session's first route — a typed URL or a deep link straight to /settings,
 * /metric/weight, ... — the chevron would silently do nothing. That is a real
 * dead end on web, where address-bar navigation is normal.
 *
 * `fallback` is the screen the chevron conceptually returns to, used only when
 * there is no history to pop; it defaults to Home. `replace`, not `push`, so
 * the dead-end route doesn't linger under the fallback.
 */
export function backOr(fallback: Href = '/(tabs)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
