import { useState } from 'react';
import { router } from 'expo-router';
import { Pressable, ScrollView, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Avatar } from '@/components/Avatar';
import { isHovered } from '@/components/hover';
import { Txt } from '@/components/Txt';
import { MetricCard } from '@/features/measurements/MetricCard';
import { seriesFor } from '@/features/measurements/growthChart';
import { MilestonesView } from '@/features/milestones/MilestonesView';
import { hexA } from '@/lib/color';
import { MEAS_KINDS } from '@/lib/measurements';
import { DesktopPage } from '@/shell/DesktopPage';
import { useDesktopShell } from '@/shell/useDesktopShell';
import { useAppStore } from '@/store/useAppStore';
import { useTheme } from '@/theme/useTheme';

type Segment = 'measurements' | 'milestones';

function SegmentToggle({ value, onChange }: { value: Segment; onChange: (s: Segment) => void }) {
  const t = useTheme();
  const opts: { key: Segment; label: string }[] = [
    { key: 'measurements', label: 'Measurements' },
    { key: 'milestones', label: 'Milestones' },
  ];
  return (
    <View style={{ flexDirection: 'row', gap: 6, backgroundColor: t.chip, borderRadius: 14, padding: 4, marginBottom: 18 }}>
      {opts.map((o) => {
        const active = o.key === value;
        return (
          <Pressable
            key={o.key}
            onPress={() => onChange(o.key)}
            accessibilityRole="button"
            accessibilityState={{ selected: active }}
            style={(s) => [
              {
                flex: 1,
                height: 40,
                borderRadius: 11,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: active ? t.surface : 'transparent',
                borderWidth: 1.5,
                borderColor: active ? hexA(t.primary, 0.35) : 'transparent',
                cursor: 'pointer',
              },
              !active && isHovered(s) && { backgroundColor: t.dark ? 'rgba(255,255,255,0.04)' : 'rgba(0,0,0,0.03)' },
            ]}
          >
            <Txt unselectable weight={700} size={14} color={active ? t.text : t.dim}>
              {o.label}
            </Txt>
          </Pressable>
        );
      })}
    </View>
  );
}

function MeasurementsView() {
  const measurements = useAppStore((s) => s.measurements);
  const openMeasurement = useAppStore((s) => s.openMeasurement);
  return (
    <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 11 }}>
      {MEAS_KINDS.map((kind) => {
        const points = seriesFor(measurements, kind);
        return (
          <MetricCard
            key={kind}
            kind={kind}
            points={points}
            onPress={() =>
              points.length
                ? router.push({ pathname: '/metric/[kind]', params: { kind } })
                : openMeasurement(kind)
            }
          />
        );
      })}
    </View>
  );
}

export default function Growth() {
  const t = useTheme();
  const insets = useSafeAreaInsets();
  const desktop = useDesktopShell();
  const child = useAppStore((s) => s.children.find((c) => c.id === s.selectedChildId));
  const openSwitcher = useAppStore((s) => s.openSwitcher);
  const [segment, setSegment] = useState<Segment>('measurements');

  // Desktop gives Milestones its own sidebar page, so Growth is measurements-only
  // there. On phone there is no room for a 7th tab, so the two share this screen
  // via a segment.
  if (desktop) return <DesktopPage maxWidth={640}><MeasurementsView /></DesktopPage>;

  return (
    <ScrollView
      style={{ flex: 1, backgroundColor: t.bg }}
      contentContainerStyle={{ paddingTop: insets.top + 8, paddingHorizontal: 18, paddingBottom: 24 }}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 2, paddingTop: 4, paddingBottom: 16 }}>
        <Txt weight={800} size={27} tracking={-0.6}>
          Growth & Development
        </Txt>
        <Pressable
          onPress={openSwitcher}
          accessibilityRole="button"
          accessibilityLabel={child ? `${child.first}, switch child` : 'Switch child'}
          style={(s) => [{ cursor: 'pointer' }, isHovered(s) && { opacity: 0.85 }]}
        >
          <Avatar child={child} size={38} radius={12} fontSize={16} />
        </Pressable>
      </View>
      <SegmentToggle value={segment} onChange={setSegment} />
      {segment === 'measurements' ? <MeasurementsView /> : <MilestonesView />}
    </ScrollView>
  );
}
