import { router } from 'expo-router';
import { Pressable, View, type ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { PulsingDot } from '@/components/PulsingDot';
import { Txt } from '@/components/Txt';
import { ALL_ACTIVITIES, ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtAgoShort, fmtDur } from '@/lib/format';
import { lastDiaper, lastFeedStartMinAgo, nextStartSide, nextWashKind } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { ActivityType, FeedMethod } from '@/types/models';

const METHOD_LABEL: Record<FeedMethod, string> = {
  left: 'left',
  right: 'right',
  both: 'both',
  bottle: 'bottle',
  parent: 'parent',
  self: 'self',
};

const ICON_FOR: Record<ActivityType, IconName> = {
  feeding: 'feeding',
  sleep: 'sleep',
  diaper: 'diaper',
  pumping: 'pumping',
  tummy: 'tummy',
  bath: 'bath',
  temperature: 'temperature',
  // Notes and milestones are never in ALL_ACTIVITIES, so these tiles never
  // render; present only to satisfy the Record<ActivityType, …> completeness check.
  note: 'note',
  milestone: 'note',
};

/**
 * The dashboard body: status strip, live-timer card, and the log-activity grid.
 * Chrome-free so it drops into both the phone Home screen (safe-area scroll +
 * child header) and the desktop shell's main region (sidebar + top bar supply
 * that chrome). `layout` only governs the activity-grid reflow: two-up on phone,
 * auto-fit multi-column on desktop.
 */
export function DashboardContent({ layout }: { layout: 'phone' | 'desktop' }) {
  const t = useTheme();
  const entries = useAppStore((s) => s.entries);
  const timers = useAppStore((s) => s.timers);
  const now = useAppStore((s) => s.now);
  const openSheet = useAppStore((s) => s.openSheet);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);

  // Phone tiles stay two-up; desktop tiles auto-fit to as many columns as fit.
  const tileStyle: ViewStyle =
    layout === 'desktop'
      ? { flexBasis: 168, minWidth: 168, flexGrow: 1 }
      : { width: '47.8%', flexGrow: 1 };

  // ---- derived status ----
  const lastFeedAgo = lastFeedStartMinAgo(entries, now);
  const lastFeeding = entries
    .filter((e): e is Extract<typeof e, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  const fedSide = lastFeeding ? METHOD_LABEL[lastFeeding.method] : null;

  const runningSleep = timers.find((tm) => tm.activity === 'sleep');
  const lastSleep = entries
    .filter((e): e is Extract<typeof e, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];

  const todaySleepMin = entries
    .filter((e): e is Extract<typeof e, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .filter((e) => new Date(e.end as number).toDateString() === new Date(now).toDateString())
    .reduce((sum, e) => sum + ((e.end as number) - e.start) / 60000, 0);

  const dia = lastDiaper(entries);
  const diaperAgo = dia ? Math.round((now - dia.time) / 60000) : null;

  const napStatus = runningSleep
    ? `napping ${fmtDur((now - runningSleep.start) / 60000)}`
    : lastSleep
      ? `${fmtAgoShort(Math.round((now - (lastSleep.end as number)) / 60000))} ago`
      : 'Tap to log';
  const diaperHint = diaperAgo != null ? `${fmtAgoShort(diaperAgo)} ago` : 'Tap to log';

  const startSideLabel = nextStartSide(entries) === 'left' ? 'Left' : 'Right';
  const washHint = nextWashKind(entries) === 'big' ? 'Big wash due today' : 'Small wash due';
  const activityHint: Record<ActivityType, string> = {
    feeding: `${lastFeedAgo != null ? `${fmtAgoShort(lastFeedAgo)} ago` : 'Tap to log'} · start ${startSideLabel}`,
    sleep: napStatus,
    diaper: diaperHint,
    pumping: 'Tap to log',
    tummy: 'Tap to log',
    bath: washHint,
    temperature: 'Tap to log',
    // never rendered (notes and milestones aren't on the Home grid), completeness only
    note: 'Tap to log',
    milestone: 'Tap to log',
  };

  const status = [
    {
      label: 'Fed',
      color: t.activity.feeding,
      value: lastFeedAgo != null ? fmtAgoShort(lastFeedAgo) : '—',
      sub: lastFeedAgo != null ? `ago · ${fedSide ?? ''}` : 'no feeds',
    },
    {
      label: 'Sleep',
      color: t.activity.sleep,
      value: runningSleep ? fmtDur((now - runningSleep.start) / 60000) : fmtDur(todaySleepMin),
      sub: runningSleep ? 'napping now' : 'today',
    },
    {
      label: 'Diaper',
      color: t.activity.diaper,
      value: diaperAgo != null ? fmtAgoShort(diaperAgo) : '—',
      sub: dia ? (dia.solid ? 'ago · solid' : 'ago · wet') : 'none',
    },
  ];

  // Newest timer (timers are appended to the end of the list).
  const runningTimer = timers[timers.length - 1];

  return (
    <>
      {/* status strip */}
      <View style={{ flexDirection: 'row', gap: 9, marginBottom: 8 }}>
        {status.map((st) => (
          <View
            key={st.label}
            style={{
              flex: 1,
              backgroundColor: t.surface,
              borderWidth: 1.5,
              borderColor: t.line,
              borderRadius: 18,
              paddingTop: 13,
              paddingHorizontal: 13,
              paddingBottom: 14,
            }}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
              <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: st.color }} />
              <Txt weight={600} size={11.5} color={t.dim} style={{ textTransform: 'uppercase' }}>
                {st.label}
              </Txt>
            </View>
            <Txt weight={700} size={19} tracking={-0.4} style={{ marginTop: 7 }}>
              {st.value}
            </Txt>
            <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 2 }}>
              {st.sub}
            </Txt>
          </View>
        ))}
      </View>

      {/* live timer card */}
      {runningTimer && (
        <Pressable
          onPress={() => router.navigate('/timers')}
          accessibilityRole="button"
          style={(s) => [
            {
              backgroundColor: t.surface,
              borderWidth: 1.5,
              borderColor: t.line,
              borderRadius: 20,
              paddingVertical: 15,
              paddingHorizontal: 17,
              marginTop: 4,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 11,
              cursor: 'pointer',
            },
            isHovered(s) && { borderColor: t.line2 },
          ]}
        >
          <PulsingDot color={t.activity[runningTimer.saveAs]} />
          <View style={{ flex: 1 }}>
            <Txt unselectable weight={600} size={12} color={t.dim} style={{ textTransform: 'uppercase' }}>
              {ACTIVITY_LABEL[runningTimer.saveAs]} running
            </Txt>
            <Txt unselectable weight={800} size={26} tracking={-0.5} color={t.activity[runningTimer.saveAs]} style={{ fontVariant: ['tabular-nums'], marginTop: 1 }}>
              {fmtDur((now - runningTimer.start) / 60000)}
            </Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Txt unselectable weight={600} size={13.5} color={t.dim}>
              View
            </Txt>
            <Icon name="chevron-right" color={t.dim} size={16} />
          </View>
        </Pressable>
      )}

      {/* section label */}
      <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', marginTop: 18, marginBottom: 12, marginHorizontal: 4 }}>
        <Txt weight={700} size={13} color={t.faint} tracking={0.8} style={{ textTransform: 'uppercase' }}>
          Log activity
        </Txt>
        <Pressable
          onPress={() => router.navigate('/timers')}
          accessibilityRole="button"
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
        >
          <Txt unselectable weight={600} size={13.5} color={t.primary}>
            Timers
          </Txt>
        </Pressable>
      </View>

      {/* activity grid */}
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
        {ALL_ACTIVITIES.map((a) => (
          <ActivityTile
            key={a}
            label={ACTIVITY_LABEL[a]}
            color={t.activity[a]}
            icon={ICON_FOR[a]}
            hint={activityHint[a]}
            widthStyle={tileStyle}
            onPress={() => openSheet(a)}
          />
        ))}
        {/* Start timer tile */}
        <Pressable
          onPress={() => {
            startQuickTimer();
            router.navigate('/timers');
          }}
          accessibilityRole="button"
          style={(s) => [
            {
              backgroundColor: hexA(t.primary, t.dark ? 0.14 : 0.12),
              borderWidth: 1.5,
              borderColor: hexA(t.primary, 0.5),
              borderStyle: 'dashed',
              borderRadius: 22,
              paddingVertical: 15,
              paddingHorizontal: 15,
              minHeight: 104,
              gap: 3,
              cursor: 'pointer',
            },
            tileStyle,
            isHovered(s) && { borderColor: hexA(t.primary, 0.75), boxShadow: t.shadow },
          ]}
        >
          <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: hexA(t.primary, 0.18), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
            <Icon name="timer" color={t.text} size={24} />
          </View>
          <Txt unselectable weight={700} size={17} tracking={-0.2}>
            Start timer
          </Txt>
          <Txt unselectable weight={500} size={12.5} color={t.dim}>
            Save as any activity
          </Txt>
        </Pressable>
      </View>
    </>
  );
}

function ActivityTile({
  label,
  color,
  icon,
  hint,
  widthStyle,
  onPress,
}: {
  label: string;
  color: string;
  icon: IconName;
  hint: string;
  widthStyle: ViewStyle;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={(s) => [
        {
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: t.line,
          borderRadius: 22,
          paddingVertical: 15,
          paddingHorizontal: 15,
          minHeight: 104,
          gap: 3,
          cursor: 'pointer',
        },
        widthStyle,
        isHovered(s) && { borderColor: hexA(color, 0.55), boxShadow: t.shadow },
      ]}
    >
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Icon name={icon} color={color} size={25} />
      </View>
      <Txt unselectable weight={700} size={17} tracking={-0.2}>
        {label}
      </Txt>
      <Txt unselectable weight={500} size={12.5} color={t.dim}>
        {hint}
      </Txt>
    </Pressable>
  );
}
