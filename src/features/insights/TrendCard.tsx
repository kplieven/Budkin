import { useState } from 'react';
import { Modal, Pressable, View } from 'react-native';

import { Txt } from '@/components/Txt';
import { hexA } from '@/lib/color';
import { useTheme } from '@/theme/useTheme';
import type { TrendPoint } from './compute';
import { bandForRange, type Norm } from './norms';
import { TrendChart } from './TrendChart';

export function TrendCard({ label, color, unit, value, delta, good, caption, norm, birth, points, yTicks, fmtY, width }: {
  label: string; color: string; unit: string; value: string;
  delta?: string; good?: boolean; caption?: string;
  norm: Norm; birth: number; points: TrendPoint[];
  yTicks: number[]; fmtY: (v: number) => string; width: number;
}) {
  const t = useTheme();
  const [info, setInfo] = useState(false);
  const band = bandForRange(norm, birth, points);
  const ruleOfThumb = norm.kind === 'ruleOfThumb';

  return (
    <View style={{ backgroundColor: t.surface, borderWidth: 1.4, borderColor: t.line, borderRadius: 20, padding: 16, marginTop: 12 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
          <View style={{ width: 7, height: 7, borderRadius: 7, backgroundColor: color }} />
          <Txt weight={700} size={11} color={t.dim} style={{ letterSpacing: 0.6, textTransform: 'uppercase' }}>{label}</Txt>
        </View>
        {caption ? (
          <Pressable onPress={() => setInfo(true)} accessibilityRole="button" accessibilityLabel={`${label} typical range info`} style={{ flexDirection: 'row', alignItems: 'center', gap: 5 }}>
            <Txt weight={600} size={11} color={ruleOfThumb ? t.faint : color}>{caption}</Txt>
            <View style={{ width: 15, height: 15, borderRadius: 15, borderWidth: 1.2, borderColor: t.faint, alignItems: 'center', justifyContent: 'center' }}>
              <Txt weight={700} size={9.5} color={t.faint}>i</Txt>
            </View>
          </Pressable>
        ) : null}
      </View>
      <View style={{ flexDirection: 'row', alignItems: 'baseline', gap: 8, marginTop: 8, marginBottom: 6 }}>
        <Txt weight={800} size={24} tracking={-0.4}>{value}</Txt>
        {unit ? <Txt weight={600} size={13} color={t.dim}>{unit}</Txt> : null}
        {delta ? (
          <View style={{ backgroundColor: good ? hexA('#3E9E6E', 0.14) : t.chip, borderRadius: 9, paddingHorizontal: 8, paddingVertical: 2 }}>
            <Txt weight={700} size={11.5} color={good ? '#3E9E6E' : t.faint}>{delta}</Txt>
          </View>
        ) : null}
      </View>
      <TrendChart points={points} band={band} color={color} ruleOfThumb={ruleOfThumb} yTicks={yTicks} fmtY={fmtY} width={width - 32} />

      <Modal visible={info} transparent animationType="fade" onRequestClose={() => setInfo(false)}>
        <View style={{ flex: 1, justifyContent: 'center', padding: 32 }}>
          {/* Scrim is a sibling of the content, not its parent — tapping the
              sheet must not bubble into this Pressable and dismiss it. */}
          <Pressable
            onPress={() => setInfo(false)}
            style={{ position: 'absolute', top: 0, left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(0,0,0,0.35)' }}
          />
          <View style={{ backgroundColor: t.surface, borderRadius: 18, padding: 20, gap: 8 }}>
            <Txt weight={700} size={15}>{label}</Txt>
            <Txt weight={500} size={13} color={t.dim}>Source: {norm.source || '—'}</Txt>
            <Txt weight={500} size={12.5} color={t.faint} style={{ lineHeight: 18 }}>{norm.disclaimer}</Txt>
          </View>
        </View>
      </Modal>
    </View>
  );
}
