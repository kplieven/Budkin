import { type RefObject, useEffect, useRef, useState } from 'react';
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
 *
 * `suppressed` lets a caller switch the gesture off for the length of some other
 * gesture that owns the finger. Insights passes it while a drag is scrubbing the
 * Rhythm plot's crosshair: these listeners sit on the scroll node's DOM and
 * inspect neither `scrollEnabled` nor `e.target`, so without it a scrub that
 * drifts downward at the top of the page reloads the screen. It defaults to
 * false, so the four callers that have no competing gesture pass nothing.
 */
export function useWebPullToRefresh(
  scrollRef: RefObject<ScrollView | null>,
  onRefresh: () => Promise<void> | void,
  suppressed: boolean = false,
) {
  const pull = useSharedValue(0);
  const [refreshing, setRefreshing] = useState(false);
  // Read through a ref inside the handlers, deliberately NOT in the effect's
  // dependency array: depending on it would tear the listeners down and rebuild
  // them on every scrub start and end, discarding the in-progress gesture state
  // (`startY`, `busy`) each time. Synced by a no-dep effect that runs after
  // every render, so nothing is mutated during render (the React Compiler is
  // on). Same shape as the `onScrubEnd` ref in SleepHeatmap.
  const suppressedRef = useRef(suppressed);
  useEffect(() => {
    suppressedRef.current = suppressed;
  });

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
      startY = !busy && !suppressedRef.current && node.scrollTop <= 0 ? e.touches[0].pageY : null;
    };
    const onMove = (e: TouchEvent) => {
      if (startY == null || busy) return;
      // Suppression usually lands mid-drag rather than at touch-down: the caller
      // sets it from a React state update on the very touch that starts the
      // competing gesture, so the ref only catches up a commit later and the
      // guard in `onStart` above misses it. Abandoning here is what actually
      // does the work. `startY = null` both stops this drag driving the
      // indicator and disarms `finish` below, so the gesture is dead for good
      // rather than resuming if the flag clears mid-drag.
      //
      // Ease back rather than dropping to 0, so a pull that was already part
      // drawn retracts the same way a released-too-short one does instead of
      // stranding a half-drawn indicator on screen. `busy` is checked first on
      // purpose: a refresh that already committed is left to finish and unwind
      // through its own `.finally`, since its spinner means real work is running.
      if (suppressedRef.current) {
        startY = null;
        easeTo(0, 320);
        return;
      }
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
      // Re-checked rather than left to `onMove`: a drag can be armed at
      // touch-down and released with no touchmove in between (a flick the
      // browser coalesces, or a scrub the user holds still), and that path would
      // otherwise release straight into a refresh. Falling through to the else
      // branch below still eases the indicator back.
      const reached = !suppressedRef.current && shouldTrigger(pull.value);
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
