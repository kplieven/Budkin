import { useFocusEffect } from 'expo-router';
import { Fragment, useCallback, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { IconButton } from '@/components/IconButton';
import { Txt } from '@/components/Txt';
import { loadQueue } from '@/data/queue';
import { detailFor } from '@/features/activity/detail';
import { groupByDay } from '@/features/activity/groupByDay';
import {
  attributionFor,
  offlineHint,
  queueSummaryHint,
  queueSummaryLine,
  queueTypeCounts,
  runQueueRetry,
  syncBlockedBy,
  syncBlockedHint,
} from '@/features/queue/queueView';
import { ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { fmtClock } from '@/lib/format';
import { backOr } from '@/lib/nav';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { makeSettingsListStyles } from '@/theme/settingsList';
import { useTheme } from '@/theme/useTheme';
import type { Entry } from '@/types/models';

/**
 * The offline write queue, read-only.
 *
 * Shows `budkin.queue.v1` (`src/data/queue.ts`) and nothing else: the entries
 * created on this device that `flushQueue` has yet to push. Deliberately NOT a
 * unified "everything unsynced" view: unsynced children, measurements and timers
 * reach the server down a different path (`flushUnsynced`, `flushPendingOps`),
 * and folding them in here would make the count on this screen mean something
 * different again from the two it already has to coexist with.
 *
 * Read-only by design. Nothing here removes an entry: `removeQueuedEntry` exists
 * for the write paths that own the record (a delete, a replace-by-timer), and a
 * discard offered from a viewer would drop a record the user can still see
 * elsewhere in the app, leaving two screens disagreeing about what exists.
 * Which screen that is depends on the type, so nothing here sends the user to
 * one: a queued `note` shows in the Notes tab and a queued `milestone` in the
 * Growth checklist, neither of them in History.
 *
 * The queue lives in AsyncStorage rather than in the store, which is what keeps
 * this screen clear of the zustand v5 selector trap: the list is `useState` fed
 * by `loadQueue()`, and the only things selected out of the store are object
 * references (`connection`, `children`, `flushQueue`, `refresh`) or a scalar
 * (`offline`). No selector here returns a freshly built array.
 *
 * The one button re-checks the connection and then flushes, in that order, so it
 * is the app's single retry affordance rather than a second, weaker one. That
 * sequence is `runQueueRetry` in `queueView.ts`, where it can be tested; `onSync`
 * below is only the wiring.
 */
export default function OfflineQueue() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();

  const connection = useAppStore((s) => s.connection);
  const offline = useAppStore((s) => s.offline);
  const children = useAppStore((s) => s.children);
  const flushQueue = useAppStore((s) => s.flushQueue);
  const refresh = useAppStore((s) => s.refresh);

  // `null` is "not read yet", which is distinct from an empty queue: the empty
  // card claims everything is synced, and it must not flash up before the read
  // that would contradict it lands.
  const [queue, setQueue] = useState<Entry[] | null>(null);
  const [syncing, setSyncing] = useState(false);
  const [result, setResult] = useState<string | null>(null);
  // Snapshot taken with each read, purely so the day headings ("Today",
  // "Yesterday") have a reference point. Deliberately not the store's `now`,
  // which ticks every second and would re-render this whole list that often for
  // labels that change twice a day.
  const [readAt, setReadAt] = useState(() => Date.now());

  const read = useCallback(async () => {
    const q = await loadQueue();
    setQueue(q);
    setReadAt(Date.now());
    // A sync result describes the flush that produced it and nothing else.
    // Leaving it up would let "Uploaded 3 entries." sit over a queue read
    // minutes later, on a return visit that uploaded nothing.
    setResult(null);
    return q;
  }, []);

  // On focus rather than on mount alone. `queueCount` in the store is not a
  // reliable mirror of the file: the Android nap widget enqueues from a headless
  // task in another process and never touches the store, so the only way to know
  // what is really queued is to read it. Coming back from elsewhere in the app
  // re-reads for the same reason.
  useFocusEffect(
    useCallback(() => {
      void read();
    }, [read]),
  );

  const loaded = queue != null;
  const serverMode = connection?.mode === 'server';
  const count = queue?.length ?? 0;
  const block = syncBlockedBy({ loaded, serverMode });
  // At most one line ever shows under the button: `offlineHint` stays quiet in
  // local mode (the only state `syncBlockedHint` speaks in) and quiet again once
  // a press has been answered below.
  const showResult = result != null && !syncing;
  const blockedHint = syncBlockedHint(block);
  const connectionHint = offlineHint({ offline, block, answered: showResult });
  const typeCounts = queueTypeCounts(queue ?? []);
  // Grouped by the entry's OWN timestamp, not by when it was enqueued: the queue
  // records no enqueue time (`Entry` has no such field and `budkin.queue.v1` is
  // not migrated for this screen), and the entry's timestamp is the one the user
  // recognises. Same grouping as History, so a queued entry sits under the day
  // heading it will still have once it lands.
  const groups = groupByDay(queue ?? [], readAt);

  const onSync = useCallback(async () => {
    setSyncing(true);
    // The whole sequence, including the order of the two awaits and when the
    // counts are taken, lives in `runQueueRetry`. `read` doubles as this
    // screen's own re-read, so the list and the counts always agree.
    setResult(
      await runQueueRetry({
        read,
        refresh,
        flushQueue,
        // From the store, not the `offline` binding above: that one was captured
        // when this callback was built, which is before the refresh that decides
        // the answer.
        getOffline: () => useAppStore.getState().offline,
      }),
    );
    setSyncing(false);
  }, [flushQueue, read, refresh]);

  const { group, row, sectionLabel } = makeSettingsListStyles(t);
  const divider = { borderBottomWidth: 1, borderBottomColor: t.line };

  const summaryCard = (
    <View style={{ ...group, padding: 16, marginBottom: 4 }}>
      {/* Headline AND hint gate on `loaded`, together. Splitting them is what
          made the first paint of every visit read "Reading the queue" over
          "Nothing is waiting right now.", which is the synced-and-settled claim
          this screen exists to be trusted about. */}
      <Txt weight={700} size={16}>
        {loaded ? queueSummaryLine(count) : 'Reading the queue'}
      </Txt>
      <Txt weight={500} size={12.5} color={t.dim} style={{ marginTop: 4, lineHeight: 18 }}>
        {queueSummaryHint(loaded, count)}
      </Txt>

      {typeCounts.length > 0 && (
        <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
          {typeCounts.map((c) => (
            <View
              key={c.type}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 6,
                paddingHorizontal: 10,
                paddingVertical: 6,
                borderRadius: 99,
                backgroundColor: hexA(t.activity[c.type], 0.16),
              }}
            >
              <Icon name={c.type} color={t.activity[c.type]} size={14} />
              <Txt weight={600} size={12.5} color={t.activity[c.type]}>
                {c.label}
              </Txt>
            </View>
          ))}
        </View>
      )}

      {/* Labelled "Retry connection" to a screen reader, matching the offline
          banner's own button (`src/app/(tabs)/index.tsx`, `src/shell/TopBar.tsx`):
          announced on its own, with none of the card around it, a bare "Retry"
          says nothing about what is being retried. */}
      <Pressable
        onPress={() => void onSync()}
        disabled={block != null || syncing}
        accessibilityRole="button"
        accessibilityLabel="Retry connection"
        accessibilityState={{ disabled: block != null || syncing }}
        style={(s) => [
          {
            flexDirection: 'row',
            alignItems: 'center',
            justifyContent: 'center',
            gap: 8,
            marginTop: 14,
            paddingVertical: 12,
            borderRadius: 13,
            backgroundColor: block != null ? t.chip : t.primary,
            cursor: block != null ? 'auto' : 'pointer',
          },
          block == null && isHovered(s) && { opacity: 0.9 },
        ]}
      >
        {syncing && <ActivityIndicator size="small" color={block != null ? t.dim : t.onPrimary} />}
        <Txt unselectable weight={700} size={15} color={block != null ? t.faint : t.onPrimary}>
          {/* "Retry", not "Sync now": the press re-checks the connection first
              and uploads second, so it is the same affordance as the offline
              banner's Retry and says so. */}
          {syncing ? 'Retrying…' : 'Retry'}
        </Txt>
      </Pressable>

      {blockedHint != null && (
        <Txt weight={500} size={12.5} color={t.dim} style={{ marginTop: 8, lineHeight: 18 }}>
          {blockedHint}
        </Txt>
      )}
      {/* Under a LIVE button, not a greyed one: this route is a stack screen on
          mobile with no offline banner over it, so without this the connection
          being down is a fact the screen never states. */}
      {connectionHint != null && (
        <Txt weight={500} size={12.5} color={t.dim} style={{ marginTop: 8, lineHeight: 18 }}>
          {connectionHint}
        </Txt>
      )}
      {showResult && (
        <Txt weight={600} size={12.5} color={t.dim} style={{ marginTop: 8, lineHeight: 18 }}>
          {result}
        </Txt>
      )}
    </View>
  );

  const body = (
    <>
      {summaryCard}

      {groups.map((g) => (
        <Fragment key={g.label}>
          <Txt
            weight={700}
            size={12.5}
            color={t.faint}
            tracking={0.8}
            style={{ ...sectionLabel, textTransform: 'uppercase' }}
          >
            {g.label}
          </Txt>
          <View style={group}>
            {g.items.map((e, i) => {
              const color = t.activity[e.type];
              const detail = detailFor(e);
              const who = attributionFor(e.childId, children);
              // `entryTimestamp` would prefer an interval's end; the queue is
              // about when the thing happened, and an entry with no end yet has
              // only a start, so the start is the one time every shape has.
              const at = e.type === 'feeding' || e.type === 'sleep' || e.type === 'pumping' || e.type === 'tummy'
                ? e.start
                : e.time;
              return (
                <View key={e.id} style={[row, i < g.items.length - 1 && divider]}>
                  <View
                    style={{
                      width: 30,
                      height: 30,
                      borderRadius: 9,
                      backgroundColor: hexA(color, 0.16),
                      alignItems: 'center',
                      justifyContent: 'center',
                      marginRight: 12,
                    }}
                  >
                    <Icon name={e.type} color={color} size={17} />
                  </View>
                  <View style={{ flex: 1, paddingRight: 10 }}>
                    <Txt weight={700} size={15.5} tracking={-0.2}>
                      {ACTIVITY_LABEL[e.type]}
                      {who ? ` · ${who}` : ''}
                    </Txt>
                    {detail ? (
                      <Txt weight={500} size={12.5} color={t.dim} numberOfLines={1} style={{ marginTop: 2 }}>
                        {detail}
                      </Txt>
                    ) : null}
                  </View>
                  <Txt weight={600} size={13.5} color={t.dim} style={{ fontVariant: ['tabular-nums'] }}>
                    {fmtClock(at)}
                  </Txt>
                </View>
              );
            })}
          </View>
        </Fragment>
      ))}

      {/* The queue carries no enqueue time, no retry count and no last error:
          `Entry` has none of those fields and `budkin.queue.v1` is not migrated
          for this screen. Saying so is better than leaving a user to wonder why
          a stuck entry never explains itself. */}
      {count > 0 && (
        <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 18, marginHorizontal: 4, lineHeight: 17 }}>
          Budkin does not record why an upload failed, so an entry that keeps
          waiting looks the same as one that has only just been logged.
        </Txt>
      )}
    </>
  );

  if (desktop) return <DesktopPage maxWidth={560}>{body}</DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: insets.bottom + 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 4, marginBottom: 14 }}>
        {/* backOr, not router.back: this route is deep-linkable and typing it in
            the address bar makes it the session's first screen, where a bare
            GO_BACK is dropped and the chevron dead-ends. */}
        <IconButton name="chevron-left" color={t.text} onPress={() => backOr('/settings')} accessibilityLabel="Back" />
        <Txt weight={800} size={27} tracking={-0.6}>
          Offline queue
        </Txt>
      </View>
      {body}
    </ScrollView>
  );
}
