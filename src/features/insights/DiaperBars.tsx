import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { DiaperDay } from './compute';

export function DiaperBars({ data, width }: { data: DiaperDay[]; width: number }) {
  const t = useTheme();
  if (width <= 0 || data.length === 0) return null;
  const days = data.slice(-14);
  const left = 6, right = 6, top = 8, plotH = 78, axisH = 18;
  const bx = left, bw = Math.max(0, width - left - right);
  const height = top + plotH + axisH;
  const maxV = Math.max(3, ...days.map((d) => Math.max(d.wet, d.dirty)));
  const floor = 6; // AAP wet-diaper reference
  const slot = bw / days.length, barW = Math.min(9, slot * 0.32);
  const yv = (v: number) => top + plotH - (v / maxV) * plotH;

  return (
    <Svg width={width} height={height}>
      {floor <= maxV ? (
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
      <Line x1={bx} y1={top + plotH} x2={bx + bw} y2={top + plotH} stroke={t.line} strokeWidth={1} />
      <SvgText x={bx} y={top + plotH + 14} fontSize={10} fontWeight="600" fill={t.faint} textAnchor="start">2 weeks ago</SvgText>
      <SvgText x={bx + bw} y={top + plotH + 14} fontSize={10} fontWeight="600" fill={t.faint} textAnchor="end">Today</SvgText>
    </Svg>
  );
}
