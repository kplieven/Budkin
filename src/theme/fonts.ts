/**
 * Figtree font loading + per-weight family mapping.
 *
 * React Native does NOT synthesize weights for custom fonts — each weight is a
 * distinct family name. Use `fontFamily(weight)` everywhere instead of the RN
 * `fontWeight` style prop.
 */

import { Figtree_400Regular } from '@expo-google-fonts/figtree/400Regular';
import { Figtree_500Medium } from '@expo-google-fonts/figtree/500Medium';
import { Figtree_600SemiBold } from '@expo-google-fonts/figtree/600SemiBold';
import { Figtree_700Bold } from '@expo-google-fonts/figtree/700Bold';
import { Figtree_800ExtraBold } from '@expo-google-fonts/figtree/800ExtraBold';

/** Passed to `useFonts(...)` in the root layout. */
export const FONTS_TO_LOAD = {
  Figtree_400Regular,
  Figtree_500Medium,
  Figtree_600SemiBold,
  Figtree_700Bold,
  Figtree_800ExtraBold,
};

export type FontWeight = 400 | 500 | 600 | 700 | 800;

export function fontFamily(weight: FontWeight = 400): string {
  switch (weight) {
    case 800:
      return 'Figtree_800ExtraBold';
    case 700:
      return 'Figtree_700Bold';
    case 600:
      return 'Figtree_600SemiBold';
    case 500:
      return 'Figtree_500Medium';
    default:
      return 'Figtree_400Regular';
  }
}
