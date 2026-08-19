import { useState } from 'react';
import { Pressable, View } from 'react-native';

import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import type { TrendPoint } from '@/features/insights/compute';
import { hexA } from '@/lib/color';
import { MEAS_META } from '@/lib/measurements';
import { fmtValue, unitLabel } from '@/lib/units';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';
import type { MeasurementKind } from '@/types/models';
import { Sparkline } from './Sparkline';

const dateLabel = (ms: number) => new Date(ms).toLocaleDateString();

export function MetricCard({ kind, points, onPress }: {
  kind: MeasurementKind; points: TrendPoint[]; onPress: () => void;
}) {
  const t = useTheme();
  const unitSystem = useAppStore((s) => s.unitSystem);
  const meta = MEAS_META[kind];
  const unit = unitLabel(kind, unitSystem);
  const [w, setW] = useState(0);
  // `points` values are canonical metric. The Sparkline is shape-only (it normalizes
  // by min/max, so a linear unit change leaves the curve identical), so only the
  // latest numeric value needs converting to the display unit.
  const latest = points.length ? points[points.length - 1] : null;

  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={latest ? `${meta.label}, view history` : `${meta.label}, add measurement`}
      style={(s) => [
        { width: '47.8%', flexGrow: 1, backgroundColor: t.surface, borderWidth: 1.5, borderColor: t.line, borderRadius: 20, padding: 15, minHeight: 96, cursor: 'pointer' },
        isHovered(s) && { borderColor: hexA(meta.color, 0.5), boxShadow: t.shadow },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7, marginBottom: 10 }}>
        <View style={{ width: 9, height: 9, borderRadius: 99, backgroundColor: meta.color }} />
        <Txt weight={600} size={11.5} color={t.dim} style={{ textTransform: 'uppercase' }}>{meta.short}</Txt>
      </View>
      {latest ? (
        <>
          <View style={{ flexDirection: 'row', alignItems: 'baseline' }}>
            <Txt weight={800} size={24} tracking={-0.4}>{fmtValue(kind, latest.value, unitSystem)}</Txt>
            {unit ? <Txt weight={600} size={13} color={t.dim} style={{ marginLeft: 3 }}>{unit}</Txt> : null}
          </View>
          {points.length >= 2 ? (
            <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ marginTop: 8, height: 30 }}>
              <Sparkline points={points} color={meta.color} width={w} height={30} />
            </View>
          ) : null}
          <Txt weight={500} size={12} color={t.faint} style={{ marginTop: 4 }}>{dateLabel(latest.t)}</Txt>
        </>
      ) : (
        <Txt weight={600} size={13.5} color={meta.color} style={{ marginTop: 4 }}>+ Tap to add</Txt>
      )}
    </Pressable>
  );
}
