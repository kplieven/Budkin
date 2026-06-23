/**
 * The reusable Time-Entry component — the app's signature feature.
 *
 * INTERVAL: three quantities (Ended / Lasted / Started), but only the last two
 * the user touched stay active; the third is derived. Nudge fine-tunes the
 * derived *time* and is disabled when both start & end are pinned.
 * POINT (diaper): a single time via "When" chips + smart anchors + nudge.
 */

import { Pressable, View } from 'react-native';

import { Chip } from '@/components/Chip';
import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { fmtAgoShort, fmtClock, fmtDur, relDayLabel } from '@/lib/format';
import {
  isActive,
  lastFeedEndMinAgo,
  lastWakeMinAgo,
  nudgeEnabled,
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

export function TimeEntry({ type, color }: { type: ActivityType; color: string }) {
  const t = useTheme();
  const te = useAppStore((s) => s.te);
  const now = useAppStore((s) => s.now);
  const entries = useAppStore((s) => s.entries);
  const setTE = useAppStore((s) => s.setTE);
  const setEnded = useAppStore((s) => s.setEnded);
  const setOngoing = useAppStore((s) => s.setOngoing);
  const setLasted = useAppStore((s) => s.setLasted);
  const setStartedAt = useAppStore((s) => s.setStartedAt);
  const nudge = useAppStore((s) => s.nudge);

  const start = teStart(te, now);
  const end = teEnd(te, now);
  const isInterval = te.shape === 'interval';
  const duration = teDurationMin(te, now);

  const result = isInterval
    ? `${fmtClock(start as number)} → ${te.ongoing ? 'now' : fmtClock(end)}`
    : fmtClock(end);
  const resultSub = isInterval
    ? te.ongoing
      ? `running · ${fmtDur(duration)} so far`
      : `lasted ${fmtDur(duration)}`
    : relDayLabel(end, now);

  const lastFeed = lastFeedEndMinAgo(entries, now);
  const lastWake = lastWakeMinAgo(entries, now);
  const lastedOpts = type === 'sleep' ? [20, 45, 90, 120] : [10, 20, 30, 45];

  const endActive = isActive(te.order, 'end');
  const lastedActive = isActive(te.order, 'lasted');
  const startActive = isActive(te.order, 'start');
  const canNudge = nudgeEnabled(te);
  const hasAnchors = lastFeed != null || (type === 'sleep' && lastWake != null);

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 16, marginBottom: 16 }}>
      {/* readout */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 13 }}>
        <Icon name="clock" color={color} size={18} />
        <View style={{ flex: 1 }}>
          <Txt weight={800} size={17} tracking={-0.3}>
            {result}
          </Txt>
          <Txt weight={500} size={12.5} color={t.dim}>
            {resultSub}
          </Txt>
        </View>
      </View>

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

      {/* nudge */}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 14, paddingTop: 14, borderTopWidth: 1, borderTopColor: t.line }}>
        <Txt weight={600} size={12.5} color={t.dim} style={{ flex: 1 }}>
          {isInterval ? (canNudge ? 'Nudge time' : 'Nudge (set start or end to enable)') : 'Fine-tune time'}
        </Txt>
        {(['−5m', '+5m'] as const).map((label, i) => (
          <Pressable
            key={label}
            disabled={!canNudge}
            onPress={() => nudge(i === 0 ? -5 : 5)}
            style={{
              paddingHorizontal: 14,
              paddingVertical: 8,
              borderRadius: 11,
              backgroundColor: t.chip,
              borderWidth: 1.5,
              borderColor: t.line,
              opacity: canNudge ? 1 : 0.4,
            }}
          >
            <Txt weight={700} size={13.5}>
              {label}
            </Txt>
          </Pressable>
        ))}
      </View>
    </View>
  );
}
