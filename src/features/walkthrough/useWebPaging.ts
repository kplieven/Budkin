import { type RefObject, useEffect, useRef } from 'react';
import { Platform, type ScrollView } from 'react-native';

import { IDLE_WHEEL_PAGER, dragScrollLeft, readWheel, stepFromDrag } from '@/features/walkthrough/pager';

/** Finger travel (px) before a drag commits to an axis, so a tap stays a tap. */
const AXIS_LOCK_PX = 8;

/**
 * Drives a horizontal pager on web, where `pagingEnabled` is only
 * `scroll-snap-type: x mandatory`. Mandatory snap lets the fling run its own
 * momentum and then lands on whichever snap point it happened to reach, so a
 * brisk wheel gesture or a hard swipe crosses several pages at once.
 *
 * So the browser does not get to scroll the deck at all: snap is switched off,
 * `touch-action` keeps the horizontal axis for us, and wheel and touch are both
 * translated into one-slide steps. A drag tracks the finger but is bounded to
 * one page either side of where it began, so the neighbouring slide is the most
 * that can ever come into view. Releasing commits that page or eases back.
 *
 * `onStep` receives -1, 0 or +1: 0 means the gesture fell short and the deck
 * should settle back onto the slide it started from.
 *
 * No-op on native, where `pagingEnabled` already pages one slide per swipe.
 */
export function useWebPaging(
  scrollRef: RefObject<ScrollView | null>,
  count: number,
  onStep: (delta: -1 | 0 | 1) => void,
  enabled: boolean,
) {
  // Kept in a ref so a re-render mid-gesture cannot resurrect stale travel.
  const wheel = useRef(IDLE_WHEEL_PAGER);
  // Read through a ref so the listeners never have to be torn down and
  // re-attached when the callback identity changes (it closes over the index).
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

    // Snap would both re-run its own momentum and fight the scrollLeft writes below.
    const prevSnap = node.style.scrollSnapType;
    const prevTouchAction = node.style.touchAction;
    node.style.scrollSnapType = 'none';
    node.style.touchAction = 'pan-y'; // vertical still belongs to the page

    const onWheel = (e: WheelEvent) => {
      const r = readWheel(wheel.current, e, e.timeStamp);
      wheel.current = r.state;
      if (e.cancelable) e.preventDefault();
      if (r.step !== 0) step.current(r.step);
    };

    let start: { x: number; y: number; scroll: number; at: number } | null = null;
    let axis: 'x' | 'y' | null = null;
    let dx = 0;

    const onTouchStart = (e: TouchEvent) => {
      // A second finger means a pinch or a two-finger scroll, not a page turn.
      if (e.touches.length !== 1) {
        start = null;
        return;
      }
      const t = e.touches[0];
      start = { x: t.pageX, y: t.pageY, scroll: node.scrollLeft, at: e.timeStamp };
      axis = null;
      dx = 0;
    };

    const onTouchMove = (e: TouchEvent) => {
      if (!start || e.touches.length !== 1) return;
      const t = e.touches[0];
      dx = t.pageX - start.x;
      const dy = t.pageY - start.y;
      if (axis === null) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) < AXIS_LOCK_PX) return;
        axis = Math.abs(dx) > Math.abs(dy) ? 'x' : 'y';
      }
      if (axis !== 'x') return;
      // Holding the default is what stops the browser adding its own momentum.
      if (e.cancelable) e.preventDefault();
      node.scrollLeft = dragScrollLeft(start.scroll, dx, node.clientWidth, count);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!start) return;
      const elapsed = e.timeStamp - start.at;
      const dragged = axis === 'x';
      const travel = dx;
      start = null;
      axis = null;
      dx = 0;
      if (dragged) step.current(stepFromDrag(travel, node.clientWidth, elapsed));
    };

    node.addEventListener('wheel', onWheel, { passive: false });
    node.addEventListener('touchstart', onTouchStart, { passive: true });
    node.addEventListener('touchmove', onTouchMove, { passive: false });
    node.addEventListener('touchend', onTouchEnd, { passive: true });
    node.addEventListener('touchcancel', onTouchEnd, { passive: true });
    return () => {
      node.style.scrollSnapType = prevSnap;
      node.style.touchAction = prevTouchAction;
      node.removeEventListener('wheel', onWheel);
      node.removeEventListener('touchstart', onTouchStart);
      node.removeEventListener('touchmove', onTouchMove);
      node.removeEventListener('touchend', onTouchEnd);
      node.removeEventListener('touchcancel', onTouchEnd);
      wheel.current = IDLE_WHEEL_PAGER;
    };
  }, [scrollRef, count, enabled]);
}
