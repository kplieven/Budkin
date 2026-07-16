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

import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { isHovered } from '@/components/hover';
import { Icon } from '@/components/Icon';
import { TimeAdjuster } from '@/components/TimeAdjuster';
import { Txt } from '@/components/Txt';
import { dayGroupLabel, fmtAgoShort, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
import {
  derivedField,
  endAnchorVisible,
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

export function TimeEntry({ color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  // Editing a running timer (opened via openTimerEdit): a running timer has no
  // end/duration, so Ended does not apply. Only Start + Lasted (which stops and
  // logs it on save) are focusable. Gating on fromTimerId leaves normal
  // new-entry sheets untouched.
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

  const lastFeed = lastFeedEndMinAgo(entries, now);
  const lastWake = lastWakeMinAgo(entries, now);
  const lastDiaper = lastDiaperMinAgo(entries, now);
  const feedStart = lastFeedStartMinAgo(entries, now);
  const sleepStart = lastSleepStartMinAgo(entries, now);

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
          feedStart != null ? { min: feedStart, label: 'When last feed started' } : null,
          sleepStart != null ? { min: sleepStart, label: 'When last sleep started' } : null,
          lastDiaper != null ? { min: lastDiaper, label: 'When last diaper changed' } : null,
        ]
      : []
  ).filter(
    (a): a is { min: number; label: string } =>
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
                {timerEdit ? (
                  <Txt weight={800} size={17} tracking={-0.3} color={t.dim}>
                    {te.ongoing ? 'now' : fmtClock(end)}
                  </Txt>
                ) : te.ongoing ? (
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
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
                label={`${a.label} (${fmtAgoShort(a.min)})`}
                color={color}
                onPress={() => setEndedAbs(now - a.min * MIN)}
              />
            ))}
          </View>
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

      {isInterval && editing === 'start' && (
        <View style={{ gap: 10, marginBottom: 4 }}>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {lastFeed != null && (
              <Chip
                label={`When last feed ended (${fmtAgoShort(lastFeed)})`}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * MIN, 'lastfeed')}
              />
            )}
            {lastWake != null && (
              <Chip
                label={`When they woke (${fmtAgoShort(lastWake)})`}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * MIN, 'wake')}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label={`When last diaper changed (${fmtAgoShort(lastDiaper)})`}
                color={color}
                selected={startActive && te.startAnchor === 'diaper'}
                onPress={() => setStartedAt(now - lastDiaper * MIN, 'diaper')}
              />
            )}
          </View>
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
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            <Chip
              label="Now"
              color={color}
              selected={te.absTime == null && te.agoMin === 0}
              onPress={() => setTE({ agoMin: 0 })}
            />
            {lastFeed != null && (
              <Chip
                label="When last feed ended"
                color={color}
                onPress={() => setTE({ agoMin: lastFeed })}
              />
            )}
            {lastWake != null && (
              <Chip
                label="When they woke"
                color={color}
                onPress={() => setTE({ agoMin: lastWake })}
              />
            )}
            {lastDiaper != null && (
              <Chip
                label="When last diaper changed"
                color={color}
                onPress={() => setTE({ agoMin: lastDiaper })}
              />
            )}
          </View>
          <TimeAdjuster mode="clock" value={end} now={now} color={color} showRelative onChange={(ms) => setTE({ absTime: ms })} />
        </View>
      )}
    </View>
  );
}
