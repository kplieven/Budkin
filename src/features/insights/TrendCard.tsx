import { openBrowserAsync } from 'expo-web-browser';
import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Icon } from '@/components/Icon';
import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import { xTicksFor } from '@/features/measurements/growthChart';
import type { TrendPoint } from './compute';
import { bandForRange, type BandStatus, type Norm } from './norms';
import { TrendChart } from './TrendChart';

const fmtDate = (ms: number) => new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

export function TrendCard({ label, color, unit, value, delta, deltaGood, deltaNote, caption, status, norm, birth, points, yTicks, fmtY, fmtValue, width, todaySoFar = false }: {
  label: string; color: string; unit: string; value: string;
  delta?: string; deltaGood?: boolean; deltaNote?: string; caption?: string; status?: BandStatus; todaySoFar?: boolean;
  norm: Norm; birth: number; points: TrendPoint[];
  yTicks: number[]; fmtY: (v: number) => string; fmtValue?: (v: number) => string; width: number;
}) {
  const t = useTheme();
  // Delta pill color is sign-driven: green when the trend improved, red when it
  // regressed. The theme has no danger/negative token, so fall back to a warm red.
  const deltaColor = deltaGood ? '#3E9E6E' : '#C7583F';
  // The "in typical range" chip replaces the static caption when the caller
  // resolves the baby's position against a solid band. "In range" reads as calm
  // reassurance (green + check); out-of-range stays neutral grey, never alarming
  // — a population band is not a target (the ⓘ sheet says so).
  const statusLabel = status === 'in' ? 'In typical range'
    : status === 'below' ? 'Below typical range'
    : status === 'above' ? 'Above typical range' : null;
  const statusColor = status === 'in' ? '#3E9E6E' : t.dim;
  const [info, setInfo] = useState(false);
  const band = bandForRange(norm, birth, points);
  const ruleOfThumb = norm.kind === 'ruleOfThumb';
  const chartW = width - 32;
  // Calendar-nice date ticks across the range (same helper the growth chart
  // uses); it adapts the label from day -> month -> year as the span grows.
  const { ticks: xTicks, fmtX } = xTicksFor(points, Math.max(2, Math.min(7, Math.floor((chartW - 36) / 56) + 1)));

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 16, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: color }} />
          <Txt weight={700} size={11} color={t.dim} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</Txt>
        </View>
        {statusLabel || caption ? (
          <Pressable onPress={() => setInfo(true)} accessibilityRole="button" accessibilityLabel={`${label} typical range info`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            {statusLabel ? (
              <>
                {status === 'in' ? <Icon name="check" size={12} color={statusColor} /> : null}
                <Txt weight={700} size={11} color={statusColor}>{statusLabel}</Txt>
              </>
            ) : (
              <Txt weight={600} size={11} color={ruleOfThumb ? t.faint : color}>{caption}</Txt>
            )}
            <View style={{ width: 15, height: 15, borderRadius: 15, borderWidth: 1.2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight={700} size={9.5} color={t.faint}>i</Txt>
            </View>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', flexWrap: 'wrap', gap: 8, marginTop: 8, marginBottom: 6 }}>
        <Txt weight={800} size={24} tracking={-0.4}>{value}</Txt>
        {unit ? <Txt weight={600} size={13} color={t.dim}>{unit}</Txt> : null}
        {todaySoFar ? <Txt weight={500} size={12.5} color={t.faint}>today so far</Txt> : null}
        {delta ? (
          <View style={{ backgroundColor: hexA(deltaColor, 0.14), borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt weight={700} size={11.5} color={deltaColor}>{delta}</Txt>
          </View>
        ) : null}
        {delta && deltaNote ? <Txt weight={500} size={12.5} color={t.faint}>{deltaNote}</Txt> : null}
      </View>
      <TrendChart points={points} band={band} color={color} ruleOfThumb={ruleOfThumb} yTicks={yTicks} fmtY={fmtY} width={chartW} xMode="time" xTicks={xTicks} fmtX={fmtX} dots="all" hover unit={unit} fmtValue={fmtValue} fmtHoverDate={fmtDate} calendarBands dashGaps />

      <Modal visible={info} transparent animationType="fade" onRequestClose={() => setInfo(false)}>
        <View style={{ flex: 1, justifyContent: 'center', alignItems: 'center', padding: 32 }}>
          {/* Scrim is a sibling of the content, not its parent — tapping the
              sheet must not bubble into this Pressable and dismiss it. */}
          <Pressable
            onPress={() => setInfo(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
          />
          <View style={{ backgroundColor: t.surface, borderRadius: 18, padding: 20, gap: 8, width: '100%', maxWidth: 380 }}>
            <Txt weight={700} size={15}>{label}</Txt>
            {norm.source ? (
              <Txt weight={500} size={13} color={t.dim}>
                Source:{' '}
                {norm.sourceUrl ? (
                  <Txt
                    weight={600}
                    size={13}
                    color={color}
                    style={{ textDecorationLine: 'underline' }}
                    accessibilityRole="link"
                    onPress={() => openBrowserAsync(norm.sourceUrl!)}
                  >
                    {norm.source}
                  </Txt>
                ) : (
                  norm.source
                )}
              </Txt>
            ) : null}
            <Txt weight={500} size={12.5} color={t.faint} style={{ lineHeight: 18 }}>{norm.disclaimer}</Txt>
          </View>
        </View>
      </Modal>
    </View>
  );
}
