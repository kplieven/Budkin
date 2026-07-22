import { type RefObject, useEffect, useRef } from 'react';
import { Platform, type ScrollView, type View } from 'react-native';

import {
  IDLE_WHEEL_PAGER,
  dragScrollLeft,
  readWheel,
  stepFromDrag,
  stepFromKey,
} from '@/features/walkthrough/pager';

/** Pointer travel (px) before a drag commits to an axis, so a tap stays a tap. */
const AXIS_LOCK_PX = 8;

/**
 * The DOM node behind a react-native-web ref: a ScrollView hands one out, a View
 * already is one. Duck-typed rather than `instanceof`, which has no meaning on
 * native (where this module never reaches the DOM at all).
 */
function domNode(ref: RefObject<unknown>): HTMLElement | null {
  const target = ref.current as unknown as { getScrollableNode?: () => HTMLElement } | null;
  if (!target) return null;
  const node = (target.getScrollableNode?.() ?? target) as HTMLElement;
  return typeof node.addEventListener === 'function' ? node : null;
}

/**
 * Drives a horizontal pager on web, where `pagingEnabled` is only
 * `scroll-snap-type: x mandatory`. Mandatory snap lets the fling run its own
 * momentum and then lands on whichever snap point it happened to reach, so a
 * brisk wheel gesture or a hard swipe crosses several pages at once.
 *
 * So the browser does not get to scroll the deck at all: snap is switched off,
 * `touch-action` keeps the horizontal axis for us, and wheel, mouse and touch are
 * all translated into one-slide steps. A drag tracks the pointer but is bounded
 * to one page either side of where it began, so the neighbouring slide is the
 * most that can ever come into view. Releasing commits that page or eases back.
 * The arrow keys turn a page outright.
 *
 * `deckRef` is the deck being scrolled; `host` is the region the gestures are
 * heard over, which is deliberately wider than the deck so a desktop pointer can
 * wheel or drag anywhere in the view rather than only over the narrow column.
 * That is also why `pageWidth` is passed in: the host is not the pager, so its
 * own width says nothing about how far one page is.
 *
 * `onStep` receives -1, 0 or +1: 0 means the gesture fell short and the deck
 * should settle back onto the slide it started from.
 *
 * No-op on native, where `pagingEnabled` already pages one slide per swipe.
 */
