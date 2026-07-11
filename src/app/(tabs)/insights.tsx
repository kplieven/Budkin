import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { buildDiaperSeries, buildSleepHeatmap, buildTrend, DAY } from '@/features/insights/compute';
import { NORMS } from '@/features/insights/norms';
import { DiaperBars } from '@/features/insights/DiaperBars';
import { SleepHeatmap } from '@/features/insights/SleepHeatmap';
import { TrendCard } from '@/features/insights/TrendCard';
import { hexA } from '@/lib/color';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

function KeepLogging({ what }: { what: string }) {
  const t = useTheme();
  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 20, marginTop: 12 }}>
      <Txt weight={600} size={13.5} color={t.dim} style={{ lineHeight: 20 }}>
        Your {what} chart will appear after a few days of logging.
      </Txt>
    </View>
  );
}

function CenteredState({ title, subtitle, action }: {
  title: string; subtitle: string; action?: { label: string; onPress: () => void };
}) {
  const t = useTheme();
  return (
    <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
      <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
        <Icon name="insights" color={t.faint} size={34} />
      </View>
      <Txt weight={700} size={16}>{title}</Txt>
      <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>{subtitle}</Txt>
      {action ? (
        <Pressable onPress={action.onPress} accessibilityRole="button" style={{ marginTop: 4, backgroundColor: t.primary, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 22 }}>
          <Txt weight={700} size={14} color={t.onPrimary}>{action.label}</Txt>
        </Pressable>
      ) : null}
    </View>
  );
}

