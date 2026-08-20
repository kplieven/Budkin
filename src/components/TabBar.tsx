import { View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { TABS, TAB_NAMES, type TabName } from '@/components/tabs';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

interface TabBarProps {
  activeName: TabName | null;
  onSelect: (name: TabName) => void;
}

/**
 * The bottom bar. Driven by the shared `TABS` table rather than by the navigator's
 * route list, so a screen with no tab navigator above it (Timers, on the root
 * Stack) can render it and pass a router navigation instead. It always renders all
 * six items, so a screen can rely on its bottom safe-area padding either way.
 */
export function AppTabBar({ activeName, onSelect }: TabBarProps) {
  const t = useTheme();
  const insets = useSafeAreaInsets();

  return (
    <View
      style={{
        flexDirection: 'row',
        borderTopWidth: 1,
        borderTopColor: t.line,
        backgroundColor: t.surface,
        paddingTop: 4,
        paddingHorizontal: 8,
        paddingBottom: insets.bottom > 0 ? insets.bottom : 12,
      }}
    >
      {TAB_NAMES.map((name) => {
        const meta = TABS[name];
        const active = activeName === name;
        const color = active ? t.primary : t.faint;
        return (
          <Tappable
            key={name}
            onPress={() => onSelect(name)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            accessibilityLabel={meta.label}
            style={(s) => [
              { flex: 1, alignItems: 'center', gap: 3, paddingTop: 8, paddingBottom: 4, cursor: 'pointer' },
              !active && isHovered(s) && { opacity: 0.75 },
            ]}
          >
            <Icon
              name={meta.icon}
              color={color}
              size={24}
              fill={active && name === '(home)' ? hexA(t.primary, 0.22) : undefined}
            />
            <Txt unselectable weight={700} size={11} color={color}>
              {meta.label}
            </Txt>
          </Tappable>
        );
      })}
    </View>
  );
}
