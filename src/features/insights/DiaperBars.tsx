import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Svg, { Line, Rect, Text as SvgText } from 'react-native-svg';

import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import type { DiaperDay } from './compute';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function DiaperBars({ data, width }: { data: DiaperDay[]; width: number }) {
  const t = useTheme();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const canHover = Platform.OS === 'web';
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

  const chart = (
    <Svg width={width} height={height}>
      {canHover && hoverIdx != null ? (
        <Rect x={bx + hoverIdx * slot} y={top} width={slot} height={plotH} fill={hexA(t.faint, 0.1)} rx={3} />
      ) : null}
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

  if (!canHover) return chart;

  const TIP_W = 118;
  const hd = hoverIdx != null ? days[hoverIdx] : null;
  const hx = hoverIdx != null ? bx + hoverIdx * slot + slot / 2 : 0;
  const tipLeft = Math.max(0, Math.min(hx - TIP_W / 2, Math.max(0, width - TIP_W)));
  return (
    <View style={{ width, height, position: 'relative' }}>
      {chart}
      {days.map((d, i) => (
        <Pressable
          key={`hit${i}`}
          onHoverIn={() => setHoverIdx(i)}
          onHoverOut={() => setHoverIdx((c) => (c === i ? null : c))}
          style={{ position: 'absolute', left: bx + i * slot, top, width: slot, height: plotH }}
        />
      ))}
      {hd ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: tipLeft, top: top + 2, width: TIP_W, backgroundColor: t.elevated, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, boxShadow: t.shadow }}
        >
          <Txt weight={700} size={12.5}>{fmtDate(hd.t)}</Txt>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 4 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: t.insightWet }} />
            <Txt weight={500} size={11.5} color={t.dim}>Wet {hd.wet}</Txt>
          </View>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 }}>
            <View style={{ width: 8, height: 8, borderRadius: 2, backgroundColor: t.insightDirty }} />
            <Txt weight={500} size={11.5} color={t.dim}>Dirty {hd.dirty}</Txt>
          </View>
        </View>
      ) : null}
    </View>
  );
}