export default function Insights() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const loadInsights = useAppStore((s) => s.loadInsights);
  // Insights is retrospective: hour-quantized `now` keeps memos stable between
  // ticks, and quantizing inside the selector means the per-second store tick
  // doesn't re-render this screen at all. The heatmap's Today-window anchor
  // rolls over within the hour of the noon boundary (exact in whole-hour
  // timezones).
  const nowH = useAppStore((s) => Math.floor(s.now / 3600000) * 3600000);
  const entries = useAppStore((s) => s.insightsEntries);
  const [width, setWidth] = useState(0);
  const heatRows = useMemo(() => buildSleepHeatmap(entries, nowH, 28), [entries, nowH]);

  const birth = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.birth ?? s.now);
  const [rangeDays, setRangeDays] = useState(30);
  const RANGES: [string, number][] = [['2 weeks', 14], ['1 month', 30], ['3 months', 90]];

  const totalSleep = useMemo(() => buildTrend(entries, 'totalSleep', nowH, rangeDays), [entries, nowH, rangeDays]);
  const longest = useMemo(() => buildTrend(entries, 'longestStretch', nowH, rangeDays), [entries, nowH, rangeDays]);
  const wake = useMemo(() => buildTrend(entries, 'wakeWindow', nowH, rangeDays), [entries, nowH, rangeDays]);
  const feeds = useMemo(() => buildTrend(entries, 'feedsPerDay', nowH, rangeDays), [entries, nowH, rangeDays]);
  const interval = useMemo(() => buildTrend(entries, 'feedInterval', nowH, rangeDays), [entries, nowH, rangeDays]);
  const diapers = useMemo(() => buildDiaperSeries(entries, nowH, rangeDays), [entries, nowH, rangeDays]);
  const lastVal = (pts: { value: number }[]) => (pts.length ? pts[pts.length - 1].value : 0);
  // The big number is the current (partial) window's value — only call it
  // "today so far" when that last point really is today's window.
  const isToday = (pts: { t: number }[]) => pts.length > 0 && nowH - pts[pts.length - 1].t < DAY;

  const loaded = useAppStore((s) => s.insightsLoaded);
  const error = useAppStore((s) => s.insightsError);
  const daysWithSleep = heatRows.filter((r) => r.segments.length > 0).length;
  const enoughForChart = (pts: unknown[]) => pts.length >= 3;
  // delta for longest stretch: last minus first in range, when there's a span.
  // Shown for both gains and losses (>= 0.5h), sign-colored, and labeled with
  // what it compares against so it reads honestly ("vs 2 wks ago", etc.).
  const stretchDelta = longest.length >= 2 ? longest[longest.length - 1].value - longest[0].value : 0;
  const stretchDeltaShown = Math.abs(stretchDelta) >= 0.5;
  const stretchDeltaText = stretchDelta > 0 ? `+${stretchDelta.toFixed(1)}h` : `${stretchDelta.toFixed(1)}h`;
  const stretchNote = rangeDays === 14 ? 'vs 2 wks ago' : rangeDays === 90 ? 'vs 3 mo ago' : 'vs 1 mo ago';
  const gated = (pts: unknown[], what: string, node: ReactNode): ReactNode =>
    enoughForChart(pts) ? node : <KeepLogging what={what} />;

  // Re-run on child switch — selectChild resets the cache, this refills it.
  useEffect(() => {
    loadInsights();
  }, [loadInsights, selectedChildId]);

  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3, marginBottom: 6 }}>
        {RANGES.map(([lbl, d]) => (
          <Pressable key={d} onPress={() => setRangeDays(d)} accessibilityRole="button" accessibilityState={{ selected: rangeDays === d }} style={{ flex: 1, paddingVertical: 8, borderRadius: 10, backgroundColor: rangeDays === d ? t.surface : 'transparent', alignItems: 'center' }}>
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
        <Txt weight={500} size={11.5} color={t.dim} style={{ marginBottom: 6 }}>Last 4 weeks, midnight in the middle</Txt>
        {daysWithSleep >= 7 ? (
          <SleepHeatmap rows={heatRows} width={width - 30} now={nowH} />
        ) : (
          <Txt weight={600} size={13} color={t.dim} style={{ paddingVertical: 18, lineHeight: 20 }}>
            Log about a week of sleep to see the rhythm heatmap here.
          </Txt>
        )}
      </View>

      {gated(totalSleep, 'total sleep', (
        <TrendCard label="Total sleep / day" color={t.activity.sleep} unit="h" value={lastVal(totalSleep).toFixed(1)}
          caption="Typical for age" norm={NORMS.totalSleep} birth={birth} points={totalSleep}
          yTicks={[10, 12, 14, 16, 18]} fmtY={(v) => `${v}h`} width={width} todaySoFar={isToday(totalSleep)} />
      ))}
      {gated(longest, 'longest stretch', (
        <TrendCard label="Longest stretch / night" color={t.activity.sleep} unit="h" value={lastVal(longest).toFixed(1)}
          caption="Rule of thumb" norm={NORMS.longestStretch} birth={birth} points={longest}
          yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}h`} width={width} todaySoFar={isToday(longest)}
          delta={stretchDeltaShown ? stretchDeltaText : undefined} deltaGood={stretchDelta > 0}
          deltaNote={stretchDeltaShown ? stretchNote : undefined} />
      ))}
      {gated(wake, 'wake window', (
        <TrendCard label="Avg wake window" color={t.activity.sleep} unit="min" value={Math.round(lastVal(wake)).toString()}
          caption="Rule of thumb" norm={NORMS.wakeWindow} birth={birth} points={wake}
          yTicks={[0, 60, 120, 180, 240]} fmtY={(v) => `${v}`} width={width} />
      ))}
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 2, textTransform: 'uppercase' }}>
        Feeding
      </Txt>
      {gated(feeds, 'feeds per day', (
        <TrendCard label="Feeds / day" color={t.activity.feeding} unit="" value={Math.round(lastVal(feeds)).toString()}
          caption="Typical for age" norm={NORMS.feedsPerDay} birth={birth} points={feeds}
          yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}`} width={width} todaySoFar={isToday(feeds)} />
      ))}
      {gated(interval, 'feed interval', (
        <TrendCard label="Avg interval between feeds" color={t.activity.feeding} unit="h" value={lastVal(interval).toFixed(1)}
          norm={NORMS.feedInterval} birth={birth} points={interval}
          yTicks={[0, 1, 2, 3, 4]} fmtY={(v) => `${v}h`} width={width} />
      ))}
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 12, textTransform: 'uppercase' }}>
        Diapers
      </Txt>
      {diapers.length >= 3 ? (
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
      ) : (
        <KeepLogging what="diaper" />
      )}
    </View>
  );

  // Phone shows the inline header; desktop uses the shell's own top bar (as in growth.tsx).
  const head = (
    <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
      <Txt weight={800} size={27} tracking={-0.6}>Insights</Txt>
      <Pressable onPress={openSwitcher} accessibilityRole="button" accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'} style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}>
        <Avatar child={child} size={38} radius={12} fontSize={16} />
      </Pressable>
    </View>
  );
  const frame = (inner: ReactNode) =>
    desktop ? (
      <DesktopPage maxWidth={640}>{inner}</DesktopPage>
    ) : (
      <ScrollView style={{ flex: 1, backgroundColor: t.bg }} contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}>
        {head}
        {inner}
      </ScrollView>
    );

  // Order matters: a failed load leaves insightsLoaded=false, so the error
  // check must come FIRST or the error/retry state is unreachable.
  if (error)
    return frame(
      <CenteredState
        title="Couldn't load insights"
        subtitle="Check your connection and try again."
        action={{ label: 'Try again', onPress: () => { useAppStore.setState({ insightsLoading: false }); loadInsights(); } }}
      />,
    );
  if (!loaded) return frame(<CenteredState title="Loading insights…" subtitle="This can take a moment the first time." />);
  return frame(body);
}
