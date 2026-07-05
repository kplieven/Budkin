import { useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { buildDiaperSeries, buildSleepHeatmap, buildTrend } from '@/features/insights/compute';
import { NORMS } from '@/features/insights/norms';
import { DiaperBars } from '@/features/insights/DiaperBars';
import { SleepHeatmap } from '@/features/insights/SleepHeatmap';
import { TrendCard } from '@/features/insights/TrendCard';
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

  const birth = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.birth ?? s.now);
  const [rangeDays, setRangeDays] = useState(30);
  const RANGES: [string, number][] = [['2 weeks', 14], ['1 month', 30], ['3 months', 90]];

  const totalSleep = useMemo(() => buildTrend(entries, 'totalSleep', now, rangeDays), [entries, now, rangeDays]);
  const longest = useMemo(() => buildTrend(entries, 'longestStretch', now, rangeDays), [entries, now, rangeDays]);
  const wake = useMemo(() => buildTrend(entries, 'wakeWindow', now, rangeDays), [entries, now, rangeDays]);
  const feeds = useMemo(() => buildTrend(entries, 'feedsPerDay', now, rangeDays), [entries, now, rangeDays]);
  const interval = useMemo(() => buildTrend(entries, 'feedInterval', now, rangeDays), [entries, now, rangeDays]);
  const diapers = useMemo(() => buildDiaperSeries(entries, now, rangeDays), [entries, now, rangeDays]);
  const lastVal = (pts: { value: number }[]) => (pts.length ? pts[pts.length - 1].value : 0);

  useEffect(() => {
    loadInsights();
  }, [loadInsights]);

  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3, marginBottom: 6 }}>
        {RANGES.map(([lbl, d]) => (
          <Pressable key={d} onPress={() => setRangeDays(d)} accessibilityRole="button" style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: rangeDays === d ? t.surface : 'transparent', alignItems: 'center' }}>
            <Txt weight={rangeDays === d ? 700 : 600} size={13} color={rangeDays === d ? t.text : t.dim}>{lbl}</Txt>
          </Pressable>
        ))}
      </View>
      <Txt weight={500} size={11} color={t.faint} style={{ marginLeft: 4, marginBottom: 14 }}>Applies to trend charts</Txt>
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

      <TrendCard label="Total sleep / day" color={t.activity.sleep} unit="h" value={lastVal(totalSleep).toFixed(1)}
        caption="Typical for age" norm={NORMS.totalSleep} birth={birth} points={totalSleep}
        yTicks={[10, 12, 14, 16, 18]} fmtY={(v) => `${v}h`} width={width} />
      <TrendCard label="Longest stretch / night" color={t.activity.sleep} unit="h" value={lastVal(longest).toFixed(1)}
        caption="Rule of thumb" norm={NORMS.longestStretch} birth={birth} points={longest}
        yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}h`} width={width} />
      <TrendCard label="Avg wake window" color={t.activity.sleep} unit="min" value={Math.round(lastVal(wake)).toString()}
        caption="Rule of thumb" norm={NORMS.wakeWindow} birth={birth} points={wake}
        yTicks={[30, 60, 90, 120, 150]} fmtY={(v) => `${v}`} width={width} />
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 2, textTransform: 'uppercase' }}>
        Feeding
      </Txt>
      <TrendCard label="Feeds / day" color={t.activity.feeding} unit="" value={Math.round(lastVal(feeds)).toString()}
        caption="Typical for age" norm={NORMS.feedsPerDay} birth={birth} points={feeds}
        yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}`} width={width} />
      <TrendCard label="Avg interval between feeds" color={t.activity.feeding} unit="h" value={lastVal(interval).toFixed(1)}
        norm={NORMS.feedInterval} birth={birth} points={interval}
        yTicks={[0, 1, 2, 3, 4]} fmtY={(v) => `${v}h`} width={width} />
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 12, textTransform: 'uppercase' }}>
        Diapers
      </Txt>
      <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 16 }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 }}>
          <Txt weight={700} size={15}>Wet vs dirty / day</Txt>
          <View style={{ flexDirection: 'row', gap: 12 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.insightWet }} />
              <Txt weight={600} size={11} color={t.dim}>Wet</Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <View style={{ width: 10, height: 10, borderRadius: 3, backgroundColor: t.insightDirty }} />
              <Txt weight={600} size={11} color={t.dim}>Dirty</Txt>
            </View>
          </View>
        </View>
        <DiaperBars data={diapers} width={width - 32} />
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
