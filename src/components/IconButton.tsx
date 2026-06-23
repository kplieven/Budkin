import { Pressable, type ViewStyle } from 'react-native';

import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme/useTheme';

interface IconButtonProps {
  name: IconName;
  onPress?: () => void;
  color?: string;
  size?: number;
  style?: ViewStyle;
}

/** 40×40 rounded square icon button (settings, close, back). */
export function IconButton({ name, onPress, color, size = 22, style }: IconButtonProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[
        {
          width: 40,
          height: 40,
          borderRadius: 13,
          backgroundColor: t.chip,
          borderWidth: 1.5,
          borderColor: t.line,
          alignItems: 'center',
          justifyContent: 'center',
        },
        style,
      ]}
    >
      <Icon name={name} color={color ?? t.dim} size={size} />
    </Pressable>
  );
}
