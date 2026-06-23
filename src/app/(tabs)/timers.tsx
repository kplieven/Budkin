import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Icon } from '@/components/Icon';
import { PulsingDot } from '@/components/PulsingDot';
import { Txt } from '@/components/Txt';
import { ACTIVITY_LABEL, TIMER_SAVE_OPTIONS } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgo, fmtElapsedClock } from '@/lib/format';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function Timers() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const timers = useAppStore((s) => s.timers);
  const now = useAppStore((s) => s.now);
  const stopTimer = useAppStore((s) => s.stopTimer);
  const discardTimer = useAppStore((s) => s.discardTimer);
  const openTimerEdit = useAppStore((s) => s.openTimerEdit);
  const setTimerSaveAs = useAppStore((s) => s.setTimerSaveAs);
  const adjustTimerStart = useAppStore((s) => s.adjustTimerStart);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <Txt weight={800} size={27} tracking={-0.6} style={{ paddingHorizontal: 2, paddingTop: 4, paddingBottom: 18 }}>
        Timers
      </Txt>

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

      <View style={{ gap: 14 }}>
        {timers.map((tm) => {
          const color = t.activity[tm.saveAs];
          return (
            <View
              key={tm.id}
              style={{
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line,
                borderRadius: 24,
                padding: 20,
                boxShadow: t.shadow,
              }}
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
                    style={{ paddingHorizontal: 12, paddingVertical: 7, borderRadius: 11, backgroundColor: t.chip, borderWidth: 1.5, borderColor: t.line }}
                  >
                    <Txt weight={700} size={13}>
                      {lbl}
                    </Txt>
                  </Pressable>
                ))}
              </View>

              <View style={{ flexDirection: 'row', gap: 9, marginTop: 14 }}>
                <Pressable
                  onPress={() => discardTimer(tm.id)}
                  style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Txt weight={700} size={14.5} color={t.dim}>
                    Discard
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => openTimerEdit(tm.id)}
                  style={{ flex: 1, height: 50, borderRadius: 14, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}
                >
                  <Txt weight={800} size={14.5} color={color}>
                    Edit
                  </Txt>
                </Pressable>
                <Pressable
                  onPress={() => stopTimer(tm.id)}
                  style={{ flex: 1.7, height: 50, borderRadius: 14, backgroundColor: color, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 6 }}
                >
                  <Txt weight={800} size={14.5} color={t.onActivity} style={{ textAlign: 'center' }}>
                    Stop &amp; save
                  </Txt>
                </Pressable>
              </View>

              <View style={{ flexDirection: 'row', gap: 7, marginTop: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                {TIMER_SAVE_OPTIONS.map((o) => {
                  const sel = tm.saveAs === o;
                  return (
                    <Pressable
                      key={o}
                      onPress={() => setTimerSaveAs(tm.id, o)}
                      style={{
                        paddingHorizontal: 11,
                        paddingVertical: 6,
                        borderRadius: 10,
                        backgroundColor: sel ? t.activity[o] : t.chip,
                        borderWidth: 1.5,
                        borderColor: sel ? t.activity[o] : t.line,
                      }}
                    >
                      <Txt weight={700} size={12.5} color={sel ? t.onActivity : t.text}>
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
        style={{
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
        }}
      >
        <Icon name="plus" color={t.primary} size={20} />
        <Txt weight={700} size={15.5} color={t.primary}>
          New timer
        </Txt>
      </Pressable>
    </ScrollView>
  );
}
