import { Fragment, useEffect, useRef, useState } from 'react';
import { Pressable, View } from 'react-native';
import Animated, { useAnimatedStyle, useSharedValue, withRepeat, withTiming } from 'react-native-reanimated';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

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

export function SleepHeatmap({ rows, width, now, runningSince, runningFeedSince, originHour = 12, showSleep = true, showFeeds = true, showDiapers = true, onScrubStart, onScrubEnd }: {
  rows: HeatRow[]; width: number; now: number; runningSince?: number | null; runningFeedSince?: number | null; originHour?: number;
  showSleep?: boolean; showFeeds?: boolean; showDiapers?: boolean;
  /**
   * Pointer down, and once when that gesture ends (released or terminated). The
   * plot cannot keep an enclosing native ScrollView from stealing a vertical drag
   * on its own, so the parent switches scrolling off between the two. Every start
   * is followed by exactly one end, so the parent never latches.
   */
  onScrubStart?: () => void; onScrubEnd?: () => void;
}) {
  const t = useTheme();
  // Declared before the early return below so hook order stays stable across renders;
  // only the bar's RENDER is conditional.
  const pulse = useSharedValue(1);
  useEffect(() => {
    pulse.value = withRepeat(withTiming(0.45, { duration: 800 }), -1, true);
  }, [pulse]);
  const pulseStyle = useAnimatedStyle(() => ({ opacity: pulse.value }));
  // Sticky scrub marker: a tap drops a vertical guide at that x (as a window
  // fraction 0..1); another tap moves it, the ✕ on its label clears it.
  const [scrubX, setScrubX] = useState<number | null>(null);
  // Located from pageX minus the plot's measured page-left. RN-web does NOT populate
  // nativeEvent.locationX on mobile touch, though it is fine with a desktop mouse, so
  // relying on it puts the line at x=0 with a NaN clock. There is no horizontal scroll
  // here, so page and viewport X agree.
  const plotRef = useRef<View>(null);
  // Measured on gesture start so each drag move converts pageX without re-measuring.
  const plotLeftRef = useRef(0);
  // Neither release nor terminate fires if the plot is unmounted mid-drag, say a
  // background sync dropping the row count under the render threshold, which would
  // strand the parent's scroll lock on and leave the page unscrollable. The callback
  // goes through a ref so the teardown can depend on nothing: depending on `onScrubEnd`
  // directly would make a caller's inline arrow change identity every render, firing the
  // cleanup one frame after the lock landed and restoring the very bug this fixes.
  const onScrubEndRef = useRef(onScrubEnd);
  useEffect(() => {
    onScrubEndRef.current = onScrubEnd;
  });
  useEffect(() => () => onScrubEndRef.current?.(), []);
  if (width <= 0 || rows.length === 0) return null;

  const night = t.activity.sleep;
  const nap = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  const feedColor = t.activity.feeding;
  const diaperColor = t.activity.diaper;
  // Wider gutter than the trend charts so the full "Today" row label fits.
  // `top` leaves headroom for the "now" caption sitting above the plot.
  const gutter = 40, rightPad = 6, top = 14, axisH = 20, pitch = 8.5, rowH = 6.6;
  const gx = gutter, gw = Math.max(0, width - gutter - rightPad);
  const gh = rows.length * pitch;
  const height = top + gh + axisH;
  const xAt = (h: number) => gx + (h / 24) * gw;
  // Midnight is the anchor line, and when the origin does not put it on a 6h tick it
  // gets its own line and label.
  const clockAt = (h: number) => (((originHour + h) % 24) + 24) % 24;
  const midnightH = (24 - (originHour % 24)) % 24;
  const midnightOnTick = midnightH % 6 === 0;
  // The remainder of the Today row has not happened yet, so it is dimmed.
  const todayFrac = Math.min(1, Math.max(0, (now - windowStart(now, originHour)) / DAY));
  const future = hexA('#000000', t.dark ? 0.32 : 0.08);

  // Each spans its timer's start, clamped to the window origin so it never spills onto
  // the previous row, up to now.
  const win = windowStart(now, originHour);
  const todayIdx = rows.findIndex((r) => r.offsetFromToday === 0);
  const liveGeom = (since: number | null | undefined) => {
    if (since == null || since >= now || todayIdx < 0) return null;
    const x0 = Math.min(1, Math.max(0, (Math.max(win, since) - win) / DAY));
    if (todayFrac <= x0) return null;
    return { x0, x1: todayFrac };
  };
  const liveSleep = showSleep ? liveGeom(runningSince) : null;
  const liveFeed = showFeeds ? liveGeom(runningFeedSince) : null;

  // The "now" rule runs the full height, not just the Today row: its whole point is
  // reading the current clock position against the same position on every past day.
  // At the window's edges it would sit on the frame, so it is dropped there.
  const nowX = todayFrac > 0 && todayFrac < 1 ? xAt(todayFrac * 24) : null;
  const nowLabelRight = nowX != null && nowX - gx < 24;

  // Scrub guide geometry: its x, the clock it points at (origin + fraction of the
  // 24h window), and a clamped left for the floating time label.
  const scrubLineX = scrubX == null ? 0 : xAt(scrubX * 24);
  const scrubClock = scrubX == null ? '' : fmtClock(originHour * 60 + scrubX * 1440);
  const labelLeft = scrubX == null ? 0 : Math.min(Math.max(gx, scrubLineX - 28), Math.max(gx, width - 66));

  // Measure the plot's page-left once per gesture (grant), then track moves
  // synchronously. Clamped to [0,1] so a drag into the gutter sticks at the edge.
  const scrubToPageX = (pageX: number) => {
    const lx = pageX - plotLeftRef.current;
    if (!Number.isFinite(lx)) return;
    setScrubX(Math.min(1, Math.max(0, (lx - gx) / gw)));
  };
  const measureThenScrub = (pageX: number) => {
    plotRef.current?.measureInWindow((mx) => {
      plotLeftRef.current = mx;
      scrubToPageX(pageX);
    });
  };

  return (
    <View>
      <View
        ref={(node: View | null) => {
          plotRef.current = node;
          // Web only: disable native scroll/zoom so a drag inside the plot moves only the
          // guide. Native refs have no `style`, so the guard skips.
          const el = node as unknown as { style?: { touchAction?: string } } | null;
          if (el?.style) el.style.touchAction = 'none';
        }}
        onStartShouldSetResponder={() => true}
        onMoveShouldSetResponder={() => true}
        onResponderTerminationRequest={() => false}
        onResponderGrant={(e) => {
          onScrubStart?.();
          measureThenScrub(e.nativeEvent.pageX);
        }}
        onResponderMove={(e) => scrubToPageX(e.nativeEvent.pageX)}
        // Both endings have to report: terminate is the responder being taken away, which
        // onResponderTerminationRequest cannot always prevent. Missing either would leave
        // the parent's scroll lock stuck on. Ending a scrub only lifts that lock, and the
        // guide stays where it was dropped.
        onResponderRelease={() => onScrubEnd?.()}
        onResponderTerminate={() => onScrubEnd?.()}
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
          const isToday = r.offsetFromToday === 0;
          return (
            <Fragment key={idx}>
              <Rect x={gx} y={y} width={gw} height={rowH} rx={1.5} fill={t.chip} />
              {showSleep ? r.segments.map((s, j) => (
                <Rect key={`s${j}`} x={gx + s.x0 * gw} y={y} width={Math.max(0, (s.x1 - s.x0) * gw)} height={rowH} rx={1.6} fill={s.nap ? nap : night} />
              )) : null}
              {/* feeding over sleep: a feed logged across a sleep wins the overlap */}
              {showFeeds ? r.feeds.map((f, j) => (
                <Rect key={`f${j}`} x={gx + f.x0 * gw} y={y} width={Math.max(1.5, (f.x1 - f.x0) * gw)} height={rowH} rx={1.6} fill={feedColor} />
              )) : null}
              {isToday && todayFrac < 1 ? (
                <Rect x={gx + todayFrac * gw} y={y} width={Math.max(0, (1 - todayFrac) * gw)} height={rowH} rx={1.5} fill={future} />
              ) : null}
              {showDiapers ? r.diapers.map((x, j) => (
                <Rect key={`d${j}`} x={gx + x * gw - 0.8} y={y - 1} width={1.6} height={rowH + 2} rx={0.6} fill={diaperColor} />
              )) : null}
              {DAY_LABELS[r.offsetFromToday] ? (
                <SvgText x={gx - 8} y={y + rowH} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">
                  {DAY_LABELS[r.offsetFromToday]}
                </SvgText>
              ) : null}
            </Fragment>
          );
        })}
        {/* Over the rows so it stays legible across a filled sleep bar, but under the
            scrub guide, which is solid and full-opacity to stay the louder of the two. */}
        {nowX != null ? (
          <>
            <Line x1={nowX} y1={top} x2={nowX} y2={top + gh} stroke={t.text} strokeWidth={1.25} strokeDasharray="3 3" opacity={0.45} />
            <SvgText x={nowX + (nowLabelRight ? 3 : -3)} y={top - 4} fontSize={8} fontWeight="700" fontFamily={fontFamily(700)} fill={t.faint} textAnchor={nowLabelRight ? 'start' : 'end'}>
              now
            </SvgText>
          </>
        ) : null}
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
          <Line x1={scrubLineX} y1={top} x2={scrubLineX} y2={top + gh} stroke={t.text} strokeWidth={1.75} />
        ) : null}
      </Svg>
      </View>
      {liveSleep ? (
        <Animated.View
          style={[
            { position: 'absolute', left: gx + liveSleep.x0 * gw, top: top + todayIdx * pitch, width: (liveSleep.x1 - liveSleep.x0) * gw, height: rowH, borderRadius: 1.6, backgroundColor: t.activity.sleep },
            pulseStyle,
          ]}
        />
      ) : null}
      {liveFeed ? (
        <Animated.View
          style={[
            { position: 'absolute', left: gx + liveFeed.x0 * gw, top: top + todayIdx * pitch, width: (liveFeed.x1 - liveFeed.x0) * gw, height: rowH, borderRadius: 1.6, backgroundColor: feedColor },
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
