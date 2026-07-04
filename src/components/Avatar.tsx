import { Image } from 'expo-image';
import { View } from 'react-native';

import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

interface AvatarChild {
  first: string;
  color: string;
  picture?: string | null;
}

/** Child avatar: real photo when present, otherwise a tinted initial tile. */
export function Avatar({
  child,
  size,
  radius,
  fontSize,
  accessibilityLabel,
}: {
  child?: AvatarChild;
  size: number;
  radius: number;
  fontSize: number;
  /** Optional accessible name (the child's name) — omit when a wrapping control already supplies one. */
  accessibilityLabel?: string;
}) {
  const t = useTheme();
  if (child?.picture) {
    return (
      <Image
        source={{ uri: child.picture }}
        style={{ width: size, height: size, borderRadius: radius }}
        contentFit="cover"
        transition={150}
        accessible={accessibilityLabel != null}
        accessibilityLabel={accessibilityLabel}
      />
    );
  }
  return (
    <View
      accessible={accessibilityLabel != null}
      accessibilityLabel={accessibilityLabel}
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        backgroundColor: child ? hexA(child.color, t.dark ? 0.32 : 0.22) : t.chip,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Txt unselectable weight={800} size={fontSize} color={child?.color ?? t.text}>
        {child ? child.first[0] : '?'}
      </Txt>
    </View>
  );
}
