import type { TextStyle } from 'react-native';

/**
 * Suppresses the browser's default focus ring on a text input on web. Spread it
 * into a TextInput's style.
 *
 * react-native-web's TextInput base style resets `border` but leaves `outline`
 * alone, so a focused <input> shows the user-agent :focus-visible outline — a
 * square that clashes with our rounded input pills/containers. `outlineStyle:
 * 'none'` removes it; `outlineWidth: 0` does NOT, because with the UA's
 * `outline-style: auto` browsers ignore the width. RN 0.85's types restrict
 * `outlineStyle` to solid|dotted|dashed, so we set it through a cast (as in
 * shadow.ts / hover.ts). No-op on native, which has no `outline` concept.
 *
 * Suppressing the ring removes a focus affordance, so always pair this with a
 * visible focus state on the wrapping container. The house style is the same
 * one Chip/ValuePill use for "active": tint the border with the accent color,
 * `borderColor: focused ? color : t.line`, keeping borderWidth fixed so the
 * layout doesn't shift.
 */
export const noFocusRing = { outlineStyle: 'none' } as unknown as TextStyle;
