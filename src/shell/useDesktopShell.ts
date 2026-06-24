import { useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';

import { isDesktopWidth } from '@/shell/breakpoints';

const emptySubscribe = () => () => {};

/**
 * False on the server and during the first (hydration) client render, true
 * thereafter — without a setState-in-effect. `getServerSnapshot` (=> false) is
 * used for SSR and the matching first client render; once hydration commits,
 * React re-reads `getSnapshot` (=> true).
 */
function useHydrated(): boolean {
  return useSyncExternalStore(
    emptySubscribe,
    () => true,
    () => false,
  );
}

/**
 * Whether to render the large-screen desktop shell instead of the phone tabs.
 *
 * SSR-safe by design. The web build is `output: "static"`, so the first render
 * happens in Node with no `window`: branching layout *structure* on the viewport
 * width there would bake the wrong breakpoint into the pre-rendered HTML and
 * flash on hydration. We therefore report the phone layout (the safe default)
 * for SSR and the first client paint, then switch to the real width-based
 * decision once hydrated. This mirrors the effect-driven entrance discipline
 * already used in BottomSheet. On native there is no SSR, so this resolves to
 * the width decision on the first render.
 */
export function useDesktopShell(): boolean {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  return hydrated && isDesktopWidth(width);
}
