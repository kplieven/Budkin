/**
 * The reusable Time-Entry component, the app's signature feature.
 *
 * One focused panel at a time. The readout pills (Start -> End, and Lasted) are
 * the always-visible summary AND the selector: tapping a pill focuses that
 * quantity and reveals its single panel (kept chips + smart anchors + the
 * precise editor); the other quantities' controls stay hidden. Three parallel
 * chip rows became one panel. The derived (computed) quantity is dimmed.
 * INTERVAL keeps the last two of Start/End/Lasted; POINT (diaper and the other
 * single-moment activities) is a single
 * "When" panel. Focusing a pill only reveals its panel, it does not pin: pinning
 * happens on a real chip/anchor/nudge/type interaction via the store setters.
 */

import { useState, type ComponentProps, type ReactNode } from 'react';
import { Pressable, ScrollView, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { ANCHOR_LABEL, anchorLabel, dayGroupLabel, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
import {
  derivedField,
  endAnchorVisible,
  entriesForChild,
  isActive,
  lastDiaperMinAgo,
  lastFeedEndMinAgo,
  lastFeedStartMinAgo,
  lastSleepStartMinAgo,
  lastWakeMinAgo,
  teDurationMin,
  teEnd,
  teStart,
} from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { ActivityType } from '@/types/models';

const MIN = 60000;

type EditField = 'start' | 'end' | 'lasted' | 'when';

/**
 * A tappable resolved value rendered as an inset pill (matches the chip
 * vocabulary). Fills with the activity color while focused; a derived quantity
 * is dimmed.
 */
function ValuePill({
  label,
  color,
  active,
  dimmed,
  onPress,
  big,
}: {
  label: string;
  color: string;
  active: boolean;
  dimmed?: boolean;
  onPress: () => void;
  big?: boolean;
}) {
  const t = useTheme();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={(s) => [
        {
          paddingHorizontal: big ? 9 : 8,
          paddingVertical: big ? 4 : 2,
          borderRadius: 9,
          backgroundColor: active ? color : t.chip,
          borderWidth: 1.5,
          borderColor: active ? color : t.line2,
          cursor: 'pointer',
        },
        !active && isHovered(s) && { borderColor: t.dim },
      ]}
    >
      <Txt
        unselectable
        weight={800}
        size={big ? 17 : 12.5}
        tracking={big ? -0.3 : undefined}
        color={active ? t.onActivity : dimmed ? t.dim : t.text}
        style={{ fontVariant: ['tabular-nums'] }}
      >
        {label}
      </Txt>
    </Pressable>
  );
}

/** A Chip preset to the compact sizing used inside the Quick set strip. */
function StripChip(props: ComponentProps<typeof Chip>) {
  return <Chip padV={8} padH={12} fontSize={13} radius={11} {...props} />;
}

/**
 * The smart anchors as a single-line, horizontally-scrollable strip beneath the
 * exact editor. One line tall regardless of anchor count; when the chips
 * overflow, the trailing chip peeks at the right edge as the "swipe for more"
 * cue. A dim "Quick set" label keeps the shortcuts discoverable below the clock.
 */
function QuickSetStrip({ children }: { children: ReactNode }) {
  const t = useTheme();
  return (
    <View style={{ gap: 6 }}>
      <Txt weight={600} size={11.5} color={t.dim} tracking={0.2}>
        Quick set
      </Txt>
      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={{ gap: 8, paddingRight: 4 }}
      >
        {children}
      </ScrollView>
    </View>
  );
}

export function TimeEntry({ color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  // Primitive selector, so no new reference per render (zustand v5).
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  // Editing a running timer (opened via openTimerEdit): Start, End and Lasted are
  // all focusable. Editing End or Lasted to a fixed value flips ongoing false so
  // save() stops the timer and logs it; leaving it ongoing saves details only.
  // Gating on fromTimerId leaves normal new-entry sheets untouched.
  const timerEdit = useAppStore((s) => s.fromTimerId != null);
  const setTE = useAppStore((s) => s.setTE);
  const setEnded = useAppStore((s) => s.setEnded);
  const setEndedAbs = useAppStore((s) => s.setEndedAbs);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const setLasted = useAppStore((s) => s.setLasted);
  const setTimerLasted = useAppStore((s) => s.setTimerLasted);
  const setStartedAt = useAppStore((s) => s.setStartedAt);

  const isInterval = te.shape === 'interval';
  const [editing, setEditing] = useState<EditField>(
    !isInterval ? 'when' : timerEdit ? 'start' : 'end',
  );

  const start = teStart(te, now);
  const end = teEnd(te, now);
  const duration = teDurationMin(te, now);
  const derived = isInterval ? derivedField(te.order) : null;

  const endIsToday = new Date(end).toDateString() === new Date(now).toDateString();
  const resultSub = isInterval ? `running · ${fmtDur(duration)} so far` : relDayLabel(end, now);

  // Scoped to the selected child: `entries` holds every child's records. This
  // is the one surface where an unscoped read PERSISTS a wrong value rather
  // than only displaying one, since tapping a suggestion chip or an end anchor
  // writes that timestamp onto the new entry. Offering a sibling's last feed
  // as this child's anchor would save it as fact.
  const childEntries = entriesForChild(entries, selectedChildId);
  const lastFeed = lastFeedEndMinAgo(childEntries, now);
  const lastWake = lastWakeMinAgo(childEntries, now);
  const lastDiaper = lastDiaperMinAgo(childEntries, now);
  const feedStart = lastFeedStartMinAgo(childEntries, now);
  const sleepStart = lastSleepStartMinAgo(childEntries, now);

  const endActive = isActive(te.order, 'end');
  const startActive = isActive(te.order, 'start');

  // Focus only reveals a panel; the store setters do the pinning on interaction.
  const focus = (f: EditField) => setEditing(f);

  // Turning on "Still ongoing" makes End live ("now") and Lasted "running",
  // neither editable, so move focus to Start (the only editable quantity).
  const goOngoing = () => {
    setOngoing();
    setEditing('start');
  };

  // Ended anchors: "this ended when the next thing started". Keep only those
  // that land after the current start (and not in the future).
  const endAnchors = (
    isInterval
      ? [
          feedStart != null ? { key: 'feedstart' as const, min: feedStart, label: ANCHOR_LABEL.feedStarted } : null,
          sleepStart != null ? { key: 'sleepstart' as const, min: sleepStart, label: ANCHOR_LABEL.sleepStarted } : null,
          lastDiaper != null ? { key: 'diaper' as const, min: lastDiaper, label: ANCHOR_LABEL.diaper } : null,
        ]
      : []
  ).filter(
    (a): a is NonNullable<typeof a> =>
      a != null && endAnchorVisible(now - a.min * MIN, start as number, now),
  );

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 16 }}>
      {/* readout: pills are the summary AND the selector */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {isInterval ? (
              <>
                <ValuePill big label={fmtClock(start as number)} color={color} active={editing === 'start'} dimmed={derived === 'start'} onPress={() => focus('start')} />
                <Txt weight={700} size={16} color={t.dim}>
                  →
                </Txt>
                {te.ongoing ? (
                  <ValuePill big label="now" color={color} active={editing === 'end'} onPress={() => focus('end')} />
                ) : (
                  <ValuePill big label={fmtClock(end)} color={color} active={editing === 'end'} dimmed={derived === 'end'} onPress={() => focus('end')} />
                )}
              </>
            ) : (
              <ValuePill big label={fmtClock(end)} color={color} active={editing === 'when'} onPress={() => focus('when')} />
            )}
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            {isInterval && !te.ongoing ? (
              <>
                {!endIsToday && (
                  <Txt weight={500} size={12.5} color={t.dim}>
                    {dayGroupLabel(end, now)} ·
                  </Txt>
                )}
                <Txt weight={500} size={12.5} color={t.dim}>
                  lasted
                </Txt>
                <ValuePill label={fmtDur(duration)} color={color} active={editing === 'lasted'} dimmed={derived === 'lasted'} onPress={() => focus('lasted')} />
              </>
            ) : isInterval && te.ongoing && timerEdit ? (
              <>
                <Txt weight={500} size={12.5} color={t.dim}>
                  running ·
                </Txt>
                <ValuePill label={fmtDur(duration)} color={color} active={editing === 'lasted'} onPress={() => focus('lasted')} />
              </>
            ) : (
              <Txt weight={500} size={12.5} color={t.dim}>
                {resultSub}
              </Txt>
            )}
          </View>
        </View>
      </View>

      {/* one focused panel */}
      {isInterval && !timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          {!te.ongoing && (
            <TimeAdjuster
              mode="clock"
              value={end}
              now={now}
              color={color}
              showRelative
              onChange={(ms) => setEndedAbs(Math.max(ms, start as number))}
            />
          )}
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <StripChip label="Still ongoing" color={color} selected={!!te.ongoing} onPress={goOngoing} />
            {endAnchors.map((a) => (
              <StripChip
                key={a.label}
                label={anchorLabel(a.label, a.min)}
                color={color}
                selected={!te.ongoing && endActive && te.endAnchor === a.key}
                onPress={() => setEndedAbs(now - a.min * MIN, a.key)}
              />
            ))}
          </QuickSetStrip>
        </View>
      )}

      {isInterval && timerEdit && editing === 'end' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster
            mode="clock"
            value={end}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setEndedAbs(Math.min(now, Math.max(start as number, ms)))}
          />
          <Txt weight={500} size={12} color={t.dim}>
            {te.ongoing ? 'Set an end to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
          </Txt>
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <StripChip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
            {endAnchors.map((a) => (
              <StripChip
                key={a.label}
                label={anchorLabel(a.label, a.min)}
                color={color}
                selected={!te.ongoing && endActive && te.endAnchor === a.key}
                onPress={() => setEndedAbs(now - a.min * MIN, a.key)}
              />
            ))}
          </QuickSetStrip>
        </View>
      )}

      {isInterval && editing === 'start' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster
            mode="clock"
            value={start as number}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setStartedAt(te.ongoing ? ms : Math.min(ms, end))}
          />
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {lastFeed != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.feedEnded, lastFeed)}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * MIN, 'lastfeed')}
              />
            )}
            {lastWake != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.woke, lastWake)}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * MIN, 'wake')}
              />
            )}
            {lastDiaper != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.diaper, lastDiaper)}
                color={color}
                selected={startActive && te.startAnchor === 'diaper'}
                onPress={() => setStartedAt(now - lastDiaper * MIN, 'diaper')}
              />
            )}
          </QuickSetStrip>
        </View>
      )}

      {isInterval && !timerEdit && editing === 'lasted' && (
        <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setLasted} />
      )}

      {isInterval && timerEdit && editing === 'lasted' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
          </View>
          <Txt weight={500} size={12} color={t.dim}>
            {te.ongoing ? 'Pick a length to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
          </Txt>
          <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setTimerLasted} />
        </View>
      )}

      {!isInterval && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <TimeAdjuster mode="clock" value={end} now={now} color={color} showRelative onChange={(ms) => setTE({ absTime: ms })} />
          <QuickSetStrip>
            <StripChip
              label="Now"
              color={color}
              selected={te.absTime == null && te.agoMin === 0}
              onPress={() => setTE({ agoMin: 0 })}
            />
            {lastFeed != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.feedEnded, lastFeed)}
                color={color}
                selected={te.pointAnchor === 'lastfeed'}
                onPress={() => setTE({ absTime: now - lastFeed * MIN, pointAnchor: 'lastfeed' })}
              />
            )}
            {lastWake != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.woke, lastWake)}
                color={color}
                selected={te.pointAnchor === 'wake'}
                onPress={() => setTE({ absTime: now - lastWake * MIN, pointAnchor: 'wake' })}
              />
            )}
            {lastDiaper != null && (
              <StripChip
                label={anchorLabel(ANCHOR_LABEL.diaper, lastDiaper)}
                color={color}
                selected={te.pointAnchor === 'diaper'}
                onPress={() => setTE({ absTime: now - lastDiaper * MIN, pointAnchor: 'diaper' })}
              />
            )}
          </QuickSetStrip>
        </View>
      )}
    </View>
  );
}
