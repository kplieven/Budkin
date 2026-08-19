import type { ViewStyle } from 'react-native';

/**
 * Wrap a CSS box-shadow string as a style object. React Native >= 0.81 supports
 * `boxShadow` on both native and web; the cast keeps older type defs happy.
 */
export function shadowStyle(boxShadow: string): ViewStyle {
  return { boxShadow } as unknown as ViewStyle;
}
