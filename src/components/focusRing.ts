import type { TextStyle } from 'react-native';

/**
 * Suppresses the browser's default focus ring on a web TextInput. Spread it into a
 * TextInput's style.
 *
 * `outlineStyle: 'none'` is what removes it; `outlineWidth: 0` does NOT, because
 * browsers ignore the width under the UA's `outline-style: auto`. RN 0.85's types
 * restrict `outlineStyle` to solid|dotted|dashed, hence the cast. No-op on native.
 *
 * This removes a focus affordance, so pair it with a visible focus state on the
 * wrapping container: `borderColor: focused ? color : t.line`, keeping borderWidth
 * fixed so the layout doesn't shift.
 */
export const noFocusRing = { outlineStyle: 'none' } as unknown as TextStyle;
