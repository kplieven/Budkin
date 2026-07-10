import { useState } from 'react';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { PulsingDot } from '@/components/PulsingDot';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL, TIMER_SAVE_OPTIONS } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtClock, fmtDur, fmtElapsedClock } from '@/lib/format';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
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
  // timer id whose exact-start editor is expanded
  const [exactFor, setExactFor] = useState<string | null>(null);
  // timer id whose ephemeral "Ended earlier…" stop editor is expanded — never
  // persisted; collapsing (or stopping) discards it without touching the timer.
  const [endEditFor, setEndEditFor] = useState<string | null>(null);
  // candidate end (ms) picked in that editor, only meaningful while it's open
  const [endCandidate, setEndCandidate] = useState(0);

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
                  </Txt>
                  <Txt weight={500} size={12.5} color={t.dim}>
                    started {fmtAgo(tm.start, now)}
                  </Txt>
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
                {([
                  ['−15m', -15],
                  ['−5m', -5],
                  ['+5m', 5],
                ] as const).map(([lbl, d]) => (
                  <Pressable
                    key={lbl}
                    onPress={() => adjustTimerStart(tm.id, d)}
                    accessibilityRole="button"
                    accessibilityLabel={d < 0 ? `Move start ${-d} minutes earlier` : `Move start ${d} minutes later`}
                    style={(s) => [
                      { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, cursor: 'pointer' },
                      isHovered(s) && { borderColor: t.line2 },
                    ]}
                  >
                    <Txt unselectable weight={700} size={13}>
                      {lbl}
                    </Txt>
                  </Pressable>
                ))}
                <Pressable
                  onPress={() => setExactFor(exactFor === tm.id ? null : tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Set exact start time"
                  accessibilityState={{ selected: exactFor === tm.id }}
                  style={(s) => [
                    {
                      paddingHorizontal: 12,
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
                    Exact…
                  </Txt>
                </Pressable>
              </View>

              {exactFor === tm.id && (
                <View style={{ marginTop: 12 }}>
                  <TimeAdjuster mode="clock" value={tm.start} now={now} color={color} onChange={(ms) => setTimerStart(tm.id, ms)} />
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}>
                <Pressable
                  onPress={() => discardTimer(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Discard ${tm.name} timer`}
                  style={(s) => [
                    { flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                    isHovered(s) && { backgroundColor: t.elevated },
                  ]}
                >
                  <Txt unselectable weight={700} size={14.5} color={t.dim}>
                    Discard
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => openTimerEdit(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Edit ${tm.name} timer`}
                  style={(s) => [
                    { flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                    isHovered(s) && { backgroundColor: t.elevated },
                  ]}
                >
                  <Txt unselectable weight={800} size={14.5} color={color}>
                    Edit
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => stopTimer(tm.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Stop and save ${tm.name} timer`}
                  style={(s) => [
                    { flex: 1.7, height: 50, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6, cursor: 'pointer' },
                    isHovered(s) && { boxShadow: t.shadow },
                  ]}
                >
                  <Txt unselectable weight={800} size={14.5} color={t.onActivity} style={{ textAlign: 'center' }}>
                    Stop &amp; save
                  </Txt>
                </Pressable>
              </View>

              <Pressable
                onPress={() => {
                  if (endEditFor === tm.id) {
                    setEndEditFor(null);
                  } else {
                    setEndEditFor(tm.id);
                    setEndCandidate(Math.max(tm.start, now - 5 * 60000));
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={`Stop ${tm.name} timer with an earlier end time`}
                accessibilityState={{ expanded: endEditFor === tm.id }}
                style={(s) => [
                  {
                    alignSelf: 'center',
                    marginTop: 10,
                    paddingHorizontal: 12,
                    paddingVertical: 7,
                    borderRadius: 11,
                    backgroundColor: endEditFor === tm.id ? hexA(color, 0.16) : t.chip,
                    borderWidth: 1.5,
                    borderColor: endEditFor === tm.id ? color : t.line,
                    cursor: 'pointer',
                  },
                  endEditFor !== tm.id && isHovered(s) && { borderColor: t.line2 },
                ]}
              >
                <Txt unselectable weight={700} size={13} color={endEditFor === tm.id ? color : t.text}>
                  Ended earlier…
                </Txt>
              </Pressable>

              {endEditFor === tm.id && (
                <View style={{ marginTop: 6 }}>
                  <View style={{ flexDirection: 'row', gap: 7, justifyContent: 'center', flexWrap: 'wrap', marginBottom: 10 }}>
                    {([
                      ['−5m', 5],
                      ['−15m', 15],
                      ['−30m', 30],
                    ] as const).map(([lbl, agoMin]) => (
                      <Pressable
                        key={lbl}
                        onPress={() => setEndCandidate(Math.max(tm.start, now - agoMin * 60000))}
                        accessibilityRole="button"
                        accessibilityLabel={`Ended ${agoMin} minutes ago`}
                        style={(s) => [
                          { paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line, cursor: 'pointer' },
                          isHovered(s) && { borderColor: t.line2 },
                        ]}
                      >
                        <Txt unselectable weight={700} size={13}>
                          {lbl}
                        </Txt>
                      </Pressable>
                    ))}
                  </View>

                  <TimeAdjuster
                    mode="clock"
                    value={endCandidate}
                    now={now}
                    color={color}
                    onChange={(ms) => setEndCandidate(Math.min(now, Math.max(tm.start, ms)))}
                  />

                  <Txt weight={600} size={13} color={t.dim} style={{ textAlign: 'center', marginBottom: 12 }}>
                    {fmtClock(tm.start)} → {fmtClock(endCandidate)} · {fmtDur((endCandidate - tm.start) / 60000)}
                  </Txt>

                  <Pressable
                    onPress={() => {
                      stopTimer(tm.id, endCandidate);
                      setEndEditFor(null);
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Save ${tm.name} timer, ended ${fmtClock(endCandidate)}`}
                    style={(s) => [
                      { height: 50, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', cursor: 'pointer' },
                      isHovered(s) && { boxShadow: t.shadow },
                    ]}
                  >
                    <Txt unselectable weight={800} size={14.5} color={t.onActivity}>
                      Save · ended {fmtClock(endCandidate)}
                    </Txt>
                  </Pressable>
                </View>
              )}

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {TIMER_SAVE_OPTIONS.map((o) => {
                  const sel = tm.saveAs === o;
                  return (
                    <Pressable
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
                    </Pressable>
                  );
                })}
              </View>
            </View>
          );
        })}
      </View>

      <Pressable
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
      </Pressable>
    </>
  );

  if (desktop) return <DesktopPage maxWidth={760}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <Txt weight={800} size={27} tracking={-0.6} style={{ paddingHorizontal: 2, paddingTop: 4, paddingBottom: 18 }}>
        Timers
      </Txt>
      {body}
    </ScrollView>
  );
}
