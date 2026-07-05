import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { buildSleepHeatmap } from '@/features/insights/compute';
import { SleepHeatmap } from '@/features/insights/SleepHeatmap';
import { hexA } from '@/lib/color';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Insights() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const loadInsights = useAppStore((s) => s.loadInsights);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.insightsEntries);
  const [width, setWidth] = useState(0);
  const heatRows = useMemo(() => buildSleepHeatmap(entries, now, 28), [entries, now]);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginBottom: 10, textTransform: 'uppercase' }}>
        Sleep
      </Txt>
      <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 15 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <Txt weight={700} size={16}>Sleep rhythm</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: t.activity.sleep }} />
              <Txt weight={600} size={11} color={t.dim}>Night</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: hexA(t.activity.sleep, t.dark ? 0.5 : 0.42) }} />
              <Txt weight={600} size={11} color={t.dim}>Nap</Txt>
            </View>
          </View>
        </View>
        <Txt weight={500} size={11.5} color={t.dim} style={{ marginBottom: 6 }}>Last 4 weeks · midnight-centred</Txt>
        <SleepHeatmap rows={heatRows} width={width - 30} />
      </View>
    </View>
  );

  if (desktop) return <DesktopPage maxWidth={640}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>Insights</Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      {body}
    </ScrollView>
  );
}
