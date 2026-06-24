/**
 * Hand-built sheet/dialog using Reanimated 4 (see memory: @gorhom/bottom-sheet
 * is broken on Reanimated 4). It owns the frame + entrance only; consumers pass
 * the header/body/footer as children.
 *
 * Two presentations, chosen automatically by viewport (useDesktopShell):
 *  - Phone: a slide-up bottom sheet (28px top radius, 92% max-height, .26s
 *    cubic-bezier slide) with a grabber you drag down to dismiss.
 *  - Desktop/large screen: a centered modal dialog (capped width, all-corner
 *    radius, scale+fade "pop" entrance, no grabber) matching the web handoff's
 *    Log Modal. Dismiss via the scrim, Escape (web), or the children's own
 *    close/Cancel control.
 *
 * Mount/unmount this conditionally from the parent so the exit animation runs.
 * The panel sizes to its content up to maxHeight; give a flexible child
 * (e.g. a ScrollView with flexShrink) to make tall content scroll.
 *
 * The ENTER animation is driven by a shared value in a mount effect rather than
 * the declarative `entering={SlideInDown}` prop. On the New Architecture the
 * declarative entering animation is configured asynchronously by the native side
 * after mount; when the sheet mounts during the app's cold-start commit storm
 * (e.g. opened from a home-screen widget deep link while the app was closed),
 * that config is silently dropped and the panel is left at the animation's
 * initial off-screen state — so the sheet "doesn't open". Animating a shared
 * value from a `useEffect` runs reliably after first paint and also degrades to
 * an instant reveal under reduce-motion, so the sheet is always visible. The
 * effect also re-runs if the viewport crosses the desktop breakpoint while open
 * (sheet <-> dialog); it resets to a clean closed state first so the new
 * presentation animates from scratch rather than a stale offset.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';
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

import { useDesktopShell } from '@/shell/useDesktopShell';
import { useTheme } from '@/theme/useTheme';

interface BottomSheetProps {
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
}

export function BottomSheet({ onClose, children, maxHeightRatio = 0.92 }: BottomSheetProps) {
  const t = useTheme();
  const { width, height } = useWindowDimensions();
  const dialog = useDesktopShell();
  // `enter` is the bottom-sheet slide-in offset (off-screen -> 0). `pop` is the
  // dialog entrance progress (0 -> 1, mapped to opacity+scale). `dragY` is the
  // sheet's drag-to-dismiss offset. Kept as separate shared values so no value
  // is mutated both inside and outside an effect.
  const enter = useSharedValue(height);
  const pop = useSharedValue(0);
  const scrim = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    // Re-arm the active presentation from its closed state so a breakpoint flip
    // while open animates from scratch, not a stale offset. Only effect-owned
    // values are touched here; `dragY` stays single-owned by the gesture (the
    // immutability rule forbids mutating it both here and in onUpdate/onEnd).
    pop.value = 0;
    if (dialog) {
      pop.value = withTiming(1, { duration: 220, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    } else {
      enter.value = Dimensions.get('window').height;
      enter.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    }
    scrim.value = withTiming(1, { duration: 200 });
  }, [dialog, enter, pop, scrim]);

  // Desktop dialog: Escape dismisses (web only; native dismisses via gesture/scrim).
  useEffect(() => {
    if (!dialog || Platform.OS !== 'web' || typeof document === 'undefined') return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [dialog, onClose]);

  // Run on the JS thread to avoid worklet/runOnJS naming differences and to call
  // onClose directly. A grabber drag doesn't need per-frame UI-thread precision.
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
      {/* On desktop the scrim is decorative (Escape/close handle dismissal for AT); keep it out of the focus order. */}
      <Pressable style={{ flex: 1 }} onPress={onClose} accessible={dialog ? false : undefined} />
    </Animated.View>
  );

  if (dialog) {
    return (
      <View
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          zIndex: 40,
          alignItems: 'center',
          justifyContent: 'center',
          padding: 24,
        }}
      >
        {scrimNode}
        {/* Outer carries the radius + shadow (no overflow, or the shadow clips); */}
        {/* inner clips the children to the same radius. */}
        <Animated.View
          exiting={FadeOut.duration(150)}
          accessibilityViewIsModal
          aria-modal
          style={[
            { borderRadius: 26, borderWidth: 1, borderColor: t.line, boxShadow: t.shadow, backgroundColor: t.bg },
            dialogPanelStyle,
          ]}
        >
          <View
            style={{
              width: Math.min(560, width - 48),
              maxHeight: height * 0.88,
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

      <Animated.View exiting={SlideOutDown.duration(220)} style={{ position: 'absolute', left: 0, right: 0, bottom: 0 }}>
        <Animated.View
          style={[
            {
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
