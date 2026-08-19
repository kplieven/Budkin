import { type RefObject, useEffect, useRef, useState } from 'react';
import { Platform, type ScrollView } from 'react-native';
import { Easing, useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';

import {
  PULL_REST_PX,
  PULL_TRIGGER_PX,
  pullOffset,
  shouldTrigger,
} from '@/features/dashboard/pullToRefresh';

/** Evaluated once: the media query is stable for the life of the session. */
const isTouchWeb =
  Platform.OS === 'web' &&
  typeof window !== 'undefined' &&
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(pointer: coarse)').matches;

/**
 * Pull-to-refresh for touch-capable web, where React Native's `RefreshControl` is an
 * inert stub: it renders a bare View and drops `onRefresh`.
 *
 * No-op on native and on mouse-driven web, which has no manual refresh gesture and leans
 * on the auto-refresh when the tab regains focus. While dragging, the caller shows a
 * determinate glyph rotated by `glyphStyle`; only once released into a refresh does
 * `refreshing` flip true, so spinning always means "working".
 *
 * `suppressed` switches the gesture off for the length of another gesture that owns the
 * finger. Insights passes it while a drag is scrubbing the Rhythm plot's crosshair: these
 * listeners sit on the scroll node's DOM and inspect neither `scrollEnabled` nor
 * `e.target`, so without it a scrub drifting downward at the top of the page reloads.
 */
export function useWebPullToRefresh(
  scrollRef: RefObject<ScrollView | null>,
  onRefresh: () => Promise<void> | void,
  suppressed: boolean = false,
) {
  const pull = useSharedValue(0);
  const [refreshing, setRefreshing] = useState(false);
  // Read through a ref inside the handlers, deliberately NOT in the effect's dependency
  // array: depending on it would tear the listeners down and rebuild them on every scrub
  // start and end, discarding the in-progress gesture state each time. Synced by a no-dep
  // effect so nothing is mutated during render, since the React Compiler is on.
  const suppressedRef = useRef(suppressed);
  useEffect(() => {
    suppressedRef.current = suppressed;
  });

  const style = useAnimatedStyle(() => ({
    opacity: Math.min(1, pull.value / PULL_TRIGGER_PX),
    transform: [{ translateY: pull.value }],
  }));

  // Rotates from down to up as the pull approaches the trigger: progress, not motion.
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
      startY = !busy && !suppressedRef.current && node.scrollTop <= 0 ? e.touches[0].pageY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null || busy) return;
      // Suppression usually lands mid-drag rather than at touch-down: the caller sets it
      // from a React state update on the very touch that starts the competing gesture, so
      // the ref catches up a commit later and the guard in `onStart` misses it.
      // `startY = null` also disarms `finish`, so the gesture is dead for good rather
      // than resuming if the flag clears mid-drag.
      if (suppressedRef.current) {
        startY = null;
        easeTo(0, 320);
        return;
      }
      const dy = e.touches[0].pageY - startY;
      if (dy > 0 && node.scrollTop <= 0) {
        // Direct assignment tracks the finger and cancels any easing in flight.
        pull.value = pullOffset(dy);
        if (pull.value > 2 && e.cancelable) e.preventDefault();
      } else if (pull.value !== 0) {
        pull.value = 0;
      }
    };
    const finish = () => {
      if (startY == null) return;
      // Re-checked rather than left to `onMove`: the suppression flag can land between
      // the last touchmove and touchend, with `pull.value` already past the threshold
      // from earlier moves that ran while the ref was stale.
      const reached = !suppressedRef.current && shouldTrigger(pull.value);
      startY = null;
      if (reached) {
        busy = true;
        setRefreshing(true);
        easeTo(PULL_REST_PX, 180); // settle to the resting spot while loading
        Promise.resolve(onRefresh()).finally(() => {
          busy = false;
          setRefreshing(false);
          easeTo(0, 320);
        });
      } else {
        easeTo(0, 320);
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
