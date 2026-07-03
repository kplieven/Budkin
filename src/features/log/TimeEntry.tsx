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
import { View } from 'react-native';

import { Chip } from '@/components/Chip';
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
  [5, '5m'],
  [15, '15m'],
  [30, '30m'],
  [60, '1h'],
  [120, '2h'],
];

type EditField = 'start' | 'end' | 'lasted' | 'when' | null;

/** A readout value: tappable (dotted underline) unless disabled; dimmed when derived. */
function Seg({
  label,
  color,
  dimmed,
  onPress,
  size = 17,
  weight = 800,
}: {
  label: string;
  color: string;
  dimmed?: boolean;
  onPress?: () => void;
  size?: number;
  weight?: 500 | 700 | 800;
}) {
  const t = useTheme();
  return (
    <Txt
      weight={weight}
      size={size}
      tracking={size >= 17 ? -0.3 : undefined}
      color={dimmed ? t.dim : t.text}
      onPress={onPress}
      suppressHighlighting
      style={
        onPress && {
          textDecorationLine: 'underline',
          textDecorationStyle: 'dotted',
          textDecorationColor: color,
        }
      }
    >
      {label}
    </Txt>
  );
}

export function TimeEntry({ type, color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
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
  const hasAnchors = lastFeed != null || (type === 'sleep' && lastWake != null);

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
      {/* readout — each value is tappable for precise entry */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={17} tracking={-0.3}>
            {isInterval ? (
              <>
                <Seg label={fmtClock(start as number)} color={color} dimmed={derived === 'start'} onPress={() => tap('start')} />
                {' → '}
                {te.ongoing ? (
                  'now'
                ) : (
                  <Seg label={fmtClock(end)} color={color} dimmed={derived === 'end'} onPress={() => tap('end')} />
                )}
              </>
            ) : (
              <Seg label={fmtClock(end)} color={color} onPress={() => tap('when')} />
            )}
          </Txt>
          <Txt weight={500} size={12.5} color={t.dim}>
            {isInterval && !te.ongoing ? (
              <>
                {endIsToday ? '' : dayGroupLabel(end, now) + ' · '}
                {'lasted '}
                <Seg
                  label={fmtDur(duration)}
                  color={color}
                  dimmed={derived === 'lasted'}
                  onPress={() => tap('lasted')}
                  size={12.5}
                  weight={700}
                />
              </>
            ) : (
              resultSub
            )}
          </Txt>
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

          {hasAnchors && (
            <>
              <SubLabel>Started</SubLabel>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginBottom: 6 }}>
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
          )}
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
