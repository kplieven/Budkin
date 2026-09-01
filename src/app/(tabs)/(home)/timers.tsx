import { useCallback, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Tappable } from '@/components/press';
import { PulsingDot } from '@/components/PulsingDot';
import { QuickSetStrip } from '@/components/QuickSetStrip';
import { SyncBadge } from '@/components/SyncBadge';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { childAttribution } from '@/features/activity/childAttribution';
import { ACTIVITY_LABEL, TIMER_SAVE_OPTIONS } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtElapsedClock } from '@/lib/format';
import { backOr } from '@/lib/nav';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { timerQuickSets } from '@/store/timerQuickSets';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Timers() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const timers = useAppStore((s) => s.timers);
  const now = useAppStore((s) => s.now);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const discardTimer = useAppStore((s) => s.discardTimer);
  const openTimerEdit = useAppStore((s) => s.openTimerEdit);
  const setTimerSaveAs = useAppStore((s) => s.setTimerSaveAs);
  const adjustTimerStart = useAppStore((s) => s.adjustTimerStart);
  const setTimerStart = useAppStore((s) => s.setTimerStart);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);
  const refresh = useAppStore((s) => s.refresh);
  // Only meaningful when connected to a server: a timer's serverId tells us
  // whether its mirror has reached Baby Buddy yet. Hidden in local mode.
  const isServer = useAppStore((s) => s.connection?.mode === 'server');
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  // Raw select (stable reference); the naming is derived per card in the render
  // body, never in the selector, which would hand zustand v5 a fresh array.
  const children = useAppStore((s) => s.children);
  // Raw select for the same reason: the per-timer Quick set chips are derived in the
  // render body, never in a selector.
  const entries = useAppStore((s) => s.entries);

  // Native uses the platform RefreshControl, touch-capable web the custom gesture.
  // A refresh() also pulls and reconciles server timers, so a timer started on
  // another device shows up here.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);
  // timer id whose exact-start editor is expanded
  const [exactFor, setExactFor] = useState<string | null>(null);

  // `timers` is a global flat list with no per-child filter, so a running timer
  // belonging to a born sibling stays visible and stoppable even while the
  // selected child is still expected. Only the affordance that CREATES a timer is
  // guarded below; the list itself always renders. Each card therefore names its
  // child once the household has two, or two siblings napping gives two cards
  // identical down to their button labels.
  const body = (
    <>
      {timers.length === 0 && (
        <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="timer" color={t.faint} size={34} />
          </View>
          <Txt weight={700} size={18}>
            No timers running
          </Txt>
          <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 250, lineHeight: 20 }}>
            Start a timer and save it later as a feeding, sleep, pumping or tummy time — even back-dated.
          </Txt>
        </View>
      )}

      <View style={desktop ? { flexDirection: 'row', flexWrap: 'wrap', gap: 14 } : { gap: 14 }}>
        {timers.map((tm) => {
          const color = t.activity[tm.saveAs];
          // The timer's OWN child, never the selected one. `who.spoken` goes on the
          // three action labels below, otherwise byte-identical between two cards
          // running the same activity.
          const who = childAttribution(tm.childId, children);
          return (
            <View
              key={tm.id}
              style={[
                {
                  backgroundColor: t.surface,
                  borderWidth: 1.5,
                  borderColor: t.line,
                  borderRadius: 24,
                  padding: 20,
                  boxShadow: t.shadow,
                },
                desktop && { flexBasis: 340, flexGrow: 1, minWidth: 320, maxWidth: 440 },
              ]}
            >
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 14 }}>
                <View style={{ width: 38, height: 38, borderRadius: 11, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center' }}>
                  <Icon name={tm.saveAs === 'sleep' ? 'sleep' : tm.saveAs} color={color} size={21} />
                </View>
                <View style={{ flex: 1 }}>
                  <Txt weight={700} size={16}>
                    {tm.name}
                    {who.drawn}
                  </Txt>
                  <Txt weight={500} size={12.5} color={t.dim}>
                    started {fmtAgo(tm.start, now)}
                  </Txt>
                  {isServer && <SyncBadge synced={tm.serverId != null} />}
                </View>
                <PulsingDot color={color} />
              </View>

              <Txt weight={800} size={52} color={color} style={{ textAlign: 'center', fontVariant: ['tabular-nums'], letterSpacing: -1.5, lineHeight: 56 }}>
                {fmtElapsedClock(tm.start, now)}
              </Txt>

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 14, justifyContent: 'center', alignItems: 'center', flexWrap: 'wrap' }}>
                <Txt weight={600} size={12.5} color={t.dim}>
                  Started earlier?
                </Txt>
                {/* These carry the "m" so they agree with the TimeAdjuster nudges on the
                    same card. Unlike those nudges these chips do not grow, so
                    paddingHorizontal is real width: at 8 (matched on "Change…" below) the
                    label plus these three measures 255px, and holds line one against the
                    281px a 360dp card gives it. At 12 it is 279px, and a nudge wraps. */}
                {([
                  ['−15m', -15],
                  ['−5m', -5],
                  ['+5m', 5],
                ] as const).map(([lbl, d]) => (
                  <Tappable
                    key={lbl}
                    onPress={() => adjustTimerStart(tm.id, d)}
                    accessibilityRole="button"
                    accessibilityLabel={d < 0 ? `Move start ${-d} minutes earlier` : `Move start ${d} minutes later`}
                    style={(s) => [
                      { paddingHorizontal: 8, paddingVertical: 7, borderRadius: 11, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, cursor: 'pointer' },
                      isHovered(s) && { borderColor: t.line2 },
                    ]}
                  >
                    <Txt unselectable weight={700} size={13}>
                      {lbl}
                    </Txt>
                  </Tappable>
                ))}
                <Tappable
                  onPress={() => setExactFor(exactFor === tm.id ? null : tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Change start time"
                  accessibilityState={{ selected: exactFor === tm.id }}
                  style={(s) => [
                    {
                      paddingHorizontal: 8,
                      paddingVertical: 7,
                      borderRadius: 11,
                      backgroundColor: exactFor === tm.id ? hexA(color, 0.16) : t.chip,
                      borderWidth: 1.5,
                      borderColor: exactFor === tm.id ? color : t.line,
                      cursor: 'pointer',
                    },
                    exactFor !== tm.id && isHovered(s) && { borderColor: t.line2 },
                  ]}
                >
                  <Txt unselectable weight={700} size={13} color={exactFor === tm.id ? color : t.text}>
                    Change…
                  </Txt>
                </Tappable>
              </View>

              {exactFor === tm.id && (
                <View style={{ marginTop: 12, marginBottom: 12, gap: 14 }}>
                  {/* Quick sets lead, exact editor follows: see QuickSetStrip on why that
                      order is load-bearing. Both live behind the toggle, so a card nobody
                      is editing keeps the height it always had. */}
                  <QuickSetStrip>
                    {timerQuickSets(entries, tm.childId, now).map((q) => (
                      <Chip
                        key={q.key}
                        label={q.label}
                        accessibilityLabel={q.spoken}
                        color={color}
                        onPress={() => setTimerStart(tm.id, q.at)}
                        padH={12}
                        padV={8}
                        fontSize={13}
                      />
                    ))}
                  </QuickSetStrip>
                  <TimeAdjuster mode="clock" value={tm.start} now={now} color={color} onChange={(ms) => setTimerStart(tm.id, ms)} />
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}>
                <Tappable
                  onPress={() => discardTimer(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Discard ${tm.name} timer${who.spoken}`}
                  style={(s) => [
                    { flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                    isHovered(s) && { backgroundColor: t.elevated },
                  ]}
                >
                  <Txt unselectable weight={700} size={14.5} color={t.dim}>
                    Discard
                  </Txt>
                </Tappable>
                <Tappable
                  onPress={() => openTimerEdit(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${tm.name} timer${who.spoken}`}
                  style={(s) => [
                    { flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                    isHovered(s) && { backgroundColor: t.elevated },
                  ]}
                >
                  <Txt unselectable weight={800} size={14.5} color={color}>
                    Edit
                  </Txt>
                </Tappable>
                <Tappable
                  onPress={() => stopTimer(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop and save ${tm.name} timer${who.spoken}`}
                  style={(s) => [
                    { flex: 1.7, height: 50, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, cursor: 'pointer' },
                    isHovered(s) && { boxShadow: t.shadow },
                  ]}
                >
                  <Txt unselectable weight={800} size={14.5} color={t.onActivity} style={{ textAlign: 'center' }}>
                    Stop &amp; save
                  </Txt>
                </Tappable>
              </View>

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {TIMER_SAVE_OPTIONS.map((o) => {
                  const sel = tm.saveAs === o;
                  return (
                    <Tappable
                      key={o}
                      onPress={() => setTimerSaveAs(tm.id, o)}
                      accessibilityRole="button"
                      accessibilityState={{ selected: sel }}
                      style={(s) => [
                        {
                          paddingHorizontal: 11,
                          paddingVertical: 6,
                          borderRadius: 10,
                          backgroundColor: sel ? t.activity[o] : t.chip,
                          borderWidth: 1.5,
                          borderColor: sel ? t.activity[o] : t.line,
                          cursor: 'pointer',
                        },
                        !sel && isHovered(s) && { borderColor: t.line2 },
                      ]}
                    >
                      <Txt unselectable weight={700} size={12.5} color={sel ? t.onActivity : t.text}>
                        {ACTIVITY_LABEL[o]}
                      </Txt>
                    </Tappable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      {child?.expected ? (
        <View style={{ marginTop: 16, alignItems: 'center', paddingVertical: 14 }}>
          <Txt weight={600} size={13.5} color={t.dim} style={{ textAlign: 'center' }}>
            New timer available once {child.first} arrives.
          </Txt>
        </View>
      ) : (
        <Tappable
          onPress={startQuickTimer}
          accessibilityRole="button"
          style={(s) => [
            {
              marginTop: 16,
              height: 54,
              borderRadius: 16,
              borderWidth: 1.5,
              borderStyle: 'dashed',
              borderColor: hexA(t.primary, 0.5),
              backgroundColor: hexA(t.primary, t.dark ? 0.1 : 0.08),
              flexDirection: 'row',
              alignItems: 'center',
              justifyContent: 'center',
              gap: 8,
              cursor: 'pointer',
            },
            isHovered(s) && { borderColor: hexA(t.primary, 0.8) },
          ]}
        >
          <Icon name="plus" color={t.primary} size={20} />
          <Txt unselectable weight={700} size={15.5} color={t.primary}>
            New timer
          </Txt>
        </Tappable>
      )}
    </>
  );

  // Timers is pushed, not a tab, so it needs its own way back on every width:
  // Settings can skip the chevron on desktop because the sidebar still highlights
  // it, but Timers is deliberately absent from the sidebar. No heading here, since
  // the desktop top bar already renders "Timers" as the screen title.
  if (desktop)
    return (
      <DesktopPage maxWidth={760}>
        <View style={{ flexDirection: 'row', alignItems: 'center', marginBottom: 14 }}>
          <IconButton name="chevron-left" color={t.text} onPress={() => backOr('/(tabs)')} accessibilityLabel="Back" />
        </View>
        {body}
      </DesktopPage>
    );

  return (
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {webPull.enabled && (
        <Animated.View
          pointerEvents="none"
          style={[
            { position: 'absolute', top: insets.top - 6, left: 0, right: 0, alignItems: 'center', zIndex: 25 },
            webPull.style,
          ]}
        >
          <View
            style={{
              width: 44,
              height: 44,
              borderRadius: 99,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: t.surface,
              borderWidth: 1,
              borderColor: t.line,
              boxShadow: t.shadow,
            }}
          >
            {webPull.refreshing ? (
              <ActivityIndicator color={t.dim} />
            ) : (
              <Animated.View style={webPull.glyphStyle}>
                <Icon name="chevron-down" color={t.dim} size={22} />
              </Animated.View>
            )}
          </View>
        </Animated.View>
      )}

      <ScrollView
        ref={scrollRef}
        style={{ flex: 1, backgroundColor: t.bg }}
        refreshControl={
          canPullToRefresh ? (
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={t.dim}
              colors={['#E2B554']}
              progressViewOffset={insets.top}
            />
          ) : undefined
        }
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
          <IconButton name="chevron-left" color={t.text} onPress={() => backOr('/(tabs)')} accessibilityLabel="Back" />
          <Txt weight={800} size={27} tracking={-0.6}>
            Timers
          </Txt>
        </View>
        {body}
      </ScrollView>
    </View>
  );
}
