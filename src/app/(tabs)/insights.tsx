import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { WaitingForBirth } from '@/features/dashboard/WaitingForBirth';
import { buildDiaperSeries, buildSleepHeatmap, buildTrend, DAY, type TrendPoint } from '@/features/insights/compute';
import { bandStatus, NORMS } from '@/features/insights/norms';
import { DiaperBars } from '@/features/insights/DiaperBars';
import { phaseNoteFor } from '@/features/insights/phase';
import { detectSafetyFlags } from '@/features/insights/safety';
import { SafetyNote } from '@/features/insights/SafetyNote';
import { SleepHeatmap } from '@/features/insights/SleepHeatmap';
import { TrendCard } from '@/features/insights/TrendCard';
import { hexA } from '@/lib/color';
import { fmtDur } from '@/lib/format';
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
  // Start of a currently-running sleep timer (epoch ms), else null. Drives the
  // live breathing bar on the heatmap's Today row.
  const runningSince = useAppStore((s) => s.timers.find((tm) => tm.activity === 'sleep')?.start ?? null);
  // Start of a currently-running feeding timer, for the live feeding bar (drawn
  // on top of a live sleep bar so feeding takes precedence).
  const runningFeedSince = useAppStore((s) => s.timers.find((tm) => tm.activity === 'feeding')?.start ?? null);
  // The Rhythm graph's day boundary. It drives the heatmap AND every per-window
  // trend below, so the graph and the numbers share one "day" (a persisted pref).
  const originHour = useAppStore((s) => s.rhythmOriginHour);
  const setRhythmOriginHour = useAppStore((s) => s.setRhythmOriginHour);
  const [width, setWidth] = useState(0);
  const heatRows = useMemo(() => buildSleepHeatmap(entries, nowH, 28, originHour), [entries, nowH, originHour]);

  const birth = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId)?.birth ?? s.now);
  const [rangeDays, setRangeDays] = useState(30);
  const RANGES: [string, number][] = [['2 weeks', 14], ['1 month', 30], ['3 months', 90]];
  // Window presets: the hour each 24h window starts at. Noon-to-noon (12) is the
  // default and keeps a normal night as one contiguous block in the middle.
  const ORIGINS: [string, number][] = [['7 PM', 19], ['Noon', 12], ['7 AM', 7], ['12 AM', 0]];
  const clockLabel = (h: number) => (h === 0 ? '12 AM' : h < 12 ? `${h} AM` : h === 12 ? 'noon' : `${h - 12} PM`);
  const originPhrase = `${clockLabel(originHour)} to ${clockLabel(originHour)}`;
  // Layer toggles for the Rhythm graph. Sleep is the band; feeds/diapers are the
  // marker lanes. The legend chips double as the on/off toggles.
  const napColor = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  const [showSleep, setShowSleep] = useState(true);
  const [showFeeds, setShowFeeds] = useState(true);
  const [showDiapers, setShowDiapers] = useState(true);
  const LAYERS = [
    { key: 'sleep', label: 'Sleep', on: showSleep, set: setShowSleep },
    { key: 'feeds', label: 'Feeds', on: showFeeds, set: setShowFeeds },
    { key: 'diapers', label: 'Diapers', on: showDiapers, set: setShowDiapers },
  ];

  const totalSleep = useMemo(() => buildTrend(entries, 'totalSleep', nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  const longest = useMemo(() => buildTrend(entries, 'longestStretch', nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  const wake = useMemo(() => buildTrend(entries, 'wakeWindow', nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  const feeds = useMemo(() => buildTrend(entries, 'feedsPerDay', nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  const interval = useMemo(() => buildTrend(entries, 'feedInterval', nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  const diapers = useMemo(() => buildDiaperSeries(entries, nowH, rangeDays, originHour), [entries, nowH, rangeDays, originHour]);
  // The narrow safety net: at most a wet-nappy and a newborn low-feed nudge,
  // only when the signal is real and current (see safety.ts). Range-independent.
  const safetyFlags = useMemo(() => detectSafetyFlags(entries, birth, nowH), [entries, birth, nowH]);
  // A gentle, age-based "what's happening now" note for the Sleep section
  // (currently just the ~4-month sleep change). null outside its age window.
  const phaseNote = useMemo(() => phaseNoteFor(birth, nowH), [birth, nowH]);
  const lastVal = (pts: { value: number }[]) => (pts.length ? pts[pts.length - 1].value : 0);
  // The big number is the current (partial) window's value — only call it
  // "today so far" when that last point really is today's window.
  const isToday = (pts: { t: number }[]) => pts.length > 0 && nowH - pts[pts.length - 1].t < DAY;
  // "In typical range" status is judged on complete windows only: drop the
  // partial current window so a low "today so far" reading can't flip the chip.
  // Only the two solid-band metrics get a status (bandStatus returns null for
  // the rule-of-thumb and floor norms).
  const completeOf = (pts: TrendPoint[]) => (isToday(pts) ? pts.slice(0, -1) : pts);
  const sleepStatus = bandStatus(NORMS.totalSleep, birth, completeOf(totalSleep)) ?? undefined;
  const feedsStatus = bandStatus(NORMS.feedsPerDay, birth, completeOf(feeds)) ?? undefined;

  const loaded = useAppStore((s) => s.insightsLoaded);
  const error = useAppStore((s) => s.insightsError);
  const daysWithSleep = heatRows.filter((r) => r.segments.length > 0).length;
  const enoughForChart = (pts: unknown[]) => pts.length >= 3;
  // delta for longest stretch: last minus first in range, when there's a span.
  // Only a *gain* (>= 0.5h) is surfaced, labeled with what it compares against
  // ("vs 2 wks ago", etc.). A decrease is deliberately not shown: night sleep
  // fragmenting for a stretch (most notably the ~4-month sleep change) is normal
  // maturation, and a red "-1.2h" pill framed it as a regression to worry about.
  const stretchDelta = longest.length >= 2 ? longest[longest.length - 1].value - longest[0].value : 0;
  const stretchDeltaShown = stretchDelta >= 0.5;
  const stretchDeltaText = `${stretchDelta < 0 ? '-' : '+'}${fmtDur(Math.abs(stretchDelta) * 60)}`;
  const stretchNote = rangeDays === 14 ? 'vs 2 wks ago' : rangeDays === 90 ? 'vs 3 mo ago' : 'vs 1 mo ago';
  // Decimal hours read oddly ("6.2h"); show sleep/interval values as h+m instead.
  const hmValue = (v: number) => fmtDur(v * 60);
  const gated = (pts: unknown[], what: string, node: ReactNode): ReactNode =>
    enoughForChart(pts) ? node : <KeepLogging what={what} />;

  // Re-run on child switch — selectChild resets the cache, this refills it.
  // Skip for an expecting child: the server has no history for a child that
  // hasn't been born yet, so loading would just fail and set insightsError.
  useEffect(() => {
    if (child?.expected) return;
    loadInsights();
  }, [loadInsights, selectedChildId, child?.expected]);

  const body = (
    <View onLayout={(e) => setWidth(e.nativeEvent.layout.width)}>
      <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 15, marginBottom: 18 }}>
        <Txt weight={700} size={16} style={{ marginBottom: 8 }}>Rhythm</Txt>
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 10 }}>
          {LAYERS.map((L) => {
            const color = L.key === 'feeds' ? t.activity.feeding : L.key === 'diapers' ? t.activity.diaper : t.activity.sleep;
            return (
              <Pressable key={L.key} onPress={() => L.set(!L.on)} accessibilityRole="button" accessibilityState={{ selected: L.on }} style={{ flexDirection: 'row', alignItems: 'center', gap: 6, opacity: L.on ? 1 : 0.4, backgroundColor: t.chip, borderRadius: 999, paddingVertical: 5, paddingHorizontal: 10 }}>
                {L.key === 'sleep' ? (
                  <View style={{ flexDirection: 'row', width: 14, height: 9, borderRadius: 3, overflow: 'hidden' }}>
                    <View style={{ flex: 1, backgroundColor: t.activity.sleep }} />
                    <View style={{ flex: 1, backgroundColor: napColor }} />
                  </View>
                ) : (
                  <View style={{ width: 9, height: 9, borderRadius: 9, backgroundColor: color }} />
                )}
                <Txt weight={600} size={11.5} color={t.dim}>{L.label}</Txt>
              </Pressable>
            );
          })}
        </View>
        <Txt weight={500} size={11.5} color={t.dim} style={{ marginBottom: 10 }}>Last 4 weeks, {originPhrase}</Txt>
        <View style={{ flexDirection: 'row', backgroundColor: t.chip, borderRadius: 12, padding: 3 }}>
          {ORIGINS.map(([lbl, h]) => (
            <Pressable key={h} onPress={() => setRhythmOriginHour(h)} accessibilityRole="button" accessibilityState={{ selected: originHour === h }} style={{ flex: 1, paddingVertical: 7, borderRadius: 10, backgroundColor: originHour === h ? t.surface : 'transparent', alignItems: 'center' }}>
              <Txt weight={originHour === h ? 700 : 600} size={12.5} color={originHour === h ? t.text : t.dim}>{lbl}</Txt>
            </Pressable>
          ))}
        </View>
        <Txt weight={500} size={11} color={t.faint} style={{ marginLeft: 4, marginTop: 6, marginBottom: 12 }}>Applies to the graph and the trend numbers</Txt>
        {daysWithSleep >= 7 ? (
          <SleepHeatmap rows={heatRows} width={width - 30} now={nowH} runningSince={runningSince} runningFeedSince={runningFeedSince} originHour={originHour} showSleep={showSleep} showFeeds={showFeeds} showDiapers={showDiapers} />
        ) : (
          <Txt weight={600} size={13} color={t.dim} style={{ paddingVertical: 18, lineHeight: 20 }}>
            Log about a week of sleep to see the rhythm heatmap here.
          </Txt>
        )}
      </View>
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

      {phaseNote ? (
        <View style={{ flexDirection: 'row', gap: 12, backgroundColor: t.chip, borderRadius: 18, padding: 15, marginTop: 12 }}>
          <View style={{ width: 30, height: 30, borderRadius: 10, backgroundColor: hexA(t.activity.sleep, 0.2), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="moon" size={16} color={t.activity.sleep} />
          </View>
          <View style={{ flex: 1, gap: 3 }}>
            <Txt weight={700} size={14}>{phaseNote.title}</Txt>
            <Txt weight={500} size={12.5} color={t.dim} style={{ lineHeight: 18 }}>{phaseNote.body}</Txt>
          </View>
        </View>
      ) : null}
      {gated(totalSleep, 'total sleep', (
        <TrendCard label="Total sleep / day" color={t.activity.sleep} unit="" value={hmValue(lastVal(totalSleep))}
          caption="Typical for age" status={sleepStatus} norm={NORMS.totalSleep} birth={birth} points={totalSleep}
          yTicks={[10, 12, 14, 16, 18]} fmtY={(v) => `${v}h`} fmtValue={hmValue} width={width} todaySoFar={isToday(totalSleep)} />
      ))}
      {gated(longest, 'longest stretch', (
        <TrendCard label="Longest stretch / night" color={t.activity.sleep} unit="" value={hmValue(lastVal(longest))}
          caption="Rule of thumb" norm={NORMS.longestStretch} birth={birth} points={longest}
          yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}h`} fmtValue={hmValue} width={width} todaySoFar={isToday(longest)}
          delta={stretchDeltaShown ? stretchDeltaText : undefined} deltaGood={stretchDelta > 0}
          deltaNote={stretchDeltaShown ? stretchNote : undefined} />
      ))}
      {gated(wake, 'wake window', (
        <TrendCard label="Avg wake window" color={t.activity.sleep} unit="min" value={Math.round(lastVal(wake)).toString()}
          caption="Rule of thumb" norm={NORMS.wakeWindow} birth={birth} points={wake}
          yTicks={[0, 60, 120, 180, 240]} fmtY={(v) => `${v}`} width={width} />
      ))}
      {safetyFlags.length ? (
        <View style={{ marginTop: 24, marginBottom: 4 }}>
          <SafetyNote flags={safetyFlags} />
        </View>
      ) : null}
      <Txt weight={800} size={12} color={t.faint} tracking={1.4} style={{ marginHorizontal: 2, marginTop: 24, marginBottom: 2, textTransform: 'uppercase' }}>
        Feeding
      </Txt>
      {gated(feeds, 'feeds per day', (
        <TrendCard label="Feeds / day" color={t.activity.feeding} unit="" value={Math.round(lastVal(feeds)).toString()}
          caption="Typical for age" status={feedsStatus} norm={NORMS.feedsPerDay} birth={birth} points={feeds}
          yTicks={[0, 3, 6, 9, 12]} fmtY={(v) => `${v}`} width={width} todaySoFar={isToday(feeds)} />
      ))}
      {gated(interval, 'feed interval', (
        <TrendCard label="Avg interval between feeds" color={t.activity.feeding} unit="" value={hmValue(lastVal(interval))}
          norm={NORMS.feedInterval} birth={birth} points={interval}
          yTicks={[0, 1, 2, 3, 4]} fmtY={(v) => `${v}h`} fmtValue={hmValue} width={width} />
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

  // Before the load guards on purpose: an expected child has nothing to load,
  // so there is no point showing a loading or error state for it.
  if (child?.expected) return frame(<WaitingForBirth what="Insights" />);

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
