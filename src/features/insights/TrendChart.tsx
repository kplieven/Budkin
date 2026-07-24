import { useState } from 'react';
import { Platform, Pressable, View } from 'react-native';
import Svg, { Circle, Line, Path, Rect, Text as SvgText } from 'react-native-svg';

import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import type { TrendPoint } from './compute';
import type { Band } from './norms';

/** Value as stored, trailing zeros trimmed: 5.20 -> "5.2", 5.00 -> "5". */
const numLabel = (v: number) => v.toFixed(2).replace(/\.?0+$/, '');
const DAY_MS = 86400000;

export function TrendChart({ points, band, color, ruleOfThumb, yTicks, fmtY, width, xMode = 'index', xStartLabel = 'Start', xEndLabel = 'Today', xTicks, fmtX, dots = 'last', hover = false, unit, fmtValue, fmtHoverDate, calendarBands = false, dashGaps = false }: {
  points: TrendPoint[]; band: Band | null; color: string; ruleOfThumb?: boolean;
  yTicks: number[]; fmtY: (v: number) => string; width: number;
  xMode?: 'index' | 'time'; xStartLabel?: string; xEndLabel?: string;
  xTicks?: number[]; fmtX?: (t: number) => string; dots?: 'all' | 'last';
  /** Web-only: hovering a data point reveals a value+date tooltip. */
  hover?: boolean; unit?: string; fmtHoverDate?: (t: number) => string;
  /** Formats the hovered value; overrides the default `numLabel + unit`. */
  fmtValue?: (v: number) => string;
  /** Time mode: shade weekends (short spans) or alternating months (long spans) behind the plot. */
  calendarBands?: boolean;
  /** Time mode: solid line for consecutive days, dashed across missed-day gaps. */
  dashGaps?: boolean;
}) {
  const t = useTheme();
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);
  const canHover = !!hover && Platform.OS === 'web';
  if (width <= 0) return null;
  const gutter = 30, right = 6, top = 8, plotH = 96, axisH = 18;
  const gx = gutter, gw = Math.max(0, width - gutter - right);
  const height = top + plotH + axisH;
  const yMin = Math.min(...yTicks), yMax = Math.max(...yTicks);
  const yv = (v: number) => top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;
  const tMin = points.length ? points[0].t : 0;
  const tMax = points.length ? points[points.length - 1].t : 1;
  const xFrac = (i: number) => {
    if (points.length <= 1) return 0.5;
    if (xMode === 'time' && tMax > tMin) return (points[i].t - tMin) / (tMax - tMin);
    return i / (points.length - 1);
  };
  const xv = (i: number) => gx + xFrac(i) * gw;
  const xAtT = (ts: number) => (tMax > tMin ? gx + ((ts - tMin) / (tMax - tMin)) * gw : gx + gw / 2);
  const dotR = points.length > 40 ? 2 : points.length > 20 ? 2.6 : 3.2;

  const area = (hi: number[], lo: number[]) => {
    let d = '';
    hi.forEach((v, i) => { d += `${i ? 'L' : 'M'} ${xv(i).toFixed(1)} ${yv(v).toFixed(1)} `; });
    for (let i = lo.length - 1; i >= 0; i--) d += `L ${xv(i).toFixed(1)} ${yv(lo[i]).toFixed(1)} `;
    return d + 'Z';
  };
  const line = points.map((p, i) => `${i ? 'L' : 'M'} ${xv(i).toFixed(1)} ${yv(p.value).toFixed(1)}`).join(' ');

  // Daily insights data: draw contiguous days with a solid line and bridge gaps
  // (missed days) with a dashed segment, so a sparse log doesn't look like a
  // smooth run of consecutive days.
  const daily = dashGaps && xMode === 'time' && points.length >= 2;
  let solidD = '', dashD = '';
  if (daily) {
    for (let i = 0; i < points.length; i++) {
      const px = xv(i).toFixed(1), py = yv(points[i].value).toFixed(1);
      if (i === 0) { solidD = `M ${px} ${py}`; continue; }
      if (points[i].t - points[i - 1].t > DAY_MS * 1.5) {
        dashD += `M ${xv(i - 1).toFixed(1)} ${yv(points[i - 1].value).toFixed(1)} L ${px} ${py} `;
        solidD += ` M ${px} ${py}`;
      } else {
        solidD += ` L ${px} ${py}`;
      }
    }
  }

  // Calendar backdrop (insights only). Short spans shade each weekend column;
  // longer spans (3 months) shade alternating months instead — weekend stripes
  // would collapse into an unreadable zebra there.
  const calBands: { x0: number; x1: number }[] = [];
  if (calendarBands && xMode === 'time' && points.length >= 2 && tMax > tMin) {
    const clampX = (x: number) => Math.max(gx, Math.min(x, gx + gw));
    if ((tMax - tMin) / DAY_MS <= 45) {
      const d0 = new Date(tMin); d0.setHours(0, 0, 0, 0);
      for (let ts = d0.getTime(); ts <= tMax; ts += DAY_MS) {
        const wd = new Date(ts).getDay();
        if (wd === 0 || wd === 6) {
          const x0 = clampX(xAtT(ts)), x1 = clampX(xAtT(ts + DAY_MS));
          if (x1 - x0 > 0.5) calBands.push({ x0, x1 });
        }
      }
    } else {
      const start = new Date(tMin); start.setDate(1); start.setHours(0, 0, 0, 0);
      for (let k = 0; ; k++) {
        const mStart = new Date(start.getFullYear(), start.getMonth() + k, 1);
        if (mStart.getTime() > tMax) break;
        if (mStart.getMonth() % 2 === 0) {
          const mEnd = new Date(start.getFullYear(), start.getMonth() + k + 1, 1).getTime();
          const x0 = clampX(xAtT(Math.max(mStart.getTime(), tMin))), x1 = clampX(xAtT(Math.min(mEnd, tMax)));
          if (x1 - x0 > 0.5) calBands.push({ x0, x1 });
        }
      }
    }
  }

  const chart = (
    <Svg width={width} height={height}>
      {calBands.map((b, i) => (
        <Rect key={`cb${i}`} x={b.x0} y={top} width={b.x1 - b.x0} height={plotH} fill={hexA(t.faint, 0.09)} />
      ))}
      {band ? (
        <Path
          d={area(band.hi, band.lo)}
          fill={hexA(color, ruleOfThumb ? 0.08 : 0.14)}
          stroke={ruleOfThumb ? color : 'none'}
          strokeWidth={ruleOfThumb ? 1 : 0}
          strokeDasharray={ruleOfThumb ? '3 3' : undefined}
          opacity={ruleOfThumb ? 0.9 : 1}
        />
      ) : null}
      {yTicks.map((v, i) => (
        <Line key={i} x1={gx} y1={yv(v)} x2={gx + gw} y2={yv(v)} stroke={t.line} strokeWidth={1} opacity={0.6} />
      ))}
      {daily ? (
        <>
          <Path d={solidD} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
          {dashD ? <Path d={dashD} fill="none" stroke={t.dim} strokeWidth={1.5} strokeLinecap="round" strokeDasharray="4 4" opacity={0.7} /> : null}
        </>
      ) : (
        <Path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      )}
      {dots === 'all' ? (
        points.map((p, i) => (
          <Circle key={`d${i}`} cx={xv(i)} cy={yv(p.value)} r={dotR} fill={color} stroke={t.surface} strokeWidth={1.4} />
        ))
      ) : points.length ? (
        <Circle cx={xv(points.length - 1)} cy={yv(points[points.length - 1].value)} r={3.6} fill={color} stroke={t.surface} strokeWidth={1.8} />
      ) : null}
      {canHover && hoverIdx != null && points[hoverIdx] ? (
        <Circle cx={xv(hoverIdx)} cy={yv(points[hoverIdx].value)} r={dotR + 2.6} fill={color} stroke={t.surface} strokeWidth={2} />
      ) : null}
      {/* Axis labels paint LAST so the trend line never covers the text. */}
      {yTicks.map((v, i) => (
        <SvgText key={`y${i}`} x={gx - 6} y={yv(v) + 3.5} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">{fmtY(v)}</SvgText>
      ))}
      {xTicks?.length && fmtX ? (
        xTicks.map((tk, i) => {
          const x = xAtT(tk);
          const textAnchor = x <= gx + 10 ? 'start' : x >= gx + gw - 10 ? 'end' : 'middle';
          return (
            <SvgText key={`x${i}`} x={x} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor={textAnchor}>{fmtX(tk)}</SvgText>
          );
        })
      ) : (
        <>
          <SvgText x={gx} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="start">{xStartLabel}</SvgText>
          <SvgText x={gx + gw} y={top + plotH + 14} fontSize={9.5} fontWeight="600" fontFamily={fontFamily(600)} fill={t.faint} textAnchor="end">{xEndLabel}</SvgText>
        </>
      )}
    </Svg>
  );

  if (!canHover) return chart;

  // Dots are 2–3px, too small to hover, so overlay enlarged hit-targets and
  // float a value+date tooltip, clamped to stay inside the chart's width.
  const HIT = 22, TIP_W = 128, TIP_GAP = 12;
  const ai = hoverIdx;
  const ap = ai != null ? points[ai] : null;
  const apx = ai != null ? xv(ai) : 0;
  const apy = ap ? yv(ap.value) : 0;
  const tipLeft = Math.max(0, Math.min(apx - TIP_W / 2, Math.max(0, width - TIP_W)));
  // Prefer BELOW the dot (it never overlaps there); flip above only for
  // low points, anchored by its bottom edge so it clears the dot regardless
  // of the tooltip's own height.
  const tipV = apy <= height / 2 ? { top: apy + TIP_GAP } : { bottom: height - apy + TIP_GAP };
  return (
    <View style={{ width, height, position: 'relative' }}>
      {chart}
      {points.map((p, i) => (
        <Pressable
          key={`hit${i}`}
          onHoverIn={() => setHoverIdx(i)}
          onHoverOut={() => setHoverIdx((c) => (c === i ? null : c))}
          style={{ position: 'absolute', left: xv(i) - HIT / 2, top: yv(p.value) - HIT / 2, width: HIT, height: HIT }}
        />
      ))}
      {ap ? (
        <View
          pointerEvents="none"
          style={{ position: 'absolute', left: tipLeft, ...tipV, width: TIP_W, alignItems: 'center', backgroundColor: t.elevated, borderWidth: 1, borderColor: t.line, borderRadius: 10, paddingVertical: 7, paddingHorizontal: 10, boxShadow: t.shadow }}
        >
          <Txt weight={700} size={13}>{fmtValue ? fmtValue(ap.value) : `${numLabel(ap.value)}${unit ? ` ${unit}` : ''}`}</Txt>
          {fmtHoverDate ? <Txt weight={500} size={11.5} color={t.faint} style={{ marginTop: 1 }}>{fmtHoverDate(ap.t)}</Txt> : null}
        </View>
      ) : null}
    </View>
  );
}
