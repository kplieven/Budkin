import { Fragment } from 'react';
import { View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import { DAY, noonWindowStart, type HeatRow } from './compute';

const HOUR_TICKS: [string, number][] = [['12 PM', 0], ['6 PM', 6], ['12 AM', 12], ['6 AM', 18], ['12 PM', 24]];
const DAY_LABELS: Record<number, string> = { 0: 'Today', 7: '1w', 14: '2w', 21: '3w', 27: '4w' };

export function SleepHeatmap({ rows, width, now }: { rows: HeatRow[]; width: number; now: number }) {
  const t = useTheme();
  if (width <= 0 || rows.length === 0) return null;

  const night = t.activity.sleep;
  const nap = hexA(t.activity.sleep, t.dark ? 0.5 : 0.42);
  // Wider gutter than the trend charts so the full "Today" row label fits
  // without clipping past the SVG's left edge.
  const gutter = 40, rightPad = 6, top = 8, axisH = 20, pitch = 8, rowH = 6.4;
  const gx = gutter, gw = Math.max(0, width - gutter - rightPad);
  const gh = rows.length * pitch;
  const height = top + gh + axisH;
  const xAt = (h: number) => gx + (h / 24) * gw;
  // Fraction of the current noon-to-noon window already elapsed; the remainder
  // of the Today row hasn't happened yet, so it's dimmed as "yet to come".
  const todayFrac = Math.min(1, Math.max(0, (now - noonWindowStart(now)) / DAY));
  const future = hexA('#000000', t.dark ? 0.32 : 0.08);

  return (
    <View>
      <Svg width={width} height={height}>
        {HOUR_TICKS.map(([, h], i) => (
          <Line key={`g${i}`} x1={xAt(h)} y1={top} x2={xAt(h)} y2={top + gh} stroke={t.line} strokeWidth={1} opacity={h === 12 ? 1 : 0.5} />
        ))}
        {rows.map((r, idx) => {
          const y = top + idx * pitch;
          const isToday = r.offsetFromToday === 0;
          return (
            <Fragment key={idx}>
              <Rect x={gx} y={y} width={gw} height={rowH} rx={1.5} fill={t.chip} />
              {r.segments.map((s, j) => (
                <Rect key={j} x={gx + s.x0 * gw} y={y} width={Math.max(0, (s.x1 - s.x0) * gw)} height={rowH} rx={1.6} fill={s.nap ? nap : night} />
              ))}
              {isToday && todayFrac < 1 ? (
                <Rect x={gx + todayFrac * gw} y={y} width={Math.max(0, (1 - todayFrac) * gw)} height={rowH} rx={1.5} fill={future} />
              ) : null}
              {DAY_LABELS[r.offsetFromToday] ? (
                <SvgText x={gx - 8} y={y + rowH} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">
                  {DAY_LABELS[r.offsetFromToday]}
                </SvgText>
              ) : null}
            </Fragment>
          );
        })}
        {HOUR_TICKS.map(([lbl, h], i) => (
          <SvgText key={`l${i}`} x={xAt(h)} y={top + gh + 15} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="middle">
            {lbl}
          </SvgText>
        ))}
      </Svg>
    </View>
  );
}
