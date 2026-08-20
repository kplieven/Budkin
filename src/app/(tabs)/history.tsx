import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { Txt } from '@/components/Txt';
import { TimelineEntry } from '@/features/activity/TimelineEntry';
import { childAttribution } from '@/features/activity/childAttribution';
import { activityOptions, dayOptions, filterItems, type TimelineFilter } from '@/features/activity/filter';
import { groupByDay, isTimer } from '@/features/activity/groupByDay';
import {
  HistoryFilterChips,
  HistoryFilterSheets,
  type OpenFilterSheet,
} from '@/features/activity/HistoryFilters';
import { isItemQueued, queuedIdSet } from '@/features/activity/queuedMarker';
import { useWebPullToRefresh } from '@/features/dashboard/useWebPullToRefresh';
import { eligibleTargetChildren } from '@/lib/logTargets';
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
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  // Quantized INSIDE the selector, not with a useMemo: every change re-runs the pipeline
  // below over the child's whole timeline and re-renders every mounted row, and quantizing
  // here is what makes the subscription go quiet for a whole minute. A visited tab screen
  // stays mounted, so the cost was being paid from other tabs too.
  const nowMinute = useAppStore((s) => Math.floor(s.now / 60000));
  const now = nowMinute * 60000;
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  // Raw array, derived below in the render body: `eligibleTargetChildren` returns a fresh
  // array, so a selector wrapping it would loop forever under zustand v5.
  const children = useAppStore((s) => s.children);
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const openEdit = useAppStore((s) => s.openEdit);
  const openTimerEdit = useAppStore((s) => s.openTimerEdit);
  const refresh = useAppStore((s) => s.refresh);
  // Raw array, never a Set built inside a selector, for the same zustand reason.
  const queuedIds = useAppStore((s) => s.queuedIds);
  const connection = useAppStore((s) => s.connection);
  // The shared predicate, so this screen's queued markers cannot disagree with the
  // offline banners about what mode the app is in.
  const serverMode = selectServerMode({ connection });
  const queued = useMemo(() => queuedIdSet(queuedIds, serverMode), [queuedIds, serverMode]);

  // Native uses RefreshControl, touch-web a custom gesture, mouse-web nothing.
  const canPullToRefresh = Platform.OS !== 'web';
  const [refreshing, setRefreshing] = useState(false);
  const onRefresh = useCallback(() => {
    setRefreshing(true);
    refresh().finally(() => setRefreshing(false));
  }, [refresh]);
  const scrollRef = useRef<ScrollView | null>(null);
  const webPull = useWebPullToRefresh(scrollRef, refresh);

  // The household view is session-local, like the filters below: a way to read the list
  // you are looking at now, not a preference to carry into the next launch. Offered only
  // from two children who can OWN activity, since counting an expecting child would offer
  // a toggle that adds no rows.
  const householdChildren = eligibleTargetChildren(children);
  const canShowHousehold = householdChildren.length > 1;
  const [household, setHousehold] = useState(false);
  // Gated rather than reset, so deleting a sibling falls back to the single-child view
  // and re-adding one restores the choice, instead of a stale `true` rendering an
  // unattributed list with no chip left to explain it.
  const showHousehold = household && canShowHousehold;

  // General notes live in the same shared array, for queue/undo/sync reuse, but have
  // their own tab.
  const isActivity = (e: { type: string }) => e.type !== 'note' && e.type !== 'milestone';
  // Running timers belong here too. Marking a logged entry "still ongoing" converts it
  // into a timer, so without this the row would vanish from the list it was marked in.
  //
  // Built per child through the same two scoping helpers in both modes, rather than by
  // dropping the filters in household view, so the per-child rules stay in force:
  // `timersForChild` refuses an unowned timer, which here would draw a chipless row in an
  // attributed list, and `entriesForChild` refuses an entry whose child it cannot
  // resolve. `groupByDay` sorts, so assembling child by child costs no ordering.
  const items = showHousehold
    ? householdChildren.flatMap((c) => [...entriesForChild(entries, c.id).filter(isActivity), ...timersForChild(timers, c.id)])
    : [...entriesForChild(entries, selectedChildId).filter(isActivity), ...timersForChild(timers, selectedChildId)];

  // Each option list is narrowed by the OTHER half of the filter, so no combination
  // reachable from the UI can come back empty. One can still empty out under the user,
  // say a refresh dropping the selected day, hence the no-matches state below.
  const [filter, setFilter] = useState<TimelineFilter>({ day: null, types: [] });
  // Lives here, not in the chip row, because the two sheets have to be mounted outside
  // the scroll container the chips sit in.
  const [filterSheet, setFilterSheet] = useState<OpenFilterSheet>(null);
  const dayChoices = dayOptions(filterItems(items, { day: null, types: filter.types }), now);
  const activityChoices = activityOptions(filterItems(items, { day: filter.day, types: [] }));
  const visible = filterItems(items, filter);
  const groups = groupByDay(visible, now);

  // A running timer counts as logged, so the empty state stays away while one is going.
  const empty = items.length === 0;
  const body = (
    <>
      {/* Rendered whenever there is either something to filter or a household to switch
          to: a child with nothing logged is precisely when someone wants to see the rest
          of the household. `showFilters` then hides the day and activity chips, which
          would open sheets with no options in them. */}
      {(!empty || canShowHousehold) && (
        <HistoryFilterChips
          filter={filter}
          now={now}
          onOpen={setFilterSheet}
          onChange={setFilter}
          // null offers no toggle at all. The label names the current state, as the day
          // and activity chips beside it do.
          household={canShowHousehold ? showHousehold : null}
          householdLabel={showHousehold ? 'Everyone' : (child?.first ?? 'This child')}
          onToggleHousehold={() => setHousehold((v) => !v)}
          showFilters={!empty}
        />
      )}
      {empty ? (
        <View style={{ alignItems: 'center', paddingVertical: 64, paddingHorizontal: 24, gap: 14 }}>
          <View style={{ width: 72, height: 72, borderRadius: 22, backgroundColor: t.chip, alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="list" color={t.faint} size={34} />
          </View>
          <Txt weight={700} size={18}>
            {showHousehold ? 'Nothing logged yet' : `Nothing logged for ${child?.first ?? 'this child'}`}
          </Txt>
          {/* A parent who has just added a second child would otherwise read this as
              "the app has nothing" rather than "this child has nothing". */}
          <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 240, lineHeight: 20 }}>
            {!showHousehold && canShowHousehold
              ? 'Switch to Everyone above to see the rest of the household, or tap a big button on Home to log something.'
              : 'Your timeline fills up as you log feedings, sleep and diapers. Tap a big button on Home to start.'}
          </Txt>
        </View>
      ) : (
        <>
          {visible.length === 0 ? (
          <View style={{ alignItems: 'center', paddingVertical: 48, paddingHorizontal: 24, gap: 12 }}>
            <Txt weight={700} size={16}>
              Nothing to show here
            </Txt>
            {/* Not spelled out per filter: the only way to reach this state is the data
                moving underneath a selection, since the two option lists narrow
                symmetrically and cannot offer an empty combination. */}
            <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
              Nothing here matches the current filter.
            </Txt>
            <Tappable
              // Spelled out in full, as the twin literal in `HistoryFilterChips` is, so
              // neither touches the household toggle: clearing a day and an activity must
              // not also throw the user back to one child. That is why the toggle is not
              // part of `TimelineFilter`.
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
            </Tappable>
          </View>
        ) : (
          groups.map((g) => (
            <View key={g.label} style={{ marginBottom: 14 }}>
              <Txt weight={700} size={12.5} color={t.faint} tracking={0.8} style={{ marginHorizontal: 22, marginBottom: 6, textTransform: 'uppercase' }}>
                {g.label}
              </Txt>
              {/* A timer row opens the running-timer editor: `openEdit` looks the id up
                  in `entries` and returns early on a miss, so sending a timer there
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
                    // The ROW's own child, never the selected one.
                    child={showHousehold ? childAttribution(e.childId, children) : undefined}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </>
        )}
      </>
  );

  // A sibling of the scroll container on both layouts, never inside it: a sheet positions
  // itself against its nearest positioned ancestor, which inside the list would be the
  // scrolled content rather than the screen.
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
          <Tappable
            onPress={openSwitcher}
            accessibilityRole="button"
            accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
            style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
          >
            <Avatar child={child} size={38} radius={12} fontSize={16} />
          </Tappable>
        </View>
        {body}
      </ScrollView>

      {filterSheets}
    </View>
  );
}
