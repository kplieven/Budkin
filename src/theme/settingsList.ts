import type { TextStyle, ViewStyle } from 'react-native';

import type { Theme } from '@/theme/tokens';

/**
 * Shared grouped-list styling for the Settings screens (`settings/index.tsx`
 * and `settings/notifications.tsx`): a rounded, bordered card (`group`)
 * containing padded rows (`row`), preceded by an uppercase section heading
 * (`sectionLabel`, spread into a `Txt`, hence `TextStyle` rather than
 * `ViewStyle`). Theme-derived (border/background colors come from the
 * active `Theme`), so this is a function of the theme rather than a static
 * style object, exactly like `makeTheme` in `./tokens`.
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
