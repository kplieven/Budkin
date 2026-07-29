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
   * Called when a pointer goes down on the plot and when that gesture ends
   * (released or terminated). The plot cannot keep an enclosing native
   * ScrollView from stealing a vertical drag on its own, so the parent uses
   * this pair to switch scrolling off for the duration. Every start is followed
   * by exactly one end, so the parent never latches.
   */
  onScrubStart?: () => void; onScrubEnd?: () => void;
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
  // Ref on the plot so a tap can be located from the pointer's page X minus the
  // plot's measured page-left. RN-web does NOT populate nativeEvent.locationX on
  // mobile touch (it's fine with a desktop mouse), so relying on it put the line
  // at x=0 with a NaN clock. pageX is populated on both, and there is no
  // horizontal scroll here, so page and viewport X agree.
  const plotRef = useRef<View>(null);
  // Cached page-left of the plot, measured on gesture start so each drag move can
  // convert pageX synchronously without re-measuring.
  const plotLeftRef = useRef(0);
  // A gesture normally ends with release or terminate, but neither fires if the
  // plot is unmounted mid-drag (a background sync dropping the row count under
  // the render threshold, a child switch resetting the load state). That would
  // strand the parent's scroll lock on and leave the page unscrollable, so
  // report the end on teardown too. Doing that with no scrub in flight is
  // harmless: the parent just clears an already-clear flag. Declared before the
  // early return below so hook order stays stable.
  useEffect(() => () => onScrubEnd?.(), [onScrubEnd]);
  if (width <= 0 || rows.length === 0) return null;

  const night = t.activity.sleep;
  const nap = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  const feedColor = t.activity.feeding;
  const diaperColor = t.activity.diaper;
  // Wider gutter than the trend charts so the full "Today" row label fits. Each
  // row is one band: sleep shaded in, feeding blocks drawn over it (feeding wins
  // any overlap), and diapers as full-height vertical bars.
  const gutter = 40, rightPad = 6, top = 8, axisH = 20, pitch = 8.5, rowH = 6.6;
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

  // Live in-progress bars on the Today row: sleep in the sleep colour, a running
  // feed in the feeding colour drawn on top so feeding takes precedence. Each
  // spans its timer's start (clamped to the window origin so it never spills onto
  // the previous row) up to now, growing in the hourly steps of `now`; the
  // breathing opacity supplies the "live" feel.
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

  // Scrub guide geometry: its x, the clock time it points at (origin + fraction
  // of the 24h window), and a clamped left for the floating time label.
  const scrubLineX = scrubX == null ? 0 : xAt(scrubX * 24);
  const scrubClock = scrubX == null ? '' : fmtClock(originHour * 60 + scrubX * 1440);
  const labelLeft = scrubX == null ? 0 : Math.min(Math.max(gx, scrubLineX - 28), Math.max(gx, width - 66));

  // Drag-to-scrub: place/move the guide from the pointer's page X. Measure the
  // plot's page-left once per gesture (grant), then track moves synchronously.
  // Clamped to [0,1] so dragging into the gutter or off the edge sticks there.
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
          // Web only: disable native scroll/zoom on the plot so a drag inside it
          // moves only the guide. Native refs have no `style`, so the guard skips.
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
        // A gesture can end two ways and BOTH have to report it. Release is the
        // finger lifting; terminate is the responder being taken away, which
        // onResponderTerminationRequest cannot always prevent (the OS can still
        // claim it). Missing either one would leave the parent's scroll lock
        // stuck on, so the page would never scroll again.
        //
        // Ending a scrub only lifts that lock. The guide is sticky on purpose:
        // it stays where it was dropped until the ✕ on its label clears it.
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
              {/* feeding over sleep — a feed logged across a sleep wins the overlap */}
              {showFeeds ? r.feeds.map((f, j) => (
                <Rect key={`f${j}`} x={gx + f.x0 * gw} y={y} width={Math.max(1.5, (f.x1 - f.x0) * gw)} height={rowH} rx={1.6} fill={feedColor} />
              )) : null}
              {isToday && todayFrac < 1 ? (
                <Rect x={gx + todayFrac * gw} y={y} width={Math.max(0, (1 - todayFrac) * gw)} height={rowH} rx={1.5} fill={future} />
              ) : null}
              {/* diapers as thin full-height vertical bars, on top of the blocks */}
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
