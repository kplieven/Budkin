/**
 * Hand-built sheet/dialog, because @gorhom/bottom-sheet is broken on Reanimated 4. It
 * owns the frame and entrance only, and the parent must mount and unmount it
 * conditionally so the exit animation runs.
 *
 * The ENTER animation is driven by a shared value in a mount effect rather than the
 * declarative `entering={SlideInDown}` prop. On the New Architecture that prop is
 * configured asynchronously by the native side after mount, and when the sheet mounts
 * during the app's cold-start commit storm (opened from a widget deep link while the app
 * was closed), the config is silently dropped and the panel is left off-screen, so the
 * sheet "doesn't open". A shared value animated from a `useEffect` runs reliably after
 * first paint and degrades to an instant reveal under reduce-motion.
 */

import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { Dimensions, Platform, Pressable, View, useWindowDimensions } from 'react-native';
import { Gesture, GestureDetector } from 'react-native-gesture-handler';
import Animated, {
  Easing,
  FadeOut,
  SlideOutDown,
  useAnimatedStyle,
  useSharedValue,
  withSpring,
  withTiming,
} from 'react-native-reanimated';

import { keyboardInset, raisesKeyboard } from '@/components/keyboardInset';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useTheme } from '@/theme/useTheme';

// On mobile web the on-screen keyboard does not resize the page. The LAYOUT viewport
// keeps its full height and the keyboard simply covers its bottom edge; only the VISUAL
// viewport shrinks, and the browser may additionally pan it. So a bottom:0 sheet stays
// pinned behind the keyboard and must be raised by exactly the covered height.
//
// The lift is gated on an actually-focused text field, NOT on the size of the gap. iOS
// Safari's innerHeight and visualViewport.height differ AT REST (the large address bar,
// overscroll offsetTop, a keyboard caught mid-dismiss), so the gap alone lifted the sheet
// about a keyboard height with no keyboard on screen, and a size threshold instead fights
// Safari's focus auto-pan.
//
// `useWindowDimensions().height` cannot stand in for this: react-native-web 0.21 feeds it
// visualViewport.height, so it already shrinks by the keyboard. That makes it right for
// capping the panel's HEIGHT, but it says nothing about where the visible bottom edge
// sits inside the layout viewport, and subtracting this inset from it double-counts.
function useKeyboardInset() {
  const [inset, setInset] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'web' || typeof window === 'undefined' || !window.visualViewport) return;
    const vv = window.visualViewport;
    const update = () => {
      const focused = raisesKeyboard(document.activeElement);
      const covered = keyboardInset(window.innerHeight, vv.height, vv.offsetTop, focused);
      setInset(covered);
      // The browser's own focus-reveal scroll ran BEFORE the sheet moved, so re-reveal
      // the focused field once the lifted layout has committed: React's flush, then a
      // frame.
      if (covered > 0) {
        requestAnimationFrame(() =>
          requestAnimationFrame(() => {
            const el = document.activeElement;
            if (el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) {
              el.scrollIntoView({ block: 'nearest' });
            }
          }),
        );
      }
    };
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
    };
  }, []);
  return inset;
}

interface BottomSheetProps {
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
  /** Desktop dialog placement; ignored in phone sheet mode. */
  anchor?: 'center' | 'bottom-left';
  /** Measured on-screen rect (from the trigger's `measureInWindow`) to open a
   *  'bottom-left' popover next to, instead of the screen's actual bottom-left
   *  corner. Ignored for `anchor="center"` and in phone sheet mode. */
  anchorRect?: { x: number; y: number; width: number; height: number } | null;
}

