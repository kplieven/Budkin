import { type RefObject, useEffect, useRef, useState } from 'react';
import { Platform, type ScrollView } from 'react-native';

import { PULL_TRIGGER_PX, pullOffset, shouldTrigger } from '@/features/dashboard/pullToRefresh';

/**
 * True only in a touch-capable browser (phones/tablets) — never on a
 * mouse-driven laptop (`pointer: fine`), and never on native. Evaluated once;
 * `matchMedia('(pointer: coarse)')` is stable for the life of the session.
 */
const isTouchWeb =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

export interface WebPullToRefresh {
  /** Whether this session gets the custom web pull-to-refresh. */
  enabled: boolean;
  /** Current indicator offset in px (0 when idle). */
  offset: number;
  /** True while a triggered refresh is running. */
  refreshing: boolean;
}

/**
 * Custom pull-to-refresh for touch-capable web, where React Native's
 * `RefreshControl` is an inert stub (it renders a bare View and drops
 * `onRefresh`). Attaches touch listeners to the ScrollView's DOM node: a
 * downward drag while scrolled to the top grows an indicator, and releasing past
 * the threshold runs `onRefresh`.
 *
 * No-op on native (use the platform `RefreshControl`) and on mouse-driven web
 * (use the tappable offline banner / pill instead).
 */
export function useWebPullToRefresh(
  scrollRef: RefObject<ScrollView | null>,
  onRefresh: () => Promise<void> | void,
): WebPullToRefresh {
  const [offset, setOffset] = useState(0);
  const [refreshing, setRefreshing] = useState(false);

  // Refs so the attached DOM listeners always read fresh values.
  const offsetRef = useRef(0);
  const refreshingRef = useRef(false);

  const setOff = (v: number) => {
    offsetRef.current = v;
    setOffset(v);
  };

  useEffect(() => {
    if (!isTouchWeb) return;
    const node: HTMLElement | undefined = (
      scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node) return;

    // Keep the browser's own overscroll/pull-to-refresh from competing with ours.
    const prevOverscroll = node.style.overscrollBehaviorY;
    node.style.overscrollBehaviorY = 'contain';

    let startY: number | null = null;

    const onStart = (e: TouchEvent) => {
      startY = node.scrollTop <= 0 && !refreshingRef.current ? e.touches[0].pageY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null || refreshingRef.current) return;
      const dy = e.touches[0].pageY - startY;
      if (dy > 0 && node.scrollTop <= 0) {
        setOff(pullOffset(dy));
        // Once we've clearly taken over the drag, suppress native rubber-banding.
        if (offsetRef.current > 2 && e.cancelable) e.preventDefault();
      } else if (offsetRef.current !== 0) {
        setOff(0);
      }
    };
    const finish = () => {
      if (startY == null) return;
      startY = null;
      if (shouldTrigger(offsetRef.current)) {
        refreshingRef.current = true;
        setRefreshing(true);
        setOff(PULL_TRIGGER_PX); // hold the spinner at the trigger point while loading
        Promise.resolve(onRefresh()).finally(() => {
          refreshingRef.current = false;
          setRefreshing(false);
          setOff(0);
        });
      } else {
        setOff(0);
      }
    };

    node.addEventListener('touchstart', onStart, { passive: true });
    node.addEventListener('touchmove', onMove, { passive: false });
    node.addEventListener('touchend', finish, { passive: true });
    node.addEventListener('touchcancel', finish, { passive: true });
    return () => {
      node.style.overscrollBehaviorY = prevOverscroll;
      node.removeEventListener('touchstart', onStart);
      node.removeEventListener('touchmove', onMove);
      node.removeEventListener('touchend', finish);
      node.removeEventListener('touchcancel', finish);
    };
  }, [scrollRef, onRefresh]);

  return { enabled: isTouchWeb, offset, refreshing };
}
