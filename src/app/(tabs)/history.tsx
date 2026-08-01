import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { TimelineEntry } from '@/features/activity/TimelineEntry';
import { activityOptions, dayOptions, filterItems, type TimelineFilter } from '@/features/activity/filter';
import { groupByDay, isTimer } from '@/features/activity/groupByDay';
import {
  HistoryFilterChips,
  HistoryFilterSheets,
  type OpenFilterSheet,
} from '@/features/activity/HistoryFilters';
import { isItemQueued, queuedIdSet } from '@/features/activity/queuedMarker';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { entriesForChild, selectServerMode, timersForChild } from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

export default function History() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const entries = useAppStore((s) => s.entries);
  const timers = useAppStore((s) => s.timers);
  // Primitive selector, so no new reference per render (zustand v5); the
  // child-scoping filter itself runs in the render body below.
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const now = useAppStore((s) => s.now);
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openEdit = useAppStore((s) => s.openEdit);
  const openTimerEdit = useAppStore((s) => s.openTimerEdit);
  const refresh = useAppStore((s) => s.refresh);
  // Raw array + object references out of the store, never a Set built inside a
  // selector: a selector returning a fresh reference makes zustand v5 loop
  // forever. The Set is derived below, in the render body.
  const queuedIds = useAppStore((s) => s.queuedIds);
  const connection = useAppStore((s) => s.connection);
  // The shared predicate rather than a fourth hand-written copy of it, so this
  // screen's queued markers cannot disagree with the offline banners about what
  // mode the app is in. Called on the already-selected `connection` (no second
  // subscription), which is exactly what it is shaped for.
  const serverMode = selectServerMode({ connection });
  const queued = useMemo(() => queuedIdSet(queuedIds, serverMode), [queuedIds, serverMode]);

  // Pull-to-refresh, mirroring Home: native uses RefreshControl, touch-web a
  // custom gesture, mouse-web nothing. History has no offline banner, so the
  // offsets are simply the safe-area inset.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);

  // `entries` holds every child's records, so scope to the selected child first:
  // otherwise switching child (or selecting an expecting one, which owns no
  // activity at all) shows the previous child's timeline. General notes live in
  // the same shared array (for queue/undo/sync reuse) but have their OWN
  // dedicated tab, so they're excluded from the activity timeline too.
  const activityEntries = entriesForChild(entries, selectedChildId).filter(
    (e) => e.type !== 'note' && e.type !== 'milestone',
  );
  // Running timers belong here too: they are this child's activity, just not
  // finished. Marking an already-logged entry "still ongoing" converts it into
  // a timer, so without this the row the user was looking at would vanish from
  // the very list they marked it in.
  const items = [...activityEntries, ...timersForChild(timers, selectedChildId)];

  // Day + activity filters, session-local: a filter is a way to read the list you
  // are looking at now, not a preference to carry into the next launch.
  //
  // Each option list is narrowed by the OTHER half of the filter, so the two
  // narrow symmetrically and no combination reachable from the UI can come back
  // empty: the days offered are days that have the chosen activities, and the
  // activities offered are the ones present on the chosen day. (A combination
  // can still empty out under the user, e.g. a refresh drops the selected day —
  // hence the no-matches state below.)
  const [filter, setFilter] = useState<TimelineFilter>({ day: null, types: [] });
  // Which filter sheet is open lives here, not in the chip row, because the two
  // sheets have to be mounted outside the scroll container the chips sit in
  // (see HistoryFilterSheets).
  const [filterSheet, setFilterSheet] = useState<OpenFilterSheet>(null);
  const dayChoices = dayOptions(filterItems(items, { day: null, types: filter.types }), now);
  const activityChoices = activityOptions(filterItems(items, { day: filter.day, types: [] }));
  const visible = filterItems(items, filter);
  const groups = groupByDay(visible, now);

  const body =
    // A running timer counts as something logged, so the empty state stays away
    // while one is going.
    items.length === 0 ? (
      <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24, gap: 14 }}>
        <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
          <Icon name="list" color={t.faint} size={34} />
        </View>
        <Txt weight={700} size={18}>
          Nothing logged yet
        </Txt>
        <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 240, lineHeight: 20 }}>
          Your timeline fills up as you log feedings, sleep and diapers. Tap a big button on Home to start.
        </Txt>
      </View>
    ) : (
      <>
        <HistoryFilterChips filter={filter} now={now} onOpen={setFilterSheet} onChange={setFilter} />
        {visible.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
            <Txt weight={700} size={16}>
              Nothing to show here
            </Txt>
            {/* Deliberately not spelled out per filter: the only way to reach
                this state is the data moving underneath a selection (a refresh
                drops the day, a child switch), since the two option lists
                narrow symmetrically and cannot offer an empty combination. */}
            <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
              Nothing here matches the current filter.
            </Txt>
            <Pressable
              onPress={() => setFilter({ day: null, types: [] })}
              accessibilityRole="button"
              style={(s) => [
                { marginTop: 2, backgroundColor: t.primary, borderRadius: 14, paddingVertical: 11, paddingHorizontal: 22, cursor: 'pointer' },
                isHovered(s) && { boxShadow: t.shadow },
              ]}
            >
              <Txt unselectable weight={700} size={14} color={t.onPrimary}>
                Clear filters
              </Txt>
            </Pressable>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={{ marginBottom: 14 }}>
              <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 22, marginBottom: 6, textTransform: 'uppercase' }}>
                {g.label}
              </Txt>
              {/* A continuous timeline spine per day. Tap a row to open the
                  editor, where entries can be edited or deleted. A timer row opens
                  the RUNNING-timer editor instead: `openEdit` looks the id up in
                  `entries` and returns early on a miss, so sending a timer there
                  would make the row silently dead. */}
              <View>
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
      </>
    );

  // Mounted as a sibling of the scroll container on both layouts, never inside
  // it: a sheet positions itself against its nearest positioned ancestor, and
  // inside the list that is the scrolled content rather than the screen.
  const filterSheets = (
    <HistoryFilterSheets
      open={filterSheet}
      onClose={() => setFilterSheet(null)}
      days={dayChoices}
      activities={activityChoices}
      filter={filter}
      onChange={setFilter}
    />
  );

  if (desktop)
    return (
      <View style={{ flex: 1 }}>
        <DesktopPage maxWidth={600}>{body}</DesktopPage>
        {filterSheets}
      </View>
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
        contentContainerStyle={{ paddingTop: insets.top + 8, paddingBottom: 24 }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 20, paddingTop: 4, paddingBottom: 16 }}>
          <Txt weight={800} size={27} tracking={-0.6}>
            History
          </Txt>
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

      {filterSheets}
    </View>
  );
}
