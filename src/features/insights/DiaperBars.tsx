import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import type { DiaperDay } from './compute';

export function DiaperBars({ data, width }: { data: DiaperDay[]; width: number }) {
  const t = useTheme();
  if (width <= 0 || data.length === 0) return null;
  const days = data.slice(-14);
  const gutter = 22, right = 6, top = 8, plotH = 78, axisH = 18;
  const bx = gutter, bw = Math.max(0, width - gutter - right);
  const height = top + plotH + axisH;
  const rawMax = Math.max(3, ...days.map((d) => Math.max(d.wet, d.dirty)));
  const step = rawMax <= 4 ? 1 : rawMax <= 8 ? 2 : 3;
  const yMax = Math.ceil(rawMax / step) * step;
  const yTicks: number[] = [];
  for (let v = 0; v <= yMax; v += step) yTicks.push(v);
  const floor = 6; // NHS: 6+ wet nappies/day (from ~day 5)
  const slot = bw / days.length, barW = Math.min(9, slot * 0.32);
  const yv = (v: number) => top + plotH - (v / yMax) * plotH;

  return (
    <Svg width={width} height={height}>
      {yTicks.map((v, i) => (
        <Line key={`g${i}`} x1={bx} y1={yv(v)} x2={bx + bw} y2={yv(v)} stroke={t.line} strokeWidth={1} opacity={0.6} />
      ))}
      {yTicks.map((v, i) => (
        <SvgText key={`yl${i}`} x={bx - 6} y={yv(v) + 3.5} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">{v}</SvgText>
      ))}
      {floor <= yMax ? (
        <Line x1={bx} y1={yv(floor)} x2={bx + bw} y2={yv(floor)} stroke={hexA(t.insightWet, 0.6)} strokeWidth={1} strokeDasharray="3 3" />
      ) : null}
      {days.map((d, i) => {
        const cx = bx + i * slot + slot / 2;
        return (
          <Rect key={`w${i}`} x={cx - barW - 1} y={yv(d.wet)} width={barW} height={top + plotH - yv(d.wet)} rx={2} fill={t.insightWet} />
        );
      })}
      {days.map((d, i) => {
        const cx = bx + i * slot + slot / 2;
        return (
          <Rect key={`d${i}`} x={cx + 1} y={yv(d.dirty)} width={barW} height={top + plotH - yv(d.dirty)} rx={2} fill={t.insightDirty} />
        );
      })}
      <SvgText x={bx} y={top + plotH + 14} fontSize={10} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="start">2 weeks ago</SvgText>
      <SvgText x={bx + bw} y={top + plotH + 14} fontSize={10} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">Today</SvgText>
    </Svg>
  );
}
