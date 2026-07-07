import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';

import { hexA } from '@/lib/color';
import { fontFamily } from '@/theme/fonts';
import { useTheme } from '@/theme/useTheme';
import type { TrendPoint } from './compute';
import type { Band } from './norms';

export function TrendChart({ points, band, color, ruleOfThumb, yTicks, fmtY, width, xMode = 'index', xStartLabel = 'Start', xEndLabel = 'Today', xTicks, fmtX, dots = 'last' }: {
  points: TrendPoint[]; band: Band | null; color: string; ruleOfThumb?: boolean;
  yTicks: number[]; fmtY: (v: number) => string; width: number;
  xMode?: 'index' | 'time'; xStartLabel?: string; xEndLabel?: string;
  xTicks?: number[]; fmtX?: (t: number) => string; dots?: 'all' | 'last';
}) {
  const t = useTheme();
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

  return (
    <Svg width={width} height={height}>
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
      <Path d={line} fill="none" stroke={color} strokeWidth={2.4} strokeLinecap="round" strokeLinejoin="round" />
      {dots === 'all' ? (
        points.map((p, i) => (
          <Circle key={`d${i}`} cx={xv(i)} cy={yv(p.value)} r={dotR} fill={color} stroke={t.surface} strokeWidth={1.4} />
        ))
      ) : points.length ? (
        <Circle cx={xv(points.length - 1)} cy={yv(points[points.length - 1].value)} r={3.6} fill={color} stroke={t.surface} strokeWidth={1.8} />
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
}
