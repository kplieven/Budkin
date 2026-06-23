import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { Icon, type IconName } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { PulsingDot } from '@/components/PulsingDot';
import { Txt } from '@/components/Txt';
import { ALL_ACTIVITIES, ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { ageStr, fmtAgoShort, fmtDur } from '@/lib/format';
import { lastDiaper, lastFeedEndMinAgo, nextStartSide } from '@/store/selectors';
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
};

export default function Home() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const entries = useAppStore((s) => s.entries);
  const timers = useAppStore((s) => s.timers);
  const now = useAppStore((s) => s.now);
  const offline = useAppStore((s) => s.offline);
  const queueCount = useAppStore((s) => s.queueCount);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSheet = useAppStore((s) => s.openSheet);
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);

  // ---- derived status ----
  const lastFeedAgo = lastFeedEndMinAgo(entries, now);
  const lastFeeding = entries
    .filter((e): e is Extract<typeof e, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];
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
  const activityHint: Record<ActivityType, string> = {
    feeding: `${lastFeedAgo != null ? `${fmtAgoShort(lastFeedAgo)} ago` : 'Tap to log'} · start ${startSideLabel}`,
    sleep: napStatus,
    diaper: diaperHint,
    pumping: 'Tap to log',
    tummy: 'Tap to log',
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
    <View style={{ flex: 1, backgroundColor: t.bg }}>
      {offline && (
        <View
          style={{
            position: 'absolute',
            top: insets.top - 2,
            left: 12,
            right: 12,
            zIndex: 30,
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            backgroundColor: t.dark ? '#3A2E18' : '#FBEFD4',
            borderWidth: 1,
            borderColor: hexA('#E2B554', 0.5),
            borderRadius: 13,
            paddingVertical: 9,
            paddingHorizontal: 13,
            boxShadow: t.shadow,
          }}
        >
          <View style={{ width: 8, height: 8, borderRadius: 99, backgroundColor: '#E2B554' }} />
          <Txt weight={600} size={12.5} style={{ flex: 1 }}>
            {queueCount > 0
              ? `Offline — ${queueCount} ${queueCount === 1 ? 'entry' : 'entries'} queued, will sync when reconnected`
              : 'Offline — changes will sync when reconnected'}
          </Txt>
        </View>
      )}

      <ScrollView
        style={{ flex: 1 }}
        contentContainerStyle={{
          paddingTop: insets.top + 8 + (offline ? 46 : 0),
          paddingHorizontal: 18,
          paddingBottom: 18,
        }}
      >
        {/* child header */}
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, paddingHorizontal: 4, paddingTop: 6, paddingBottom: 18 }}>
          <Pressable onPress={openSwitcher}>
            <Avatar child={child} size={50} radius={16} fontSize={21} />
          </Pressable>
          <Pressable onPress={openSwitcher} style={{ flex: 1 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Txt weight={700} size={21} tracking={-0.3} numberOfLines={1} style={{ flexShrink: 1 }}>
                {child ? `${child.first} ${child.last}` : 'No child'}
              </Txt>
              <Icon name="chevron-down" color={t.text} size={18} />
            </View>
            <Txt weight={500} size={13.5} color={t.dim} style={{ marginTop: 1 }}>
              {child ? ageStr(child.birth, now) : ''}
            </Txt>
          </Pressable>
          <IconButton name="settings" onPress={() => router.push('/settings')} />
        </View>

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
            style={{
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
            }}
          >
            <PulsingDot color={t.activity[runningTimer.saveAs]} />
            <View style={{ flex: 1 }}>
              <Txt weight={600} size={12} color={t.dim} style={{ textTransform: 'uppercase' }}>
                {ACTIVITY_LABEL[runningTimer.saveAs]} running
              </Txt>
              <Txt weight={800} size={26} tracking={-0.5} color={t.activity[runningTimer.saveAs]} style={{ fontVariant: ['tabular-nums'], marginTop: 1 }}>
                {fmtDur((now - runningTimer.start) / 60000)}
              </Txt>
            </View>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt weight={600} size={13.5} color={t.dim}>
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
          <Pressable onPress={() => router.navigate('/timers')}>
            <Txt weight={600} size={13.5} color={t.primary}>
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
              onPress={() => openSheet(a)}
            />
          ))}
          {/* Start timer tile */}
          <Pressable
            onPress={() => {
              startQuickTimer();
              router.navigate('/timers');
            }}
            style={{
              width: '47.8%',
              flexGrow: 1,
              backgroundColor: hexA(t.primary, t.dark ? 0.14 : 0.12),
              borderWidth: 1.5,
              borderColor: hexA(t.primary, 0.5),
              borderStyle: 'dashed',
              borderRadius: 22,
              paddingVertical: 15,
              paddingHorizontal: 15,
              minHeight: 104,
              gap: 3,
            }}
          >
            <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: hexA(t.primary, 0.18), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
              <Icon name="timer" color={t.text} size={24} />
            </View>
            <Txt weight={700} size={17} tracking={-0.2}>
              Start timer
            </Txt>
            <Txt weight={500} size={12.5} color={t.dim}>
              Save as any activity
            </Txt>
          </Pressable>
        </View>
      </ScrollView>
    </View>
  );
}

function ActivityTile({
  label,
  color,
  icon,
  hint,
  onPress,
}: {
  label: string;
  color: string;
  icon: IconName;
  hint: string;
  onPress: () => void;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      style={{
        width: '47.8%',
        flexGrow: 1,
        backgroundColor: t.surface,
        borderWidth: 1.5,
        borderColor: t.line,
        borderRadius: 22,
        paddingVertical: 15,
        paddingHorizontal: 15,
        minHeight: 104,
        gap: 3,
      }}
    >
      <View style={{ width: 46, height: 46, borderRadius: 14, backgroundColor: hexA(color, 0.16), alignItems: 'center', justifyContent: 'center', marginBottom: 6 }}>
        <Icon name={icon} color={color} size={25} />
      </View>
      <Txt weight={700} size={17} tracking={-0.2}>
        {label}
      </Txt>
      <Txt weight={500} size={12.5} color={t.dim}>
        {hint}
      </Txt>
    </Pressable>
  );
}
