/**
 * How much of the app's window the native on-screen keyboard covers, in dp.
 *
 * Android runs EDGE-TO-EDGE (`edgeToEdgeEnabled=true` in android/gradle.properties, and
 * non-negotiable from Android 15), which quietly turns the manifest's
 * `windowSoftInputMode="adjustResize"` into a no-op: the window keeps its full height and
 * the IME is simply drawn on top of it. Nothing in the tree moves on its own, so a focused
 * TextInput near the bottom — every bottom sheet's, and the tail of the onboarding, baby
 * setup and settings forms — ends up behind the keyboard.
 *
 * The fix is to re-create what adjustResize used to do, in JS: shrink the app's root by
 * this height (src/app/_layout.tsx, via MARGIN — see the note there, padding moves only
 * the flow children and leaves the absolutely positioned sheets behind the keyboard).
 * Everything laid out inside it then follows, and Android's own ScrollView.onSizeChanged
 * scrolls the focused field back into the smaller viewport for free — the same mechanism
 * that made adjustResize work before.
 *
 * Android only, deliberately:
 *   - web already has its own, very different correction (visualViewport, in BottomSheet);
 *     the layout viewport there does not shrink either, but the fix must be applied to the
 *     sheet rather than the root, and `useWindowDimensions().height` is ALREADY the visual
 *     height, so shrinking the root as well would double-count.
 *   - iOS has the same gap and no handling at all, but the payload's geometry differs (it
 *     includes the home indicator) and there is no iOS device here to verify against, so
 *     it is left for someone who can test it.
 */

import { useEffect, useState } from 'react';
import { Keyboard, Platform } from 'react-native';

import { nativeKeyboardHeight } from '@/components/keyboardInset';

export function useKeyboardHeight(): number {
  const [height, setHeight] = useState(0);
  useEffect(() => {
    if (Platform.OS !== 'android') return;
    // `did`, not `will`: Android never emits the `will` pair.
    const show = Keyboard.addListener('keyboardDidShow', (e) =>
      setHeight(nativeKeyboardHeight(e.endCoordinates.height)),
    );
    const hide = Keyboard.addListener('keyboardDidHide', () => setHeight(0));
    return () => {
      show.remove();
      hide.remove();
    };
  }, []);
  return height;
}
