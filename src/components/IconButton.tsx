import { Pressable, type ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { useTheme } from '@/theme/useTheme';

interface IconButtonProps {
  name: IconName;
  /** Required: the icon alone conveys nothing to assistive tech. */
  accessibilityLabel: string;
  onPress?: () => void;
  color?: string;
  size?: number;
  style?: ViewStyle;
}

export function IconButton({ name, accessibilityLabel, onPress, color, size = 22, style }: IconButtonProps) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel}
      hitSlop={6}
      style={(s) => [
        {
          width: 40,
          height: 40,
          borderRadius: 13,
          backgroundColor: t.chip,
          borderWidth: 1.5,
          borderColor: t.line,
          alignItems: 'center',
          justifyContent: 'center',
          cursor: 'pointer',
        },
        style,
        isHovered(s) && { backgroundColor: t.elevated },
      ]}
    >
      <Icon name={name} color={color ?? t.dim} size={size} />
    </Pressable>
  );
}
