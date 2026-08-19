import type { TextStyle, ViewStyle } from 'react-native';

import type { Theme } from '@/theme/tokens';

/**
 * Shared grouped-list styling for the Settings screens: a rounded, bordered card
 * (`group`) of padded rows (`row`), under an uppercase section heading
 * (`sectionLabel`, spread into a `Txt`, hence `TextStyle` and not `ViewStyle`).
 */
export function makeSettingsListStyles(t: Theme): {
  group: ViewStyle;
  row: ViewStyle;
  sectionLabel: TextStyle;
} {
  return {
    group: {
      backgroundColor: t.surface,
      borderWidth: 1.5,
      borderColor: t.line,
      borderRadius: 18,
      overflow: 'hidden',
    },
    row: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingVertical: 15,
      paddingHorizontal: 16,
    },
    sectionLabel: {
      marginTop: 22,
      marginBottom: 9,
      marginHorizontal: 4,
    },
  };
}
