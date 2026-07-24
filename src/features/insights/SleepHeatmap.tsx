import { Fragment, useEffect, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Circle, Line, Rect, Text as SvgText } from 'react-native-svg';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import { DAY, windowStart, type HeatRow } from './compute';

const DAY_LABELS: Record<number, string> = { 0: 'Today', 7: '1w', 14: '2w', 21: '3w', 27: '4w' };
const TICK_HS = [0, 6, 12, 18, 24];
const fmtHour = (hr: number) => `${String(hr).padStart(2, '0')}:00`;
/** A minutes-since-midnight value as a 24h "HH:MM" clock (wraps past 1440). */
const fmtClock = (min: number) => {
  const m = ((Math.round(min) % 1440) + 1440) % 1440;
  return `${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`;
};

export function SleepHeatmap({ rows, width, now, runningSince, originHour = 12, showSleep = true, showFeeds = true, showDiapers = true }: {
  rows: HeatRow[]; width: number; now: number; runningSince?: number | null; originHour?: number;
  showSleep?: boolean; showFeeds?: boolean; showDiapers?: boolean;
}) {
  const t = useTheme();
  // Breathing pulse for the live "asleep now" bar. Declared before the early
  // return below so the hook order stays stable across renders (matches
  // PulsingDot's 1 ↔ 0.45 / 800ms loop). Only the bar's RENDER is conditional.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  // Sticky scrub marker: a tap drops a vertical guide at that x (as a window
  // fraction 0..1); another tap moves it, the ✕ on its label clears it. Declared
  // before the early return so hook order stays stable.
  const [scrubX, setScrubX] = useState<number | null>(null);
  if (width <= 0 || rows.length === 0) return null;

  const night = t.activity.sleep;
  const nap = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  const feedColor = t.activity.feeding;
  const diaperColor = t.activity.diaper;
  // Wider gutter than the trend charts so the full "Today" row label fits. Each
  // row stacks a feed marker lane, the sleep band, then a diaper marker lane
  // within `pitch`; `bandDy` offsets the band down to leave room for the top lane.
  const gutter = 40, rightPad = 6, top = 8, axisH = 20, pitch = 12;
  const bandDy = 3.5, rowH = 5, feedDy = 1.6, diaperDy = 9.8, dotR = 1.8;
  const gx = gutter, gw = Math.max(0, width - gutter - rightPad);
  const gh = rows.length * pitch;
  const height = top + gh + axisH;
  const xAt = (h: number) => gx + (h / 24) * gw;
  // Clock hour shown at offset `h` (0..24) from the window origin, and where
  // clock-midnight falls inside the row. Midnight is the anchor line; when the
  // origin doesn't put it on a 6h tick, it gets its own emphasized line + label.
  const clockAt = (h: number) => (((originHour + h) % 24) + 24) % 24;
  const midnightH = (24 - (originHour % 24)) % 24;
  const midnightOnTick = midnightH % 6 === 0;
  // Fraction of the current window already elapsed; the remainder of the Today
  // row hasn't happened yet, so it's dimmed as "yet to come".
  const todayFrac = Math.min(1, Math.max(0, (now - windowStart(now, originHour)) / DAY));
  const future = hexA('#000000', t.dark ? 0.32 : 0.08);

  // Live in-progress sleep: a distinct-accent bar on the Today row spanning the
  // running timer's start up to now. A start before the window origin clamps to
  // the row's left edge so it never spills onto the previous row. Length grows
  // in the hourly steps of `now`; the breathing opacity supplies the "live" feel.
  const win = windowStart(now, originHour);
  const todayIdx = rows.findIndex((r) => r.offsetFromToday === 0);
  const liveX0 = Math.min(1, Math.max(0, (Math.max(win, runningSince ?? win) - win) / DAY));
  const liveX1 = todayFrac;
  const showLive = runningSince != null && runningSince < now && todayIdx >= 0 && liveX1 > liveX0;

  // Scrub guide geometry: its x, the clock time it points at (origin + fraction
  // of the 24h window), and a clamped left for the floating time label.
  const scrubLineX = scrubX == null ? 0 : xAt(scrubX * 24);
  const scrubClock = scrubX == null ? '' : fmtClock(originHour * 60 + scrubX * 1440);
  const labelLeft = scrubX == null ? 0 : Math.min(Math.max(gx, scrubLineX - 28), Math.max(gx, width - 66));

  return (
    <View>
      <Pressable
        onPress={(e) => {
          const lx = e.nativeEvent.locationX;
          if (lx < gx || lx > gx + gw) return; // ignore taps in the day-label gutter
          setScrubX((lx - gx) / gw);
        }}
      >
      <Svg width={width} height={height}>
        {TICK_HS.map((h) => (
          <Line key={`g${h}`} x1={xAt(h)} y1={top} x2={xAt(h)} y2={top + gh} stroke={t.line} strokeWidth={1} opacity={clockAt(h) === 0 ? 1 : 0.5} />
        ))}
        {!midnightOnTick ? (
          <Line x1={xAt(midnightH)} y1={top} x2={xAt(midnightH)} y2={top + gh} stroke={t.line} strokeWidth={1} opacity={1} />
        ) : null}
        {rows.map((r, idx) => {
          const y = top + idx * pitch;
          const by = y + bandDy;
          const isToday = r.offsetFromToday === 0;
          return (
            <Fragment key={idx}>
              <Rect x={gx} y={by} width={gw} height={rowH} rx={1.5} fill={t.chip} />
              {showSleep ? r.segments.map((s, j) => (
                <Rect key={`s${j}`} x={gx + s.x0 * gw} y={by} width={Math.max(0, (s.x1 - s.x0) * gw)} height={rowH} rx={1.6} fill={s.nap ? nap : night} />
              )) : null}
              {isToday && todayFrac < 1 ? (
                <Rect x={gx + todayFrac * gw} y={by} width={Math.max(0, (1 - todayFrac) * gw)} height={rowH} rx={1.5} fill={future} />
              ) : null}
              {showFeeds ? r.feeds.map((x, j) => (
                <Circle key={`f${j}`} cx={gx + x * gw} cy={y + feedDy} r={dotR} fill={feedColor} />
              )) : null}
              {showDiapers ? r.diapers.map((x, j) => (
                <Circle key={`d${j}`} cx={gx + x * gw} cy={y + diaperDy} r={dotR} fill={diaperColor} />
              )) : null}
              {DAY_LABELS[r.offsetFromToday] ? (
                <SvgText x={gx - 8} y={by + rowH} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">
                  {DAY_LABELS[r.offsetFromToday]}
                </SvgText>
              ) : null}
            </Fragment>
          );
        })}
        {TICK_HS.map((h) => {
          // Drop a tick label that would collide with the standalone midnight label.
          if (!midnightOnTick && Math.abs(xAt(h) - xAt(midnightH)) < 20) return null;
          return (
            <SvgText key={`l${h}`} x={xAt(h)} y={top + gh + 15} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'}>
              {fmtHour(clockAt(h))}
            </SvgText>
          );
        })}
        {!midnightOnTick ? (
          <SvgText x={xAt(midnightH)} y={top + gh + 15} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="middle">
            00:00
          </SvgText>
        ) : null}
        {scrubX != null ? (
          <Line x1={scrubLineX} y1={top} x2={scrubLineX} y2={top + gh} stroke={t.primary} strokeWidth={1.5} />
        ) : null}
      </Svg>
      </Pressable>
      {showLive ? (
        <Animated.View
          style={[
            {
              position: 'absolute',
              left: gx + liveX0 * gw,
              top: top + todayIdx * pitch + bandDy,
              width: (liveX1 - liveX0) * gw,
              height: rowH,
              borderRadius: 1.6,
              backgroundColor: t.primary,
            },
            pulseStyle,
          ]}
        />
      ) : null}
      {scrubX != null ? (
        <View style={{ position: 'absolute', top: top + 2, left: labelLeft, flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: t.elevated, borderWidth: 1, borderColor: t.line2, borderRadius: 8, paddingVertical: 3, paddingHorizontal: 7 }}>
          <Txt weight={700} size={11} color={t.text}>{scrubClock}</Txt>
          <Pressable onPress={() => setScrubX(null)} hitSlop={8} accessibilityRole="button" accessibilityLabel="Clear time marker">
            <Icon name="close" size={11} color={t.dim} />
          </Pressable>
        </View>
      ) : null}
    </View>
  );
}
