import { type RefObject, useEffect, useState } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  PULL_REST_PX,
  PULL_TRIGGER_PX,
  pullOffset,
  shouldTrigger,
} from '@/features/dashboard/pullToRefresh';

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

/**
 * Custom pull-to-refresh for touch-capable web, where React Native's
 * `RefreshControl` is an inert stub (it renders a bare View and drops
 * `onRefresh`). Attaches touch listeners to the ScrollView's DOM node: a
 * downward drag while scrolled to the top tracks the finger 1:1 (with an
 * Android-style rubber-band past the ceiling), and releasing past the threshold
 * runs `onRefresh`. Release always eases back with `withTiming`.
 *
 * No-op on native (use the platform `RefreshControl`) and on mouse-driven web
 * (use the tappable offline banner / pill instead). The indicator is driven
 * entirely by the `pull` shared value, so at rest (0) it is simply transparent —
 * no mount/unmount bookkeeping.
 *
 * While dragging, the caller shows a determinate glyph rotated by `glyphStyle`
 * (progress, not motion); only once released into a refresh does `refreshing`
 * flip true and the caller swap in a spinner. Spinning always means "working".
 */
export function useWebPullToRefresh(
  scrollRef: RefObject<ScrollView | null>,
  onRefresh: () => Promise<void> | void,
) {
  const pull = useSharedValue(0);
  const [refreshing, setRefreshing] = useState(false);

  // Puck position/fade: opacity ramps in with the pull, and it rides down with it.
  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pull.value / PULL_TRIGGER_PX),
    transform: [{ translateY: pull.value }],
  }));

  // Determinate drag glyph: a chevron that rotates from down (0) to up (180°) as
  // the pull approaches the trigger — reflects where it's dragged, does not spin.
  const glyphStyle = useAnimatedStyle(() => ({
    transform: [{ rotate: `${Math.min(1, pull.value / PULL_TRIGGER_PX) * 180}deg` }],
  }));

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
    let busy = false; // a triggered refresh is in flight

    const easeTo = (toValue: number, duration: number) => {
      pull.value = withTiming(toValue, { duration, easing: Easing.out(Easing.cubic) });
    };

    const onStart = (e: TouchEvent) => {
      startY = !busy && node.scrollTop <= 0 ? e.touches[0].pageY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null || busy) return;
      const dy = e.touches[0].pageY - startY;
      if (dy > 0 && node.scrollTop <= 0) {
        // Direct assignment tracks the finger 1:1 and cancels any easing in flight.
        pull.value = pullOffset(dy);
        if (pull.value > 2 && e.cancelable) e.preventDefault();
      } else if (pull.value !== 0) {
        pull.value = 0;
      }
    };
    const finish = () => {
      if (startY == null) return;
      const reached = shouldTrigger(pull.value);
      startY = null;
      if (reached) {
        busy = true;
        setRefreshing(true); // released past the threshold → now spinning/working
        easeTo(PULL_REST_PX, 180); // settle to the resting spot while loading
        Promise.resolve(onRefresh()).finally(() => {
          busy = false;
          setRefreshing(false);
          easeTo(0, 320); // eased snap-back
        });
      } else {
        easeTo(0, 320); // eased snap-back (did not reach the threshold)
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
  }, [scrollRef, onRefresh, pull]);

  return { enabled: isTouchWeb, style, glyphStyle, refreshing };
}
