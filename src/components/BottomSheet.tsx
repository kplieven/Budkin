/**
 * Hand-built bottom sheet using Reanimated 4 (see memory: @gorhom/bottom-sheet
 * is broken on Reanimated 4). Slide-up panel + fading scrim, matching the
 * handoff spec: 28px top radius, 92% max-height, .26s cubic-bezier slide.
 * Drag the grabber down to dismiss.
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
 * an instant reveal under reduce-motion, so the sheet is always visible.
 */

import type { ReactNode } from 'react';
import { useEffect } from 'react';
import { Pressable, View, useWindowDimensions } from 'react-native';
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

import { useTheme } from '@/theme/useTheme';

interface BottomSheetProps {
  onClose: () => void;
  children: ReactNode;
  maxHeightRatio?: number;
}

export function BottomSheet({ onClose, children, maxHeightRatio = 0.92 }: BottomSheetProps) {
  const t = useTheme();
  const { height } = useWindowDimensions();
  // `enter` is the mount slide-in offset (off-screen -> 0), driven only by the
  // mount effect. `dragY` is the drag-to-dismiss offset, driven only by the
  // gesture. They're kept as separate shared values (and summed in the style) so
  // neither is mutated both inside and outside an effect.
  const enter = useSharedValue(height);
  const scrim = useSharedValue(0);
  const dragY = useSharedValue(0);

  useEffect(() => {
    enter.value = withTiming(0, { duration: 260, easing: Easing.bezier(0.2, 0.8, 0.2, 1) });
    scrim.value = withTiming(1, { duration: 200 });
  }, [enter, scrim]);

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

  const panelStyle = useAnimatedStyle(() => ({ transform: [{ translateY: enter.value + dragY.value }] }));
  const scrimStyle = useAnimatedStyle(() => ({ opacity: scrim.value }));

  return (
    <View style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, zIndex: 40 }}>
      <Animated.View
        exiting={FadeOut.duration(200)}
        style={[
          { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.45)' },
          scrimStyle,
        ]}
      >
        <Pressable style={{ flex: 1 }} onPress={onClose} />
      </Animated.View>

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
            panelStyle,
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
