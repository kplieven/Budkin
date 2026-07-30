import { router } from 'expo-router';
import { Pressable, View, type ViewStyle } from 'react-native';

import { isHovered } from '@/components/hover';
import { Icon, type IconName } from '@/components/Icon';
import { PulsingDot } from '@/components/PulsingDot';
import { SyncBadge } from '@/components/SyncBadge';
import { Txt } from '@/components/Txt';
import { ALL_ACTIVITIES, ACTIVITY_LABEL } from '@/lib/activities';
import { hexA } from '@/lib/color';
import { ExpectingCard } from '@/features/dashboard/ExpectingCard';
import { NoChildCard } from '@/features/dashboard/NoChildCard';
import { liveSleepMsInWindow, windowStart } from '@/features/insights/compute';
import { MilestoneNudge } from '@/features/milestones/MilestoneNudge';
import { fmtAgoShort, fmtDur } from '@/lib/format';
import { bathGivenToday, treatmentDueHint, treatmentDueList, treatmentsAllGiven, entriesForChild, fmtDayStartHour, lastDiaper, lastFeedStartMinAgo, nextStartSide, nextWashKind, runningTimer, timersForChild } from '@/store/selectors';
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
  medication: 'medication',
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
  // The client-wide day boundary (set in Settings); "today's sleep" below counts
  // over this window, not calendar midnight.
  const originHour = useAppStore((s) => s.rhythmOriginHour);
  const openSheet = useAppStore((s) => s.openSheet);
  const openMedicationLog = useAppStore((s) => s.openMedicationLog);
  const startQuickTimer = useAppStore((s) => s.startQuickTimer);
  const smallWashesPerBig = useAppStore((s) => s.smallWashesPerBig);
  // Raw select (stable reference); the due list is derived in the render body
  // below, never in the selector, per the zustand v5 rule.
  const treatments = useAppStore((s) => s.treatments);
  // Sync badges only mean something when mirroring to a server; hidden in local
  // mode, exactly as on the Timers screen. Primitive selector, stable reference.
  const isServer = useAppStore((s) => s.connection?.mode === 'server');
  // Primitive selector, so no new reference per render (zustand v5).
  const hasChild = useAppStore((s) => s.children.length > 0);
  // Returns a store element, not a derived object, so the reference is stable.
  const selectedChild = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));

  if (!hasChild) return <NoChildCard />;
  if (selectedChild?.expected) return <ExpectingCard child={selectedChild} />;

  // Phone tiles stay two-up; desktop tiles auto-fit to as many columns as fit.
  const tileStyle: ViewStyle =
    layout === 'desktop'
      ? { flexBasis: 168, minWidth: 168, flexGrow: 1 }
      : { width: '47.8%', flexGrow: 1 };

  // ---- derived status ----
  // Scoped to the selected child: the store's `entries` holds every child's
  // records, so an unscoped read shows a sibling's last feed and diaper here.
  // Safe below the early returns above, since this is a plain call, not a hook.
  const childEntries = entriesForChild(entries, selectedChild?.id);
  const lastFeedAgo = lastFeedStartMinAgo(childEntries, now);
  const lastFeeding = childEntries
    .filter((e): e is Extract<typeof e, { type: 'feeding' }> => e.type === 'feeding' && e.end != null)
    .sort((a, b) => b.start - a.start)[0];
  const fedSide = lastFeeding ? METHOD_LABEL[lastFeeding.method] : null;

  // Scoped like `childEntries`: a sibling's running nap must not land in this
  // child's sleep total. Keyed on `saveAs`, not `activity`, because that is what
  // the timer will be written as when stopped — a quick timer switched to sleep
  // is sleep. Same rule the sleep-aware notification scheduler uses.
  const childTimers = timersForChild(timers, selectedChild?.id);
  // `runningTimer` is that same rule for one kind of timer: the selected child is
  // passed as both ids, which is the `timersForChild` case, so this is exactly
  // `childTimers.find(saveAs === 'sleep')` with the rule stated in one place.
  const runningSleep = runningTimer(timers, 'sleep', selectedChild?.id, selectedChild?.id);
  const lastSleep = childEntries
    .filter((e): e is Extract<typeof e, { type: 'sleep' }> => e.type === 'sleep' && e.end != null)
    .sort((a, b) => (b.end as number) - (a.end as number))[0];

  const dayStartMs = windowStart(now, originHour);
  // Sleep so far in today's window: logged sleep plus the elapsed part of a nap
  // that is still running, so the number keeps counting up instead of being
  // replaced by the timer (`now` ticks every second, so this ticks too).
  // Everything is apportioned at the window boundary — a sleep or a nap
  // straddling it counts here only for its in-window part, the rest lands in the
  // neighbouring day. Matches the Insights Rhythm graph and its totalSleep
  // trend, which split sleep on the same seam; windowStart rebuilds from
  // calendar fields so the boundary stays correct across DST.
  const todaySleepMin = liveSleepMsInWindow(childEntries, childTimers, dayStartMs, now) / 60000;
  // "since noon" / "since 7:00" / "since midnight" — names the boundary the
  // total counts from, which is user-configurable in Settings and is not
  // midnight by default. fmtDayStartHour is already lowercase for this use.
  const daySinceLabel = `since ${fmtDayStartHour(originHour)}`;

  const dia = lastDiaper(childEntries);
  const diaperAgo = dia ? Math.round((now - dia.time) / 60000) : null;

  const napStatus = runningSleep
    ? `napping ${fmtDur((now - runningSleep.start) / 60000)}`
    : lastSleep
      ? `${fmtAgoShort(Math.round((now - (lastSleep.end as number)) / 60000))} ago`
      : 'Tap to log';
  const diaperHint = diaperAgo != null ? `${fmtAgoShort(diaperAgo)} ago` : 'Tap to log';

  const startSideLabel = nextStartSide(childEntries) === 'left' ? 'Left' : 'Right';
  // Today's-wash "checked" state: >=1 bath on today's local date. `now`-keyed, so
  // it clears itself at local midnight without any reset logic.
  const washedToday = bathGivenToday(childEntries, now);
  const washKind = nextWashKind(childEntries, smallWashesPerBig);
  // Once a wash is logged today the tile switches to the "done" copy; otherwise
  // it keeps the forward-looking "due" hint.
  const washHint = washedToday ? 'Washed today' : washKind === 'big' ? 'Big wash due today' : 'Small wash due';
  // Treatments get the same treatment as washes: a forward-looking "due" hint
  // and a done check once the day's doses are all logged. `null` means this
  // child keeps no treatments, so the tile falls back to the generic copy.
  const treatmentDue = treatmentDueList(treatments, selectedChild?.id, childEntries, now);
  const medHint = treatmentDueHint(treatmentDue);
  // `undefined`, not `false`, when this child keeps no treatments: the tile then has
  // no done state at all and must not announce itself as an unchecked one.
  const dosesAllGiven = treatmentDue.length > 0 ? treatmentsAllGiven(treatmentDue) : undefined;
  const activityHint: Record<ActivityType, string> = {
    feeding: `${lastFeedAgo != null ? `${fmtAgoShort(lastFeedAgo)} ago` : 'Tap to log'} · start ${startSideLabel}`,
    sleep: napStatus,
    diaper: diaperHint,
    pumping: 'Tap to log',
    tummy: 'Tap to log',
    bath: washHint,
    temperature: 'Tap to log',
    medication: medHint ?? 'Tap to log',
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
      // Always the day's running total, never just the current nap. No "—"
      // empty state: a real zero is the answer to "how much sleep today", and
      // fmtDur(0) says "0 min". A running nap is announced on the Sleep grid
      // tile and the live-timer card, so the sub here stays the boundary label.
      label: 'Sleep',
      color: t.activity.sleep,
      value: fmtDur(todaySleepMin),
      sub: daySinceLabel,
    },
    {
      label: 'Diaper',
      color: t.activity.diaper,
      value: diaperAgo != null ? fmtAgoShort(diaperAgo) : '—',
      sub: dia ? (dia.solid ? 'ago · solid' : 'ago · wet') : 'none',
    },
  ];

  return (
    <>
      <MilestoneNudge />
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

      {/* live-timer cards + start-timer card — one full-width card each, same
          card style. Every running timer shows (global list, so a born
          sibling's timer stays visible even while another child is selected),
          then the Start-timer card sits below as the "start another" action. */}
      <View style={{ gap: 9, marginTop: 4 }}>
        {timers.map((tm) => (
          <Pressable
            key={tm.id}
            onPress={() => router.navigate('/timers')}
            accessibilityRole="button"
            accessibilityLabel={`${ACTIVITY_LABEL[tm.saveAs]} timer running${isServer ? (tm.serverId != null ? ', synced' : ', pending sync') : ''}, view timers`}
            style={(s) => [
              {
                backgroundColor: t.surface,
                borderWidth: 1.5,
                borderColor: t.line,
                borderRadius: 20,
                paddingVertical: 15,
                paddingHorizontal: 17,
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                cursor: 'pointer',
              },
              isHovered(s) && { borderColor: t.line2 },
            ]}
          >
            <PulsingDot color={t.activity[tm.saveAs]} />
            <View style={{ flex: 1 }}>
              {/* Eyebrow row: the "{ACTIVITY} RUNNING" label with the per-timer
                  sync badge beside it. The badge's tallest part (12px icon,
                  11.5px text) is no taller than the 12px label's own line box,
                  so this row is 14px with or without it and the card height does
                  not move. The label shrinks and truncates ahead of the badge
                  because the badge is the part that can widen: "Pending sync" is
                  materially wider than "Synced". In local mode the badge is
                  gated off and the row is just the label. */}
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
                <Txt unselectable numberOfLines={1} weight={600} size={12} color={t.dim} style={{ flexShrink: 1, textTransform: 'uppercase' }}>
                  {ACTIVITY_LABEL[tm.saveAs]} running
                </Txt>
                {isServer && <SyncBadge synced={tm.serverId != null} inline />}
              </View>
              <Txt unselectable weight={800} size={26} tracking={-0.5} color={t.activity[tm.saveAs]} style={{ fontVariant: ['tabular-nums'], marginTop: 1 }}>
                {fmtDur((now - tm.start) / 60000)}
              </Txt>
            </View>
            {/* Right column: the "View" affordance and its chevron on one centred
                row. The sync badge sits on the eyebrow row above instead of
                stacked under here, so this column stays a single line. */}
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
              <Txt unselectable weight={600} size={13.5} color={t.dim}>
                View
              </Txt>
              <Icon name="chevron-right" color={t.dim} size={16} />
            </View>
          </Pressable>
        ))}

        {/* Start-timer card */}
        <Pressable
          onPress={() => {
            startQuickTimer();
            router.navigate('/timers');
          }}
          accessibilityRole="button"
          accessibilityLabel="Start timer, save as any activity"
          style={(s) => [
            {
              backgroundColor: hexA(t.primary, t.dark ? 0.14 : 0.12),
              borderWidth: 1.5,
              borderColor: hexA(t.primary, 0.5),
              borderStyle: 'dashed',
              borderRadius: 20,
              paddingVertical: 15,
              paddingHorizontal: 17,
              flexDirection: 'row',
              alignItems: 'center',
              gap: 13,
              cursor: 'pointer',
            },
            isHovered(s) && { borderColor: hexA(t.primary, 0.75), boxShadow: t.shadow },
          ]}
        >
          <View style={{ width: 44, height: 44, borderRadius: 13, backgroundColor: hexA(t.primary, 0.18), alignItems: 'center', justifyContent: 'center' }}>
            <Icon name="timer" color={t.primary} size={23} />
          </View>
          <View style={{ flex: 1 }}>
            <Txt unselectable weight={700} size={17} tracking={-0.2}>
              Start timer
            </Txt>
            <Txt unselectable weight={500} size={12.5} color={t.dim} style={{ marginTop: 1 }}>
              Save as any activity
            </Txt>
          </View>
          <Icon name="plus" color={t.primary} size={20} />
        </Pressable>
      </View>

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
            // Medication routes through the treatment picker (which falls back to the
            // manual form when the child has no active treatments today); every other
            // tile opens its log sheet directly.
            onPress={() => (a === 'medication' ? openMedicationLog() : openSheet(a))}
            done={a === 'bath' ? washedToday : a === 'medication' ? dosesAllGiven : undefined}
          />
        ))}
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
  done,
}: {
  label: string;
  color: string;
  icon: IconName;
  hint: string;
  widthStyle: ViewStyle;
  onPress: () => void;
  /** Marks the tile "done for today" with a check-circle badge and an accent
   *  border. `undefined` for tiles that have no done state, so only a
   *  done-capable tile carries the checked accessibility semantics. */
  done?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={done === undefined ? undefined : { checked: done }}
      style={(s) => [
        {
          backgroundColor: t.surface,
          borderWidth: 1.5,
          borderColor: done ? hexA(color, 0.4) : t.line,
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
      {done ? (
        <View
          style={{
            position: 'absolute',
            top: 12,
            right: 12,
            width: 24,
            height: 24,
            borderRadius: 999,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: color,
          }}
        >
          <Icon name="check" color={t.onActivity} size={15} />
        </View>
      ) : null}
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
