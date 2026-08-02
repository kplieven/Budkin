import { useCallback, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, Platform, Pressable, RefreshControl, ScrollView, View } from 'react-native';
import Animated from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
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
  // Primitive selector, so no new reference per render (zustand v5); the
  // child-scoping filter itself runs in the render body below.
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  // MINUTE-quantized, deliberately not the raw per-second `s.now`. Every change
  // of this value re-runs the whole pipeline below (child scoping, both option
  // lists, the filter, the grouping) over the child's entire timeline AND
  // re-renders every mounted row, and nothing on this screen is finer-grained
  // than a minute: an ongoing row's elapsed pill is whole minutes
  // (`fmtAgoShort`), its capsule grows about a fifth of a pixel per minute, and
  // the Today/Yesterday headings turn over at midnight. Subscribing to `s.now`
  // bought 59 extra full-list passes a minute that all rendered identically —
  // and kept paying them while the user sat on another tab, since a visited tab
  // screen stays mounted.
  //
  // The selector returns a NUMBER, never a fresh reference (zustand v5), and
  // holds the same number for a whole minute, so the subscription itself is what
  // goes quiet — a useMemo here would have saved the recompute but not the
  // re-render.
  const nowMinute = useAppStore((s) => Math.floor(s.now / 60000));
  const now = nowMinute * 60000;
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  // Raw array out of the store, derived below in the render body (zustand v5:
  // `eligibleTargetChildren` returns a fresh array, so a selector wrapping it
  // would make every snapshot look changed and loop forever).
  const children = useAppStore((s) => s.children);
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

  // The household view: show every child's activity at once, each row naming
  // whose it is. Session-local like the filters below, and for the same reason:
  // it is a way to read the list you are looking at now, not a preference to
  // carry into the next launch.
  //
  // Offered only from two children who can OWN activity. An expecting child is
  // excluded by `eligibleTargetChildren`, because their `birth` is a due date
  // and nothing can be logged against them, so counting them would offer a
  // toggle that adds no rows. The same rule the log sheet's target picker uses,
  // so the two cannot disagree about what a household is.
  const householdChildren = eligibleTargetChildren(children);
  const canShowHousehold = householdChildren.length > 1;
  const [household, setHousehold] = useState(false);
  // Gated rather than reset, so deleting a sibling (or switching to a server
  // that has one child) quietly falls back to the single-child view and
  // re-adding one restores what the user had chosen, instead of a stale `true`
  // rendering an unattributed list with no chip left to explain it.
  const showHousehold = household && canShowHousehold;

  // `entries` holds every child's records, so scope to the selected child first:
  // otherwise switching child (or selecting an expecting one, which owns no
  // activity at all) shows the previous child's timeline. General notes live in
  // the same shared array (for queue/undo/sync reuse) but have their OWN
  // dedicated tab, so they're excluded from the activity timeline too.
  const isActivity = (e: { type: string }) => e.type !== 'note' && e.type !== 'milestone';
  // Running timers belong here too: they are the child's activity, just not
  // finished. Marking an already-logged entry "still ongoing" converts it into
  // a timer, so without this the row the user was looking at would vanish from
  // the very list they marked it in.
  //
  // Built per child through the SAME two scoping helpers in both modes, rather
  // than by dropping the filters when the household view is on. That keeps the
  // documented per-child rules in force: `timersForChild` refuses to adopt an
  // unowned timer (the Timers tab deliberately lists the raw array instead, so
  // a legacy timer stays stoppable, but here an unattributable row would draw a
  // chipless entry in an attributed list), and `entriesForChild` refuses an
  // entry whose child it cannot resolve. `groupByDay` sorts, so assembling
  // child by child costs no ordering.
  const items = showHousehold
    ? householdChildren.flatMap((c) => [...entriesForChild(entries, c.id).filter(isActivity), ...timersForChild(timers, c.id)])
    : [...entriesForChild(entries, selectedChildId).filter(isActivity), ...timersForChild(timers, selectedChildId)];

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

  // A running timer counts as something logged, so the empty state stays away
  // while one is going.
  const empty = items.length === 0;
  const body = (
    <>
      {/* Rendered whenever there is EITHER something to filter or a household to
          switch to, not only in the non-empty case. The toggle used to live
          inside the populated branch, which made it unreachable on a child with
          nothing logged: precisely the state in which someone wants to see the
          rest of the household. `showFilters` then hides the day and activity
          chips, which would otherwise open sheets with no options in them. */}
      {(!empty || canShowHousehold) && (
        <HistoryFilterChips
          filter={filter}
          now={now}
          onOpen={setFilterSheet}
          onChange={setFilter}
          // null offers no toggle at all. The label names the CURRENT state, the
          // way the day and activity chips beside it do.
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
          {/* When a sibling might have something, say so: the empty timeline is
              the one place the household toggle is genuinely useful, and a
              parent who has just added a second child would otherwise read this
              as "the app has nothing" rather than "this child has nothing". */}
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
            {/* Deliberately not spelled out per filter: the only way to reach
                this state is the data moving underneath a selection (a refresh
                drops the day, a child switch), since the two option lists
                narrow symmetrically and cannot offer an empty combination. */}
            <Txt weight={500} size={14} color={t.dim} style={{ textAlign: 'center', maxWidth: 260, lineHeight: 20 }}>
              Nothing here matches the current filter.
            </Txt>
            <Pressable
              // The second of the two hard-coded cleared-state literals (the
              // other is in `HistoryFilterChips`). Both spell `TimelineFilter`
              // out in full, so neither touches the household toggle, which is
              // deliberately not part of that type: clearing a day and an
              // activity must not also throw the user back to one child. If the
              // toggle is ever moved INTO `TimelineFilter`, these two literals
              // decide that by accident.
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
                    // Only while the household view is on: with one child's rows
                    // on screen the answer is never in doubt, and
                    // `childAttribution` would fall silent anyway below two
                    // children. Passed the ROW's own child, never the selected
                    // one, which is the whole point of the view.
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