export function useWebPaging({
  deckRef,
  hostRef,
  count,
  pageWidth,
  onStep,
}: {
  deckRef: RefObject<ScrollView | null>;
  hostRef: RefObject<View | null>;
  count: number;
  pageWidth: number;
  onStep: (delta: -1 | 0 | 1) => void;
}) {
  // Kept in a ref so a re-render mid-gesture cannot resurrect stale travel.
  const wheel = useRef(IDLE_WHEEL_PAGER);
  // Read through a ref so the listeners never have to be torn down and
  // re-attached when the callback identity changes (it closes over the index).
  const step = useRef(onStep);
  useEffect(() => {
    step.current = onStep;
  });

  // The arrow keys are handled on the host rather than on the document, which
  // already carries the bottom sheet's Escape listener. That needs the host to be
  // able to hold focus, and to hold it from the start: a carousel whose keys only
  // wake up after a click reads as broken. `-1` keeps it out of the tab order, so
  // tabbing still goes straight to Skip and Next (whose own key events bubble
  // back up to here).
  useEffect(() => {
    if (Platform.OS !== 'web') return;
    const host = domNode(hostRef);
    if (!host) return;
    const prevTabIndex = host.getAttribute('tabindex');
    const prevOutline = host.style.outline;
    host.tabIndex = -1;
    host.style.outline = 'none';
    host.focus({ preventScroll: true });
    return () => {
      if (prevTabIndex === null) host.removeAttribute('tabindex');
      else host.setAttribute('tabindex', prevTabIndex);
      host.style.outline = prevOutline;
    };
  }, [hostRef]);

  useEffect(() => {
    if (Platform.OS !== 'web' || pageWidth <= 0) return;
    const deck = domNode(deckRef);
    const host = domNode(hostRef);
    if (!deck || !host) return;

    // Snap would both re-run its own momentum and fight the scrollLeft writes below.
    const prevSnap = deck.style.scrollSnapType;
    const prevDeckTouch = deck.style.touchAction;
    const prevHostTouch = host.style.touchAction;
    deck.style.scrollSnapType = 'none';
    // Vertical still belongs to the page, on the deck and across the whole region.
    deck.style.touchAction = 'pan-y';
    host.style.touchAction = 'pan-y';

    const onWheel = (e: WheelEvent) => {
      const r = readWheel(wheel.current, e, e.timeStamp);
      wheel.current = r.state;
      // Only what the pager actually takes: this host spans the whole view, so
      // blanket-preventing would swallow the page's own scrolling everywhere.
      if (r.consumed && e.cancelable) e.preventDefault();
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
      start = { x: t.pageX, y: t.pageY, scroll: deck.scrollLeft, at: e.timeStamp };
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
      // Holding the default is what stops the browser adding its own momentum,
      // and it also suppresses the compatibility click that would otherwise fire
      // on whatever the finger came to rest over.
      if (e.cancelable) e.preventDefault();
      deck.scrollLeft = dragScrollLeft(start.scroll, dx, pageWidth, count);
    };

    const onTouchEnd = (e: TouchEvent) => {
      if (!start) return;
      const elapsed = e.timeStamp - start.at;
      const dragged = axis === 'x';
      const travel = dx;
      start = null;
      axis = null;
      dx = 0;
      if (dragged) step.current(stepFromDrag(travel, pageWidth, elapsed));
    };

    // Mouse drag. The gesture is claimed only once the pointer has travelled far
    // enough sideways, so an ordinary click still reaches the button under it and
    // a vertical drag is handed straight back to the page.
    let mouse: { x: number; y: number; scroll: number; at: number } | null = null;
    let dragging = false;
    let mdx = 0;
    let prevUserSelect: string | null = null;
    let clickGuard: ReturnType<typeof setTimeout> | null = null;

    // The release that ends a drag must not also press whatever it landed on.
    // Caught on the way down, before React's delegated click reaches the root.
    const swallowClick = (e: MouseEvent) => {
      e.stopPropagation();
      e.preventDefault();
    };

    const endMouse = () => {
      mouse = null;
      dragging = false;
      mdx = 0;
      if (prevUserSelect !== null) {
        host.style.userSelect = prevUserSelect;
        prevUserSelect = null;
      }
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };

    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouse = { x: e.pageX, y: e.pageY, scroll: deck.scrollLeft, at: e.timeStamp };
      dragging = false;
      mdx = 0;
      // On the window, so a drag that leaves the region still finishes cleanly.
      window.addEventListener('mousemove', onMouseMove);
      window.addEventListener('mouseup', onMouseUp);
    };

    const onMouseMove = (e: MouseEvent) => {
      if (!mouse) return;
      mdx = e.pageX - mouse.x;
      const dy = e.pageY - mouse.y;
      if (!dragging) {
        if (Math.max(Math.abs(mdx), Math.abs(dy)) < AXIS_LOCK_PX) return;
        if (Math.abs(mdx) <= Math.abs(dy)) {
          endMouse(); // vertical: not ours, and it will not become ours later
          return;
        }
        dragging = true;
        // Dragging across the slide text would otherwise select it.
        prevUserSelect = host.style.userSelect;
        host.style.userSelect = 'none';
      }
      e.preventDefault();
      deck.scrollLeft = dragScrollLeft(mouse.scroll, mdx, pageWidth, count);
    };

    const onMouseUp = (e: MouseEvent) => {
      const began = mouse;
      const dragged = dragging;
      const travel = mdx;
      endMouse();
      if (!began || !dragged) return;
      host.addEventListener('click', swallowClick, true);
      if (clickGuard) clearTimeout(clickGuard);
      // Dropped again straight after the click that follows this release, so it
      // never outlives the gesture (a drag ending off-region emits no click).
      clickGuard = setTimeout(() => host.removeEventListener('click', swallowClick, true), 0);
      step.current(stepFromDrag(travel, pageWidth, e.timeStamp - began.at));
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const target = e.target as HTMLElement | null;
      const tag = target?.tagName;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target?.isContentEditable) return;
      const delta = stepFromKey(e.key);
      if (delta === 0) return;
      e.preventDefault();
      step.current(delta);
    };

    host.addEventListener('wheel', onWheel, { passive: false });
    host.addEventListener('touchstart', onTouchStart, { passive: true });
    host.addEventListener('touchmove', onTouchMove, { passive: false });
    host.addEventListener('touchend', onTouchEnd, { passive: true });
    host.addEventListener('touchcancel', onTouchEnd, { passive: true });
    host.addEventListener('mousedown', onMouseDown);
    host.addEventListener('keydown', onKeyDown);
    return () => {
      deck.style.scrollSnapType = prevSnap;
      deck.style.touchAction = prevDeckTouch;
      host.style.touchAction = prevHostTouch;
      host.removeEventListener('wheel', onWheel);
      host.removeEventListener('touchstart', onTouchStart);
      host.removeEventListener('touchmove', onTouchMove);
      host.removeEventListener('touchend', onTouchEnd);
      host.removeEventListener('touchcancel', onTouchEnd);
      host.removeEventListener('mousedown', onMouseDown);
      host.removeEventListener('keydown', onKeyDown);
      host.removeEventListener('click', swallowClick, true);
      if (clickGuard) clearTimeout(clickGuard);
      endMouse();
      wheel.current = IDLE_WHEEL_PAGER;
    };
  }, [deckRef, hostRef, count, pageWidth]);
}
