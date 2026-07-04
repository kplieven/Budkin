import { Pressable, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';

/** Minimal subset of expo-router's tab bar props (avoids importing react-navigation). */
interface TabBarProps {
  state: { index: number; routes: { key: string; name: string }[] };
  navigation: { navigate: (name: string) => void };
}

const TABS: Record<string, { label: string; icon: IconName }> = {
  index: { label: 'Home', icon: 'home' },
  timers: { label: 'Timers', icon: 'timer' },
  history: { label: 'History', icon: 'list' },
  growth: { label: 'Growth', icon: 'chart' },
};

export function AppTabBar({ state, navigation }: TabBarProps) {
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
      {state.routes.map((route, i) => {
        const meta = TABS[route.name];
        if (!meta) return null;
        const active = state.index === i;
        const color = active ? t.primary : t.faint;
        return (
          <Pressable
            key={route.key}
            onPress={() => navigation.navigate(route.name)}
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
              fill={active && route.name === 'index' ? hexA(t.primary, 0.22) : undefined}
            />
            <Txt weight={700} size={11} color={color}>
              {meta.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}
