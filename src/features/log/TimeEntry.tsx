/**
 * The reusable Time-Entry component.
 *
 * Zero or one focused panel at a time. INTERVAL logs open with nothing focused,
 * so it is always the user's deliberate choice which time (Start, End, Lasted)
 * they are adjusting; a POINT log has one "When" time, no ambiguity, so its panel
 * opens straight away. The readout pills are the summary AND the selector:
 * tapping one focuses that quantity and reveals its single panel, and the derived
 * (computed) quantity is dimmed. Focusing a pill only reveals its panel, it does
 * not pin: pinning happens on a real chip/anchor/nudge/type interaction via the
 * store setters.
 */

import { useState, type ReactNode } from 'react';
import { ScrollView, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { Tappable } from '@/components/press';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { ANCHOR_LABEL, anchorLabel, dayGroupLabel, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
import { anchorChildId } from '@/lib/logTargets';
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
    <Tappable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      style={(s) => [
        {
          // `big` is 8, not 9: the one-line readout still has to fit a 375pt
          // phone, and two pills' worth of padding is 4 of the 7px that buys.
          paddingHorizontal: 8,
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
    </Tappable>
  );
}

/**
 * Order is load-bearing: with the strip below the exact editor, the panel handed you a
 * finished answer at the top, so the task ended before your eye reached the chips and the
 * anchors went unused.
 *
 * One line tall regardless of anchor count. When the chips overflow, the trailing one
 * peeks at the right edge as the "swipe for more" cue.
 */
function QuickSetStrip({ children }: { children: ReactNode }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingRight: 4 }}
    >
      {children}
    </ScrollView>
  );
}