export function BottomSheet({
  onClose,
  children,
  maxHeightRatio = 0.92,
  anchor = 'center',
  anchorRect = null,
}: BottomSheetProps) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const dialog = useDesktopShell();
  // Applied as the phone wrapper's layout `bottom`, deliberately not via the animated
  // transform, so the correction never depends on a React-state-in-worklet round trip.
  const keyboardInset = useKeyboardInset();
  // Separate shared values so none is mutated both inside and outside an effect.
  const enter = useSharedValue(height);
  const pop = useSharedValue(0);
  const scrim = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    // Re-arm from the closed state so a breakpoint flip while open animates from scratch,
    // not a stale offset. `dragY` stays single-owned by the gesture.
    pop.value = 0;
    if (dialog) {
      pop.value = withTiming(1, { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    } else {
      enter.value = Dimensions.get('window').height;
      enter.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    }
    scrim.value = withTiming(1, { duration: 200 });
  }, [dialog, enter, pop, scrim]);

  useEffect(() => {
    if (!dialog || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  // On the JS thread, to avoid worklet/runOnJS naming differences and call onClose
  // directly. A grabber drag does not need per-frame UI-thread precision.
  const pan = Gesture.Pan()
    .runOnJS(true)
    .onUpdate((e) => {
      dragY.value = Math.max(0, e.translationY);
    })
    .onEnd((e) => {
      if (e.translationY > 90 || e.velocityY > 600) {
        dragY.value = withTiming(height, { duration: 180 });
        onClose();
      } else {
        dragY.value = withSpring(0, { damping: 18, stiffness: 200 });
      }
    });

  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));
  const sheetPanelStyle = useAnimatedStyle(() => ({
    transform: [{ translateY: enter.value + dragY.value }],
  }));
  const dialogPanelStyle = useAnimatedStyle(() => ({
    opacity: pop.value,
    transform: [{ translateY: (1 - pop.value) * 10 }, { scale: 0.98 + pop.value * 0.02 }],
  }));

  const scrimNode = (
    <Animated.View
      exiting={FadeOut.duration(200)}
      style={[
        { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
        scrimStyle,
      ]}
    >
      {/* Decorative on desktop, where Escape and the close button handle dismissal. */}
      <Pressable style={{ flex: 1, cursor: 'auto' }} onPress={onClose} accessible={dialog ? false : undefined} />
    </Animated.View>
  );

  if (dialog) {
    const popover = anchor === 'bottom-left';
    const popoverWidth = 340;
    const popoverMaxHeight = height * 0.7;
    // A rect to open next to beats the corner: the corner is only ever right for
    // the one trigger that happens to sit there (the desktop sidebar's child
    // card), and looks disconnected from anywhere else a popover trigger lives.
    // Clamped into the viewport so a trigger near an edge can't push the panel
    // off-screen.
    const positioned =
      popover && anchorRect
        ? {
            left: Math.min(Math.max(anchorRect.x, 12), width - popoverWidth - 12),
            top: Math.min(Math.max(anchorRect.y + anchorRect.height + 8, 12), height - popoverMaxHeight - 12),
          }
        : null;

    return (
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          ...(positioned
            ? {}
            : { alignItems: popover ? 'flex-start' : 'center', justifyContent: popover ? 'flex-end' : 'center' }),
          padding: positioned ? 0 : 24,
        }}
      >
        {scrimNode}
        {/* Outer carries the radius and shadow (no overflow, or the shadow clips); inner clips the children. */}
        <Animated.View
          exiting={FadeOut.duration(150)}
          accessibilityViewIsModal
          aria-modal
          style={[
            { borderRadius: 26, borderWidth: 1, borderColor: t.line, boxShadow: t.shadow, backgroundColor: t.bg },
            positioned && { position: 'absolute', left: positioned.left, top: positioned.top },
            dialogPanelStyle,
          ]}
        >
          <View
            style={{
              width: popover ? popoverWidth : Math.min(560, width - 48),
              maxHeight: popover ? popoverMaxHeight : height * 0.88,
              borderRadius: 26,
              overflow: 'hidden',
              backgroundColor: t.bg,
            }}
          >
            {children}
          </View>
        </Animated.View>
      </View>
    );
  }

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}>
      {scrimNode}

      {/* bottom = keyboardInset pins the sheet to the VISIBLE bottom edge (top of
          the mobile-web keyboard); 0 on native and desktop. */}
      <Animated.View
        exiting={SlideOutDown.duration(220)}
        style={{ position: 'absolute', left: 0, right: 0, bottom: keyboardInset }}
      >
        <Animated.View
          style={[
            {
              // react-native-web derives `height` from visualViewport.height, which
              // already excludes the keyboard. Subtracting keyboardInset double-counts.
              maxHeight: height * maxHeightRatio,
              backgroundColor: t.bg,
              borderTopLeftRadius: 28,
              borderTopRightRadius: 28,
              borderWidth: 1,
              borderBottomWidth: 0,
              borderColor: t.line,
              boxShadow: '0px -8px 40px rgba(0,0,0,0.4)',
            },
            sheetPanelStyle,
          ]}
        >
          <GestureDetector gesture={pan}>
            <View style={{ paddingTop: 10, paddingBottom: 4, alignItems: 'center' }}>
              <View style={{ width: 40, height: 5, borderRadius: 99, backgroundColor: t.line2 }} />
            </View>
          </GestureDetector>
          {children}
        </Animated.View>
      </Animated.View>
    </View>
  );
}
