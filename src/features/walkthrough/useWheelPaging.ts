import { type RefObject, useEffect, useRef } from 'react';
import { Platform, type ScrollView } from 'react-native';

import { IDLE_WHEEL_PAGER, readWheel } from '@/features/walkthrough/pager';

/**
 * Turns wheel and trackpad gestures over a horizontal pager into one-slide
 * steps, forwards and back.
 *
 * Web only, and needed there because `pagingEnabled` on react-native-web is just
 * `scroll-snap-type: x mandatory`. Mandatory snap picks whichever snap point the
 * fling happens to decelerate near, so a brisk gesture skips slides. Taking the
 * wheel over (the listener is non-passive so `preventDefault` actually holds)
 * means the browser never scrolls the deck itself and `onStep` decides the page.
 *
 * Touch drags are deliberately left alone — native paging already handles those.
 */
export function useWheelPaging(
  scrollRef: RefObject<ScrollView | null>,
  onStep: (delta: -1 | 1) => void,
  enabled: boolean,
) {
  // Kept in a ref so a re-render mid-gesture cannot resurrect stale travel.
  const gesture = useRef(IDLE_WHEEL_PAGER);
  // Read through a ref so the listener never has to be torn down and re-attached
  // when the callback identity changes (it closes over the current slide index).
  const step = useRef(onStep);
  useEffect(() => {
    step.current = onStep;
  });

  useEffect(() => {
    if (Platform.OS !== 'web' || !enabled) return;
    const node: HTMLElement | undefined = (
      scrollRef.current as unknown as { getScrollableNode?: () => HTMLElement } | null
    )?.getScrollableNode?.();
    if (!node) return;

    const onWheel = (e: WheelEvent) => {
      const r = readWheel(gesture.current, e, e.timeStamp);
      gesture.current = r.state;
      if (e.cancelable) e.preventDefault();
      if (r.step !== 0) step.current(r.step);
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    return () => {
      node.removeEventListener('wheel', onWheel);
      gesture.current = IDLE_WHEEL_PAGER;
    };
  }, [scrollRef, enabled]);
}
