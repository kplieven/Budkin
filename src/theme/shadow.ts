import type { ViewStyle } from 'react-native';

/**
 * Wrap a CSS box-shadow string as a style object. React Native >= 0.81 supports
 * the `boxShadow` style prop on both native and web; we cast to keep older type
 * defs happy.
 */
export function shadowStyle(boxShadow: string): ViewStyle {
  return { boxShadow } as unknown as ViewStyle;
}