export function TimeEntry({ color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  // Primitive selectors, and `entries` selected raw: never return a fresh
  // reference from a zustand v5 selector. Scoping happens in the render body.
  const selectedChildId = useAppStore((s) => s.selectedChildId);
  const sheetChildIds = useAppStore((s) => s.sheetChildIds);
  // Editing a running timer: setting End or Lasted to a fixed value flips
  // ongoing false, so save() stops the timer and logs it. Gating on fromTimerId
  // leaves normal new-entry sheets untouched.
  const timerEdit = useAppStore((s) => s.fromTimerId != null);
  const setTE = useAppStore((s) => s.setTE);
  const setEnded = useAppStore((s) => s.setEnded);
  const setEndedAbs = useAppStore((s) => s.setEndedAbs);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const setLasted = useAppStore((s) => s.setLasted);
  const setTimerLasted = useAppStore((s) => s.setTimerLasted);
  const setStartedAt = useAppStore((s) => s.setStartedAt);

  const isInterval = te.shape === 'interval';
  const [editing, setEditing] = useState<EditField | null>(isInterval ? null : 'when');

  const start = teStart(te, now);
  const end = teEnd(te, now);
  const duration = teDurationMin(te, now);
  const derived = isInterval ? derivedField(te.order) : null;

  const endIsToday = new Date(end).toDateString() === new Date(now).toDateString();
  const resultSub = isInterval ? `running · ${fmtDur(duration)} so far` : relDayLabel(end, now);

  // Scoped to the child the SHEET is aimed at, not the global selection:
  // `entries` holds every child's records. This is the one surface where an
  // unscoped read PERSISTS a wrong value rather than only displaying one, since
  // tapping a suggestion chip or an end anchor writes that timestamp onto the new
  // entry as fact. With SEVERAL children targeted there is no single right
  // answer, so `anchorChildId` yields undefined and every anchor chip drops.
  const childEntries = entriesForChild(entries, anchorChildId(sheetChildIds, selectedChildId));
  const lastFeed = lastFeedEndMinAgo(childEntries, now);
  const lastWake = lastWakeMinAgo(childEntries, now);
  const lastDiaper = lastDiaperMinAgo(childEntries, now);
  const feedStart = lastFeedStartMinAgo(childEntries, now);
  const sleepStart = lastSleepStartMinAgo(childEntries, now);

  const endActive = isActive(te.order, 'end');
  const startActive = isActive(te.order, 'start');

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
    // The 10 is a `gap`, not a marginBottom on the readout, so it exists only
    // when a panel is actually open.
    <View style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, gap: 10, marginBottom: 16 }}>
      {/* ONE line: Start → End leads and the duration is pushed to the trailing
          edge by a flexBasis-0 spacer, not marginLeft 'auto'. The row must keep
          its flexWrap escape hatch (a large font scale, or a day label in front
          of the duration), and an auto margin survives the wrap and right-aligns
          the duration on its own line, where a zero-base spacer just eats the
          first line's slack. The 8px minimum separation is that spacer's
          minWidth, not an outer columnGap, which would be charged twice against
          the wrap threshold for one visible gap. The row needs 267px and a 375pt
          phone gives it 271, which is why the two gaps here (6 and 5) and the
          `big` pill padding are each a notch tighter than they read. */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1, flexDirection: 'row', alignItems: 'center', flexWrap: 'wrap', rowGap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
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
          <View style={{ flex: 1, minWidth: 8 }} />
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
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

      {isInterval && !timerEdit && editing === 'end' && (
        <View style={{ gap: 14 }}>
          <QuickSetStrip>
            <Chip
              label="Now"
              color={color}
              selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
              onPress={() => setEnded(0)}
            />
            <Chip label="Still ongoing" color={color} selected={!!te.ongoing} onPress={goOngoing} />
            {endAnchors.map((a) => (
              <Chip
                key={a.label}
                label={anchorLabel(a.label, a.min)}
                color={color}
                selected={!te.ongoing && endActive && te.endAnchor === a.key}
                onPress={() => setEndedAbs(now - a.min * MIN, a.key)}
              />
            ))}
          </QuickSetStrip>
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
        </View>
      )}

      {isInterval && timerEdit && editing === 'end' && (
        <View style={{ gap: 14 }}>
          {/* The caption leads the whole panel: a Quick set chip stops the timer
              too, so the warning has to precede the chips, not just the clock. */}
          <View style={{ gap: 8 }}>
            <Txt weight={500} size={12} color={t.dim}>
              {te.ongoing ? 'Set an end to stop the timer and log it.' : 'Saving stops the timer and logs it.'}
            </Txt>
            <QuickSetStrip>
              <Chip
                label="Now"
                color={color}
                selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === 0}
                onPress={() => setEnded(0)}
              />
              <Chip label="Still running" color={color} selected={!!te.ongoing} onPress={setOngoing} />
              {endAnchors.map((a) => (
                <Chip
                  key={a.label}
                  label={anchorLabel(a.label, a.min)}
                  color={color}
                  selected={!te.ongoing && endActive && te.endAnchor === a.key}
                  onPress={() => setEndedAbs(now - a.min * MIN, a.key)}
                />
              ))}
            </QuickSetStrip>
          </View>
          <TimeAdjuster
            mode="clock"
            value={end}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setEndedAbs(Math.min(now, Math.max(start as number, ms)))}
          />
        </View>
      )}

      {isInterval && editing === 'start' && (
        <View style={{ gap: 14 }}>
          <QuickSetStrip>
            <Chip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {lastFeed != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.feedEnded, lastFeed)}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * MIN, 'lastfeed')}
              />
            )}
            {lastWake != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.woke, lastWake)}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * MIN, 'wake')}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.diaper, lastDiaper)}
                color={color}
                selected={startActive && te.startAnchor === 'diaper'}
                onPress={() => setStartedAt(now - lastDiaper * MIN, 'diaper')}
              />
            )}
          </QuickSetStrip>
          <TimeAdjuster
            mode="clock"
            value={start as number}
            now={now}
            color={color}
            showRelative
            onChange={(ms) => setStartedAt(te.ongoing ? ms : Math.min(ms, end))}
          />
        </View>
      )}

      {isInterval && !timerEdit && editing === 'lasted' && (
        <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setLasted} />
      )}

      {isInterval && timerEdit && editing === 'lasted' && (
        <View style={{ gap: 10 }}>
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
        <View style={{ gap: 14 }}>
          <QuickSetStrip>
            <Chip
              label="Now"
              color={color}
              selected={te.absTime == null && te.agoMin === 0}
              onPress={() => setTE({ agoMin: 0 })}
            />
            {lastFeed != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.feedEnded, lastFeed)}
                color={color}
                selected={te.pointAnchor === 'lastfeed'}
                onPress={() => setTE({ absTime: now - lastFeed * MIN, pointAnchor: 'lastfeed' })}
              />
            )}
            {lastWake != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.woke, lastWake)}
                color={color}
                selected={te.pointAnchor === 'wake'}
                onPress={() => setTE({ absTime: now - lastWake * MIN, pointAnchor: 'wake' })}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label={anchorLabel(ANCHOR_LABEL.diaper, lastDiaper)}
                color={color}
                selected={te.pointAnchor === 'diaper'}
                onPress={() => setTE({ absTime: now - lastDiaper * MIN, pointAnchor: 'diaper' })}
              />
            )}
          </QuickSetStrip>
          <TimeAdjuster mode="clock" value={end} now={now} color={color} showRelative onChange={(ms) => setTE({ absTime: ms })} />
        </View>
      )}
    </View>
  );
}
