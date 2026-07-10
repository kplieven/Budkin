import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { TimelineEntry } from '@/features/activity/TimelineEntry';
import { groupByDay } from '@/features/activity/groupByDay';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/**
 * Desktop dashboard's right-hand timeline rail (fixed 372px): day-grouped recent
 * activity, sharing ActivityRow + groupByDay with the History screen. Rendered
 * only above the rail breakpoint (see showRail / the dashboard's desktop branch).
 */
export function TimelineRail() {
  const t = useTheme();
  const entries = useAppStore((s) => s.entries);
  const now = useAppStore((s) => s.now);
  const openEdit = useAppStore((s) => s.openEdit);

  // Notes have their own dedicated tab — keep them out of the recent-activity rail.
  const activityEntries = entries.filter((e) => e.type !== 'note');
  const groups = groupByDay(activityEntries, now);

  return (
    <View
      style={{
        width: 372,
        borderLeftWidth: 1,
        borderLeftColor: t.line,
        backgroundColor: t.dark ? '#13100D' : '#FBF4EB',
      }}
    >
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 24,
          paddingTop: 22,
          paddingBottom: 14,
        }}
      >
        <Txt weight={800} size={16} tracking={-0.3}>
          Recent activity
        </Txt>
        <Pressable
          onPress={() => router.navigate('/history')}
          accessibilityRole="button"
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.75 }]}
        >
          <Txt unselectable weight={700} size={13} color={t.primary}>
            All
          </Txt>
        </Pressable>
      </View>

      <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 24, paddingBottom: 24 }}>
        {activityEntries.length === 0 ? (
          <Txt weight={500} size={13.5} color={t.faint} style={{ paddingTop: 8, lineHeight: 20 }}>
            Logged activity shows up here.
          </Txt>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={{ marginBottom: 16 }}>
              <Txt weight={700} size={11.5} color={t.faint} tracking={0.6} style={{ marginHorizontal: 2, marginBottom: 8, textTransform: 'uppercase' }}>
                {g.label}
              </Txt>
              <View>
                {g.items.map((e, i) => (
                  <TimelineEntry key={e.id} entry={e} now={now} onPress={() => openEdit(e.id)} isFirst={i === 0} isLast={i === g.items.length - 1} />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
