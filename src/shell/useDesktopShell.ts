import { useSyncExternalStore } from 'react';
import { useWindowDimensions } from 'react-native';

import { isDesktopWidth } from '@/shell/breakpoints';

const emptySubscribe = () => () => {};

/**
 * False during SSR and the first (hydration) client render, true thereafter,
 * without a setState-in-effect.
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
 * The web build is `output: "static"`, so the first render happens in Node with
 * no `window`: branching layout *structure* on the viewport width there would
 * bake the wrong breakpoint into the pre-rendered HTML and flash on hydration.
 * So report the phone layout for SSR and the first client paint, then switch to
 * the real width-based decision once hydrated. On native there is no SSR, so
 * this resolves to the width decision on the first render.
 */
export function useDesktopShell(): boolean {
  const { width } = useWindowDimensions();
  const hydrated = useHydrated();
  return hydrated && isDesktopWidth(width);
}
