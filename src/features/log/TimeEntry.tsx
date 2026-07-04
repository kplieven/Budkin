/**
 * The reusable Time-Entry component — the app's signature feature.
 *
 * INTERVAL: three quantities (Ended / Lasted / Started), but only the last two
 * the user touched stay active; the third is derived. The chips are the fast
 * path; every resolved value in the readout is tappable and expands an inline
 * precise editor (exact clock time / exact minutes) that pins that quantity.
 * POINT (diaper): a single time via "When" chips + smart anchors + the same
 * precise editor.
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
  isActive,
  lastFeedEndMinAgo,
  lastWakeMinAgo,
  teDurationMin,
  teEnd,
  teStart,
} from '@/store/selectors';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { ActivityType } from '@/types/models';

function SubLabel({ children }: { children: string }) {
  const t = useTheme();
  return (
    <Txt weight={700} size={12} color={t.faint} tracking={0.5} style={{ marginTop: 2, marginBottom: 8, textTransform: 'uppercase' }}>
      {children}
    </Txt>
  );
}

const ENDED_OPTS: [number, string][] = [
  [0, 'Now'],
  [15, '15m ago'],
  [30, '30m ago'],
  [60, '1h ago'],
];
const AGO_OPTS: [number, string][] = [
  [0, 'Now'],
  [5, '5m ago'],
  [15, '15m ago'],
  [30, '30m ago'],
  [60, '1h ago'],
  [120, '2h ago'],
];
// Quick "started X ago" offsets (minutes), mirroring the Ended/When chips.
const STARTED_OPTS = [5, 10, 15, 30, 45];

type EditField = 'start' | 'end' | 'lasted' | 'when' | null;

/**
 * A tappable resolved value rendered as an inset pill (matches the chip
 * vocabulary). Fills with the activity color while its editor is open; the
 * derived quantity is dimmed.
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

export function TimeEntry({ type, color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  // Editing a running timer (opened via openTimerEdit): a running timer has no
  // end/duration, so the Ended/Lasted controls don't apply — only Start + the
  // detail fields do. Ending stays on the Timers tab (Stop). Gating strictly on
  // fromTimerId leaves normal new-entry sheets (incl. "Still ongoing") untouched.
  const timerEdit = useAppStore((s) => s.fromTimerId != null);
  const setTE = useAppStore((s) => s.setTE);
  const setEnded = useAppStore((s) => s.setEnded);
  const setEndedAbs = useAppStore((s) => s.setEndedAbs);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const setLasted = useAppStore((s) => s.setLasted);
  const setStartedAt = useAppStore((s) => s.setStartedAt);

  const [editing, setEditing] = useState<EditField>(null);

  const start = teStart(te, now);
  const end = teEnd(te, now);
  const isInterval = te.shape === 'interval';
  const duration = teDurationMin(te, now);
  const derived = isInterval ? derivedField(te.order) : null;

  const endIsToday = new Date(end).toDateString() === new Date(now).toDateString();
  const resultSub = isInterval ? `running · ${fmtDur(duration)} so far` : relDayLabel(end, now);

  const lastFeed = lastFeedEndMinAgo(entries, now);
  const lastWake = lastWakeMinAgo(entries, now);
  const lastedOpts = type === 'sleep' ? [20, 45, 90, 120] : [10, 20, 30, 45];

  const endActive = isActive(te.order, 'end');
  const lastedActive = isActive(te.order, 'lasted');
  const startActive = isActive(te.order, 'start');

  // Tapping a readout value pins it at its resolved value and toggles its editor.
  const tap = (f: Exclude<EditField, null>) => {
    if (editing === f) {
      setEditing(null);
      return;
    }
    if (f === 'start') setStartedAt(start as number);
    else if (f === 'end') setEndedAbs(end);
    else if (f === 'lasted') setLasted(Math.max(1, duration));
    else setTE({ absTime: end });
    setEditing(f);
  };

  // While editing, chips can hand a quantity back to "derived" (e.g. tapping a
  // Lasted chip while the start editor is open) — the editor keeps pinning it,
  // which is exactly what the accordion promises. Only `ongoing` invalidates
  // the end/lasted editors.
  const activeEditor = te.ongoing && (editing === 'end' || editing === 'lasted') ? null : editing;

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 16 }}>
      {/* readout — each resolved value is a tappable pill for precise entry */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, flexWrap: 'wrap' }}>
            {isInterval ? (
              <>
                <ValuePill big label={fmtClock(start as number)} color={color} active={activeEditor === 'start'} dimmed={derived === 'start'} onPress={() => tap('start')} />
                <Txt weight={700} size={16} color={t.dim}>
                  →
                </Txt>
                {te.ongoing ? (
                  <Txt weight={800} size={17} tracking={-0.3} color={t.dim}>
                    now
                  </Txt>
                ) : (
                  <ValuePill big label={fmtClock(end)} color={color} active={activeEditor === 'end'} dimmed={derived === 'end'} onPress={() => tap('end')} />
                )}
              </>
            ) : (
              <ValuePill big label={fmtClock(end)} color={color} active={activeEditor === 'when'} onPress={() => tap('when')} />
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
                <ValuePill label={fmtDur(duration)} color={color} active={activeEditor === 'lasted'} dimmed={derived === 'lasted'} onPress={() => tap('lasted')} />
              </>
            ) : (
              <Txt weight={500} size={12.5} color={t.dim}>
                {resultSub}
              </Txt>
            )}
          </View>
        </View>
      </View>

      {/* precise editor (accordion) */}
      {activeEditor === 'start' && (
        <TimeAdjuster
          mode="clock"
          value={start as number}
          now={now}
          color={color}
          onChange={(ms) => setStartedAt(!te.ongoing && endActive && derived === 'lasted' ? Math.min(ms, end) : ms)}
        />
      )}
      {activeEditor === 'end' && (
        <TimeAdjuster
          mode="clock"
          value={end}
          now={now}
          color={color}
          onChange={(ms) => setEndedAbs(startActive && derived === 'lasted' ? Math.max(ms, start as number) : ms)}
        />
      )}
      {activeEditor === 'lasted' && (
        <TimeAdjuster mode="duration" value={Math.max(1, duration)} now={now} color={color} onChange={setLasted} />
      )}
      {activeEditor === 'when' && (
        <TimeAdjuster mode="clock" value={end} now={now} color={color} onChange={(ms) => setTE({ absTime: ms })} />
      )}

      {isInterval ? (
        <>
          {!timerEdit && (
            <>
              <SubLabel>Ended</SubLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {ENDED_OPTS.map(([m, label]) => (
                  <Chip
                    key={m}
                    label={label}
                    color={color}
                    selected={!te.ongoing && endActive && te.endAbs == null && te.endAgoMin === m}
                    onPress={() => setEnded(m)}
                  />
                ))}
                <Chip label="Still ongoing" color={color} selected={!!te.ongoing} onPress={setOngoing} />
              </View>

              <SubLabel>Lasted</SubLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
                {lastedOpts.map((m) => (
                  <Chip
                    key={m}
                    label={fmtDur(m)}
                    color={color}
                    selected={!te.ongoing && lastedActive && te.durationMin === m}
                    onPress={() => setLasted(m)}
                  />
                ))}
              </View>
            </>
          )}

          <SubLabel>Started</SubLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
            <Chip
              label="Now"
              color={color}
              selected={startActive && te.startAnchor === 'now'}
              onPress={() => setStartedAt(now, 'now')}
            />
            {STARTED_OPTS.map((m) => (
              <Chip
                key={m}
                label={`${m}m ago`}
                color={color}
                onPress={() => setStartedAt(now - m * 60000)}
              />
            ))}
            {lastFeed != null && (
              <Chip
                label={`When last feed ended (${fmtAgoShort(lastFeed)})`}
                color={color}
                selected={startActive && te.startAnchor === 'lastfeed'}
                onPress={() => setStartedAt(now - lastFeed * 60000, 'lastfeed')}
              />
            )}
            {type === 'sleep' && lastWake != null && (
              <Chip
                label={`When they woke (${fmtAgoShort(lastWake)})`}
                color={color}
                selected={startActive && te.startAnchor === 'wake'}
                onPress={() => setStartedAt(now - lastWake * 60000, 'wake')}
              />
            )}
          </View>
        </>
      ) : (
        <>
          <SubLabel>When</SubLabel>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {AGO_OPTS.map(([m, label]) => (
              <Chip
                key={m}
                label={label}
                color={color}
                selected={te.absTime == null && te.agoMin === m}
                onPress={() => setTE({ agoMin: m })}
              />
            ))}
          </View>
          {(lastFeed != null || lastWake != null) && (
            <>
              <SubLabel>Smart anchors</SubLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
                {lastFeed != null && (
                  <Chip label="When last feed ended" color={color} onPress={() => setTE({ agoMin: lastFeed, absTime: undefined })} />
                )}
                {lastWake != null && (
                  <Chip label="When they woke" color={color} onPress={() => setTE({ agoMin: lastWake, absTime: undefined })} />
                )}
              </View>
            </>
          )}
        </>
      )}
    </View>
  );
}
