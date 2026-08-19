import Svg, { Circle, Path } from 'react-native-svg';

import type { TrendPoint } from '@/features/insights/compute';

/** Minimal progression line for the Growth overview cards: no axes, ticks or labels,
 *  just the curve and a dot on the latest point. */
export function Sparkline({ points, color, width, height = 30 }: {
  points: TrendPoint[]; color: string; width: number; height?: number;
}) {
  if (width <= 0 || points.length < 2) return null;
  const pad = 3;
  const tMin = points[0].t;
  const tMax = points[points.length - 1].t;
  const vals = points.map((p) => p.value);
  const vMin = Math.min(...vals);
  const vMax = Math.max(...vals);
  const tSpan = tMax - tMin;
  const vSpan = vMax - vMin;
  const xv = (p: TrendPoint) => pad + (tSpan > 0 ? (p.t - tMin) / tSpan : 0.5) * (width - pad * 2);
  const yv = (v: number) => pad + (vSpan > 0 ? 1 - (v - vMin) / vSpan : 0.5) * (height - pad * 2);
  const d = points.map((p, i) => `${i ? 'L' : 'M'} ${xv(p).toFixed(1)} ${yv(p.value).toFixed(1)}`).join(' ');
  const last = points[points.length - 1];
  return (
    <Svg width={width} height={height}>
      <Path d={d} fill="none" stroke={color} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      <Circle cx={xv(last)} cy={yv(last.value)} r={2.6} fill={color} />
    </Svg>
  );
}
