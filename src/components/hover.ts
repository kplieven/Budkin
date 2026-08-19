import type { PressableStateCallbackType } from 'react-native';

/**
 * Mouse-hover state for a Pressable on web. react-native-web adds `hovered` to the
 * style-callback state (react-native's types only declare `pressed`), hence the
 * cast. Always false on native/touch, so hover styles are a desktop-only extra.
 */
export function isHovered(state: PressableStateCallbackType): boolean {
  return (state as { hovered?: boolean }).hovered ?? false;
}
