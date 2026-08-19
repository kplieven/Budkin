import { Text, type TextProps } from 'react-native';

import { fontFamily, type FontWeight } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';

interface TxtProps extends TextProps {
  weight?: FontWeight;
  size?: number;
  color?: string;
  /** letterSpacing */
  tracking?: number;
  /** Marks chrome (button/chip/tab/control labels) as non-selectable on web. */
  unselectable?: boolean;
}

export function Txt({
  weight = 400,
  size = 15,
  color,
  tracking,
  unselectable,
  style,
  ...rest
}: TxtProps) {
  const t = useTheme();
  return (
    <Text
      {...rest}
      style={[
        { fontFamily: fontFamily(weight), fontSize: size, color: color ?? t.text },
        tracking != null && { letterSpacing: tracking },
        unselectable && { userSelect: 'none' as const },
        style,
      ]}
    />
  );
}
