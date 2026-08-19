import { router, type Href } from 'expo-router';

/**
 * `router.back()` alone is only correct when the screen was pushed. React Navigation
 * drops a GO_BACK no navigator can handle, so on a screen that IS the session's first
 * route the chevron would silently do nothing: a real dead end on web, where address-bar
 * navigation is normal. `replace`, not `push`, so that route does not linger underneath.
 */
export function backOr(fallback: Href = '/(tabs)') {
  if (router.canGoBack()) router.back();
  else router.replace(fallback);
}
