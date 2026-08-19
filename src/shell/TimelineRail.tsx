import { router } from 'expo-router';
import { useMemo } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { TimelineEntry } from '@/features/activity/TimelineEntry';
import { groupByDay, isTimer } from '@/features/activity/groupByDay';
import { isItemQueued, queuedIdSet } from '@/features/activity/queuedMarker';
import { entriesForChild, selectServerMode, timersForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

/** Desktop dashboard's right-hand rail: day-grouped recent activity. */
export function TimelineRail() {
  const t = useTheme();
  const entries = useAppStore((s) => s.entries);
  const timers = useAppStore((s) => s.timers);
  // Primitive selector, so no new reference per render (zustand v5).
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const now = useAppStore((s) => s.now);
  const openEdit = useAppStore((s) => s.openEdit);
  const openTimerEdit = useAppStore((s) => s.openTimerEdit);
  // Queued markers on the terms History uses: raw-select then derive, because a
  // Set built inside a selector loops zustand v5. The shared predicate then runs
  // on the already-selected `connection` rather than taking a second subscription.
  const queuedIds = useAppStore((s) => s.queuedIds);
  const connection = useAppStore((s) => s.connection);
  const serverMode = selectServerMode({ connection });
  const queued = useMemo(() => queuedIdSet(queuedIds, serverMode), [queuedIds, serverMode]);

  // `entries` holds every child's records, so scope it. Notes have their own
  // dedicated tab, so keep them out of the rail.
  const activityEntries = entriesForChild(entries, selectedChildId).filter(
    (e) => e.type !== 'note' && e.type !== 'milestone',
  );
  const items = [...activityEntries, ...timersForChild(timers, selectedChildId)];
  const groups = groupByDay(items, now);

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
        {items.length === 0 ? (
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
                {/* A timer row opens the running-timer editor: `openEdit` only knows
                    ids in `entries` and returns early on a miss, so a timer sent
                    there would be a dead row. */}
                {g.items.map((e, i) => (
                  <TimelineEntry
                    key={isTimer(e) ? `timer:${e.id}` : e.id}
                    item={e}
                    now={now}
                    onPress={() => (isTimer(e) ? openTimerEdit(e.id) : openEdit(e.id))}
                    isFirst={i === 0}
                    isLast={i === g.items.length - 1}
                    queued={isItemQueued(e, queued)}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
    </View>
  );
}
